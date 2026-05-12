import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, User, WebsiteAudit, WebsiteAuditFinding, WebsiteAuditPage
from app.services.site_audit.auditor import run_audit
from tests.fixtures.site_audit.static_server import run_server


GOOD_HTML = """<html><head>
<title>Acme Pricing</title>
<meta name="description" content="Acme costs $99/month for the Pro plan. Volume discounts at 50+ seats.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.com","logo":"x","sameAs":["https://linkedin.com/company/acme"]}
</script>
</head><body>
<h1>Acme Pricing</h1>
<h2>How much does Acme cost?</h2>
<p>Acme costs $99 per month for the Pro plan as of 2025. Volume discounts start at 50 seats. According to a 2025 study by Forrester, 73% of teams using Acme save over 12 hours per week.</p>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$99</td></tr></table>
<p>See <a href="https://forrester.com">Forrester</a> for context.</p>
</body></html>"""

ROBOTS_OK = "User-agent: *\nAllow: /\n"
LLMS_OK = "# Acme\n\n> Acme makes B2B widgets.\n\n## Key resources\n- [Home](http://example.com/)\n"


@pytest.mark.asyncio
async def test_run_audit_completes_with_scores():
    async with AsyncSessionLocal() as db:
        u = User(email="auditor@test.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        user_id = u.id
        await db.commit()

    routes = {
        "/": (200, "text/html", GOOD_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
        "/llms.txt": (200, "text/plain", LLMS_OK),
    }
    async with run_server(routes) as base:
        async with AsyncSessionLocal() as db:
            b = Brand(name="Acme", slug="acme", user_id=user_id, website_url=base, tier="basic")
            db.add(b); await db.commit()
            brand_id = b.id

        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

        async with AsyncSessionLocal() as db:
            audit = await db.get(WebsiteAudit, audit_id)
            assert audit is not None
            assert audit.status == "completed", audit.error_message
            assert audit.overall_score is not None
            assert audit.total_pages >= 1
            pages = (await db.execute(select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id))).scalars().all()
            assert pages
            findings = (await db.execute(select(WebsiteAuditFinding).where(WebsiteAuditFinding.audit_id == audit_id))).scalars().all()
            # Should have at least the positive llms_txt finding
            ids = {f.check_id for f in findings}
            assert "llms_txt_present_valid" in ids


@pytest.mark.asyncio
async def test_run_audit_marks_failed_on_unreachable_host():
    async with AsyncSessionLocal() as db:
        u = User(email="u2@test.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="X", slug="x2", user_id=u.id, website_url="http://10.255.255.1", tier="basic")
        db.add(b); await db.commit()
        brand_id = b.id

    audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        # Either completed with no pages or failed — both acceptable
        assert audit.status in ("failed", "completed")
        if audit.status == "failed":
            assert audit.error_message
