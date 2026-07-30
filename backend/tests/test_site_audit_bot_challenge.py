"""Blocked-crawl handling: when bot protection rejects the standard crawler the
audit escalates (browser headers → rendered browser) before failing with an
actionable message — and never scores a challenge page as if it were the site
(MSC prod incident, 2026-07-29: two "completed" audits with total_pages=1, the
page being a Cloudflare 403 challenge)."""
from contextlib import asynccontextmanager

import pytest
from aiohttp import web
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, User, WebsiteAudit, WebsiteAuditFinding, WebsiteAuditPage
from app.services.site_audit import auditor as auditor_mod
from app.services.site_audit.auditor import run_audit
from app.services.site_audit.fetcher import FetchResult
from tests.fixtures.site_audit.static_server import run_server


CF_CHALLENGE_HTML = """<html><head><title>Just a moment...</title></head>
<body><noscript>Enable JavaScript and cookies to continue</noscript>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
<div id="challenge-running">Checking your browser before accessing the site.</div>
</body></html>"""

PLAIN_403_HTML = "<html><body><h1>403 Forbidden</h1></body></html>"

GOOD_HTML = """<html><head><title>Acme Pricing</title></head><body>
<h1>Acme Pricing</h1><p>Acme costs $99 per month for the Pro plan as of 2025.
Volume discounts start at 50 seats and include priority support.</p>
</body></html>"""

ROBOTS_OK = "User-agent: *\nAllow: /\n"


@asynccontextmanager
async def _blocked_rendered_session(concurrency: int = 2):
    """Fake rendered session: the challenge blocks a real browser too."""
    async def _fetch(url: str, timeout_s: float = 10.0) -> FetchResult:
        return FetchResult(url=url, status=403, html=CF_CHALLENGE_HTML, fetch_ms=5)
    yield _fetch


@asynccontextmanager
async def _good_rendered_session(concurrency: int = 2):
    """Fake rendered session: the browser passes the challenge."""
    async def _fetch(url: str, timeout_s: float = 10.0) -> FetchResult:
        return FetchResult(url=url, status=200, html=GOOD_HTML, fetch_ms=5)
    yield _fetch


@asynccontextmanager
async def run_ua_server(bot_response, browser_response, extra_routes=None):
    """Server that discriminates by User-Agent, like a UA-based WAF rule."""
    async def handler(request: web.Request) -> web.Response:
        if extra_routes and request.path in extra_routes:
            status, ctype, body = extra_routes[request.path]
            return web.Response(status=status, content_type=ctype, text=body)
        ua = request.headers.get("User-Agent", "")
        status, ctype, body = bot_response if "LumidianAuditBot" in ua else browser_response
        return web.Response(status=status, content_type=ctype, text=body)

    app = web.Application()
    app.router.add_route("GET", "/{path:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        await runner.cleanup()


async def _make_brand(email: str, slug: str, base: str) -> int:
    async with AsyncSessionLocal() as db:
        u = User(email=email, password_hash="x", email_verified=True)
        db.add(u)
        await db.flush()
        b = Brand(name=slug, slug=slug, user_id=u.id, website_url=base, tier="basic")
        db.add(b)
        await db.commit()
        return b.id


async def _get_audit(audit_id: int) -> WebsiteAudit:
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        assert audit is not None
        return audit


async def _site_finding_ids(audit_id: int) -> set[str]:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(WebsiteAuditFinding.check_id).where(
                    WebsiteAuditFinding.audit_id == audit_id,
                    WebsiteAuditFinding.page_id.is_(None),
                )
            )
        ).scalars().all()
        return set(rows)


@pytest.mark.asyncio
async def test_audit_escalates_to_browser_headers_when_bot_ua_blocked():
    """UA-based WAF rule: bot UA challenged, browser headers pass — the audit
    must complete via the browser-header fallback and record the finding."""
    async with run_ua_server(
        bot_response=(403, "text/html", CF_CHALLENGE_HTML),
        browser_response=(200, "text/html", GOOD_HTML),
        extra_routes={"/robots.txt": (200, "text/plain", ROBOTS_OK)},
    ) as base:
        brand_id = await _make_brand("uablock@test.com", "uablock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    audit = await _get_audit(audit_id)
    assert audit.status == "completed", audit.error_message
    assert audit.total_pages >= 1
    assert "bot_protection_challenge" in await _site_finding_ids(audit_id)


@pytest.mark.asyncio
async def test_audit_escalates_to_rendered_crawl(monkeypatch):
    """Everything non-browser is challenged; a real (rendered) browser passes —
    the audit must complete via the rendered fallback."""
    monkeypatch.setattr(auditor_mod, "rendered_fetch_session", _good_rendered_session)
    routes = {
        "/": (403, "text/html", CF_CHALLENGE_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        brand_id = await _make_brand("rendered@test.com", "rendered", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    audit = await _get_audit(audit_id)
    assert audit.status == "completed", audit.error_message
    assert audit.total_pages >= 1
    # Raw fetches were blocked, so raw-vs-rendered comparison is impossible
    assert audit.render_mode == "unknown"
    assert "bot_protection_challenge" in await _site_finding_ids(audit_id)


@pytest.mark.asyncio
async def test_audit_fails_on_cloudflare_challenge(monkeypatch):
    """Full ladder exhausted (even the rendered browser is challenged) →
    fail with the actionable Cloudflare message, no fabricated score."""
    monkeypatch.setattr(auditor_mod, "rendered_fetch_session", _blocked_rendered_session)
    routes = {
        "/": (403, "text/html", CF_CHALLENGE_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        brand_id = await _make_brand("cfblock@test.com", "cfblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    audit = await _get_audit(audit_id)
    assert audit.status == "failed"
    assert audit.error_message
    assert "cloudflare" in audit.error_message.lower()
    assert "LumidianAuditBot" in audit.error_message
    assert audit.overall_score is None
    async with AsyncSessionLocal() as db:
        pages = (
            await db.execute(
                select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id)
            )
        ).scalars().all()
        assert pages == []


@pytest.mark.asyncio
async def test_audit_fails_on_generic_bot_block(monkeypatch):
    monkeypatch.setattr(auditor_mod, "rendered_fetch_session", _blocked_rendered_session)
    routes = {
        "/": (403, "text/html", PLAIN_403_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        brand_id = await _make_brand("plainblock@test.com", "plainblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    audit = await _get_audit(audit_id)
    assert audit.status == "failed"
    assert audit.error_message
    # Generic block: no false Cloudflare attribution, still actionable
    assert "cloudflare" not in audit.error_message.lower()
    assert "LumidianAuditBot" in audit.error_message


@pytest.mark.asyncio
async def test_audit_completes_when_any_page_is_usable():
    """Homepage challenged but sitemap-discovered pages fetch fine → audit
    must proceed on the usable pages without escalating or failing."""
    sitemap = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>PLACEHOLDER/page1</loc></url>
</urlset>"""
    routes = {
        "/": (403, "text/html", CF_CHALLENGE_HTML),
        "/page1": (200, "text/html", GOOD_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        # static_server reads routes per-request; register sitemap now
        routes["/sitemap.xml"] = (200, "application/xml", sitemap.replace("PLACEHOLDER", base))
        brand_id = await _make_brand("mixedblock@test.com", "mixedblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    audit = await _get_audit(audit_id)
    assert audit.status == "completed", audit.error_message
    assert audit.total_pages >= 1
