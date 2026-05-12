"""Tests for the public client review router (no auth)."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import (
    AgencyClient,
    AgencyStaff,
    Brand,
    ClientReviewLink,
    ContentDraft,
    Notification,
    User,
)


async def _setup_client_with_pending_draft(client_name: str = "PubClient") -> tuple[str, int]:
    """Create an agency client + brand + token + one awaiting_client draft. Returns (token, draft_id)."""
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=client_name, slug=client_name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        brand = Brand(name=client_name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="standard")
        db.add(brand)
        await db.flush()
        link = ClientReviewLink(agency_client_id=ac.id, token="testtoken-" + client_name.lower())
        db.add(link)
        draft = ContentDraft(
            brand_id=brand.id,
            platform="medium",
            content_text="Draft body",
            status="awaiting_client",
            title="Demo draft",
        )
        db.add(draft)
        await db.commit()
        return link.token, draft.id


async def _make_staff_user(email: str = "staff-public@example.com") -> int:
    """Create a User + AgencyStaff row so notifications have a recipient. Returns user_id."""
    async with AsyncSessionLocal() as db:
        user = User(email=email, password_hash="x", name="Staff", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()
        db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()
        return user.id


@pytest.mark.asyncio
async def test_invalid_token_returns_404(client):
    resp = await client.get("/api/public/review/does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_review_page_lists_awaiting_drafts(client):
    token, draft_id = await _setup_client_with_pending_draft("ReviewPage")
    resp = await client.get(f"/api/public/review/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["client_name"] == "ReviewPage"
    assert len(body["drafts"]) == 1
    assert body["drafts"][0]["id"] == draft_id


@pytest.mark.asyncio
async def test_approve_transitions_status(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Approve")
    resp = await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "approved"
    assert refreshed.approved_at is not None
    assert refreshed.client_reviewed_at is not None


@pytest.mark.asyncio
async def test_request_changes_writes_feedback(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Changes")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/request-changes",
        json={"feedback": "Make it shorter"},
    )
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "changes_requested"
    assert refreshed.client_feedback == "Make it shorter"


@pytest.mark.asyncio
async def test_reject_writes_reason(client, db_session):
    from app.models import ContentDraft as Cd

    token, draft_id = await _setup_client_with_pending_draft("Reject")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/reject",
        json={"reason": "Off-brand"},
    )
    assert resp.status_code == 204

    refreshed = await db_session.get(Cd, draft_id)
    assert refreshed.status == "rejected"
    assert refreshed.client_feedback == "Off-brand"


@pytest.mark.asyncio
async def test_action_on_already_reviewed_draft_409(client):
    token, draft_id = await _setup_client_with_pending_draft("AlreadyDone")
    await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    again = await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_request_changes_validates_feedback_length(client):
    token, draft_id = await _setup_client_with_pending_draft("Validate")
    resp = await client.post(
        f"/api/public/review/{token}/draft/{draft_id}/request-changes",
        json={"feedback": ""},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_approve_creates_staff_notification(client, db_session):
    staff_user_id = await _make_staff_user()
    token, draft_id = await _setup_client_with_pending_draft("Notif")

    resp = await client.post(f"/api/public/review/{token}/draft/{draft_id}/approve")
    assert resp.status_code == 204

    count_q = await db_session.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == staff_user_id,
            Notification.type == "draft_reviewed",
        )
    )
    assert count_q.scalar_one() == 1
