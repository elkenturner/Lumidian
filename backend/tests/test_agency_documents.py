"""Tests for the document engine endpoints. LLM is mocked."""
from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, ClientActivityEvent, ClientDocument, User
from tests.conftest import factory_agency_client_full, register_and_login


async def _make_agency_user(client, email: str = "docs@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _get_user_id(email: str) -> int:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        return user.id


async def _insert_doc(agency_client_id: int, kind: str = "audit_initial", body: str = "# Doc") -> int:
    """Insert a ClientDocument directly for test setup."""
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=agency_client_id,
            kind=kind,
            title=f"{kind} — test",
            body_markdown=body,
            data_snapshot=json.dumps({"client": {"name": "TestCo"}}),
        )
        db.add(doc)
        await db.commit()
        return doc.id


@pytest.mark.asyncio
async def test_list_templates_returns_all(client):
    await _make_agency_user(client)
    resp = await client.get("/api/agency/document-templates")
    assert resp.status_code == 200
    kinds = {t["kind"] for t in resp.json()}
    assert kinds == {
        "agency_weekly_report",
        "audit_initial",
        "sow",
        "monthly_report",
        "kickoff_checklist",
        "wikipedia_plan",
        "site_plan",
    }


@pytest.mark.asyncio
async def test_generate_document_emits_event(client, db_session):
    """Render endpoint persists a ClientDocument and emits a document_generated event."""
    import shutil
    import pytest as _pytest
    from app.services.document_engine.audit_initial import AuditInitialOutput

    if shutil.which("typst") is None:
        _pytest.skip("typst CLI not installed")

    email = "docs-event@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    cid, _ = await factory_agency_client_full(
        db_session, user_id, brand_name="DocEventCo", website_url="https://doceventco.com",
        company_description="A fine test company"
    )

    fake_output = AuditInitialOutput(
        current_state="Visibility is low.",
        working=["Strong Reddit presence"],
        gaps=["No tone captured"],
        recommendations=["Run baseline tracking"],
        open_questions=["Primary buyer?"],
    )

    with patch(
        "app.services.document_engine.generator.request_structured_output",
        new=AsyncMock(return_value=fake_output),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/documents/audit_initial/render",
        )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "document_generated",
            ClientActivityEvent.agency_client_id == cid,
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_generate_unknown_kind_returns_400(client):
    email = "docs-unknown@example.com"
    await _make_agency_user(client, email=email)
    # Need a real client so the endpoint reaches the kind-check
    resp_c = await client.post("/api/agency/clients", json={"name": "UnknownKindCo"})
    cid = resp_c.json()["id"]
    resp = await client.post(f"/api/agency/clients/{cid}/documents/bogus_kind/render")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_documents_filters_by_kind(client, db_session):
    email = "docs-list@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    cid, _ = await factory_agency_client_full(db_session, user_id, brand_name="ListCo")

    await _insert_doc(cid, kind="audit_initial")
    await _insert_doc(cid, kind="sow")

    all_docs = await client.get(f"/api/agency/clients/{cid}/documents")
    assert len(all_docs.json()) == 2
    audits = await client.get(f"/api/agency/clients/{cid}/documents?kind=audit_initial")
    assert len(audits.json()) == 1
    assert audits.json()[0]["kind"] == "audit_initial"


@pytest.mark.asyncio
async def test_update_document_body(client, db_session):
    email = "docs-update@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    cid, _ = await factory_agency_client_full(db_session, user_id, brand_name="UpdateCo")

    did = await _insert_doc(cid, kind="sow", body="# Original")
    resp = await client.patch(f"/api/agency/documents/{did}", json={"body_markdown": "# Edited"})
    assert resp.status_code == 200
    assert resp.json()["body_markdown"] == "# Edited"
    assert resp.json()["updated_at"] is not None


@pytest.mark.asyncio
async def test_delete_document(client, db_session):
    email = "docs-delete@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    cid, _ = await factory_agency_client_full(db_session, user_id, brand_name="DeleteCo")

    did = await _insert_doc(cid, kind="kickoff_checklist")
    resp = await client.delete(f"/api/agency/documents/{did}")
    assert resp.status_code == 204
    refreshed = await db_session.get(ClientDocument, did)
    assert refreshed is None


@pytest.mark.asyncio
async def test_no_anthropic_key_returns_503(client, db_session):
    """When ANTHROPIC_API_KEY is empty, request_structured_output raises ValueError; surface as 503."""
    import os
    email = "docs-nokey@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    cid, _ = await factory_agency_client_full(
        db_session, user_id, brand_name="NoKeyCo",
        website_url="https://nokey.com", company_description="A company"
    )
    # Let request_structured_output raise ValueError due to missing key
    prev = os.environ.get("ANTHROPIC_API_KEY", "")
    os.environ["ANTHROPIC_API_KEY"] = ""
    try:
        resp = await client.post(f"/api/agency/clients/{cid}/documents/audit_initial/render")
        assert resp.status_code == 503
    finally:
        os.environ["ANTHROPIC_API_KEY"] = prev
