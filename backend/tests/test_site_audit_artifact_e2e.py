"""End-to-end test for the artifact draft flow: rule-based jsonld_org."""
import pytest
from httpx import AsyncClient, ASGITransport

from app.database import AsyncSessionLocal
from app.main import app
from app.models import (
    BrandProfile,
    WebsiteAudit,
    WebsiteAuditRecommendation,
    utcnow,
)
from tests.conftest import create_brand, register_and_login


async def _make_brand_audit_rec(
    user_email: str,
    *,
    subscription_tier: str | None = "starter",
    artifact_type: str | None = "jsonld_org",
) -> tuple[AsyncClient, int]:
    ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await register_and_login(ac, email=user_email)
    # Promote to paid tier BEFORE brand creation (brand-create checks tier).
    if subscription_tier is not None:
        from app.models import User
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            u = (
                await db.execute(select(User).where(User.email == user_email))
            ).scalar_one()
            u.subscription_tier = subscription_tier
            await db.commit()
    brand_dict = await create_brand(ac, name="Acme Co")
    async with AsyncSessionLocal() as db:
        profile = BrandProfile(
            brand_id=brand_dict["id"],
            company_description="Acme makes anvils.",
            publications="https://twitter.com/acme\nhttps://linkedin.com/company/acme",
        )
        db.add(profile)
        audit = WebsiteAudit(
            brand_id=brand_dict["id"],
            status="completed",
            triggered_by="user",
            started_at=utcnow(),
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        rec = WebsiteAuditRecommendation(
            audit_id=audit.id,
            priority="high",
            effort="low",
            category="schema",
            title="Add Organization JSON-LD",
            body="…",
            artifact_type=artifact_type,
        )
        db.add(rec)
        await db.commit()
        await db.refresh(rec)
        return ac, rec.id


@pytest.mark.asyncio
async def test_draft_jsonld_org_end_to_end():
    ac, rec_id = await _make_brand_audit_rec("e2e-org@test.com")
    try:
        r = await ac.post(f"/api/site-audit/recommendation/{rec_id}/draft")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["artifact_type"] == "jsonld_org"
        assert "Organization" in data["artifact"]
        assert "Acme Co" in data["artifact"]
        assert "example.com" in data["artifact"]
        assert "twitter.com/acme" in data["artifact"]  # sameAs from publications
        # Persisted on the row
        async with AsyncSessionLocal() as db:
            rec = await db.get(WebsiteAuditRecommendation, rec_id)
            assert rec.artifact is not None
            assert rec.artifact_generated_at is not None
            assert rec.artifact_regen_count == 0
    finally:
        await ac.aclose()


@pytest.mark.asyncio
async def test_draft_regenerate_increments_counter():
    ac, rec_id = await _make_brand_audit_rec("e2e-regen@test.com")
    try:
        await ac.post(f"/api/site-audit/recommendation/{rec_id}/draft")
        r = await ac.post(
            f"/api/site-audit/recommendation/{rec_id}/draft",
            json={"regenerate_notes": "make socials shorter"},
        )
        assert r.status_code == 200
        async with AsyncSessionLocal() as db:
            rec = await db.get(WebsiteAuditRecommendation, rec_id)
            assert rec.artifact_regen_count == 1
    finally:
        await ac.aclose()


@pytest.mark.asyncio
async def test_draft_rejects_rec_without_artifact_type():
    ac, rec_id = await _make_brand_audit_rec(
        "e2e-no-type@test.com", artifact_type=None
    )
    try:
        r = await ac.post(f"/api/site-audit/recommendation/{rec_id}/draft")
        assert r.status_code == 400
        assert "artifact_type" in r.json()["detail"]
    finally:
        await ac.aclose()


@pytest.mark.asyncio
async def test_draft_llm_type_blocked_for_basic_tier():
    ac, rec_id = await _make_brand_audit_rec(
        "e2e-basic@test.com",
        subscription_tier="basic",
        artifact_type="meta_title",  # LLM type
    )
    try:
        r = await ac.post(f"/api/site-audit/recommendation/{rec_id}/draft")
        assert r.status_code == 402
    finally:
        await ac.aclose()
