"""
LLM Service — async query functions for ChatGPT, Claude, Perplexity, and Gemini.

Each function returns a dict:
    {
        "response_text": str | None,
        "mentioned":     bool,
        "latency_ms":    int,
        "error":         str | None,
    }
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import time

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ── Per-model rate limiting ──────────────────────────────────────────────────
# Semaphores limit concurrency; _RatePacer adds a minimum gap between requests
# so we never burst past a provider's per-minute quota even under high concurrency.

class _RatePacer:
    """Enforce a minimum interval between requests to a single provider."""
    __slots__ = ("_lock", "_min_gap", "_last")

    def __init__(self, requests_per_minute: float):
        self._lock = asyncio.Lock()
        self._min_gap = 60.0 / requests_per_minute
        self._last = 0.0

    async def wait(self):
        async with self._lock:
            now = time.monotonic()
            wait = self._min_gap - (now - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()


# Perplexity: 2 concurrent + paced to 20 RPM (1 every 3s).
# The pacer is the primary rate guard; the semaphore just caps in-flight
# requests so we overlap response waits without exceeding RPM.
_PERPLEXITY_SEM = asyncio.Semaphore(2)
_PERPLEXITY_PACER = _RatePacer(20)

# Claude rate-limit guard: Anthropic enforces 50 req/min on claude-haiku.
# With ~2-3s per call, 3 concurrent slots ≈ 60-90 req/min at peak.
# Combined with the 65s retry backoff for 429s, this keeps us under the limit.
_CLAUDE_SEM = asyncio.Semaphore(3)

# Gemini rate-limit guard: Google returns 503 UNAVAILABLE when flooded.
# 2 concurrent slots (like Perplexity) reduce burst pressure on the API.
_GEMINI_SEM = asyncio.Semaphore(2)


# Human-readable display names for each model (used in placeholder messages)
_MODEL_DISPLAY_NAMES = {
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
}


def _api_key_placeholder(model: str) -> dict:
    """Return a placeholder result when an API key is not configured."""
    display = _MODEL_DISPLAY_NAMES.get(model, model)
    return {
        "response_text": (
            f"[{display} API key not configured. "
            "Add your API key in Settings → Connected Accounts to enable this model.]"
        ),
        "mentioned": False,
        "latency_ms": 0,
        "error": "api_key_not_configured",
    }

TIER_RUNS = {
    "basic": 3,
    "standard": 3,
    "premium": 3,
}

# Model categories for the dual-score visibility architecture.
# LIVE_MODELS  — query the web in real-time; reflect content changes within days.
# INDEX_MODELS — static training data; change slowly, reflect long-term presence.
LIVE_MODELS: frozenset = frozenset({"perplexity", "gemini"})
INDEX_MODELS: frozenset = frozenset({"chatgpt", "claude"})

# Model versions per subscription tier.
# Default = Starter/free users; Pro = paid Pro subscribers.
# Only LIVE_MODELS (perplexity, gemini) get upgraded — they query the web,
# so better models = better brand detection.  INDEX_MODELS (chatgpt, claude)
# use static training data; upgrading them doesn't improve visibility.
_MODEL_VERSIONS: dict[str, dict[str, str]] = {
    "chatgpt":    {"default": "gpt-4.1-mini",              "pro": "gpt-4o-mini-search-preview"},
    "claude":     {"default": "claude-haiku-4-5-20251001",  "pro": "claude-haiku-4-5-20251001"},
    "perplexity": {"default": "sonar",                      "pro": "sonar-pro"},
    "gemini":     {"default": "gemini-2.5-flash",           "pro": "gemini-2.5-flash"},
}


def _get_model_version(model_key: str, pro: bool = False) -> str:
    """Return the API model ID for the given model key and subscription tier."""
    versions = _MODEL_VERSIONS.get(model_key)
    if versions is None:
        return model_key
    return versions["pro"] if pro else versions["default"]


def _mentioned(brand_name: str, text: str) -> bool:
    """Case-insensitive substring check."""
    return brand_name.lower() in text.lower()


def _build_result(
    response_text: str | None,
    brand_name: str,
    latency_ms: int,
    error: str | None = None,
) -> dict:
    mentioned = _mentioned(brand_name, response_text) if response_text else False
    return {
        "response_text": response_text,
        "mentioned": mentioned,
        "latency_ms": latency_ms,
        "error": error,
    }


# ── Citation stripping (used by search-model responses) ──────────────────────
# Patterns for stripping citation noise from search-model responses.
# Applied BEFORE mention-detection so brand names hidden in URL hostnames
# (e.g. "stripe.com" in a footer) do not produce false-positive matches.
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_BRACKET_REF_RE = re.compile(r"\[\d+\]")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")  # [text](url) -> text


def _strip_url_citations(text: str) -> str:
    """
    Remove URLs, bracketed numeric refs, and markdown link targets so brand
    mention detection only sees the visible answer text.
    Markdown link text is preserved (so "[Stripe](https://stripe.com)" -> "Stripe").
    """
    if not text:
        return text
    # 1) Markdown links — keep the visible label, drop the URL
    text = _MD_LINK_RE.sub(r"\1", text)
    # 2) Bare URLs — drop entirely
    text = _URL_RE.sub("", text)
    # 3) Bracketed numeric citation markers like [1] [2] — drop
    text = _BRACKET_REF_RE.sub("", text)
    return text


# ── ChatGPT ───────────────────────────────────────────────────────────────────

async def _query_chatgpt(prompt: str, brand_name: str, model_version: str = "gpt-4.1-mini") -> dict:
    if not OPENAI_API_KEY:
        return _api_key_placeholder("chatgpt")
    start = time.monotonic()
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        response = await client.chat.completions.create(
            model=model_version,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=1024,
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = response.choices[0].message.content
        if not text:
            logger.warning(
                "[chatgpt] API returned empty/null content for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from ChatGPT API",
            )
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[chatgpt] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[chatgpt] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Claude ────────────────────────────────────────────────────────────────────

async def _query_claude(prompt: str, brand_name: str, model_version: str = "claude-haiku-4-5-20251001") -> dict:
    if not ANTHROPIC_API_KEY:
        return _api_key_placeholder("claude")
    start = time.monotonic()
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        async with _CLAUDE_SEM:
            response = await client.messages.create(
                model=model_version,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = response.content[0].text if response.content else None
        if not text:
            logger.warning(
                "[claude] API returned empty/null content for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from Claude API",
            )
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[claude] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[claude] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Perplexity ────────────────────────────────────────────────────────────────

_perplexity_client = None  # Module-level singleton — avoids per-request connection churn

def _get_perplexity_client():
    global _perplexity_client
    if _perplexity_client is None:
        from openai import AsyncOpenAI
        _perplexity_client = AsyncOpenAI(
            api_key=PERPLEXITY_API_KEY,
            base_url="https://api.perplexity.ai",
            timeout=45.0,
        )
    return _perplexity_client


async def _query_perplexity(prompt: str, brand_name: str, model_version: str = "sonar") -> dict:
    if not PERPLEXITY_API_KEY:
        return _api_key_placeholder("perplexity")
    start = time.monotonic()
    try:
        client = _get_perplexity_client()
        # Rate-pace then acquire semaphore — prevents bursting past RPM quota.
        await _PERPLEXITY_PACER.wait()
        async with _PERPLEXITY_SEM:
            response = await client.chat.completions.create(
                model=model_version,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1024,
                temperature=0.7,
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = response.choices[0].message.content
        if not text:
            logger.warning(
                "[perplexity] API returned empty/null content for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from Perplexity API",
            )
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[perplexity] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[perplexity] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Gemini ────────────────────────────────────────────────────────────────────

import threading

_gemini_client = None  # Module-level singleton — avoids per-request httpx lifecycle issues
_gemini_lock = threading.Lock()

def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        with _gemini_lock:
            if _gemini_client is None:  # double-checked locking
                from google import genai
                _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


_GEMINI_TIMEOUT = 90.0   # seconds; Flash is the only variant we use


async def _query_gemini(prompt: str, brand_name: str, model_version: str = "gemini-2.5-flash") -> dict:
    if not GEMINI_API_KEY:
        return _api_key_placeholder("gemini")
    start = time.monotonic()
    timeout = _GEMINI_TIMEOUT
    try:
        from google.genai import types

        client = _get_gemini_client()

        # Try with google_search grounding first; fall back to plain call if
        # the model doesn't support the tool (older API versions return
        # "google_search_retrieval is not supported").
        config_with_search = types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        )
        config_plain = types.GenerateContentConfig()

        response = None
        for config in (config_with_search, config_plain):
            try:
                async with _GEMINI_SEM:
                    response = await asyncio.wait_for(
                        client.aio.models.generate_content(
                            model=model_version,
                            contents=prompt,
                            config=config,
                        ),
                        timeout=timeout,
                    )
                break  # success — stop trying configs
            except Exception as inner_exc:
                err_str = str(inner_exc).lower()
                if "google_search" in err_str and config is config_with_search:
                    logger.warning(
                        "[gemini] google_search tool not supported for %s, retrying without it",
                        model_version,
                    )
                    continue  # try plain config
                raise  # re-raise for outer handler

        if response is None:
            latency_ms = int((time.monotonic() - start) * 1000)
            return _build_result(None, brand_name, latency_ms, error="No response from Gemini API")

        text = response.text  # Returns None on safety blocks (no ValueError)
        latency_ms = int((time.monotonic() - start) * 1000)
        if not text:
            # Safety block or empty response — log details for debugging
            finish_reason = "unknown"
            if response.candidates:
                finish_reason = str(getattr(response.candidates[0], "finish_reason", "unknown"))
            logger.warning(
                "[gemini] Empty/blocked response for prompt %r — finish_reason=%s",
                prompt[:100], finish_reason,
            )
            return _build_result(
                None, brand_name, latency_ms,
                error=f"Empty response from Gemini API (finish_reason={finish_reason})",
            )
        logger.debug("[gemini] response preview: %r", text[:200])
        return _build_result(text, brand_name, latency_ms)
    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[gemini] Request timed out after %.0fs for prompt %r", timeout, prompt[:100])
        return _build_result(None, brand_name, latency_ms, error=f"Request timed out ({timeout:.0f}s)")
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[gemini] API error for prompt %r: %s", prompt[:100], exc)
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Public dispatcher ─────────────────────────────────────────────────────────

_DISPATCHERS = {
    "chatgpt": _query_chatgpt,
    "claude": _query_claude,
    "perplexity": _query_perplexity,
    "gemini": _query_gemini,
}

SUPPORTED_MODELS = list(_DISPATCHERS.keys())


def _classify_error(error: str) -> str:
    """Classify an error string for retry strategy."""
    e = error.lower()
    # Check rate-limit indicators FIRST — Perplexity returns HTTP 401 for
    # quota exhaustion ('insufficient_quota'), which must not be treated as a
    # permanent auth failure.  Checking quota/rate keywords before the generic
    # "401" guard ensures mid-run quota hits are retried with backoff.
    if "429" in e or "rate_limit" in e or "rate limit" in e or "insufficient_quota" in e:
        return "rate_limit"
    if "401" in e or "unauthorized" in e or "invalid api key" in e or "invalid_api_key" in e:
        return "auth"  # permanent — bad API key
    if "503" in e or "unavailable" in e or "overloaded" in e or "timed out" in e:
        return "overload"
    return "other"


# Per-model retry budgets.  Rate-limited models (Perplexity) get more attempts
# because a single 429 shouldn't burn the whole query — the pacer will keep us
# under quota on the retry.
_MAX_ATTEMPTS: dict[str, int] = {
    "perplexity": 5,
    "gemini": 4,
}
_DEFAULT_MAX_ATTEMPTS = 3


async def _with_retry(handler, prompt: str, brand_name: str, model_key: str, max_attempts: int = 0, model_version: str = "", cancel_event: asyncio.Event | None = None) -> dict:
    """
    Call handler(prompt, brand_name, model_version) and retry with backoff.

    Retry strategy by error type:
      - rate_limit (429, quota): 30-90s jittered backoff (avoids thundering herd)
      - overload (503, timeout): 5s → 10s backoff + jitter; falls back to lighter model
      - other: 3s flat backoff
      - api_key_not_configured / auth: no retry (permanent)

    If cancel_event is provided and set, retries stop immediately.
    """
    if max_attempts <= 0:
        max_attempts = _MAX_ATTEMPTS.get(model_key, _DEFAULT_MAX_ATTEMPTS)

    display = _MODEL_DISPLAY_NAMES.get(model_key, model_key)
    errors: list[str] = []

    # Track whether we've fallen back to a lighter model for overload errors
    active_model_version = model_version
    _FALLBACK_MODELS = {
        "sonar-pro": "sonar",
    }

    for attempt in range(1, max_attempts + 1):
        # Check for cancellation before each attempt
        if cancel_event is not None and cancel_event.is_set():
            return {"response_text": None, "mentioned": False, "latency_ms": 0, "error": "cancelled"}

        result = await handler(prompt, brand_name, active_model_version)

        # Successful response — return immediately
        if result.get("response_text") and not result.get("error"):
            if attempt > 1:
                logger.info("[%s] Attempt %d succeeded for prompt %r", model_key, attempt, prompt[:100])
            return result

        # api_key_not_configured is permanent — retrying won't help
        if result.get("error") == "api_key_not_configured":
            return result

        error = result.get("error") or "empty response"

        # 401/unauthorized is permanent — invalid API key, no point retrying
        if _classify_error(error) == "auth":
            logger.error("[%s] Authentication failed (invalid API key?) — not retrying", model_key)
            return {
                "response_text": None,
                "mentioned": False,
                "latency_ms": result.get("latency_ms"),
                "error": f"{display} API key is invalid or expired. Update it in Settings → Connected Accounts.",
            }

        error_type = _classify_error(error)
        errors.append(f"attempt {attempt}: {error}")

        # On overload, fall back to a lighter model if available
        if error_type == "overload" and active_model_version in _FALLBACK_MODELS:
            fallback = _FALLBACK_MODELS[active_model_version]
            logger.info(
                "[%s] %s overloaded — falling back to %s for prompt %r",
                model_key, active_model_version, fallback, prompt[:100],
            )
            active_model_version = fallback

        # Don't sleep after the last attempt
        if attempt < max_attempts:
            if error_type == "rate_limit":
                # Jittered 30-90s — spreads retries so they don't all hit at once
                retry_delay = 30 + random.uniform(0, 60)
            elif error_type == "overload":
                retry_delay = 5 * (2 ** (attempt - 1))
                retry_delay = retry_delay * (1 + random.uniform(0, 0.25))
            else:
                retry_delay = 3

            logger.warning(
                "[%s] Attempt %d/%d failed (%s, error=%r) for prompt %r — retrying in %.0fs",
                model_key, attempt, max_attempts, error_type, error, prompt[:100], retry_delay,
            )
            # Use cancellable wait instead of plain sleep
            if cancel_event is not None:
                try:
                    await asyncio.wait_for(cancel_event.wait(), timeout=retry_delay)
                    # Event was set — run was cancelled, bail out
                    return {"response_text": None, "mentioned": False, "latency_ms": 0, "error": "cancelled"}
                except asyncio.TimeoutError:
                    pass  # Normal — cancel wasn't requested, continue retrying
            else:
                await asyncio.sleep(retry_delay)

    # All attempts failed — return a single descriptive error
    final_error = f"Empty response from {display} API after {len(errors)} attempts ({'; '.join(errors)})"
    logger.error(
        "[%s] All %d attempts failed for prompt %r. Final error: %s",
        model_key, len(errors), prompt[:100], final_error,
    )
    return {
        "response_text": None,
        "mentioned": False,
        "latency_ms": result.get("latency_ms"),
        "error": final_error,
    }


async def query_model(model: str, prompt: str, brand_name: str, pro: bool = False, cancel_event: asyncio.Event | None = None) -> dict:
    """
    Query a single LLM model with the given prompt.

    Args:
        model:      One of 'chatgpt', 'claude', 'perplexity', 'gemini'.
        prompt:     The text prompt to send.
        brand_name: The brand name to check for in the response.
        pro:        Whether the user has a Pro subscription (selects upgraded models).
        cancel_event: Optional asyncio.Event; if set, retries stop immediately.

    Returns:
        {
            "response_text": str | None,
            "mentioned":     bool,
            "latency_ms":    int,
            "error":         str | None,
        }
    """
    handler = _DISPATCHERS.get(model)
    if handler is None:
        return {
            "response_text": None,
            "mentioned": False,
            "latency_ms": 0,
            "error": f"Unknown model: {model}",
        }

    model_version = _get_model_version(model, pro)
    return await _with_retry(handler, prompt, brand_name, model, model_version=model_version, cancel_event=cancel_event)
