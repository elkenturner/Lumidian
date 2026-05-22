"""Resolve a prospect's logo as a data URI for embedding in the PDF.

Fallback chain (in order, each is best-effort):
  1. og:image meta tag from homepage
  2. apple-touch-icon (high-res, no transparency issues)
  3. <link rel="icon"> / <link rel="shortcut icon"> from homepage
  4. /favicon.ico (legacy default)
  5. Clearbit Logo API — works for thousands of recognized domains
  6. None → caller renders a styled wordmark instead

All network calls swallow exceptions; cascade to next on any failure.
"""
from __future__ import annotations

import base64
import logging
import re
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)


_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_APPLE_TOUCH_RE = re.compile(
    r'<link[^>]+rel=["\'](?:apple-touch-icon(?:-precomposed)?)["\'][^>]+href=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_LINK_ICON_RE = re.compile(
    r'<link[^>]+rel=["\'](?:shortcut icon|icon)["\'][^>]+href=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


async def _http_get(url: str, timeout: float = 10):
    """Wrapped so tests can patch one symbol."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        return await client.get(url)


async def fetch_prospect_logo(website_url: str, business_name: str) -> str | None:
    """Return a data URI for the prospect's logo, or None if every source failed.

    Caller decides what to do when None — currently we render the business name
    as a styled wordmark, which usually looks more polished than a letter tile.
    """
    base = website_url.rstrip("/")
    parsed = urlparse(base)
    base_with_slash = base + "/"

    homepage_html: str | None = None
    try:
        resp = await _http_get(base)
        ct = resp.headers.get("content-type", "")
        if resp.status_code == 200 and "html" in ct.lower():
            homepage_html = resp.text
    except Exception as exc:
        logger.debug("logo: homepage fetch failed for %s: %s", base, exc)

    # 1. og:image
    if homepage_html:
        m = _OG_IMAGE_RE.search(homepage_html)
        if m:
            og_url = urljoin(base_with_slash, m.group(1))
            uri = await _fetch_as_data_uri(og_url)
            if uri:
                return uri

    # 2. apple-touch-icon (usually 180px PNG, clean)
    if homepage_html:
        m = _APPLE_TOUCH_RE.search(homepage_html)
        if m:
            apple_url = urljoin(base_with_slash, m.group(1))
            uri = await _fetch_as_data_uri(apple_url)
            if uri:
                return uri

    # Even without HTML, try the default apple-touch-icon location
    uri = await _fetch_as_data_uri(urljoin(base_with_slash, "/apple-touch-icon.png"))
    if uri:
        return uri

    # 3. link rel="icon" / "shortcut icon"
    if homepage_html:
        m = _LINK_ICON_RE.search(homepage_html)
        if m:
            icon_url = urljoin(base_with_slash, m.group(1))
            uri = await _fetch_as_data_uri(icon_url)
            if uri:
                return uri

    # 4. /favicon.ico (legacy default)
    uri = await _fetch_as_data_uri(urljoin(base_with_slash, "/favicon.ico"))
    if uri:
        return uri

    # 5. Clearbit Logo API — works for most recognized brands
    if parsed.hostname:
        uri = await _fetch_as_data_uri(f"https://logo.clearbit.com/{parsed.hostname}")
        if uri:
            return uri

    # 6. None — caller falls back to a styled wordmark
    return None


async def _fetch_as_data_uri(url: str) -> str | None:
    try:
        resp = await _http_get(url)
    except Exception:
        return None
    if resp.status_code != 200 or not resp.content:
        return None
    ct = resp.headers.get("content-type", "image/png").split(";")[0].strip()
    if not ct.startswith("image/"):
        return None
    # Skip absurdly small responses (often broken/placeholder)
    if len(resp.content) < 100:
        return None
    b64 = base64.b64encode(resp.content).decode("ascii")
    return f"data:{ct};base64,{b64}"


def _text_tile_data_uri(business_name: str) -> str:
    """Legacy letter-tile fallback — kept for backward compatibility with tests.

    Production code path now prefers returning None from fetch_prospect_logo so
    the template can render a styled wordmark instead of an ugly initial tile.
    """
    initial = (business_name.strip()[:1] or "?").upper()
    palette = ["#5f7ea6", "#0f766e", "#7c3aed", "#b91c1c", "#b45309", "#1d4ed8"]
    color = palette[(ord(initial) if initial else 0) % len(palette)]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">'
        f'<rect width="140" height="140" fill="{color}" rx="14"/>'
        f'<text x="70" y="92" font-family="Georgia, serif" font-size="76" '
        f'fill="white" text-anchor="middle">{initial}</text>'
        f'</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
