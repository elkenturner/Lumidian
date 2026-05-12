"""Sanity tests that the new site_audit models register and persist."""
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, User, WebsiteAudit, WebsiteAuditPage,
    WebsiteAuditFinding, WebsiteAuditRecommendation, CitationSource,
    utcnow,
)


@pytest.mark.asyncio
async def test_website_audit_round_trip():
    async with AsyncSessionLocal() as db:
        user = User(email="a@x.com", password_hash="x", email_verified=True)
        db.add(user)
        await db.flush()
        brand = Brand(name="B", slug="b", user_id=user.id, website_url="https://b.com")
        db.add(brand)
        await db.flush()

        audit = WebsiteAudit(
            brand_id=brand.id, status="pending", triggered_by="user", started_at=utcnow()
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)

        assert audit.id is not None

        page = WebsiteAuditPage(
            audit_id=audit.id, url="https://b.com/", depth=0, page_type="homepage"
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        assert page.id is not None

        finding = WebsiteAuditFinding(
            audit_id=audit.id, page_id=page.id, check_id="missing_h1",
            severity="high", category="content", message="No H1 found", evidence="{}",
        )
        rec = WebsiteAuditRecommendation(
            audit_id=audit.id, page_id=page.id, priority="high", effort="low",
            category="content", title="Add an H1", body="...",
        )
        cite = CitationSource(
            brand_id=brand.id, tracking_run_id=None, prompt_id=None, query_result_id=None,
            model="chatgpt", url="https://x.com/a", domain="x.com", kind="competitor",
        )
        # NOTE: tracking_run_id / prompt_id / query_result_id are FK-nullable for this smoke
        db.add_all([finding, rec, cite])
        await db.commit()

        rows = (await db.execute(select(WebsiteAuditFinding))).scalars().all()
        assert len(rows) == 1
