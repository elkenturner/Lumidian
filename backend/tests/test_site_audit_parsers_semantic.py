from pathlib import Path

import pytest

from app.services.site_audit.parsers.semantic import parse_semantic

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "site_audit"


def _load(name: str) -> str:
    return (FIXTURE_DIR / name).read_text()


def test_well_structured_emits_no_critical_findings():
    out = parse_semantic(_load("well_structured.html"), "https://example.com/")
    critical = [f for f in out.findings if f.severity == "critical"]
    assert critical == []
    assert out.measurements["h1_text"] == "Main Heading"
    assert out.measurements["h2_count"] == 2
    assert out.measurements["table_count"] == 1
    assert out.measurements["list_count"] >= 1
    assert out.measurements["outbound_links"] == 1
    assert out.measurements["word_count"] > 30


def test_no_h1_emits_missing_h1():
    out = parse_semantic(_load("no_h1.html"), "https://example.com/")
    ids = {f.check_id for f in out.findings}
    assert "missing_h1" in ids


def test_fake_lists_detected():
    out = parse_semantic(_load("fake_lists.html"), "https://example.com/")
    ids = {f.check_id for f in out.findings}
    assert "fake_lists" in ids


def test_fact_density_present_on_well_structured():
    out = parse_semantic(_load("well_structured.html"), "https://example.com/")
    assert out.measurements["fact_density"] > 0


def test_pronoun_overuse_detection():
    html = "<html><body><h1>X</h1>" + ("<p>It is great.</p>" * 50) + "</body></html>"
    out = parse_semantic(html, "https://example.com/a")
    ids = {f.check_id for f in out.findings}
    assert "pronoun_overuse" in ids
