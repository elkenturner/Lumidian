"""Tests for the agency weekly report PDF renderer + endpoint."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, ClientDocument, User
from app.services.document_engine.markdown_sections import parse_sections
from app.services.document_engine.agency_weekly_report import SECTION_MAP as WEEKLY_SECTION_MAP
from tests.conftest import register_and_login


def _parse_markdown_sections(body):
    """Compatibility shim so the existing weekly-specific tests keep passing."""
    return parse_sections(body, WEEKLY_SECTION_MAP)


async def _make_agency_user(client, email: str = "pdf@example.com") -> None:
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


async def _create_agency_client(client, name: str = "PdfCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


async def _insert_weekly_report_doc(agency_client_id: int, with_snapshot: bool = True) -> int:
    snapshot = {
        "client": {"name": "TestClient"},
        "period": {"label": "Week of May 8, 2026"},
        "this_week_run": {"overall_score": 47.5, "total_queries": 12, "total_mentions": 6},
        "last_week_run": {"overall_score": 40.0, "total_queries": 12, "total_mentions": 5},
        "model_scores": [{"model": "chatgpt", "score": 50.0, "total_queries": 6, "total_mentions": 3}],
        "per_prompt": [
            {
                "prompt_id": 1,
                "prompt_text": "What is X?",
                "this_week_score": 60.0,
                "last_week_score": 40.0,
                "delta": 20.0,
                "trend": "up",
            }
        ],
        "competitors": [],
        "content_shipped": [{"platform": "linkedin", "count": 2}],
        "draft_attribution": [],
        "top_gaps": [],
        "activity_sample": [],
        "has_data": True,
    }
    body_md = (
        "# Weekly\n\n"
        "## Executive summary\n\nVisibility improved meaningfully.\n\n"
        "## Visibility this week\n\nUp across the board.\n\n"
        "## Next week\n\n- ship more LinkedIn\n- audit competitor X\n"
    )
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=agency_client_id,
            kind="agency_weekly_report",
            title="Weekly report — TestClient — week of May 8, 2026",
            body_markdown=body_md,
            generated_by_user_id=None,
            data_snapshot=json.dumps(snapshot) if with_snapshot else None,
        )
        db.add(doc)
        await db.commit()
        return doc.id


def test_parse_markdown_sections_well_formed():
    md = (
        "# Title\n\n"
        "## Executive summary\n\nfoo.\n\n"
        "## Next week\n\n- a\n- b\n"
    )
    out = _parse_markdown_sections(md)
    assert "executive_summary" in out
    assert "next_week" in out
    assert "<p>foo.</p>" in out["executive_summary"]


def test_parse_markdown_sections_empty():
    assert _parse_markdown_sections("") == {}
    assert _parse_markdown_sections(None) == {}


def test_parse_markdown_sections_unknown_heading_ignored():
    md = "## random heading\n\nbody\n\n## Executive summary\n\nfoo.\n"
    out = _parse_markdown_sections(md)
    assert list(out.keys()) == ["executive_summary"]


@pytest.mark.asyncio
async def test_pdf_endpoint_returns_pdf_bytes(client):
    """End-to-end: render via Playwright and confirm bytes are PDF."""
    await _make_agency_user(client)
    cid, _bid = await _create_agency_client(client)
    doc_id = await _insert_weekly_report_doc(cid, with_snapshot=True)
    resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    body = resp.content
    assert body[:4] == b"%PDF", f"Bytes do not start with PDF magic: {body[:20]!r}"


@pytest.mark.asyncio
async def test_pdf_unknown_kind_returns_400(client):
    await _make_agency_user(client, email="pdf-unknown@example.com")
    aid, _ = await _create_agency_client(client, "PdfUnknownCo")
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=aid,
            kind="not_a_real_kind",
            title="x",
            body_markdown="x",
        )
        db.add(doc)
        await db.commit()
        doc_id = doc.id
    resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 400
    # Either ValueError message is fine (template-registry vs section-map registry
    # both raise ValueError → mapped to 400); just confirm we hit the kind-unknown path.
    detail = resp.json()["detail"]
    assert ("No PDF template registered" in detail) or ("Unknown template kind" in detail)


@pytest.mark.asyncio
async def test_pdf_endpoint_404_unknown_id(client):
    await _make_agency_user(client, email="pdf3@example.com")
    resp = await client.get("/api/agency/documents/99999/pdf")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_pdf_endpoint_uses_snapshot_when_present(client):
    """When data_snapshot exists, we should not call fetch_data."""
    await _make_agency_user(client, email="pdf4@example.com")
    cid, _bid = await _create_agency_client(client, name="PdfCo4")
    doc_id = await _insert_weekly_report_doc(cid, with_snapshot=True)

    with patch(
        "app.services.document_engine.agency_weekly_report.fetch_data",
        new=AsyncMock(side_effect=AssertionError("fetch_data should not be called when snapshot present")),
    ):
        resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 200
