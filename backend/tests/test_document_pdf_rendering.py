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
