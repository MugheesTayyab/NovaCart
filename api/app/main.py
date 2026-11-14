"""Policy Desk answer service.

Run from the api/ folder:  uvicorn app.main:app --host 0.0.0.0 --port 8000

Endpoints
- GET  /health        service, policy index, provider and circuit-breaker status (no secrets)
- POST /chat/stream   {message, session_id?} -> Server-Sent Events: meta, token..., done
- POST /ask           {question, session_id?} -> the same answer as one JSON object
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import pipeline
from .config import load_settings, validate
from .gateway import Gateway
from .logging_setup import setup_logging
from .policies.store import PolicyStore
from .retrieval import Retriever
from .sessions import RateLimiter, SessionStore

settings = load_settings()
setup_logging(settings.log_level)
SERVERLESS = bool(os.environ.get("VERCEL"))
log = logging.getLogger("app")


async def _build_index(app: FastAPI) -> None:
    try:
        store = await asyncio.to_thread(PolicyStore.build, settings.policy_dir, settings.index_cache_dir)
        app.state.store = store
        app.state.retriever = Retriever(store, settings.retrieval_cache_size)
    except Exception:
        log.exception("policy_index_failed")
        app.state.store = None
    finally:
        app.state.loading = False


def _init_state(app: FastAPI) -> None:
    app.state.settings = settings
    app.state.config_problems = validate(settings)
    for p in app.state.config_problems:
        log.error("config_problem", extra={"detail": p})
    log.info("config_loaded", extra=settings.describe())
    app.state.gateway = Gateway(settings)
    app.state.sessions = SessionStore(settings.session_ttl_s, settings.max_sessions)
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.store = None
    app.state.retriever = None
    app.state.loading = True


_ready_lock = asyncio.Lock()


async def ensure_ready(app: FastAPI) -> None:
    """Serverless hosts (Vercel) may not run the startup hook, and may freeze background
    tasks between requests. There the first request sets up state and builds the index
    itself (22 files, well under a second)."""
    if getattr(app.state, "gateway", None) is not None and not (SERVERLESS and app.state.loading):
        return
    async with _ready_lock:
        if getattr(app.state, "gateway", None) is None:
            _init_state(app)
        if app.state.loading:
            await _build_index(app)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_state(app)
    task = None
    if SERVERLESS:
        await _build_index(app)
    else:
        # The index is built before the first chat answer; requests that arrive while it is
        # loading get a short "starting up" reply instead of an error.
        task = asyncio.create_task(_build_index(app))
    yield
    if task:
        task.cancel()
    await app.state.gateway.close()


app = FastAPI(title="Policy Desk answer service", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    max_age=600,
)


class ChatIn(BaseModel):
    message: str = Field(default="", max_length=20000)
    session_id: str | None = Field(default=None, max_length=64)


class AskIn(BaseModel):
    question: str = Field(default="", max_length=20000)
    session_id: str | None = Field(default=None, max_length=64)


def _client_key(request: Request, session_id: str | None) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"s:{session_id}" if session_id else f"ip:{ip}"


@app.get("/")
async def root() -> dict:
    return {
        "service": "Policy Desk answer service",
        "endpoints": {
            "GET /health": "status of the policy index and model providers",
            "POST /ask": '{"question": "...", "session_id": "optional"} -> one JSON answer',
            "POST /chat/stream": '{"message": "...", "session_id": "optional"} -> Server-Sent Events',
        },
    }


@app.get("/health")
async def health() -> dict:
    await ensure_ready(app)
    st = app.state
    store = st.store
    ok = not st.config_problems and store is not None and store.ready and not st.loading
    return {
        "status": "ok" if ok else ("starting" if st.loading else "degraded"),
        "chat_enabled": ok,
        "config_problems": st.config_problems,
        "policies": {
            "loaded": len(store.docs) if store else 0,
            "sections": len(store.sections) if store else 0,
            "corpus_hash": store.corpus_hash if store else None,
            "index_ready": bool(store and store.ready),
            "unresolved_cross_references": len(store.unresolved_refs) if store else None,
            "registry_ids_not_found": len(store.unknown_registry_ids) if store else None,
        },
        "llm": st.gateway.health(),
        "sessions": len(st.sessions),
    }


@app.post("/chat/stream")
async def chat_stream(body: ChatIn, request: Request) -> StreamingResponse:
    await ensure_ready(app)
    key = _client_key(request, body.session_id)

    async def events():
        try:
            async for ev in pipeline.answer(app, body.session_id, body.message, key):
                yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"
        except Exception:
            log.exception("chat_stream_failed")
            data = pipeline._reply("Something went wrong on our side. Please send your question again.")
            yield f"event: done\ndata: {json.dumps(data)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/ask")
async def ask(body: AskIn, request: Request) -> JSONResponse:
    await ensure_ready(app)
    key = _client_key(request, body.session_id)
    final = None
    try:
        async for ev in pipeline.answer(app, body.session_id, body.question, key):
            if ev["event"] == "done":
                final = ev["data"]
    except Exception:
        log.exception("ask_failed")
    if final is None:
        final = pipeline._reply("Something went wrong on our side. Please send your question again.")
    return JSONResponse(final)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_error")
    return JSONResponse({"status": "unavailable", "answer": "Something went wrong on our side. Please try again."},
                        status_code=500)
