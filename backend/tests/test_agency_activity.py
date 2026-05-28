"""Tests for the agency client activity log + notes."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, Brand, ClientActivityEvent, ClientReviewLink, ContentDraft, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "act@example.com") -> None:
    from sqlalchemy import update
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "ActCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_create_client_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    count = (await db_session.execute(
        select(func.count(ClientActivityEvent.id))
        .where(ClientActivityEvent.agency_client_id == cid, ClientActivityEvent.event_type == "client_created")
    )).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_status_change_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.patch(f"/api/agency/clients/{cid}", json={"status": "active"})
    assert resp.status_code == 200
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_status_changed",
        )
    )).scalars().all()
    assert len(events) == 1
    assert "onboarding" in events[0].body and "active" in events[0].body


@pytest.mark.asyncio
async def test_status_unchanged_does_not_emit(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Patch without status field
    resp = await client.patch(f"/api/agency/clients/{cid}", json={"retainer_amount_usd": 2500})
    assert resp.status_code == 200
    count = (await db_session.execute(
        select(func.count(ClientActivityEvent.id)).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_status_changed",
        )
    )).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_generate_review_link_emits_generated_then_rotated(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    await client.post(f"/api/agency/clients/{cid}/review-link")
    await client.post(f"/api/agency/clients/{cid}/review-link")
    types = [e.event_type for e in (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type.in_(("review_link_generated", "review_link_rotated")),
        ).order_by(ClientActivityEvent.id.asc())
    )).scalars().all()]
    assert types == ["review_link_generated", "review_link_rotated"]


@pytest.mark.asyncio
async def test_draft_sent_to_client_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, brand_id = await _create_client_via_api(client)
    draft = ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="draft", title="Hello")
    db_session.add(draft)
    await db_session.commit()
    await db_session.refresh(draft)
    resp = await client.patch(f"/api/agency/drafts/{draft.id}/status", json={"status": "awaiting_client"})
    assert resp.status_code == 204
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "draft_sent_to_client",
            ClientActivityEvent.related_draft_id == draft.id,
        )
    )).scalars().all()
    assert len(events) == 1
    assert "Hello" in events[0].body


@pytest.mark.asyncio
async def test_post_note_creates_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/activity/note",
        json={"body": "Client wants to focus on B2B SaaS"},
    )
    assert resp.status_code == 201
    out = resp.json()
    assert out["event_type"] == "note"
    assert out["body"] == "Client wants to focus on B2B SaaS"
    assert out["actor_user_id"] is not None


@pytest.mark.asyncio
async def test_note_create_validates_length(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_edit_note_author_only(client, db_session):
    await _make_agency_user(client, email="author@example.com")
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": "Original"})
    event_id = post.json()["id"]

    edit = await client.patch(f"/api/agency/activity/{event_id}/note", json={"body": "Edited"})
    assert edit.status_code == 200
    assert edit.json()["body"] == "Edited"
    assert edit.json()["updated_at"] is not None


@pytest.mark.asyncio
async def test_edit_non_note_event_404(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # The client_created event was emitted; try to PATCH it as if it were a note
    sys_event = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "client_created",
        )
    )).scalar_one()
    resp = await client.patch(f"/api/agency/activity/{sys_event.id}/note", json={"body": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_note(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": "Delete me"})
    event_id = post.json()["id"]
    resp = await client.delete(f"/api/agency/activity/{event_id}/note")
    assert resp.status_code == 204

    refreshed = await db_session.get(ClientActivityEvent, event_id)
    assert refreshed is None


@pytest.mark.asyncio
async def test_list_activity_paginates(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Post 5 notes (plus the client_created from creation = 6 events)
    for i in range(5):
        await client.post(f"/api/agency/clients/{cid}/activity/note", json={"body": f"Note {i}"})

    first = await client.get(f"/api/agency/clients/{cid}/activity?limit=3")
    assert first.status_code == 200
    page1 = first.json()
    assert len(page1) == 3
    # Order: newest first
    assert page1[0]["body"] == "Note 4"

    last_id = page1[-1]["id"]
    second = await client.get(f"/api/agency/clients/{cid}/activity?limit=10&before={last_id}")
    assert second.status_code == 200
    page2 = second.json()
    # Remaining: Note 1, Note 0, client_created = 3
    assert len(page2) == 3
    assert page2[-1]["event_type"] == "client_created"


@pytest.mark.asyncio
async def test_public_review_approve_emits_activity_event(client, db_session):
    from app.database import AsyncSessionLocal as Sess

    await _make_agency_user(client)
    cid, brand_id = await _create_client_via_api(client)
    # Create a token + a draft in awaiting_client status directly
    async with Sess() as db:
        link = ClientReviewLink(agency_client_id=cid, token="acttest-approve")
        db.add(link)
        draft = ContentDraft(
            brand_id=brand_id, platform="medium",
            content_text="x", status="awaiting_client", title="Pub-approve",
        )
        db.add(draft)
        await db.commit()
        draft_id = draft.id

    resp = await client.post(f"/api/public/review/acttest-approve/draft/{draft_id}/approve")
    assert resp.status_code == 204
    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "client_approved",
            ClientActivityEvent.related_draft_id == draft_id,
        )
    )).scalars().all()
    assert len(events) == 1
    assert events[0].actor_user_id is None  # client action — no actor
