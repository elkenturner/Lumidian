"""
Quora question search — site-scoped Serper helper for ``quora.com``.

Filters Serper results down to real Quora question pages (skipping profiles,
topics, spaces) and exposes the same ``{title, url, snippet, date}`` shape as
the canonical helper.

Public API
----------
search_quora_questions(query, num_results=5, cache_key=None) → list[dict]
extract_keywords(prompt_text, max_words=5)                   → str
invalidate_cache(key)                                        → None
"""
from __future__ import annotations

from app.services.serper_search_service import (
    extract_keywords,
    invalidate_cache as _invalidate_site_cache,
    search_site_async,
)

_SITE = "quora.com"

# URL path prefixes that indicate a real Quora question page
_QUESTION_PATTERNS = (
    '/What-', '/How-', '/Is-', '/Why-', '/Can-', '/Does-', '/Are-',
    '/Was-', '/Were-', '/Will-', '/Should-', '/Do-', '/When-', '/Where-',
    '/Which-', '/Who-', '/Has-', '/Have-', '/Did-', '/Could-', '/Would-',
)


def _is_quora_question_url(url: str) -> bool:
    return any(pat in url for pat in _QUESTION_PATTERNS)


def invalidate_cache(key: int) -> None:
    """Remove a cached Quora result so the next call fetches fresh data."""
    _invalidate_site_cache(_SITE, key)


async def search_quora_questions(
    query: str,
    num_results: int = 5,
    cache_key: int | None = None,
) -> list[dict]:
    """Search for real Quora question pages matching *query* via Serper.dev."""
    return await search_site_async(
        site=_SITE,
        query=query,
        num_results=num_results,
        cache_key=cache_key,
        url_filter=_is_quora_question_url,
        log_label="quora_search",
    )


__all__ = ["search_quora_questions", "extract_keywords", "invalidate_cache"]
