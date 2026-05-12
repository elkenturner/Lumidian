import pytest

from app.services.site_audit.fetcher import (
    fetch_raw, fetch_rendered, classify_render_mode, FetchResult,
)
from tests.fixtures.site_audit.static_server import run_server

SSR_BODY = "<html><body><h1>Real Page</h1><p>Lots of server-side content here. " + ("blah " * 200) + "</p></body></html>"
SPA_SHELL = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'


@pytest.mark.asyncio
async def test_fetch_raw_returns_html():
    async with run_server({"/": (200, "text/html", SSR_BODY)}) as base:
        res = await fetch_raw(base + "/")
        assert isinstance(res, FetchResult)
        assert res.status == 200
        assert "Real Page" in res.html
        assert res.error is None


@pytest.mark.asyncio
async def test_fetch_raw_handles_404():
    async with run_server({}) as base:
        res = await fetch_raw(base + "/missing")
        assert res.status == 404
        assert res.error is None  # 404 is not an "error" — it's a status


@pytest.mark.asyncio
async def test_fetch_raw_timeout(monkeypatch):
    # set very small timeout to force trip
    res = await fetch_raw("http://10.255.255.1/", timeout_s=0.5)
    assert res.status is None
    assert res.error and "timeout" in res.error.lower() or "connect" in res.error.lower()


@pytest.mark.asyncio
async def test_classify_render_mode_ssr():
    assert classify_render_mode(SSR_BODY, SSR_BODY) == "ssr"


@pytest.mark.asyncio
async def test_classify_render_mode_csr():
    rendered = "<html><body><h1>After JS</h1>" + ("content " * 200) + "</body></html>"
    assert classify_render_mode(SPA_SHELL, rendered) == "csr"


@pytest.mark.asyncio
async def test_classify_render_mode_noscript_marker():
    raw = '<html><body><noscript>You need to enable JavaScript</noscript></body></html>'
    assert classify_render_mode(raw, raw) == "csr"


@pytest.mark.asyncio
async def test_fetch_rendered_against_static_server():
    async with run_server({"/": (200, "text/html", SSR_BODY)}) as base:
        res = await fetch_rendered(base + "/")
        assert res.status == 200
        assert "Real Page" in res.html
