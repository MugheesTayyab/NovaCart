"""One customer message in, one answer out: retrieval, precedence and calculation in
code, then exactly one streamed model call through the gateway.

Yields events: meta (what the answer is built from), token (answer text), done (the
final AskResponse-shaped payload). Every failure path ends in a `done` event with a
friendly message; nothing raw reaches the customer.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import asdict
from datetime import date, datetime
from typing import AsyncIterator
from zoneinfo import ZoneInfo

from . import calc as calc_mod
from . import facts as facts_mod
from .gateway import AllProvidersFailed, CallResult
from .precedence import decide
from .prompt import StateFilter, build_messages, check_citations, estimate_tokens, evidence_block, parse_state

log = logging.getLogger("pipeline")

CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏  ﻿]")
STATUSES = ("answered", "partial", "not_covered", "needs_info", "conflict")
REGION_LABEL = {
    "metro": "a Metro city",
    "rest_of_pakistan": "Rest of Pakistan",
    "remote": "a Remote area",
    "international": "international",
    "unserved": "a country NovaCart does not serve",
}


def _reply(text: str, status: str = "unavailable", **meta) -> dict:
    return {
        "status": status,
        "answer": text,
        "sources": [],
        "calculation": [],
        "rule_order": [],
        "clarifying_question": None,
        "not_covered_parts": [],
        "meta": meta,
    }


def _slots(f: facts_mod.Facts) -> dict:
    out: dict = {}
    if f.region:
        out["region"] = f"{f.location}, {REGION_LABEL[f.region]}" if f.location else REGION_LABEL[f.region]
    if f.category:
        out["category"] = f.category.capitalize()
    if f.seller:
        out["seller"] = "Marketplace seller" if f.seller == "marketplace" else "Sold by NovaCart"
    if f.order_date:
        out["order date"] = f.order_date
    if f.delivery_date:
        out["delivery date"] = f.delivery_date
    if f.payment_method:
        out["payment"] = f.payment_method.capitalize()
    if f.promo_codes:
        out["promo code"] = ", ".join(f.promo_codes)
    if f.items:
        out["items"] = ", ".join(f"{i.name} Rs. {i.price:,}" for i in f.items)
    if f.condition:
        out["condition"] = f.condition.replace("_", " ").capitalize()
    if f.reason:
        out["reason"] = "Change of mind" if f.reason == "change_of_mind" else "NovaCart error"
    return out


async def answer(app, session_id: str | None, raw_message: str, client_key: str) -> AsyncIterator[dict]:
    st = app.state
    rid = uuid.uuid4().hex[:12]
    t_start = time.perf_counter()
    timings: dict[str, int] = {}

    def lap(name: str, t: float) -> None:
        timings[name] = round((time.perf_counter() - t) * 1000)

    # ---- service checks ----
    if st.config_problems:
        log.error("chat_not_configured", extra={"request_id": rid})
        yield {"event": "done", "data": _reply(
            "The answer service is not configured yet, so I can't answer right now. Please try again later.",
            request_id=rid)}
        return
    if st.loading:
        yield {"event": "done", "data": _reply(
            "The help desk is starting up. Please send your question again in a few seconds.", request_id=rid)}
        return
    store = st.store
    if store is None or not store.ready:
        yield {"event": "done", "data": _reply(
            "The store policies are unavailable at the moment, so I can't answer policy questions. "
            "Please try again later.", request_id=rid)}
        return
    if not st.limiter.allow(client_key):
        log.warning("rate_limited", extra={"request_id": rid})
        yield {"event": "done", "data": _reply(
            "You're sending messages faster than I can answer. Please wait a moment and try again.", request_id=rid)}
        return

    message = CONTROL.sub("", raw_message or "").strip()
    if not message:
        yield {"event": "done", "data": _reply("Please type your question about a NovaCart order or policy.",
                                               status="needs_info", request_id=rid)}
        return
    if len(message) > st.settings.max_message_chars:
        yield {"event": "done", "data": _reply(
            f"That message is too long for me. Please keep it under {st.settings.max_message_chars} characters, "
            "with the main question first.", status="needs_info", request_id=rid)}
        return

    session = st.sessions.get(session_id)

    # ---- facts ----
    t = time.perf_counter()
    today = datetime.now(ZoneInfo(st.settings.timezone)).date()
    f = session.facts
    facts_mod.extract(message, today, f)
    facts_mod.extract_codes(message, set(store.promo_codes), f)
    contact = date.fromisoformat(f.contact_date)
    lap("facts", t)

    # ---- retrieval ----
    t = time.perf_counter()
    ev, cache_hit = st.retriever.retrieve(message, f)
    lap("retrieval", t)

    # ---- precedence ----
    t = time.perf_counter()
    ap = decide(store, ev.ids, f, contact)
    ids = [i for i in ev.ids if i not in ap.excluded]
    why = dict(ev.why)  # the retrieval result is cached; never modify it
    lap("precedence", t)

    # ---- calculation ----
    t = time.perf_counter()
    try:
        calc = calc_mod.run(store, f, contact, message)
    except Exception:
        log.exception("calculation_failed", extra={"request_id": rid})
        calc = None
    calc_dict = calc.to_dict() if calc else None
    lap("calculation", t)

    # The rules behind each precedence decision and each calculation step are required
    # evidence: the answer cites them.
    for ref in [d.rule for d in ap.decisions] + (calc.rules if calc else []):
        for sec in store.expand(ref):
            if sec.id not in ids and sec.id not in ap.excluded:
                ids.append(sec.id)
                why.setdefault(sec.id, "rule used by code")

    decisions = merge_decisions([asdict(d) for d in ap.decisions])
    history = list(session.history)[-2 * st.settings.chat_history_turns:] if st.settings.chat_history_turns else []
    messages = build_messages(
        question=message,
        facts={**f.public(), "contact_date": f.contact_date},
        history=history,
        evidence=evidence_block(store, ids, ap.status),
        decisions=decisions,
        calculation=calc_dict,
    )
    est = estimate_tokens(messages)
    if est > st.settings.max_input_tokens:
        log.info("evidence_over_budget", extra={"request_id": rid, "tokens_est": est, "sections": len(ids)})
        yield {"event": "done", "data": _reply(
            "Your question touches a lot of policies at once. Could you ask about one thing at a time, for example "
            "the refund amount, the return window or the shipping fee?", status="needs_info", request_id=rid)}
        return

    supplied = set(ids)
    meta = {
        "request_id": rid,
        "session_id": session.id,
        "contact_date": f.contact_date,
        "slots": _slots(f),
        "evidence": [{"id": store.by_id[i].short, "status": ap.status.get(i, "applies"), "why": why[i]} for i in ids],
        "decisions": decisions,
        "cache_hit": cache_hit,
    }
    yield {"event": "meta", "data": meta}

    # ---- the one model call ----
    t = time.perf_counter()
    call = CallResult()
    filt = StateFilter()
    text_parts: list[str] = []
    failed = False
    try:
        async for chunk in st.gateway.stream_answer(messages, call):
            out = filt.feed(chunk)
            if out:
                text_parts.append(out)
                yield {"event": "token", "data": out}
        tail = filt.flush()
        if tail:
            text_parts.append(tail)
            yield {"event": "token", "data": tail}
    except AllProvidersFailed:
        failed = True
    lap("llm", t)

    if failed:
        listed = "\n".join(
            f"- [{store.by_id[i].filename}, Section {store.by_id[i].num}] {store.by_id[i].heading}"
            for i in ids if ap.status.get(i, "applies") == "applies" and why[i] != "file 00 interpretation"
        )[:3000]
        result_line = ""
        if calc and calc.status == "ok" and calc.result:
            last = calc.steps[-1]
            result_line = f"\n\nCalculated from the policies: {last.label} {calc.result}."
        text = (
            "The full answer is temporarily unavailable. These policy sections cover your question:\n\n"
            f"{listed}{result_line}"
        )
        payload = _reply(text, status="unavailable", **meta, degraded=True)
        payload["calculation"] = [_step(s) for s in calc.steps] if calc and calc.status == "ok" else []
        log.warning("answer_degraded", extra={"request_id": rid, "timings": timings})
        yield {"event": "done", "data": payload}
        return

    raw_answer = "".join(text_parts).strip()
    if call.interrupted:
        note = "\n\n(The answer was interrupted. Please send your question again.)"
        raw_answer += note
        yield {"event": "token", "data": note}

    state = parse_state(filt.hidden) or {}
    rejected = facts_mod.apply_model_updates(f, state.get("facts") or {})
    if rejected:
        log.info("model_fact_updates_rejected", extra={"request_id": rid, "keys": rejected})
    answer_text, flagged, cited = check_citations(raw_answer, supplied, store)
    if flagged:
        log.warning("citations_not_in_evidence", extra={"request_id": rid, "count": len(flagged)})

    status = state.get("status") if state.get("status") in STATUSES else ("partial" if call.interrupted else "answered")
    clarifying = state.get("clarifying_question") if isinstance(state.get("clarifying_question"), str) else None
    not_covered = [p for p in (state.get("not_covered_parts") or []) if isinstance(p, str)][:5]
    notices = [d["reason"] + f" [file {d['rule'][:2]}, Section {d['rule'][3:]}]"
               for d in decisions if d["rule"] in ("00#4.2", "00#4.4")]

    session.history.append(("Customer", message))
    session.history.append(("Desk", answer_text))

    payload = {
        "status": status,
        "answer": answer_text,
        "sources": cited,
        "calculation": [_step(s) for s in calc.steps] if calc and calc.status == "ok" else [],
        "rule_order": [{"rule": d["rule"], "reason": d["reason"]} for d in decisions],
        "clarifying_question": clarifying if status == "needs_info" else None,
        "not_covered_parts": not_covered,
        "meta": {
            **meta,
            "latency_ms": round((time.perf_counter() - t_start) * 1000),
            "tokens": (call.input_tokens or 0) + (call.output_tokens or 0) or None,
            "model_route": [f"{call.provider}:{call.model}"] + (["fallback"] if call.fallback_used else []),
            "fallback_used": call.fallback_used,
            "interrupted": call.interrupted,
            "flagged_citations": flagged,
            "notices": notices,
            "calc_status": calc.status if calc else None,
            "timings_ms": timings,
        },
    }
    log.info(
        "answer_done",
        extra={
            "request_id": rid,
            "status": status,
            "sections": len(ids),
            "tokens_est": est,
            "cache_hit": cache_hit,
            "calc": calc.kind if calc else None,
            "provider": call.provider,
            "fallback_used": call.fallback_used,
            "timings_ms": timings,
        },
    )
    yield {"event": "done", "data": payload}


def merge_decisions(decisions: list[dict]) -> list[dict]:
    """One line per (rule, outcome, files kept, files set aside): '01 over 02' once, not per topic."""
    merged: dict[tuple, dict] = {}
    for d in decisions:
        key = (d["rule"], d["outcome"], tuple(sorted({a[:2] for a in d["applies"]})),
               tuple(sorted({x[:2] for x in d["set_aside"]})), d["reason"] if d["outcome"] != "resolved" else "")
        if d["outcome"] == "resolved":
            key = (d["rule"], d["outcome"], key[2], key[3], "")
        if key in merged:
            m = merged[key]
            if d["topic"] not in m["topic"]:
                m["topic"] += f"; {d['topic']}"
            m["applies"] = sorted(set(m["applies"]) | set(d["applies"]))
            m["set_aside"] = sorted(set(m["set_aside"]) | set(d["set_aside"]))
        else:
            merged[key] = dict(d)
    return list(merged.values())


def _step(s) -> dict:
    return {"label": s.label, "formula": s.formula, "result": s.result, "rule": s.rule}
