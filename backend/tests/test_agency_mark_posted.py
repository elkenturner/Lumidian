"""Tests for the agency mark-posted endpoint."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import (
    AgencyStaff,
    Brand,
    ContentDraft,
    ContentPost,
    Prompt,
    User,
)
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "mp@example.com") -> None:
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


async def _create_agency_client(client, name: str = "MPCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


async def _create_approved_draft(brand_id: int, platform: str = "linkedin") -> int:
    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=brand_id, text="test", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        d = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt.id,
            platform=platform,
            status="approved",
            title="My draft",
            content_text="body",
            source="manual",
        )
        db.add(d)
        await db.commit()
        return d.id


@pytest.mark.asyncio
async def test_mark_posted_with_url(client):
    await _make_agency_user(client)
    _cid, bid = await _create_agency_client(client)
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted",
        json={"post_url": "https://linkedin.com/posts/12345"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "posted"
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        posts = post_q.scalars().all()
        assert len(posts) == 1
        assert posts[0].post_url == "https://linkedin.com/posts/12345"
        assert posts[0].platform == "linkedin"


@pytest.mark.asyncio
async def test_mark_posted_without_url(client):
    await _make_agency_user(client, email="mp2@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo2")
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted",
        json={},
    )
    assert resp.status_code == 200, resp.text
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        post = post_q.scalar_one()
        assert post.post_url is None


@pytest.mark.asyncio
async def test_mark_posted_non_approved_returns_409(client):
    await _make_agency_user(client, email="mp3@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo3")
    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=bid, text="test", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        d = ContentDraft(
            brand_id=bid,
            prompt_id=prompt.id,
            platform="linkedin",
            status="draft",
            title="t",
            content_text="b",
            source="manual",
        )
        db.add(d)
        await db.commit()
        draft_id = d.id
    resp = await client.post(f"/api/agency/drafts/{draft_id}/mark-posted", json={})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_mark_posted_non_agency_brand_returns_400(client, db_session):
    await _make_agency_user(client, email="mp4@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo4")
    await db_session.execute(update(Brand).where(Brand.id == bid).values(agency_client_id=None))
    await db_session.commit()
    draft_id = await _create_approved_draft(bid)
    resp = await client.post(f"/api/agency/drafts/{draft_id}/mark-posted", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_mark_posted_idempotent(client):
    await _make_agency_user(client, email="mp5@example.com")
    _cid, bid = await _create_agency_client(client, name="MPCo5")
    draft_id = await _create_approved_draft(bid)
    r1 = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted", json={"post_url": "https://x.com/1"}
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/agency/drafts/{draft_id}/mark-posted", json={"post_url": "https://x.com/2"}
    )
    assert r2.status_code == 200
    async with AsyncSessionLocal() as db:
        post_q = await db.execute(select(ContentPost).where(ContentPost.draft_id == draft_id))
        assert len(post_q.scalars().all()) == 1


@pytest.mark.asyncio
async def test_mark_posted_unknown_draft_404(client):
    await _make_agency_user(client, email="mp6@example.com")
    resp = await client.post("/api/agency/drafts/99999/mark-posted", json={})
    assert resp.status_code == 404
