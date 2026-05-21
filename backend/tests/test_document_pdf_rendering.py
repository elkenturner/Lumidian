"""Tests for the generalized PDF rendering pipeline (all 5 kinds)."""
from __future__ import annotations

import pytest

from app.services.document_engine.markdown_sections import parse_sections


def test_parse_sections_maps_headings_to_block_keys():
    body = (
        "# Title\n\n"
        "## Foo Bar\n\nFoo content here.\n\n"
        "## Baz Qux\n\nBaz content here.\n"
    )
    mapping = {"foo bar": "foo", "baz qux": "baz"}
    out = parse_sections(body, mapping)
    assert "foo" in out
    assert "baz" in out
    assert "<p>Foo content here.</p>" in out["foo"]
    assert "<p>Baz content here.</p>" in out["baz"]


def test_parse_sections_ignores_unmapped_headings():
    body = "## Known\n\nyes\n\n## Unknown\n\nno\n"
    out = parse_sections(body, {"known": "k"})
    assert out == {"k": "<p>yes</p>"}


def test_parse_sections_empty_body_returns_empty_dict():
    assert parse_sections("", {"any": "x"}) == {}
    assert parse_sections(None, {"any": "x"}) == {}


import importlib

from app.services.document_engine.pdf_renderer import _template_filename, _section_map_for


def test_template_filename_maps_each_kind():
    assert _template_filename("agency_weekly_report") == "weekly_report.html.j2"
    assert _template_filename("monthly_report") == "monthly_report.html.j2"
    assert _template_filename("sow") == "sow.html.j2"
    assert _template_filename("audit_initial") == "audit_initial.html.j2"
    assert _template_filename("kickoff_checklist") == "kickoff_checklist.html.j2"


def test_template_filename_rejects_unknown_kind():
    with pytest.raises(ValueError):
        _template_filename("not_a_real_kind")


def test_section_map_for_loads_from_module():
    mapping = _section_map_for("kickoff_checklist")
    assert "what we have" in mapping
    assert mapping["what we have"] == "have"


from unittest.mock import patch
import json as _json
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientDocument


async def _make_client_with_doc(name: str, kind: str, body_md: str, snapshot: dict) -> int:
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=name, slug=name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        brand = Brand(name=name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="agency")
        db.add(brand)
        doc = ClientDocument(
            agency_client_id=ac.id,
            kind=kind,
            title=f"{kind} — {name}",
            body_markdown=body_md,
            data_snapshot=_json.dumps(snapshot),
        )
        db.add(doc)
        await db.commit()
        return doc.id


