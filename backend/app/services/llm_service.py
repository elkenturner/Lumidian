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
from typing import Optional

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

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


def _mentioned(brand_name: str, text: str) -> bool:
    """Case-insensitive substring check."""
    return brand_name.lower() in text.lower()


def _build_result(
    response_text: Optional[str],
    brand_name: str,
    latency_ms: int,
    error: Optional[str] = None,
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
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
            temperature=0.7,
        )
        text = response.choices[0].message.content or ""
        latency_ms = int((time.monotonic() - start) * 1000)
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
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
        text = response.content[0].text if response.content else ""
        latency_ms = int((time.monotonic() - start) * 1000)
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[claude] API error: %s", exc)
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
        response = await client.chat.completions.create(
            model="sonar",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
            temperature=0.7,
        )
        text = response.choices[0].message.content or ""
        latency_ms = int((time.monotonic() - start) * 1000)
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return _build_result(None, brand_name, latency_ms, error=str(exc))


# ── Gemini ────────────────────────────────────────────────────────────────────

async def _query_gemini(prompt: str, brand_name: str) -> dict:
    if not GEMINI_API_KEY:
        return _api_key_placeholder("gemini")
    start = time.monotonic()
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-flash-latest")
        # google-generativeai does not provide a native async client for
        # generate_content, so we run it in a thread pool to keep the event
        # loop free.
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None, lambda: model.generate_content(prompt)
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
        logger.debug("[gemini] response preview: %r", text[:200] if text else "")
        return _build_result(text, brand_name, latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.error("[gemini] API error: %s", exc)
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
    return await handler(prompt, brand_name)
