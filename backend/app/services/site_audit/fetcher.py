"""Raw HTML (httpx) and rendered HTML (Playwright) fetchers + render-mode classifier."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from time import perf_counter

import httpx

from app.services.site_audit.constants import AUDIT_USER_AGENT, PER_PAGE_TIMEOUT_S

logger = logging.getLogger(__name__)

_SCRIPT_RE = re.compile(r"<(script|style|template)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_NOSCRIPT_JS_HINT_RE = re.compile(r"<noscript[^>]*>\s*[^<]*JavaScript[^<]*", re.IGNORECASE)


@dataclass
class FetchResult:
    url: str
    status: int | None
    html: str
    fetch_ms: int | None
    error: str | None = None


async def fetch_raw(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
    """Fetch raw HTML via httpx. No JS execution. Never raises."""
    started = perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers={"User-Agent": AUDIT_USER_AGENT, "Accept": "text/html,*/*"},
        ) as client:
            resp = await client.get(url)
            ms = int((perf_counter() - started) * 1000)
            text = ""
            ctype = resp.headers.get("content-type", "")
            if "html" in ctype or "xml" in ctype or "text/plain" in ctype or not ctype:
                text = resp.text
            return FetchResult(url=url, status=resp.status_code, html=text, fetch_ms=ms)
    except httpx.TimeoutException:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error="timeout")
    except httpx.HTTPError as exc:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"http_error: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_raw unexpected error for %s: %s", url, exc)
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"unexpected: {exc}")


async def fetch_rendered(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
    """Fetch JS-rendered HTML via Playwright Chromium. Never raises."""
    try:
        from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    except ImportError as exc:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"playwright_missing: {exc}")

    started = perf_counter()
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page(user_agent=AUDIT_USER_AGENT)
                try:
                    resp = await page.goto(url, wait_until="networkidle", timeout=timeout_s * 1000)
                    html = await page.content()
                    status = resp.status if resp else None
                    ms = int((perf_counter() - started) * 1000)
                    return FetchResult(url=url, status=status, html=html, fetch_ms=ms)
                finally:
                    await page.close()
            finally:
                await browser.close()
    except PWTimeout:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error="render_timeout")
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_rendered unexpected error for %s: %s", url, exc)
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"render_error: {exc}")


def _visible_text_length(html: str) -> int:
    """Length of visible text inside <body>, stripping scripts/styles/templates."""
    if not html:
        return 0
    no_scripts = _SCRIPT_RE.sub(" ", html)
    plain = _TAG_RE.sub(" ", no_scripts)
    collapsed = _WS_RE.sub(" ", plain).strip()
    return len(collapsed)


def classify_render_mode(raw_html: str, rendered_html: str) -> str:
    """Return 'ssr', 'csr', 'ssg', or 'unknown' for one page.

    Heuristics:
      - rendered > 1.5x raw AND raw < 500 chars → 'csr'
      - rendered ≈ raw (within 15%) → 'ssr' (treated as SSR; SSG indistinguishable without HTTP headers)
      - <noscript ...JavaScript...> marker → 'csr'
      - else 'unknown'
    """
    if _NOSCRIPT_JS_HINT_RE.search(raw_html or ""):
        return "csr"

    raw_len = _visible_text_length(raw_html)
    rendered_len = _visible_text_length(rendered_html)

    if rendered_len == 0 and raw_len == 0:
        return "unknown"
    if raw_len < 500 and rendered_len > raw_len * 1.5:
        return "csr"
    if raw_len == 0:
        return "csr"
    ratio = rendered_len / max(raw_len, 1)
    if 0.85 <= ratio <= 1.15:
        return "ssr"
    return "unknown"
