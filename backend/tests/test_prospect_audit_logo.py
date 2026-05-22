"""Logo fetch fallback chain: og:image → apple-touch-icon → link icon → favicon → Clearbit → None."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.logo_fetch import fetch_prospect_logo, _text_tile_data_uri


# Reasonable image payload — over the 100-byte minimum filter
_IMG_BYTES = b"\x89PNG\r\n\x1a\nfake" + b"\x00" * 200


@pytest.mark.asyncio
async def test_og_image_present_returns_og_image():
    html = '<html><head><meta property="og:image" content="https://example.com/logo.png"></head></html>'

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/logo.png":
            return _MockResp(200, "image/png", _IMG_BYTES)
        return _MockResp(404, "text/plain", b"not found")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri is not None
    assert uri.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_og_image_absent_falls_back_to_apple_touch():
    html = '<html><head><link rel="apple-touch-icon" href="/apple.png"></head></html>'

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/apple.png":
            return _MockResp(200, "image/png", _IMG_BYTES)
        return _MockResp(404, "text/plain", b"")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri is not None
    assert uri.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_falls_back_to_favicon_when_no_meta_tags():
    html = "<html><head><title>No og image</title></head></html>"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/favicon.ico":
            return _MockResp(200, "image/x-icon", _IMG_BYTES)
        return _MockResp(404, "text/plain", b"")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri is not None
    assert uri.startswith("data:image/x-icon;base64,")


@pytest.mark.asyncio
async def test_falls_back_to_clearbit_when_site_offers_nothing():
    """When the site has no logo assets, try the Clearbit fallback."""
    html = "<html><head><title>nothing</title></head></html>"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url.startswith("https://logo.clearbit.com/"):
            return _MockResp(200, "image/png", _IMG_BYTES)
        return _MockResp(404, "text/plain", b"")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri is not None
    assert uri.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_all_fallbacks_fail_returns_none():
    """If every source fails, return None — caller renders a styled wordmark instead."""
    async def fake_get(url, timeout=10):
        raise RuntimeError("network down")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri is None


def test_text_tile_uses_first_letter():
    """The legacy text-tile helper is still available for callers that want it."""
    uri = _text_tile_data_uri("Acme Dental")
    import base64
    svg = base64.b64decode(uri.split(",", 1)[1]).decode()
    assert ">A<" in svg


class _MockResp:
    def __init__(self, status: int, content_type: str, body: bytes):
        self.status_code = status
        self.headers = {"content-type": content_type}
        self.content = body
        self.text = body.decode(errors="replace")
