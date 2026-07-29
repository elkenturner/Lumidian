"""Blocked-crawl detection: an audit whose every page fetch is rejected by
bot protection must fail with an actionable message — not score the challenge
page as if it were the site (MSC prod incident, 2026-07-29: two "completed"
audits with total_pages=1, the page being a Cloudflare 403 challenge)."""
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, User, WebsiteAudit, WebsiteAuditPage
from app.services.site_audit.auditor import run_audit
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


async def _make_brand(email: str, slug: str, base: str) -> int:
    async with AsyncSessionLocal() as db:
        u = User(email=email, password_hash="x", email_verified=True)
        db.add(u)
        await db.flush()
        b = Brand(name=slug, slug=slug, user_id=u.id, website_url=base, tier="basic")
        db.add(b)
        await db.commit()
        return b.id


@pytest.mark.asyncio
async def test_audit_fails_on_cloudflare_challenge():
    routes = {
        "/": (403, "text/html", CF_CHALLENGE_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        brand_id = await _make_brand("cfblock@test.com", "cfblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        assert audit.status == "failed"
        assert audit.error_message
        assert "cloudflare" in audit.error_message.lower()
        assert "LumidianAuditBot" in audit.error_message
        # No fabricated score, no challenge page persisted as a real page
        assert audit.overall_score is None
        pages = (
            await db.execute(
                select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id)
            )
        ).scalars().all()
        assert pages == []


@pytest.mark.asyncio
async def test_audit_fails_on_generic_bot_block():
    routes = {
        "/": (403, "text/html", PLAIN_403_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        brand_id = await _make_brand("plainblock@test.com", "plainblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        assert audit.status == "failed"
        assert audit.error_message
        # Generic block: no false Cloudflare attribution, still actionable
        assert "cloudflare" not in audit.error_message.lower()
        assert "LumidianAuditBot" in audit.error_message


@pytest.mark.asyncio
async def test_audit_completes_when_any_page_is_usable():
    """Homepage challenged but sitemap-discovered pages fetch fine → audit
    must proceed on the usable pages, not fail."""
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>PLACEHOLDER/page1</loc></url>
</urlset>"""
    routes = {
        "/": (403, "text/html", CF_CHALLENGE_HTML),
        "/page1": (200, "text/html", GOOD_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
    }
    async with run_server(routes) as base:
        routes_sitemap = sitemap.replace("PLACEHOLDER", base)
        # static_server routes are read per-request; register sitemap now
        routes["/sitemap.xml"] = (200, "application/xml", routes_sitemap)
        brand_id = await _make_brand("mixedblock@test.com", "mixedblock", base)
        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        assert audit.status == "completed", audit.error_message
        assert audit.total_pages >= 1
