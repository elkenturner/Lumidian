"""
Quora question search — uses Serper.dev to find real Quora questions.

Environment variable required:
  SERPER_API_KEY — API key from https://serper.dev (2,500 free searches/month)

If not set, search_quora_questions() returns [] and logs a warning.
Results are cached in-process for 24 hours per cache key to preserve quota.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

# ── Stop-word list for keyword extraction ──────────────────────────────────────

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

# URL path prefixes that indicate a real Quora question page
_QUESTION_PATTERNS = (
    '/What-', '/How-', '/Is-', '/Why-', '/Can-', '/Does-', '/Are-',
    '/Was-', '/Were-', '/Will-', '/Should-', '/Do-', '/When-', '/Where-',
    '/Which-', '/Who-', '/Has-', '/Have-', '/Did-', '/Could-', '/Would-',
)

# ── In-process cache ───────────────────────────────────────────────────────────

_cache: dict[int, tuple[float, list[dict]]] = {}  # key → (expires_at, results)
_CACHE_TTL = 86_400.0  # 24 hours


def invalidate_cache(key: int) -> None:
    """Remove a cached result so the next call fetches fresh data from Serper."""
    _cache.pop(key, None)


_SERPER_URL = "https://google.serper.dev/search"


# ── Public API ─────────────────────────────────────────────────────────────────

def extract_keywords(prompt_text: str, max_words: int = 5) -> str:
    """Return the most meaningful terms from a prompt, stripping stop words."""
    words = [
        w.strip('.,!?;:"\'()[]{}').lower()
        for w in prompt_text.split()
    ]
    keywords = [w for w in words if w and w not in _STOP_WORDS and len(w) > 2]
    return ' '.join(keywords[:max_words])


async def search_quora_questions(
    query: str,
    num_results: int = 5,
    cache_key: int | None = None,
) -> list[dict]:
    """
    Search for real Quora question pages matching *query* via Serper.dev.

    Returns a list of dicts: {title, url, snippet, date}
    Returns [] gracefully on missing credentials, API errors, or no matches.
    """
    # Cache check
    if cache_key is not None:
        entry = _cache.get(cache_key)
        if entry and time.monotonic() < entry[0]:
            logger.debug("quora_search: cache hit for key=%s", cache_key)
            return entry[1]

    api_key = os.getenv('SERPER_API_KEY', '').strip()
    if not api_key:
        logger.warning(
            "quora_search: SERPER_API_KEY not configured — "
            "Quora question finder disabled, returning empty list"
        )
        return []

    _TRANSIENT_CODES = {429, 500, 502, 503}
    _MAX_ATTEMPTS = 2
    _RETRY_DELAY = 2.0  # seconds

    data = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    _SERPER_URL,
                    headers={
                        "X-API-KEY": api_key,
                        "Content-Type": "application/json",
                    },
                    json={"q": f"site:quora.com {query}", "num": 20},
                )
                resp.raise_for_status()
                data = resp.json()
                break  # success
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            try:
                error_body = exc.response.json()
            except Exception:
                error_body = exc.response.text

            if status_code in _TRANSIENT_CODES and attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "quora_search: HTTP %s from Serper (attempt %d/%d), retrying in %.0fs — %s",
                    status_code, attempt, _MAX_ATTEMPTS, _RETRY_DELAY, error_body,
                )
                await asyncio.sleep(_RETRY_DELAY)
                continue

            logger.error(
                "quora_search: HTTP %s from Serper (attempt %d/%d, giving up) — %s",
                status_code, attempt, _MAX_ATTEMPTS, error_body,
            )
            return []
        except Exception as exc:
            if attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "quora_search: request failed (attempt %d/%d), retrying in %.0fs — %s",
                    attempt, _MAX_ATTEMPTS, _RETRY_DELAY, exc,
                )
                await asyncio.sleep(_RETRY_DELAY)
                continue

            logger.error(
                "quora_search: request failed (attempt %d/%d, giving up) — %s",
                attempt, _MAX_ATTEMPTS, exc,
            )
            return []

    if data is None:
        return []

    items = data.get('organic', [])
    results: list[dict] = []

    for item in items:
        url: str = item.get('link', '')
        title: str = item.get('title', '')
        snippet: str = item.get('snippet', '')

        # Keep only real question pages, skip profiles/topics/spaces
        if not any(pat in url for pat in _QUESTION_PATTERNS):
            continue

        results.append({
            'title': _clean_title(title),
            'url': url,
            'snippet': snippet,
            'date': item.get('date', ''),
        })

        if len(results) >= num_results:
            break

    logger.info(
        "quora_search: %d questions found for query=%r (%d raw Serper results)",
        len(results), query, len(items),
    )

    if cache_key is not None:
        _cache[cache_key] = (time.monotonic() + _CACHE_TTL, results)

    return results


# ── Helpers ────────────────────────────────────────────────────────────────────

def _clean_title(title: str) -> str:
    """Strip trailing Quora branding from a search result title."""
    for suffix in (' - Quora', ' | Quora', ' – Quora', ' — Quora'):
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title.strip()
