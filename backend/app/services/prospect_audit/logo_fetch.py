"""Resolve a prospect's logo as a data URI for embedding in the PDF.

Fallback chain: og:image meta tag → /favicon.ico → text-tile SVG (first letter).
All network calls are best-effort — any failure cascades to the next step.
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


async def _http_get(url: str, timeout: float = 10):
    """Wrapped so tests can patch one symbol."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        return await client.get(url)


async def fetch_prospect_logo(website_url: str, business_name: str) -> str:
    """Return a data URI for the prospect's logo. Never raises."""
    base = website_url.rstrip("/")

    # 1. og:image
    try:
        resp = await _http_get(base)
        ct = resp.headers.get("content-type", "")
        if resp.status_code == 200 and "html" in ct.lower():
            m = _OG_IMAGE_RE.search(resp.text)
            if m:
                og_url = urljoin(base + "/", m.group(1))
                uri = await _fetch_as_data_uri(og_url)
                if uri:
                    return uri
    except Exception as exc:
        logger.debug("prospect logo og:image fetch failed for %s: %s", base, exc)

    # 2. favicon
    try:
        favicon_url = urljoin(base + "/", "/favicon.ico")
        uri = await _fetch_as_data_uri(favicon_url)
        if uri:
            return uri
    except Exception as exc:
        logger.debug("prospect logo favicon fetch failed for %s: %s", base, exc)

    # 3. text tile
    return _text_tile_data_uri(business_name)


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
    b64 = base64.b64encode(resp.content).decode("ascii")
    return f"data:{ct};base64,{b64}"


def _text_tile_data_uri(business_name: str) -> str:
    """Generate a small colored-square SVG with the business's first letter."""
    initial = (business_name.strip()[:1] or "?").upper()
    # Deterministic color from the initial — feels less random than literal random
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
