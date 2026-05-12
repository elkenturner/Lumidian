"""Tests for the document engine endpoints. LLM is mocked."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, ClientActivityEvent, ClientDocument, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "docs@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "DocCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_list_templates_returns_four(client):
    await _make_agency_user(client)
    resp = await client.get("/api/agency/document-templates")
    assert resp.status_code == 200
    kinds = {t["kind"] for t in resp.json()}
    assert kinds == {"audit_initial", "sow", "monthly_report", "kickoff_checklist"}


@pytest.mark.asyncio
async def test_generate_document_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Initial Audit\n\nMocked content."),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/documents",
            json={"kind": "audit_initial"},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "audit_initial"
    assert body["body_markdown"].startswith("# Initial Audit")
    assert body["title"].startswith("Initial audit")

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "document_generated",
            ClientActivityEvent.agency_client_id == cid,
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_generate_unknown_kind_returns_400(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "bogus"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_documents_filters_by_kind(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Doc\n"),
    ):
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "audit_initial"})
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
    all_docs = await client.get(f"/api/agency/clients/{cid}/documents")
    assert len(all_docs.json()) == 2
    audits = await client.get(f"/api/agency/clients/{cid}/documents?kind=audit_initial")
    assert len(audits.json()) == 1
    assert audits.json()[0]["kind"] == "audit_initial"


@pytest.mark.asyncio
async def test_update_document_body(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Original\n"),
    ):
        post = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
    did = post.json()["id"]
    resp = await client.patch(f"/api/agency/documents/{did}", json={"body_markdown": "# Edited"})
    assert resp.status_code == 200
    assert resp.json()["body_markdown"] == "# Edited"
    assert resp.json()["updated_at"] is not None


@pytest.mark.asyncio
async def test_delete_document(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# X"),
    ):
        post = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "kickoff_checklist"})
    did = post.json()["id"]
    resp = await client.delete(f"/api/agency/documents/{did}")
    assert resp.status_code == 204
    refreshed = await db_session.get(ClientDocument, did)
    assert refreshed is None


@pytest.mark.asyncio
async def test_recent_documents_returns_with_client_name(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client, name="RecentDocCo")
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# R"),
    ):
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "monthly_report"})
    resp = await client.get("/api/agency/documents/recent")
    assert resp.status_code == 200
    docs = resp.json()
    assert any(d["client_name"] == "RecentDocCo" for d in docs)


@pytest.mark.asyncio
async def test_no_anthropic_key_returns_503(client):
    """When ANTHROPIC_API_KEY is empty, call_claude raises ValueError; surface as 503."""
    import os
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Don't mock call_claude — let it bail with ValueError due to missing key in test env
    prev = os.environ.get("ANTHROPIC_API_KEY", "")
    os.environ["ANTHROPIC_API_KEY"] = ""
    try:
        resp = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
        assert resp.status_code == 503
    finally:
        os.environ["ANTHROPIC_API_KEY"] = prev
