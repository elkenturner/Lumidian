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

async def _query_chatgpt(prompt: str, brand_name: str) -> dict:
    if not OPENAI_API_KEY:
        return _api_key_placeholder("chatgpt")
    start = time.monotonic()
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
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

async def _query_claude(prompt: str, brand_name: str) -> dict:
    if not ANTHROPIC_API_KEY:
        return _api_key_placeholder("claude")
    start = time.monotonic()
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
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

async def _query_perplexity(prompt: str, brand_name: str) -> dict:
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
                model="sonar",
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

async def _query_gemini(prompt: str, brand_name: str) -> dict:
    if not GEMINI_API_KEY:
        return _api_key_placeholder("gemini")
    start = time.monotonic()
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash")
        # google-generativeai does not provide a native async client for
        # generate_content, so we run it in a thread pool to keep the event
        # loop free.
        # Enable Google Search grounding so Gemini queries the live web index —
        # the closest available API proxy for Google AI brand mentions in real-time.
        # Try both proto paths; SDK 0.8.x may expose GoogleSearch as an inner
        # class of Tool or as a top-level proto type depending on build.
        gen_kwargs: dict = {}
        _grounding_ok = False
        for _build_tool in (
            lambda: genai.protos.Tool(google_search=genai.protos.Tool.GoogleSearch()),
            lambda: genai.protos.Tool(google_search=genai.protos.GoogleSearch()),
        ):
            try:
                gen_kwargs = {"tools": [_build_tool()]}
                _grounding_ok = True
                break
            except AttributeError:
                continue
        if not _grounding_ok:
            logger.warning(
                "[gemini] Google Search grounding unavailable in this SDK build "
                "(google-generativeai %s) — running ungrounded",
                getattr(genai, "__version__", "unknown"),
            )
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None, lambda: model.generate_content(prompt, **gen_kwargs)
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


async def _with_retry(handler, prompt: str, brand_name: str, model_key: str) -> dict:
    """
    Call handler(prompt, brand_name) and retry once after 3 seconds if the
    response is empty or errored (but not due to a missing API key, which is
    a permanent configuration issue).
    """
    result = await handler(prompt, brand_name)

    # Successful response — return immediately
    if result.get("response_text") and not result.get("error"):
        return result

    # api_key_not_configured is permanent — retrying won't help
    if result.get("error") == "api_key_not_configured":
        return result

    display = _MODEL_DISPLAY_NAMES.get(model_key, model_key)
    first_error = result.get("error") or "empty response"

    # Rate-limit errors (429) need a much longer backoff — the standard window
    # is 60 seconds. A 3s retry will almost certainly hit the same limit again.
    is_rate_limit = "429" in first_error or "rate_limit" in first_error.lower() or "rate limit" in first_error.lower()
    retry_delay = 65 if is_rate_limit else 3

    logger.warning(
        "[%s] First attempt failed (error=%r) for prompt %r — retrying in %ds",
        model_key, first_error, prompt[:100], retry_delay,
    )
    await asyncio.sleep(retry_delay)

    retry = await handler(prompt, brand_name)
    if retry.get("response_text") and not retry.get("error"):
        logger.info("[%s] Retry succeeded for prompt %r", model_key, prompt[:100])
        return retry

    # Both attempts failed — return a single descriptive error
    retry_error = retry.get("error") or "empty response"
    final_error = (
        f"Empty response from {display} API after retry "
        f"(attempt 1: {first_error}; attempt 2: {retry_error})"
    )
    logger.error(
        "[%s] Both attempts failed for prompt %r. Final error: %s",
        model_key, prompt[:100], final_error,
    )
    return {
        "response_text": None,
        "mentioned": False,
        "latency_ms": retry.get("latency_ms"),
        "error": final_error,
    }


async def query_model(model: str, prompt: str, brand_name: str) -> dict:
    """
    Query a single LLM model with the given prompt.

    Args:
        model:      One of 'chatgpt', 'claude', 'perplexity', 'gemini'.
        prompt:     The text prompt to send.
        brand_name: The brand name to check for in the response.

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
    return await _with_retry(handler, prompt, brand_name, model)
