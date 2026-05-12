from pathlib import Path

import pytest

from app.services.site_audit.parsers.schema import parse_schema

F = Path(__file__).parent / "fixtures" / "site_audit"


def test_good_organization_passes(tmp_path):
    html = (F / "good_organization_schema.html").read_text()
    out = parse_schema(html, "https://acme.com/", page_type="homepage")
    assert out.measurements["has_jsonld"] is True
    assert "Organization" in out.measurements["schema_types"]
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" not in ids
    assert "incomplete_organization_schema" not in ids


def test_malformed_jsonld_detected():
    html = (F / "malformed_jsonld.html").read_text()
    out = parse_schema(html, "https://acme.com/", page_type="homepage")
    ids = {f.check_id for f in out.findings}
    assert "malformed_jsonld" in ids


def test_homepage_without_org_schema_flagged():
    out = parse_schema("<html><body>No schema</body></html>", "https://acme.com/", page_type="homepage")
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" in ids


def test_non_homepage_no_org_schema_not_flagged():
    out = parse_schema("<html><body></body></html>", "https://acme.com/blog/x", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" not in ids


def test_article_missing_author_and_dates():
    html = """<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"Foo"}
    </script>
    </head><body></body></html>"""
    out = parse_schema(html, "https://x.com/blog/foo", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "article_missing_author" in ids
    assert "article_missing_dates" in ids


def test_schema_content_mismatch_detected():
    html = """<html><head><title>Real Title</title>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"Totally Different"}
    </script></head><body></body></html>"""
    out = parse_schema(html, "https://x.com/a", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "schema_content_mismatch" in ids
