import pytest
from httpx import AsyncClient, ASGITransport

from app.database import AsyncSessionLocal
from app.main import app
from app.models import (
    Brand,
    WebsiteAudit,
    WebsiteAuditRecommendation,
    utcnow,
)
from tests.conftest import create_brand, register_and_login


async def _make_rec(user_email: str) -> tuple[AsyncClient, int]:
    """Create (brand, audit, recommendation) chain owned by `user_email`."""
    ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await register_and_login(ac, email=user_email)
    brand_dict = await create_brand(ac, name="Status Test Brand")
    async with AsyncSessionLocal() as db:
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
            title="Test rec",
            body="Body",
        )
        db.add(rec)
        await db.commit()
        await db.refresh(rec)
        rec_id = rec.id
    return ac, rec_id


@pytest.mark.asyncio
async def test_status_update_rejects_bad_value():
    ac, rec_id = await _make_rec("status-bad@test.com")
    try:
        r = await ac.patch(
            f"/api/site-audit/recommendation/{rec_id}/status",
            json={"status": "bogus"},
        )
        assert r.status_code == 400
    finally:
        await ac.aclose()


@pytest.mark.asyncio
async def test_status_update_applies():
    ac, rec_id = await _make_rec("status-ok@test.com")
    try:
        r = await ac.patch(
            f"/api/site-audit/recommendation/{rec_id}/status",
            json={"status": "applied"},
        )
        assert r.status_code == 204
        async with AsyncSessionLocal() as db:
            rec = await db.get(WebsiteAuditRecommendation, rec_id)
            assert rec.status == "applied"
    finally:
        await ac.aclose()


@pytest.mark.asyncio
async def test_status_update_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.patch(
            "/api/site-audit/recommendation/1/status",
            json={"status": "applied"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_status_update_404_for_missing_rec():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await register_and_login(ac, email="status-404@test.com")
        r = await ac.patch(
            "/api/site-audit/recommendation/99999/status",
            json={"status": "applied"},
        )
    assert r.status_code == 404
