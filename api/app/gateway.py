"""LLM gateway. Every model call in the service goes through `Gateway.stream_answer`.

- One primary and one fallback provider, both OpenAI-compatible chat completions,
  chosen by configuration only.
- A successful answer is exactly one model call. Retries and failover happen only
  before the first token reaches the customer; after that the stream either finishes
  or ends with a short "interrupted" note. Two providers never share one message.
- Fails over on 429, 5xx, timeouts, connection errors, 401/403 and model-not-found.
  A 400 caused by our own request is not retried and does not fail over.
- Honours Retry-After, otherwise exponential backoff with jitter, capped by
  LLM_MAX_RETRIES and by the remaining request time.
- A semaphore caps concurrent calls; a simple circuit breaker sends traffic to the
  fallback for a cool-down after repeated primary failures.
- Logs provider, model, latency, tokens, retries, fallback and error class. Never
  keys, headers or message content.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx

from .config import ProviderConfig, Settings

log = logging.getLogger("gateway")
USER_AGENT = "novacart-policy-desk/1.0"  # some providers reject requests without one


class GatewayError(Exception):
    def __init__(self, kind: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(kind)
        self.kind = kind  # rate_limit | server | timeout | connection | auth | model_not_found | bad_request | other
        self.status = status
        self.retry_after = retry_after

    @property
    def fail_over(self) -> bool:
        return self.kind != "bad_request"

    @property
    def retryable(self) -> bool:
        return self.kind in ("rate_limit", "server", "timeout", "connection")


class AllProvidersFailed(Exception):
    pass


@dataclass
class CallResult:
    provider: str = ""
    model: str = ""
    latency_ms: int = 0
    first_token_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    retries: int = 0
    fallback_used: bool = False
    interrupted: bool = False
    errors: list[str] = field(default_factory=list)


class CircuitBreaker:
    def __init__(self, threshold: int, cooldown_s: int):
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures = 0
        self.open_until = 0.0

    @property
    def state(self) -> str:
        if self.open_until > time.monotonic():
            return "open"
        return "half_open" if self.failures >= self.threshold else "closed"

    def allow(self) -> bool:
        return self.open_until <= time.monotonic()

    def success(self) -> None:
        self.failures, self.open_until = 0, 0.0

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.open_until = time.monotonic() + self.cooldown_s
            log.warning("circuit_open", extra={"cooldown_s": self.cooldown_s})


def _classify(status: int, body: str) -> GatewayError:
    low = body.lower()
    if status == 429:
        return GatewayError("rate_limit", status)
    if status >= 500:
        return GatewayError("server", status)
    if status in (401, 403):
        return GatewayError("auth", status)
    if status == 404 or "model_not_found" in low or ("model" in low and "not found" in low) or "does not exist" in low:
        return GatewayError("model_not_found", status)
    if status == 400 and "model" in low and ("decommission" in low or "not supported" in low or "invalid model" in low):
        return GatewayError("model_not_found", status)
    if status in (400, 413, 422):
        return GatewayError("bad_request", status)
    return GatewayError("other", status)


def _retry_after(headers: httpx.Headers) -> float | None:
    raw = headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


class Gateway:
    def __init__(self, settings: Settings):
        self.s = settings
        self.sem = asyncio.Semaphore(settings.max_concurrent)
        self.breaker = CircuitBreaker(settings.breaker_threshold, settings.breaker_cooldown_s)
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.request_timeout_s, connect=10.0),
            headers={"User-Agent": USER_AGENT},
        )

    async def close(self) -> None:
        await self.client.aclose()

    def providers(self) -> list[ProviderConfig]:
        out: list[ProviderConfig] = []
        if self.s.primary.configured and self.breaker.allow():
            out.append(self.s.primary)
        if self.s.fallback.configured:
            out.append(self.s.fallback)
        if not out and self.s.primary.configured:  # breaker open and no fallback: still try primary
            out.append(self.s.primary)
        return out

    def health(self) -> dict:
        return {
            "primary": self.s.primary.describe(),
            "fallback": self.s.fallback.describe(),
            "circuit_breaker": self.breaker.state,
            "max_concurrent": self.s.max_concurrent,
        }

    def _body(self, p: ProviderConfig, messages: list[dict]) -> dict:
        body: dict = {
            "model": p.model,
            "messages": messages,
            "temperature": self.s.temperature,
            "max_tokens": self.s.max_output_tokens,
            "stream": True,
        }
        if p.provider in ("groq", "openai", "openrouter"):
            body["stream_options"] = {"include_usage": True}
        # Reasoning models on Groq: keep reasoning short; it arrives outside the content field.
        if p.provider == "groq" and "gpt-oss" in p.model:
            body["reasoning_effort"] = "low"
        return body

    async def stream_answer(self, messages: list[dict], result: CallResult) -> AsyncIterator[str]:
        """Yields text chunks of one answer. Fills `result` as it goes.

        Raises AllProvidersFailed if no provider produced a first token. If a stream
        breaks after the first token, it stops and sets result.interrupted.
        """
        t0 = time.monotonic()
        deadline = t0 + self.s.request_timeout_s
        providers = self.providers()
        if not providers:
            raise AllProvidersFailed("no provider configured")
        async with self.sem:
            for n, p in enumerate(providers):
                result.fallback_used = p.role == "fallback"
                attempt = 0
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 1:
                        result.errors.append(f"{p.role}:out_of_time")
                        break
                    try:
                        started = False
                        async for chunk in self._stream_once(p, messages, result, t0, remaining):
                            started = True
                            yield chunk
                        if p.role == "primary":
                            self.breaker.success()
                        result.provider, result.model = p.provider, p.model
                        result.latency_ms = round((time.monotonic() - t0) * 1000)
                        self._log(result, "llm_call_ok")
                        return
                    except _Interrupted:
                        result.provider, result.model = p.provider, p.model
                        result.interrupted = True
                        result.latency_ms = round((time.monotonic() - t0) * 1000)
                        self._log(result, "llm_stream_interrupted")
                        return
                    except GatewayError as e:
                        result.errors.append(f"{p.role}:{e.kind}")
                        if p.role == "primary" and e.kind != "bad_request":
                            self.breaker.failure()
                        if not e.fail_over:
                            log.error("llm_bad_request", extra={"provider": p.provider, "status": e.status})
                            raise AllProvidersFailed("bad request")
                        if e.retryable and attempt < self.s.max_retries:
                            wait = e.retry_after if e.retry_after is not None else min(8.0, 0.5 * 2**attempt)
                            wait = wait * (0.75 + random.random() * 0.5) if e.retry_after is None else wait
                            if time.monotonic() + wait >= deadline - 1:
                                break  # waiting would use up the request; go to the fallback
                            attempt += 1
                            result.retries += 1
                            await asyncio.sleep(wait)
                            continue
                        break
        result.latency_ms = round((time.monotonic() - t0) * 1000)
        self._log(result, "llm_all_providers_failed")
        raise AllProvidersFailed(",".join(result.errors))

    async def _stream_once(
        self, p: ProviderConfig, messages: list[dict], result: CallResult, t0: float, remaining: float
    ) -> AsyncIterator[str]:
        url = f"{p.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {p.api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(remaining, connect=min(10.0, remaining))
        sent_any = False
        try:
            async with self.client.stream("POST", url, json=self._body(p, messages), headers=headers, timeout=timeout) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode("utf-8", "replace")[:500]
                    err = _classify(r.status_code, body)
                    err.retry_after = _retry_after(r.headers)
                    raise err
                lines = r.aiter_lines()
                first_deadline = self.s.first_token_timeout_s
                while True:
                    try:
                        if not sent_any:
                            line = await asyncio.wait_for(lines.__anext__(), timeout=first_deadline)
                        else:
                            line = await lines.__anext__()
                    except StopAsyncIteration:
                        break
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(chunk, dict) and chunk.get("error"):
                        raise GatewayError("server")
                    usage = chunk.get("usage") or (chunk.get("x_groq") or {}).get("usage")
                    if usage:
                        result.input_tokens = usage.get("prompt_tokens", result.input_tokens)
                        result.output_tokens = usage.get("completion_tokens", result.output_tokens)
                    for choice in chunk.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            if not sent_any:
                                result.first_token_ms = round((time.monotonic() - t0) * 1000)
                            sent_any = True
                            yield text
        except GatewayError:
            if sent_any:
                raise _Interrupted()
            raise
        except asyncio.TimeoutError:
            if sent_any:
                raise _Interrupted()
            raise GatewayError("timeout")
        except httpx.TimeoutException:
            if sent_any:
                raise _Interrupted()
            raise GatewayError("timeout")
        except httpx.TransportError:
            if sent_any:
                raise _Interrupted()
            raise GatewayError("connection")
        if not sent_any:
            raise GatewayError("server")  # an empty answer counts as a provider failure

    def _log(self, r: CallResult, event: str) -> None:
        log.info(
            event,
            extra={
                "provider": r.provider or None,
                "model": r.model or None,
                "latency_ms": r.latency_ms,
                "first_token_ms": r.first_token_ms,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "retries": r.retries,
                "fallback_used": r.fallback_used,
                "errors": r.errors,
            },
        )


class _Interrupted(Exception):
    """The stream broke after tokens were already sent."""
