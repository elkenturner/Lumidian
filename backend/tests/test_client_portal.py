"""Tests for the client portal (read-only token-gated mirror of SaaS surfaces)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, User


async def _make_agency_user(client, email: str = "staff@example.com") -> None:
    """Register/verify/login + flip is_agency_staff."""
    from tests.conftest import register_and_login
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True)
        )
        await db.commit()


@pytest_asyncio.fixture
async def agency_staff_user(client):
    """Log in as an agency staff user; return the httpx client (with cookies set)."""
    await _make_agency_user(client, email="staff@example.com")
    return client


@pytest.mark.asyncio
async def test_agency_client_has_proposal_columns(db_session):
    """AgencyClient table has current_proposal_doc_url and current_proposal_label columns."""
    ac = AgencyClient(
        name="Acme Inc",
        slug="acme-inc",
        status="active",
        current_proposal_doc_url="https://docs.google.com/document/d/abc",
        current_proposal_label="Week of May 22 — 5 pieces",
    )
    db_session.add(ac)
    await db_session.commit()
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc"
    assert ac.current_proposal_label == "Week of May 22 — 5 pieces"


@pytest.mark.asyncio
async def test_staff_can_set_proposal_pointer(client, db_session, agency_staff_user):
    """PATCH /api/agency/clients/{id}/proposal updates the doc_url + label."""
    # Create client (auto-assigns creator)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 201
    client_id = resp.json()["id"]

    # Patch proposal pointer
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={
            "current_proposal_doc_url": "https://docs.google.com/document/d/abc123",
            "current_proposal_label": "Week of May 22 — 5 pieces",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_proposal_doc_url"] == "https://docs.google.com/document/d/abc123"
    assert body["current_proposal_label"] == "Week of May 22 — 5 pieces"

    # Verify persisted
    ac = await db_session.get(AgencyClient, client_id)
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc123"


@pytest.mark.asyncio
async def test_staff_can_clear_proposal_pointer(client, db_session, agency_staff_user):
    """PATCH with null values clears the proposal pointer."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Test"},
    )
    # Clear
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": None, "current_proposal_label": None},
    )
    assert resp.status_code == 200
    assert resp.json()["current_proposal_doc_url"] is None
    assert resp.json()["current_proposal_label"] is None

    # Verify the clear persisted to the DB
    ac = await db_session.get(AgencyClient, client_id)
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url is None
    assert ac.current_proposal_label is None


@pytest.mark.asyncio
async def test_review_link_emits_client_url(client, agency_staff_user):
    """POST /api/agency/clients/{id}/review-link returns a /client/{token} URL."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]

    resp = await client.post(f"/api/agency/clients/{client_id}/review-link")
    assert resp.status_code == 201
    url = resp.json()["url"]
    assert "/client/" in url, f"Expected /client/ in URL, got {url}"
    assert "/review/" not in url, f"URL should not contain /review/ anymore: {url}"


@pytest.mark.asyncio
async def test_client_view_context_resolves_valid_token(client, agency_staff_user):
    """A valid token resolves to the right AgencyClient + Brand."""
    # Create client and get token
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    # Hit the new public brand endpoint — built in Task 5; here we just confirm
    # the endpoint reaches the resolver. This test will fail until Task 5 ships
    # the route.
    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id


@pytest.mark.asyncio
async def test_client_view_context_rejects_unknown_token(client):
    """Unknown tokens return 404."""
    resp = await client.get("/api/public/client/notatoken/brand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_client_view_context_rejects_revoked_token(client, db_session, agency_staff_user):
    """Revoked review-link tokens return 404."""
    from app.models import ClientReviewLink
    from datetime import datetime

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    # Revoke the link directly in the DB
    link_q = await db_session.execute(select(ClientReviewLink).where(ClientReviewLink.token == token))
    link = link_q.scalar_one()
    link.revoked_at = datetime.utcnow()
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 404
