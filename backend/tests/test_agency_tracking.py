"""Tests for the agency tracking trigger endpoint."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, Brand, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "track@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_agency_client(client, name: str = "TrackCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_trigger_tracking_returns_202(client):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    with patch(
        "app.services.tracking_service.run_tracking",
        new=AsyncMock(return_value=1),
    ):
        resp = await client.post(f"/api/agency/clients/{cid}/tracking/run")
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["brand_id"] == brand_id


@pytest.mark.asyncio
async def test_trigger_tracking_rejects_non_agency_brand(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    await db_session.execute(update(Brand).where(Brand.id == brand_id).values(brand_type="standard"))
    await db_session.commit()
    resp = await client.post(f"/api/agency/clients/{cid}/tracking/run")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_trigger_tracking_unknown_client_404(client):
    await _make_agency_user(client)
    resp = await client.post("/api/agency/clients/9999/tracking/run")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_weekly_agency_sweep_is_registered():
    from app.scheduler import scheduler, start_scheduler, stop_scheduler

    start_scheduler()
    try:
        job_ids = {j.id for j in scheduler.get_jobs()}
        assert "weekly_agency_sweep" in job_ids
    finally:
        stop_scheduler()
