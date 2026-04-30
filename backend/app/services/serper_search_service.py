"""
Generic Serper.dev search — site-scoped helper used by all opportunity scanners.

Public API
----------
search_site_async(site, query, ...)        → list[dict]   (async, with retries + cache)
extract_keywords(prompt_text, max_words=5) → str
parse_serper_date(date_str)                → datetime | None
clean_title(title, site)                   → str
invalidate_cache(site, key)                → None

Each scanner module composes around this — providing site-specific URL filters,
title-suffix entries (registered in ``_TITLE_SUFFIXES``), and post-processing
hooks via ``extras_fn``.

Environment variable required:
  SERPER_API_KEY — API key from https://serper.dev (2,500 free searches/month)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

_SERPER_URL = "https://google.serper.dev/search"

# In-process cache keyed by (site, cache_key). Sharing across scanners means the
# same prompt id used on different sites doesn't collide.
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_CACHE_TTL = 86_400.0  # 24 hours

_TRANSIENT_CODES = frozenset({429, 500, 502, 503})


# ── Stop words ────────────────────────────────────────────────────────────────

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


# ── Date parsing ──────────────────────────────────────────────────────────────

_RELATIVE_RE = re.compile(
    r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_serper_date(date_str: str | None) -> datetime | None:
    """
    Parse Serper.dev `date` field into a UTC-naive datetime.
    Handles:
      - Relative: "3 days ago", "2 weeks ago", "1 month ago"
      - Absolute: "Dec 15, 2023" / "December 15, 2023"
    Returns None if unparseable.
    """
    if not date_str:
        return None
    now = datetime.now(UTC)

    m = _RELATIVE_RE.match(date_str.strip())
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta_map = {
            "second": timedelta(seconds=n),
            "minute": timedelta(minutes=n),
            "hour":   timedelta(hours=n),
            "day":    timedelta(days=n),
            "week":   timedelta(weeks=n),
            "month":  timedelta(days=30 * n),
            "year":   timedelta(days=365 * n),
        }
        dt = now - delta_map.get(unit, timedelta(0))
        return dt.replace(tzinfo=None)

    abs_m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", date_str.strip())
    if abs_m:
        month = _MONTHS.get(abs_m.group(1)[:3].lower())
        if month:
            try:
                return datetime(int(abs_m.group(3)), month, int(abs_m.group(2)))
            except ValueError:
                pass
    return None


# ── Title cleaning ────────────────────────────────────────────────────────────

_TITLE_SUFFIXES: dict[str, tuple[str, ...]] = {
    "linkedin.com": (" | LinkedIn", " - LinkedIn", " — LinkedIn", " – LinkedIn"),
    "x.com":        (" / X", " on X", " — X", " - X", " | X"),
    "twitter.com":  (" / X", " on X", " — X", " - X", " | X"),
    "quora.com":    (" - Quora", " | Quora", " – Quora", " — Quora"),
    "reddit.com":   (" - Reddit", " — Reddit", " – Reddit", " | Reddit"),
}


def clean_title(title: str, site: str) -> str:
    """Strip common branding suffixes from search result titles for *site*."""
    for suffix in _TITLE_SUFFIXES.get(site, ()):
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title.strip()


# ── Cache helpers ─────────────────────────────────────────────────────────────

def invalidate_cache(site: str, key: int) -> None:
    """Remove a cached result so the next call fetches fresh data."""
    _cache.pop((site, key), None)


# ── Async site search ─────────────────────────────────────────────────────────

async def search_site_async(
    site: str,
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
    *,
    raw_num: int = 20,
    timeout: float = 8.0,
    url_filter: Callable[[str], bool] | None = None,
    extras_fn: Callable[[dict], dict] | None = None,
    max_attempts: int = 2,
    retry_delay: float = 2.0,
    log_label: str | None = None,
) -> list[dict]:
    """
    Search Google via Serper.dev, scoped to *site* (e.g. ``"linkedin.com"``).

    Returns a list of dicts ``{title, url, snippet, date, ...extras}``.
    Returns ``[]`` gracefully on missing credentials, API errors, or no matches.

    Args:
        site:         Domain to scope (``site:<site> <query>``)
        query:        Free-text query
        num_results:  Max accepted results to return
        cache_key:    Optional 24h dedup key (e.g. prompt id)
        raw_num:      Serper API ``num`` parameter (defaults to 20)
        timeout:      Request timeout in seconds
        url_filter:   Only results where ``url_filter(url)`` is truthy are kept
        extras_fn:    Returns extra fields to merge into each result; can also
                      override base fields (e.g. ``title`` for site-specific
                      post-cleaning)
        max_attempts: Total HTTP attempts (1 = no retries)
        retry_delay:  Sleep between retries on transient errors
        log_label:    Override log line prefix (defaults to ``"serper[<site>]"``)
    """
    label = log_label or f"serper[{site}]"

    if cache_key is not None:
        entry = _cache.get((site, cache_key))
        if entry and time.monotonic() < entry[0]:
            logger.debug("%s: cache hit for key=%s", label, cache_key)
            return entry[1]

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning("%s: SERPER_API_KEY not configured — returning empty list", label)
        return []

    data: dict | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    _SERPER_URL,
                    headers={
                        "X-API-KEY": api_key,
                        "Content-Type": "application/json",
                    },
                    json={"q": f"site:{site} {query}", "num": raw_num},
                )
                resp.raise_for_status()
                data = resp.json()
                break
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            try:
                error_body = exc.response.json()
            except Exception:
                error_body = exc.response.text

            if status_code in _TRANSIENT_CODES and attempt < max_attempts:
                logger.warning(
                    "%s: HTTP %s (attempt %d/%d), retrying in %.0fs — %s",
                    label, status_code, attempt, max_attempts, retry_delay, error_body,
                )
                await asyncio.sleep(retry_delay)
                continue

            logger.error(
                "%s: HTTP %s (attempt %d/%d, giving up) — %s",
                label, status_code, attempt, max_attempts, error_body,
            )
            return []
        except Exception as exc:
            if attempt < max_attempts:
                logger.warning(
                    "%s: request failed (attempt %d/%d), retrying in %.0fs — %s",
                    label, attempt, max_attempts, retry_delay, exc,
                )
                await asyncio.sleep(retry_delay)
                continue
            logger.error(
                "%s: request failed (attempt %d/%d, giving up) — %s",
                label, attempt, max_attempts, exc,
            )
            return []

    if data is None:
        return []

    items = data.get("organic", [])
    results: list[dict] = []

    for item in items:
        url: str = item.get("link", "")
        title: str = item.get("title", "")
        snippet: str = item.get("snippet", "")

        if not url or not title:
            continue
        if url_filter is not None and not url_filter(url):
            continue

        result = {
            "title": clean_title(title, site),
            "url": url,
            "snippet": snippet,
            "date": item.get("date", ""),
        }
        if extras_fn is not None:
            result.update(extras_fn(item))

        results.append(result)
        if len(results) >= num_results:
            break

    logger.info(
        "%s: %d results for query=%r (%d raw)",
        label, len(results), query, len(items),
    )

    if cache_key is not None:
        _cache[(site, cache_key)] = (time.monotonic() + _CACHE_TTL, results)

    return results
