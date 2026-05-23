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
    """A valid token resolves to the right AgencyClient + Brand.

    Task 4 ships the dep but no route uses it yet, so the request 404s.
    Task 5 mounts /api/public/client/{token}/brand and this test starts passing.
    The strict xfail will then flip to XPASS, signaling: remove the marker.
    """
    # Create client and get token
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id


@pytest.mark.asyncio
async def test_client_view_context_rejects_unknown_token(client):
    """Unknown tokens return 404.

    Currently passes because the route is not yet mounted (Task 5 lands it);
    after Task 5 it will pass for the right reason — the dep itself raises 404.
    """
    resp = await client.get("/api/public/client/notatoken/brand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_client_view_context_rejects_revoked_token(client, db_session, agency_staff_user):
    """Revoked review-link tokens return 404.

    Currently passes for the wrong reason (route not mounted); after Task 5
    the dep's revoked-link branch will trigger the 404 instead.
    """
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


@pytest.mark.asyncio
async def test_client_portal_brand_returns_brand_summary(client, agency_staff_user):
    """GET /api/public/client/{token}/brand returns brand id, name, slug, type."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme Inc"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id
    assert body["name"] == "Acme Inc"
    assert body["brand_type"] == "agency"


@pytest.mark.asyncio
async def test_client_portal_proposal_returns_pointer(client, agency_staff_user):
    """GET /api/public/client/{token}/proposal returns current proposal fields."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{ac_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Week of May 22"},
    )
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] == "https://docs.google.com/document/d/abc"
    assert body["label"] == "Week of May 22"


@pytest.mark.asyncio
async def test_client_portal_proposal_null_when_unset(client, agency_staff_user):
    """If proposal not set, endpoint returns nulls (not 404)."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] is None
    assert body["label"] is None


@pytest_asyncio.fixture
async def agency_brand_with_run(client, db_session, agency_staff_user):
    """Create an agency client + completed tracking run + return (ac_id, brand_id, token)."""
    from datetime import datetime
    from app.models import TrackingRun

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]

    # Insert a completed run directly
    run = TrackingRun(
        brand_id=brand_id,
        status="completed",
        run_type="manual",
        overall_score=42.0,
        total_queries=10,
        total_mentions=4,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]
    return ac_id, brand_id, token


@pytest.mark.asyncio
async def test_client_portal_dashboard_returns_overview(client, agency_brand_with_run):
    """GET /api/public/client/{token}/dashboard returns visibility overview."""
    ac_id, _brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert "overall_score" in body
    assert "total_runs" in body


@pytest.mark.asyncio
async def test_client_portal_runs_returns_recent_runs(client, agency_brand_with_run):
    """GET /api/public/client/{token}/runs returns the run list."""
    ac_id, brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/runs")
    assert resp.status_code == 200
    runs = resp.json()
    assert isinstance(runs, list)
    assert len(runs) >= 1
    assert all(r.get("brand_id") == brand_id for r in runs)
