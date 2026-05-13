"""Tests for the agency weekly report template."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import (
    AgencyClient,
    AgencyStaff,
    Brand,
    ContentDraft,
    Prompt,
    TrackingRun,
    User,
)
from app.services.document_engine import get_template, list_templates
from app.services.document_engine.agency_weekly_report import fetch_data
from tests.conftest import register_and_login


# Copied verbatim from tests/test_agency_tracking.py (known-working helpers)
async def _make_agency_user(client, email: str = "weekly@example.com") -> None:
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


async def _create_agency_client(client, name: str = "WeeklyCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


def test_template_is_registered():
    t = get_template("agency_weekly_report")
    assert t is not None
    assert "agency_weekly_report" in {x.kind for x in list_templates()}


@pytest.mark.asyncio
async def test_fetch_data_empty_brand(client):
    await _make_agency_user(client)
    cid, _bid = await _create_agency_client(client)
    async with AsyncSessionLocal() as db:
        ac = await db.get(AgencyClient, cid)
        data = await fetch_data(db, ac)
    assert data["client"]["name"] == "WeeklyCo"
    assert data["this_week_run"] is None
    assert data["per_prompt"] == []
    assert data["competitors"] == []
    assert data["content_shipped"] == []


@pytest.mark.asyncio
async def test_fetch_data_with_run_and_draft(client):
    await _make_agency_user(client, email="weekly2@example.com")
    cid, bid = await _create_agency_client(client, name="WeeklyCo2")
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        # Insert a Prompt first so any FK constraints are satisfied
        prompt = Prompt(brand_id=bid, text="test prompt", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        db.add(
            TrackingRun(
                brand_id=bid,
                status="completed",
                run_type="scheduled",
                overall_score=42.5,
                total_queries=12,
                total_mentions=5,
                completed_at=now - timedelta(hours=1),
                started_at=now - timedelta(hours=1, minutes=2),
            )
        )
        db.add(
            ContentDraft(
                brand_id=bid,
                prompt_id=prompt.id,
                platform="linkedin",
                status="posted",
                title="hello",
                content_text="hi",
                source="manual",
                posted_at=now - timedelta(days=1),
            )
        )
        await db.commit()

        ac = await db.get(AgencyClient, cid)
        data = await fetch_data(db, ac)

    assert data["this_week_run"]["overall_score"] == 42.5
    assert data["content_shipped"] == [{"platform": "linkedin", "count": 1}]
    assert data["has_data"] is True


@pytest.mark.asyncio
async def test_run_agency_brand_and_report_calls_both():
    from app.scheduler import _run_agency_brand_and_report

    with patch("app.scheduler._safe_run", new=AsyncMock(return_value=None)) as safe_run:
        await _run_agency_brand_and_report(brand_id=1, client_id=1)

    assert safe_run.await_count == 1


@pytest.mark.asyncio
async def test_run_agency_brand_and_report_swallows_errors():
    from app.scheduler import _run_agency_brand_and_report

    with patch("app.scheduler._safe_run", new=AsyncMock(return_value=None)), \
         patch(
             "app.services.document_engine.generate_document",
             new=AsyncMock(side_effect=RuntimeError("boom")),
         ):
        await _run_agency_brand_and_report(brand_id=1, client_id=1)


@pytest.mark.asyncio
async def test_create_document_with_weekly_kind(client):
    await _make_agency_user(client, email="weekly3@example.com")
    cid, _bid = await _create_agency_client(client, name="WeeklyCo3")
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Weekly report\n\nstub body"),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/documents",
            json={"kind": "agency_weekly_report"},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "agency_weekly_report"
    assert body["title"].startswith("Weekly report")
