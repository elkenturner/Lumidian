"""Integration tests for POST /api/agency/clients/{id}/documents/{kind}/render."""
from __future__ import annotations

import shutil
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, User
from app.services.document_engine.audit_initial import AuditInitialOutput
from tests.conftest import factory_agency_client_full, factory_agency_client_only, register_and_login


pytestmark = pytest.mark.skipif(
    shutil.which("typst") is None,
    reason="typst CLI not installed",
)


async def _make_agency_user(client, email: str = "pdf-render@example.com") -> None:
    """Register + promote to agency admin (mirrors test_agency_documents.py pattern)."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True)
        )
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _get_user_id(email: str) -> int:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        return user.id


@pytest.mark.asyncio
async def test_render_audit_initial_returns_pdf(client, db_session):
    email = "pdf-render-happy@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    agency_client_id, _brand_id = await factory_agency_client_full(
        db_session,
        user_id,
        brand_name="Acme",
        website_url="https://acme.com",
        company_description="Sells widgets",
    )

    fake_output = AuditInitialOutput(
        current_state="Acme has limited visibility.",
        working=["Strong on Reddit"],
        gaps=["No tone of voice captured"],
        recommendations=["Run baseline tracking"],
        open_questions=["Primary buyer?"],
    )

    with patch(
        "app.services.document_engine.generator.request_structured_output",
        new=AsyncMock(return_value=fake_output),
    ):
        res = await client.post(
            f"/api/agency/clients/{agency_client_id}/documents/audit_initial/render",
        )

    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF-")
    assert "attachment" in res.headers["content-disposition"]


@pytest.mark.asyncio
async def test_render_returns_400_on_missing_brand_data(client, db_session):
    email = "pdf-render-missing@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    agency_client_id = await factory_agency_client_only(db_session, user_id)

    res = await client.post(
        f"/api/agency/clients/{agency_client_id}/documents/audit_initial/render",
    )
    assert res.status_code == 400
    body = res.json()
    assert "missing_fields" in body["detail"]
    assert (
        "brand.name" in body["detail"]["missing_fields"]
        or "brand.website_url" in body["detail"]["missing_fields"]
    )


@pytest.mark.asyncio
async def test_render_returns_400_on_unknown_kind(client, db_session):
    email = "pdf-render-unknown@example.com"
    await _make_agency_user(client, email=email)
    user_id = await _get_user_id(email)
    agency_client_id, _ = await factory_agency_client_full(db_session, user_id)

    res = await client.post(
        f"/api/agency/clients/{agency_client_id}/documents/bogus_kind/render",
    )
    assert res.status_code == 400
