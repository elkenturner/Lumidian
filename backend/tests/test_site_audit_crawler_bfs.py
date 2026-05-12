import asyncio

import pytest

from app.services.site_audit.crawler import crawl_site, CrawlPage
from tests.fixtures.site_audit.static_server import run_server


HOME_HTML = '<html><body><a href="/a">A</a><a href="/b">B</a><a href="https://other.com/x">Other</a></body></html>'
A_HTML = '<html><body><a href="/c">C</a></body></html>'
B_HTML = '<html><body><h1>B</h1></body></html>'
C_HTML = '<html><body><h1>C</h1></body></html>'


@pytest.mark.asyncio
async def test_bfs_discovers_internal_links_only():
    routes = {
        "/": (200, "text/html", HOME_HTML),
        "/a": (200, "text/html", A_HTML),
        "/b": (200, "text/html", B_HTML),
        "/c": (200, "text/html", C_HTML),
    }
    async with run_server(routes) as base:
        pages = await crawl_site(base + "/", max_pages=10, max_depth=3, seed_urls=None)
        urls = {p.url for p in pages}
        assert any(u.endswith("/") for u in urls)
        assert any(u.endswith("/a") for u in urls)
        assert any(u.endswith("/b") for u in urls)
        assert any(u.endswith("/c") for u in urls)
        # cross-host link not followed
        assert not any("other.com" in u for u in urls)


@pytest.mark.asyncio
async def test_bfs_respects_max_pages():
    routes = {f"/p{i}": (200, "text/html", HOME_HTML) for i in range(20)}
    routes["/"] = (200, "text/html",
                   "".join(f'<a href="/p{i}">p</a>' for i in range(20)))
    async with run_server(routes) as base:
        pages = await crawl_site(base + "/", max_pages=5, max_depth=3, seed_urls=None)
        assert len(pages) <= 5


@pytest.mark.asyncio
async def test_bfs_uses_seed_urls_when_provided():
    routes = {
        "/": (200, "text/html", HOME_HTML),
        "/seeded": (200, "text/html", A_HTML),
    }
    async with run_server(routes) as base:
        seeds = [f"{base}/seeded"]
        pages = await crawl_site(base + "/", max_pages=10, max_depth=1, seed_urls=seeds)
        urls = {p.url for p in pages}
        assert any(u.endswith("/seeded") for u in urls)
