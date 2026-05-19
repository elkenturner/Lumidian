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
