"""Logo fetch fallback chain: og:image → favicon → text tile."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.logo_fetch import fetch_prospect_logo, _text_tile_data_uri


@pytest.mark.asyncio
async def test_og_image_present_returns_og_image():
    html = '<html><head><meta property="og:image" content="https://example.com/logo.png"></head></html>'
    image_bytes = b"\x89PNG\r\n\x1a\nfake"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/logo.png":
            return _MockResp(200, "image/png", image_bytes)
        raise AssertionError(f"unexpected url {url}")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_og_image_absent_falls_back_to_favicon():
    html = "<html><head><title>No og image</title></head></html>"
    favicon_bytes = b"\x00\x00\x01\x00fake"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/favicon.ico":
            return _MockResp(200, "image/x-icon", favicon_bytes)
        raise AssertionError(f"unexpected url {url}")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/x-icon;base64,")


@pytest.mark.asyncio
async def test_all_fallbacks_fail_returns_text_tile():
    async def fake_get(url, timeout=10):
        raise RuntimeError("network down")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/svg+xml;base64,")


def test_text_tile_uses_first_letter():
    uri = _text_tile_data_uri("Acme Dental")
    import base64
    svg = base64.b64decode(uri.split(",", 1)[1]).decode()
    # Should contain the letter A (uppercase first letter of "Acme")
    assert ">A<" in svg


class _MockResp:
    def __init__(self, status: int, content_type: str, body: bytes):
        self.status_code = status
        self.headers = {"content-type": content_type}
        self.content = body
        self.text = body.decode(errors="replace")
