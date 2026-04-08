"""
Generic Serper.dev search — site-scoped.

Used by LinkedIn and X scanners. The Quora scanner has its own implementation
in quora_search_service.py (predates this module).

Environment variable required:
  SERPER_API_KEY — API key from https://serper.dev
"""
from __future__ import annotations

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

_SERPER_URL = "https://google.serper.dev/search"

# In-process cache: (site, cache_key) -> (expires_at, results)
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_CACHE_TTL = 86_400.0  # 24 hours

_STOP_WORDS = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that', 'these',
    'those', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'as', 'about', 'into', 'through', 'and', 'or', 'but', 'if', 'when',
    'where', 'what', 'which', 'who', 'how', 'why', 'not', 'no', 'so',
    'than', 'then', 'there', 'here', 'i', 'we', 'you', 'they', 'he', 'she',
    'my', 'your', 'our', 'their', 'me', 'him', 'her', 'us', 'them', 'just',
    'also', 'very', 'much', 'more', 'most', 'some', 'any', 'each', 'all',
})


def extract_keywords(prompt_text: str, max_words: int = 5) -> str:
    """Return the most meaningful terms from a prompt, stripping stop words."""
    words = [
        w.strip('.,!?;:"\'()[]{}').lower()
        for w in prompt_text.split()
    ]
    keywords = [w for w in words if w and w not in _STOP_WORDS and len(w) > 2]
    return " ".join(keywords[:max_words])


def invalidate_cache(site: str, key: int) -> None:
    """Remove a cached result so the next call fetches fresh data."""
    _cache.pop((site, key), None)


def search_site(
    site: str,
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
) -> list[dict]:
    """
    Search Google via Serper.dev scoped to a specific site.

    Args:
        site: Domain to scope the search to (e.g. "linkedin.com", "x.com")
        query: Keywords to search for
        num_results: Max results to return
        cache_key: Optional cache key (e.g. prompt_id) for 24h dedup

    Returns list of dicts: {title, url, snippet, date}
    """
    if cache_key is not None:
        entry = _cache.get((site, cache_key))
        if entry and time.monotonic() < entry[0]:
            logger.debug("serper_search: cache hit for site=%s key=%s", site, cache_key)
            return entry[1]

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning("serper_search: SERPER_API_KEY not configured — returning empty")
        return []

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                _SERPER_URL,
                headers={
                    "X-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json={"q": f"site:{site} {query}", "num": 20},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        try:
            error_body = exc.response.json()
        except Exception:
            error_body = exc.response.text
        logger.error("serper_search: HTTP %s — %s", exc.response.status_code, error_body)
        return []
    except Exception as exc:
        logger.error("serper_search: request failed — %s", exc)
        return []

    items = data.get("organic", [])
    results: list[dict] = []

    for item in items:
        url: str = item.get("link", "")
        title: str = item.get("title", "")
        snippet: str = item.get("snippet", "")
        date: str = item.get("date", "")

        if not url or not title:
            continue

        results.append({
            "title": _clean_title(title, site),
            "url": url,
            "snippet": snippet,
            "date": date,
        })
        if len(results) >= num_results:
            break

    logger.info(
        "serper_search: %d results for site=%s query=%r (%d raw)",
        len(results), site, query, len(items),
    )

    if cache_key is not None:
        _cache[(site, cache_key)] = (time.monotonic() + _CACHE_TTL, results)

    return results


def _clean_title(title: str, site: str) -> str:
    """Strip common branding suffixes from search result titles."""
    suffixes = {
        "linkedin.com": (" | LinkedIn", " - LinkedIn", " — LinkedIn", " – LinkedIn"),
        "x.com": (" / X", " on X", " - X"),
        "twitter.com": (" / X", " on X", " - X"),
    }
    for suffix in suffixes.get(site, ()):
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title.strip()
