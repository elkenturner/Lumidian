"""Raw HTML (httpx) and rendered HTML (Playwright) fetchers + render-mode classifier."""
from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from time import perf_counter

import httpx

from app.services.site_audit.constants import (
    AUDIT_USER_AGENT,
    BROWSER_FALLBACK_HEADERS,
    PER_PAGE_TIMEOUT_S,
    RENDERED_CHALLENGE_WAIT_MS,
)

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


async def fetch_raw(
    url: str,
    timeout_s: float = PER_PAGE_TIMEOUT_S,
    *,
    browser_profile: bool = False,
) -> FetchResult:
    """Fetch raw HTML via httpx. No JS execution. Never raises.

    ``browser_profile=True`` sends realistic browser headers instead of the
    audit-bot UA — used only as a blocked-crawl fallback (see constants).
    """
    started = perf_counter()
    headers = (
        dict(BROWSER_FALLBACK_HEADERS)
        if browser_profile
        else {"User-Agent": AUDIT_USER_AGENT, "Accept": "text/html,*/*"}
    )
    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers=headers,
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


@asynccontextmanager
async def rendered_fetch_session(concurrency: int = 2):
    """Yield a ``fetch(url) -> FetchResult`` backed by ONE shared headless
    Chromium — for crawling many pages without a browser launch per page.

    Used by the blocked-crawl rendered fallback. On a 401/403/429/503 the page
    gets a short grace period (managed anti-bot challenges auto-solve in a real
    browser) and one re-navigation before we take the answer as final. The
    yielded fetch never raises.
    """
    try:
        from playwright.async_api import TimeoutError as PWTimeout
        from playwright.async_api import async_playwright
    except ImportError as exc:
        err = f"playwright_missing: {exc}"

        async def _unavailable(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
            return FetchResult(url=url, status=None, html="", fetch_ms=None, error=err)

        yield _unavailable
        return

    sem = asyncio.Semaphore(concurrency)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:

            async def _fetch(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
                started = perf_counter()
                try:
                    async with sem:
                        page = await browser.new_page()
                        try:
                            resp = await page.goto(
                                url, wait_until="domcontentloaded", timeout=timeout_s * 1000
                            )
                            status = resp.status if resp else None
                            if status in (401, 403, 429, 503):
                                await page.wait_for_timeout(RENDERED_CHALLENGE_WAIT_MS)
                                resp = await page.goto(
                                    url, wait_until="domcontentloaded", timeout=timeout_s * 1000
                                )
                                if resp:
                                    status = resp.status
                            html = await page.content()
                            ms = int((perf_counter() - started) * 1000)
                            return FetchResult(url=url, status=status, html=html, fetch_ms=ms)
                        finally:
                            await page.close()
                except PWTimeout:
                    return FetchResult(url=url, status=None, html="", fetch_ms=None, error="render_timeout")
                except Exception as exc:  # noqa: BLE001
                    logger.warning("rendered_fetch_session error for %s: %s", url, exc)
                    return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"render_error: {exc}")

            yield _fetch
        finally:
            await browser.close()


def _visible_text_length(html: str) -> int:
    """Length of visible text inside <body>, stripping scripts/styles/templates."""
    if not html:
        return 0
    no_scripts = _SCRIPT_RE.sub(" ", html)
    plain = _TAG_RE.sub(" ", no_scripts)
    collapsed = _WS_RE.sub(" ", plain).strip()
    return len(collapsed)


# Common SPA-framework markers that imply CSR even without a Playwright render.
# Detecting these in raw HTML lets us classify render-mode when Playwright fails.
_SPA_HINT_RES = [
    re.compile(r'<div\s+id\s*=\s*["\']root["\']\s*>\s*</div>', re.IGNORECASE),  # React root
    re.compile(r'<div\s+id\s*=\s*["\']app["\']\s*>\s*</div>', re.IGNORECASE),  # Vue / generic
    re.compile(r'<div\s+id\s*=\s*["\']__next["\']', re.IGNORECASE),  # Next.js CSR shell
    re.compile(r'<router-outlet\b', re.IGNORECASE),  # Angular
    re.compile(r'data-reactroot=', re.IGNORECASE),
    re.compile(r'window\.__NUXT__', re.IGNORECASE),
]


def _looks_like_spa_shell(raw_html: str) -> bool:
    """Empty SPA shells: HTML with framework markers but no meaningful body text."""
    if not raw_html:
        return False
    visible_chars = _visible_text_length(raw_html)
    if visible_chars > 1500:
        return False
    return any(rx.search(raw_html) for rx in _SPA_HINT_RES)


def classify_render_mode(raw_html: str, rendered_html: str) -> str:
    """Return 'ssr', 'csr', 'ssg', or 'unknown' for one page.

    Heuristics:
      - <noscript ...JavaScript...> marker → 'csr'
      - rendered > 1.5x raw AND raw < 500 chars → 'csr'
      - rendered ≈ raw (within 15%) → 'ssr' (treated as SSR; SSG indistinguishable without HTTP headers)
      - else falls back to raw-HTML SPA shell detection (works when Playwright is unavailable)
      - else 'unknown'
    """
    if _NOSCRIPT_JS_HINT_RE.search(raw_html or ""):
        return "csr"

    raw_len = _visible_text_length(raw_html)
    rendered_len = _visible_text_length(rendered_html)

    if rendered_len == 0 and raw_len == 0:
        # Both empty — try SPA shell detection on raw HTML directly
        return "csr" if _looks_like_spa_shell(raw_html) else "unknown"
    if raw_len < 500 and rendered_len > raw_len * 1.5:
        return "csr"
    if raw_len == 0:
        return "csr"
    ratio = rendered_len / max(raw_len, 1)
    if 0.85 <= ratio <= 1.15:
        return "ssr"

    # Rendered HTML didn't materially differ AND we didn't get a clear SSR ratio.
    # Try SPA shell signature on the raw HTML to catch CSR sites where rendered
    # fetch was missing/empty.
    if _looks_like_spa_shell(raw_html):
        return "csr"
    return "unknown"
