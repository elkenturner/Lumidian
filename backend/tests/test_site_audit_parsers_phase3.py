"""Tests for the four new Phase-3 parsers: eeat, qa, linking, agents_md."""
from bs4 import BeautifulSoup

from app.services.site_audit.parsers.agents_md import parse_agents_md
from app.services.site_audit.parsers.eeat import parse_eeat
from app.services.site_audit.parsers.linking import parse_linking
from app.services.site_audit.parsers.qa import parse_qa


# ── eeat ─────────────────────────────────────────────────────────────────────

def test_eeat_skips_non_article_pages():
    soup = BeautifulSoup("<html><body><h1>X</h1></body></html>", "lxml")
    findings = parse_eeat(soup, "https://x.com/", "homepage")
    assert findings == []


def test_eeat_flags_missing_byline_on_article():
    soup = BeautifulSoup(
        "<html><body><h1>X</h1><p>some text</p></body></html>", "lxml"
    )
    findings = parse_eeat(soup, "https://x.com/blog/y", "article")
    ids = [f.check_id for f in findings]
    assert "missing_author_byline" in ids


def test_eeat_passes_with_byline_and_date():
    html = """
    <html><body>
    <article>
      <h1>Headline</h1>
      <span class="byline">By Jane Doe</span>
      <time datetime="2026-01-15">January 15, 2026</time>
      <p>Body text.</p>
    </article>
    </body></html>
    """
    soup = BeautifulSoup(html, "lxml")
    findings = parse_eeat(soup, "https://x.com/blog/y", "article")
    ids = [f.check_id for f in findings]
    assert "missing_author_byline" not in ids
    assert "missing_published_date" not in ids


def test_eeat_flags_long_article_without_outbound_links():
    body_text = "word " * 600
    html = f"<html><body><article><h1>X</h1><span class='byline'>By X</span><time>2026</time><p>{body_text}</p></article></body></html>"
    soup = BeautifulSoup(html, "lxml")
    findings = parse_eeat(soup, "https://x.com/blog/y", "article")
    ids = [f.check_id for f in findings]
    assert "missing_outbound_citations" in ids


# ── qa ───────────────────────────────────────────────────────────────────────

def test_qa_flags_long_content_with_no_qa():
    body_text = "word " * 900
    html = f"<html><body>{body_text}</body></html>"
    soup = BeautifulSoup(html, "lxml")
    findings = parse_qa(soup, "https://x.com/", "article")
    ids = [f.check_id for f in findings]
    assert "no_qa_format" in ids


def test_qa_flags_visible_qa_without_schema():
    html = """
    <html><body>
    <h2>What is X?</h2><p>X is …</p>
    <h2>How does X work?</h2><p>It works by …</p>
    <h2>Why use X?</h2><p>Because …</p>
    </body></html>
    """
    soup = BeautifulSoup(html, "lxml")
    findings = parse_qa(soup, "https://x.com/", "article")
    ids = [f.check_id for f in findings]
    assert "qa_without_schema" in ids


def test_qa_passes_with_schema_present():
    schema = """{"@type":"FAQPage","mainEntity":[
      {"@type":"Question","name":"Q1"},
      {"@type":"Question","name":"Q2"},
      {"@type":"Question","name":"Q3"}
    ]}"""
    html = f"""
    <html><body>
    <h2>What is X?</h2><p>X is…</p>
    <h2>How does X work?</h2><p>…</p>
    <h2>Why X?</h2><p>…</p>
    <script type="application/ld+json">{schema}</script>
    </body></html>
    """
    soup = BeautifulSoup(html, "lxml")
    findings = parse_qa(soup, "https://x.com/", "article")
    ids = [f.check_id for f in findings]
    assert "qa_without_schema" not in ids
    assert "qa_thin" not in ids


# ── linking ──────────────────────────────────────────────────────────────────

def test_linking_orphan_detected():
    pages = {
        "https://x.com/": {"links": ["https://x.com/about"], "http_status": 200, "page_type": "homepage"},
        "https://x.com/about": {"links": [], "http_status": 200, "page_type": "other"},
        "https://x.com/orphan": {"links": [], "http_status": 200, "page_type": "other"},
    }
    findings = parse_linking(pages, "https://x.com/")
    orphan_ids = [f.check_id for f in findings.get("https://x.com/orphan", [])]
    assert "orphan_page" in orphan_ids


def test_linking_deep_page_detected():
    pages = {
        "https://x.com/": {"links": ["https://x.com/a"], "http_status": 200, "page_type": "homepage"},
        "https://x.com/a": {"links": ["https://x.com/b"], "http_status": 200, "page_type": "other"},
        "https://x.com/b": {"links": ["https://x.com/c"], "http_status": 200, "page_type": "other"},
        "https://x.com/c": {"links": ["https://x.com/d"], "http_status": 200, "page_type": "other"},
        "https://x.com/d": {"links": [], "http_status": 200, "page_type": "other"},
    }
    findings = parse_linking(pages, "https://x.com/")
    d_ids = [f.check_id for f in findings.get("https://x.com/d", [])]
    assert "deep_page" in d_ids


def test_linking_weak_hub_detected():
    pages = {
        "https://x.com/": {"links": ["https://x.com/hub"], "http_status": 200, "page_type": "homepage"},
        "https://x.com/hub": {"links": ["https://x.com/a", "https://x.com/b"], "http_status": 200, "page_type": "hub"},
        "https://x.com/a": {"links": [], "http_status": 200, "page_type": "other"},
        "https://x.com/b": {"links": [], "http_status": 200, "page_type": "other"},
    }
    findings = parse_linking(pages, "https://x.com/")
    hub_ids = [f.check_id for f in findings.get("https://x.com/hub", [])]
    assert "weak_hub" in hub_ids


# ── agents_md ────────────────────────────────────────────────────────────────

def test_agents_md_missing_emits_info_finding():
    findings = parse_agents_md(None)
    assert len(findings) == 1
    assert findings[0].check_id == "agents_md_missing"
    assert findings[0].severity == "info"


def test_agents_md_present_emits_nothing():
    findings = parse_agents_md("# My brand\n\n## Agent policy\n…")
    assert findings == []
