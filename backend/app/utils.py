"""Shared utilities used across routers and services."""
from __future__ import annotations

MODEL_ORDER = ["chatgpt", "claude", "perplexity", "gemini"]
MODEL_LABELS = {"chatgpt": "ChatGPT", "claude": "Claude", "perplexity": "Perplexity", "gemini": "Gemini"}


def normalise_model(model: str) -> str:
    """Normalise a raw model string (e.g. 'gpt-4o', 'claude-3-haiku') to a canonical key."""
    key = model.lower().replace("-", "").replace("_", "").replace(" ", "")
    for m in MODEL_ORDER:
        if m in key:
            return m
    return model