@pytest.mark.asyncio
async def test_render_html_sow_contains_letterhead_and_signatures():
    body = (
        "# SOW\n\n"
        "## 1. Engagement Summary\n\nWe will increase visibility.\n\n"
        "## 2. Scope of Services\n\n- Tracking\n- Drafts\n\n"
        "## 3. Deliverables\n\n8 LinkedIn drafts/mo\n\n"
        "## 4. Term\n\nMonthly renewal\n\n"
        "## 5. Payment Terms\n\nNet 30\n\n"
        "## 6. Termination\n\n30 days written notice\n\n"
        "## 7. Signatures\n\nSee below\n"
    )
    snapshot = {
        "client": {"name": "TestSowCo", "primary_contact_name": "Jane Client", "primary_contact_email": "jane@x.com", "retainer_amount_usd": 3500, "retainer_started_at": None},
        "brand": {"name": "TestSowCo", "website_url": "https://x.com"},
        "brand_profile": None,
        "today": "May 18, 2026",
    }
    doc_id = await _make_client_with_doc("SowCo", "sow", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "Statement of Work" in html
    assert "TestSowCo" in html
    assert "sig-row" in html  # signature block rendered
    assert "Engagement Summary" in html
    assert "<!DOCTYPE html>" in html


@pytest.mark.asyncio
async def test_render_html_kickoff_uses_checklist_items():
    body = (
        "# Kickoff\n\n"
        "## What we have\n\n- [x] Primary contact name\n- [x] Primary contact email\n\n"
        "## What the client still owes\n\n- [ ] Brand profile: tone of voice\n- [ ] At least 10 tracked prompts\n\n"
        "## Suggested first call\n\n- Walk through visibility goals\n- Confirm review cadence\n"
    )
    snapshot = {
        "client": {"name": "KickoffCo", "primary_contact_name": True, "primary_contact_email": True},
        "brand": {"name": "KickoffCo", "website_url": True},
        "brand_profile": {"company_description": True, "tone_of_voice": False, "what_not_to_say": False, "approved_language": False, "publications": False},
        "prompt_count": 3,
    }
    doc_id = await _make_client_with_doc("KickoffCo", "kickoff_checklist", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "KickoffCo" in html
    assert "Kickoff Checklist" in html or "KICKOFF CHECKLIST" in html
    assert "What we have" in html
    assert "What we still need" in html or "What the client still owes" in html
    # Markdown `- [x]` / `- [ ]` should produce task-list-item class OR checked input
    assert "task-list-item" in html or "checked" in html


@pytest.mark.asyncio
async def test_render_html_audit_initial_shows_score_inset_when_present():
    body = (
        "# Audit\n\n"
        "## Current State\n\nVisibility is 42%. Below industry median.\n\n"
        "## What's Working\n\n- LinkedIn presence is strong\n\n"
        "## Gaps\n\n- No Reddit coverage\n- Wikipedia missing\n\n"
        "## Recommendations (next 30 days)\n\n- Add 4 Reddit drafts\n- Build Wikipedia stub\n\n"
        "## Open Questions for the Client\n\n- What is your North-Star use case?\n"
    )
    snapshot = {
        "client": {"name": "AuditCo", "slug": "auditco", "status": "active"},
        "brand": {"name": "AuditCo", "website_url": "https://x.com"},
        "brand_profile": None,
        "prompts": [],
        "competitors": [],
        "latest_run": {"overall_score": 42.0, "total_queries": 24, "total_mentions": 10, "completed_at": "2026-05-17T10:00:00"},
        "generated_at": "2026-05-18T12:00:00",
        "has_data": True,
    }
    doc_id = await _make_client_with_doc("AuditCo", "audit_initial", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "Initial Audit" in html or "INITIAL AUDIT" in html
    assert "AuditCo" in html
    assert "42" in html  # score in the inset card
    assert "Recommendations" in html or "recommendations" in html


@pytest.mark.asyncio
async def test_render_html_monthly_report_has_cover_and_summary():
    body = (
        "# Monthly\n\n"
        "## Summary\n\nVisibility up 8 points; 12 posts shipped.\n\n"
        "## Visibility Change\n\nFrom 42% to 50%.\n\n"
        "## Content Shipped\n\n- linkedin: 6\n- medium: 4\n- reddit: 2\n\n"
        "## Notable Activity\n\n- 8 drafts approved\n- Client kicked off pillar page\n\n"
        "## Next Month\n\n- Ramp Reddit\n- Wikipedia stub\n"
    )
    snapshot = {
        "client": {"name": "MonthlyCo"},
        "period": {"start": "2026-05-01T00:00:00", "end": "2026-05-18T12:00:00", "label": "May 2026"},
        "this_month_run": {"overall_score": 50.0, "total_queries": 36},
        "last_month_run": {"overall_score": 42.0, "total_queries": 36},
        "drafts_posted_this_month": 12,
        "drafts_by_platform": {"linkedin": 6, "medium": 4, "reddit": 2},
        "activity_events_count": 18,
        "activity_sample": [],
        "has_data": True,
    }
    doc_id = await _make_client_with_doc("MonthlyCo", "monthly_report", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "MonthlyCo" in html
    assert "May 2026" in html
    assert "Monthly Report" in html or "MONTHLY REPORT" in html
    assert "50" in html  # hero score


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,body,snapshot", [
    ("sow",
     "# SOW\n## 1. Engagement Summary\n\nx\n## 2. Scope of Services\n\nx\n## 3. Deliverables\n\nx\n## 4. Term\n\nx\n## 5. Payment Terms\n\nx\n## 6. Termination\n\nx\n## 7. Signatures\n\nx\n",
     {"client": {"name": "C", "primary_contact_name": "N", "primary_contact_email": "e@e.com", "retainer_amount_usd": 1000, "retainer_started_at": None}, "brand": {"name": "C", "website_url": "x"}, "brand_profile": None, "today": "May 18, 2026"}),
    ("kickoff_checklist",
     "# K\n## What we have\n\n- [x] a\n## What the client still owes\n\n- [ ] b\n## Suggested first call\n\n- c\n",
     {"client": {"name": "C", "primary_contact_name": True, "primary_contact_email": True}, "brand": {"name": "C", "website_url": True}, "brand_profile": None, "prompt_count": 3}),
    ("audit_initial",
     "# A\n## Current State\n\nx\n## What's Working\n\n- y\n## Gaps\n\n- z\n## Recommendations (next 30 days)\n\n- q\n## Open Questions for the Client\n\n- r?\n",
     {"client": {"name": "C", "slug": "c", "status": "active"}, "brand": {"name": "C", "website_url": "x"}, "brand_profile": None, "prompts": [], "competitors": [], "latest_run": None, "generated_at": "2026-05-18T12:00:00", "has_data": False}),
    ("monthly_report",
     "# M\n## Summary\n\nx\n## Visibility Change\n\ny\n## Content Shipped\n\nz\n## Notable Activity\n\nq\n## Next Month\n\nr\n",
     {"client": {"name": "C"}, "period": {"label": "May 2026"}, "this_month_run": None, "last_month_run": None, "drafts_posted_this_month": 0, "drafts_by_platform": {}, "activity_events_count": 0, "activity_sample": [], "has_data": False}),
])
async def test_render_pdf_produces_nonempty_bytes_for_each_kind(kind, body, snapshot):
    doc_id = await _make_client_with_doc(f"Pdf{kind}", kind, body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_pdf
        pdf = await render_pdf(db, doc)
    assert isinstance(pdf, bytes)
    assert len(pdf) > 1000  # any real PDF is well over a KB
    assert pdf.startswith(b"%PDF-")
