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
