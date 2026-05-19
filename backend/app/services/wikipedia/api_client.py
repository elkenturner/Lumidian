"""Wikipedia REST API client wrapper.

Single source of truth for talking to en.wikipedia.org/w/api.php. No business
logic in here — just typed wrappers around the underlying GET calls. Tests mock
``_get_json`` to isolate the orchestrators from network IO.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WIKIPEDIA_USER_AGENT = "Lumidian/1.0 (https://lumidian.app; support@lumidian.app)"
_WIKI_API_URL = "https://en.wikipedia.org/w/api.php"
_TIMEOUT_SECONDS = 10.0


async def _get_json(params: dict[str, Any]) -> dict:
    """Single GET to the Wikipedia API. One retry on network error."""
    params = {**params, "format": "json", "formatversion": "2"}
    headers = {"User-Agent": WIKIPEDIA_USER_AGENT}
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, headers=headers) as client:
                resp = await client.get(_WIKI_API_URL, params=params)
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_error = e
            if attempt == 0:
                logger.warning("Wikipedia API call failed, retrying: %s", e)
                continue
            logger.exception("Wikipedia API call failed after retry: %s", e)
            raise
    if last_error:
        raise last_error
    return {}


async def search_articles(query: str, limit: int = 5) -> list[dict]:
    """Returns a list of {title, pageid, snippet} dicts. Empty list on no results."""
    body = await _get_json(
        {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": limit,
        }
    )
    results = body.get("query", {}).get("search", []) or []
    return [
        {"title": r.get("title", ""), "pageid": int(r.get("pageid", 0)), "snippet": r.get("snippet", "")}
        for r in results
        if r.get("pageid")
    ]


async def fetch_lead_extract(pageid: int) -> tuple[str, str] | None:
    """Returns (verified_title, plain-text intro) or None if the page is missing."""
    body = await _get_json(
        {
            "action": "query",
            "prop": "extracts",
            "exintro": "1",
            "explaintext": "1",
            "pageids": pageid,
        }
    )
    pages = body.get("query", {}).get("pages", [])
    if not pages:
        return None
    page = pages[0] if isinstance(pages, list) else next(iter(pages.values()), None)
    if not page or page.get("missing"):
        return None
    title = page.get("title") or ""
    extract = page.get("extract") or ""
    if not title or not extract:
        return None
    return title, extract


async def fetch_wikitext_and_sections(pageid: int) -> tuple[str, list[str]]:
    """Returns (full wikitext, list of section names). Empty string + empty list if missing."""
    body = await _get_json(
        {
            "action": "parse",
            "pageid": pageid,
            "prop": "wikitext|sections",
        }
    )
    parse = body.get("parse") or {}
    wt = parse.get("wikitext")
    if isinstance(wt, dict):
        wikitext = wt.get("*", "")
    elif isinstance(wt, str):
        wikitext = wt
    else:
        wikitext = ""
    section_objs = parse.get("sections") or []
    sections = [s.get("line", "") for s in section_objs if s.get("line")]
    return wikitext, sections
