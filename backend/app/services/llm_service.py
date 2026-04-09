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
import time

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Perplexity rate-limit guard: allow at most 2 concurrent calls to avoid 429s.
# Perplexity's per-minute quota is small; flooding it causes later prompts in a
# run to fail while early ones succeed, producing inconsistent report data.
_PERPLEXITY_SEM = asyncio.Semaphore(2)

# Claude rate-limit guard: Anthropic enforces 50 req/min on claude-haiku.
# With ~2-3s per call, 3 concurrent slots ≈ 60-90 req/min at peak.
# Combined with the 65s retry backoff for 429s, this keeps us under the limit.
_CLAUDE_SEM = asyncio.Semaphore(3)

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
    "basic": 5,
    "standard": 10,
    "premium": 20,
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
    "chatgpt":    {"default": "gpt-4.1-mini",              "pro": "gpt-4.1-mini"},
    "claude":     {"default": "claude-haiku-4-5-20251001",  "pro": "claude-haiku-4-5-20251001"},
    "perplexity": {"default": "sonar",                      "pro": "sonar-pro"},
    "gemini":     {"default": "gemini-2.5-flash",           "pro": "gemini-2.5-pro"},
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

async def _query_perplexity(prompt: str, brand_name: str, model_version: str = "sonar") -> dict:
    if not PERPLEXITY_API_KEY:
        return _api_key_placeholder("perplexity")
    start = time.monotonic()
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=PERPLEXITY_API_KEY,
            base_url="https://api.perplexity.ai",
        )
        # Throttle to at most _PERPLEXITY_SEM concurrent calls so we don't
        # blast Perplexity's per-minute quota and cause 429s on later prompts.
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

async def _query_gemini(prompt: str, brand_name: str, model_version: str = "gemini-2.5-flash") -> dict:
    if not GEMINI_API_KEY:
        return _api_key_placeholder("gemini")
    start = time.monotonic()
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(model_version)
        # google-generativeai does not provide a native async client for
        # generate_content, so we run it in a thread pool to keep the event
        # loop free.
        # Enable Google Search grounding so Gemini queries the live web index.
        # SDK ≥0.8.6 supports the google_search Tool proto field; older builds
        # only have google_search_retrieval (now rejected server-side with 400).
        gen_kwargs: dict = {}
        _tool = genai.protos.Tool()
        if "google_search" in [f.name for f in genai.protos.Tool.meta.fields.values()]:
            _tool.google_search = {}
            gen_kwargs = {"tools": [_tool]}
        else:
            try:
                gen_kwargs = {"tools": [genai.protos.Tool(
                    google_search_retrieval=genai.protos.GoogleSearchRetrieval()
                )]}
            except (AttributeError, TypeError):
                logger.warning(
                    "[gemini] Google Search grounding unavailable in this SDK build "
                    "(google-generativeai %s) — running ungrounded",
                    getattr(genai, "__version__", "unknown"),
                )
        loop = asyncio.get_running_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(
                None, lambda: model.generate_content(prompt, **gen_kwargs)
            ),
            timeout=30.0,  # 30s timeout to avoid hanging
        )
        # response.text raises ValueError when the response was blocked by a
        # safety filter or finished with a non-STOP reason (e.g. RECITATION,
        # MAX_TOKENS with no content).  Extract the text safely so we can log
        # exactly what happened instead of silently returning mentioned=False.
        try:
            text = response.text
        except ValueError as val_err:
            finish_reason = "unknown"
            if response.candidates:
                finish_reason = str(getattr(response.candidates[0], "finish_reason", "unknown"))
            logger.error(
                "[gemini] response.text raised ValueError (likely safety block) — "
                "finish_reason=%s error=%s candidates=%s",
                finish_reason,
                val_err,
                response.candidates,
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            return _build_result(None, brand_name, latency_ms, error=f"gemini_blocked: {val_err}")
        latency_ms = int((time.monotonic() - start) * 1000)
        if not text:
            logger.warning(
                "[gemini] API returned empty/null content for prompt %r", prompt[:100]
            )
            return _build_result(
                None, brand_name, latency_ms,
                error="Empty response from Gemini API",
            )
        logger.debug("[gemini] response preview: %r", text[:200])
        return _build_result(text, brand_name, latency_ms)
    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[gemini] Request timed out after 30s for prompt %r", prompt[:100])
        return _build_result(None, brand_name, latency_ms, error="Request timed out (30s)")
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[gemini] API error for prompt %r: %s", prompt[:100], exc)
        body = getattr(exc, "response", None)
        if body is not None:
            try:
                logger.error("[gemini] API error body: %s", body.text)
            except Exception:
                pass
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Public dispatcher ─────────────────────────────────────────────────────────

_DISPATCHERS = {
    "chatgpt": _query_chatgpt,
    "claude": _query_claude,
    "perplexity": _query_perplexity,
    "gemini": _query_gemini,
}

SUPPORTED_MODELS = list(_DISPATCHERS.keys())


async def _with_retry(handler, prompt: str, brand_name: str, model_key: str, max_attempts: int = 3, model_version: str = "") -> dict:
    """
    Call handler(prompt, brand_name, model_version) and retry up to max_attempts
    times if the response is empty or errored (but not due to a missing API key,
    which is a permanent configuration issue).
    """
    display = _MODEL_DISPLAY_NAMES.get(model_key, model_key)
    errors: list[str] = []

    for attempt in range(1, max_attempts + 1):
        result = await handler(prompt, brand_name, model_version)

        # Successful response — return immediately
        if result.get("response_text") and not result.get("error"):
            if attempt > 1:
                logger.info("[%s] Attempt %d succeeded for prompt %r", model_key, attempt, prompt[:100])
            return result

        # api_key_not_configured is permanent — retrying won't help
        if result.get("error") == "api_key_not_configured":
            return result

        error = result.get("error") or "empty response"
        errors.append(f"attempt {attempt}: {error}")

        # Don't sleep after the last attempt
        if attempt < max_attempts:
            # Rate-limit errors (429) need a much longer backoff
            is_rate_limit = "429" in error or "rate_limit" in error.lower() or "rate limit" in error.lower()
            retry_delay = 65 if is_rate_limit else 3

            logger.warning(
                "[%s] Attempt %d/%d failed (error=%r) for prompt %r — retrying in %ds",
                model_key, attempt, max_attempts, error, prompt[:100], retry_delay,
            )
            await asyncio.sleep(retry_delay)

    # All attempts failed — return a single descriptive error
    final_error = f"Empty response from {display} API after {max_attempts} attempts ({'; '.join(errors)})"
    logger.error(
        "[%s] All %d attempts failed for prompt %r. Final error: %s",
        model_key, max_attempts, prompt[:100], final_error,
    )
    return {
        "response_text": None,
        "mentioned": False,
        "latency_ms": result.get("latency_ms"),
        "error": final_error,
    }


async def query_model(model: str, prompt: str, brand_name: str, pro: bool = False) -> dict:
    """
    Query a single LLM model with the given prompt.

    Args:
        model:      One of 'chatgpt', 'claude', 'perplexity', 'gemini'.
        prompt:     The text prompt to send.
        brand_name: The brand name to check for in the response.
        pro:        Whether the user has a Pro subscription (selects upgraded models).

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
    return await _with_retry(handler, prompt, brand_name, model, model_version=model_version)
