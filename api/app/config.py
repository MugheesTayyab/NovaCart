"""Configuration, read once from environment variables at startup.

Keys are never logged. `describe()` returns a redacted view for /health and logs.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

API_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = API_DIR.parent

# A local .env at the repository root or in api/ is loaded if present. Real
# environment variables always win, so Docker and hosting settings take priority.
for candidate in (REPO_ROOT / ".env", API_DIR / ".env"):
    if candidate.is_file():
        load_dotenv(candidate, override=False)

log = logging.getLogger("config")

# OpenAI-compatible base URLs for providers we know. *_BASE_URL overrides these.
KNOWN_BASE_URLS = {
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
}


def _get(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return value.strip() if value is not None and value.strip() != "" else default


def _int(name: str, default: int) -> int:
    raw = _get(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        log.warning("config_invalid_int", extra={"var": name})
        return default


def _float(name: str, default: float) -> float:
    raw = _get(name)
    try:
        return float(raw) if raw else default
    except ValueError:
        log.warning("config_invalid_float", extra={"var": name})
        return default


@dataclass(frozen=True)
class ProviderConfig:
    role: str  # "primary" or "fallback"
    provider: str
    api_key: str = field(repr=False)
    base_url: str
    model: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model and self.base_url)

    def describe(self) -> dict:
        return {
            "provider": self.provider or None,
            "model": self.model or None,
            "configured": self.configured,
        }


def _provider(prefix: str, role: str) -> ProviderConfig:
    provider = _get(f"{prefix}_LLM_PROVIDER").lower()
    base_url = _get(f"{prefix}_LLM_BASE_URL") or KNOWN_BASE_URLS.get(provider, "")
    return ProviderConfig(
        role=role,
        provider=provider,
        api_key=_get(f"{prefix}_LLM_API_KEY"),
        base_url=base_url.rstrip("/"),
        model=_get(f"{prefix}_LLM_MODEL"),
    )


@dataclass(frozen=True)
class Settings:
    primary: ProviderConfig
    fallback: ProviderConfig
    temperature: float
    max_output_tokens: int
    max_input_tokens: int
    request_timeout_s: float
    first_token_timeout_s: float
    max_retries: int
    max_concurrent: int
    policy_dir: Path
    index_cache_dir: Path
    retrieval_cache_size: int
    chat_history_turns: int
    allowed_origins: list[str]
    log_level: str
    timezone: str
    # Service limits (not in .env.example; sensible defaults, overridable).
    max_message_chars: int = 2000
    rate_limit_per_minute: int = 20
    session_ttl_s: int = 1800
    max_sessions: int = 5000
    breaker_threshold: int = 3
    breaker_cooldown_s: int = 60

    def describe(self) -> dict:
        return {
            "primary": self.primary.describe(),
            "fallback": self.fallback.describe(),
            "policy_dir": str(self.policy_dir),
            "max_input_tokens": self.max_input_tokens,
            "timezone": self.timezone,
        }


def load_settings() -> Settings:
    policy_dir = Path(_get("POLICY_DIR") or (REPO_ROOT / "policies"))
    if not policy_dir.is_absolute():
        policy_dir = (REPO_ROOT / policy_dir).resolve()
    cache_dir = Path(_get("INDEX_CACHE_DIR", ".cache/policy_index"))
    if not cache_dir.is_absolute():
        cache_dir = (API_DIR / cache_dir).resolve()
    origins = [o.strip() for o in _get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    return Settings(
        primary=_provider("PRIMARY", "primary"),
        fallback=_provider("FALLBACK", "fallback"),
        temperature=_float("LLM_TEMPERATURE", 0.0),
        max_output_tokens=_int("LLM_MAX_OUTPUT_TOKENS", 800),
        # Groq's free tier allows about 8,000 tokens per minute on gpt-oss-120b, so the
        # default keeps one request (input + output) well under that.
        max_input_tokens=_int("LLM_MAX_INPUT_TOKENS", 5500),
        request_timeout_s=_float("LLM_REQUEST_TIMEOUT_SECONDS", 30.0),
        first_token_timeout_s=_float("LLM_FIRST_TOKEN_TIMEOUT_SECONDS", 10.0),
        max_retries=_int("LLM_MAX_RETRIES", 2),
        max_concurrent=max(1, _int("LLM_MAX_CONCURRENT_REQUESTS", 3)),
        policy_dir=policy_dir,
        index_cache_dir=cache_dir,
        retrieval_cache_size=max(0, _int("RETRIEVAL_CACHE_SIZE", 512)),
        chat_history_turns=max(0, _int("CHAT_HISTORY_TURNS", 4)),
        allowed_origins=origins,
        log_level=_get("LOG_LEVEL", "INFO").upper(),
        timezone=_get("APP_TIMEZONE", "Asia/Karachi"),
        max_message_chars=_int("MAX_MESSAGE_CHARS", 2000),
        rate_limit_per_minute=_int("RATE_LIMIT_PER_MINUTE", 20),
    )


def validate(settings: Settings) -> list[str]:
    """Returns problems that disable chat. Logs a warning for a missing fallback."""
    problems: list[str] = []
    if not settings.primary.configured:
        missing = [
            n
            for n, v in (
                ("PRIMARY_LLM_API_KEY", settings.primary.api_key),
                ("PRIMARY_LLM_MODEL", settings.primary.model),
                ("PRIMARY_LLM_BASE_URL or a known PRIMARY_LLM_PROVIDER", settings.primary.base_url),
            )
            if not v
        ]
        problems.append("primary LLM not configured: missing " + ", ".join(missing))
    if not settings.fallback.configured:
        log.warning("fallback_not_configured", extra={"detail": "running with the primary provider only"})
    return problems
