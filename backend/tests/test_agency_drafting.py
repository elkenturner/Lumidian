"""Tests for the agency drafting endpoint + brand-type filtering."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, Brand, ClientActivityEvent, ContentDraft, Prompt, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "draft@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_agency_client(client, name: str = "DraftCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_new_client_brand_type_is_agency(client, db_session):
    await _make_agency_user(client)
    _, brand_id = await _create_agency_client(client)
    brand = await db_session.get(Brand, brand_id)
    assert brand.brand_type == "agency"


@pytest.mark.asyncio
async def test_saas_brand_list_excludes_agency_brands(client, db_session):
    await _make_agency_user(client)
    await _create_agency_client(client, name="HiddenCo")
    me = (await db_session.execute(select(User).where(User.email == "draft@example.com"))).scalar_one()
    db_session.add(Brand(name="VisibleCo", slug="visible-co", user_id=me.id, brand_type="standard"))
    await db_session.commit()

    resp = await client.get("/api/brands")
    assert resp.status_code == 200
    names = {b["name"] for b in resp.json()}
    assert "VisibleCo" in names
    assert "HiddenCo" not in names


@pytest.mark.asyncio
async def test_generate_draft_returns_201_with_mocked_llm(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    db_session.add(Prompt(brand_id=brand_id, text="What is the best CRM for B2B SaaS?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()

    # generate_gap_draft side-effect: persist a real ContentDraft into the endpoint's
    # db session so FK constraints and db.refresh() both work correctly.
    async def _fake_generate(db, brand_id, prompt_id, platform, **kwargs):
        draft = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=platform,
            status="draft",
            title="Mock title",
            content_text="Mock body",
            source="agency",
        )
        db.add(draft)
        await db.flush()  # assigns draft.id without committing
        return draft

    # Patch the symbol where the agency router imports it from
    with patch(
        "app.routers.agency.generate_gap_draft",
        new=AsyncMock(side_effect=_fake_generate),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/drafts/generate",
            json={"prompt_id": prompt.id, "platform": "medium"},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["platform"] == "medium"
    assert body["title"] == "Mock title"

    # Expire the session cache so we read fresh from DB
    db_session.expire_all()
    events = (
        await db_session.execute(
            select(ClientActivityEvent).where(
                ClientActivityEvent.agency_client_id == cid,
                ClientActivityEvent.event_type == "draft_generated_by_staff",
            )
        )
    ).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_generate_draft_rejects_unknown_prompt(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_agency_client(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": 99999, "platform": "medium"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_generate_draft_rejects_unsupported_platform(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    db_session.add(Prompt(brand_id=brand_id, text="Q?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": prompt.id, "platform": "bogusnet"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_draft_rejects_when_brand_not_agency_tier(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    await db_session.execute(update(Brand).where(Brand.id == brand_id).values(brand_type="standard"))
    await db_session.commit()
    db_session.add(Prompt(brand_id=brand_id, text="Q?"))
    await db_session.commit()
    prompt = (await db_session.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalar_one()
    resp = await client.post(
        f"/api/agency/clients/{cid}/drafts/generate",
        json={"prompt_id": prompt.id, "platform": "medium"},
    )
    assert resp.status_code == 400
