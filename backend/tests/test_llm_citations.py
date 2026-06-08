"""Layer B0 — citation instrumentation tests (mocked SDK shapes, no live API)."""
import types

from app.services.llm_service import (
    _extract_claude_citations,
    _extract_gemini_citations,
)
from app.services.site_audit.citations import classify_structured_citation


def _ns(**kw):
    return types.SimpleNamespace(**kw)


# ── Claude (B0.1) ──────────────────────────────────────────────────────────────

def test_claude_citations_from_text_blocks():
    cite = _ns(type="web_search_result_location", url="https://a.com/x", title="A")
    text_block = _ns(type="text", text="answer", citations=[cite])
    resp = _ns(content=[text_block])
    assert _extract_claude_citations(resp) == [{"url": "https://a.com/x", "title": "A"}]


def test_claude_dedupes_and_skips_blocks_without_citations():
    t1 = _ns(type="text", text="a", citations=[_ns(url="https://a.com", title=None)])
    t2 = _ns(type="text", text="b", citations=[_ns(url="https://a.com", title=None)])  # dup
    t3 = _ns(type="text", text="c")  # no .citations attr
    resp = _ns(content=[t1, t2, t3])
    assert _extract_claude_citations(resp) == [{"url": "https://a.com", "title": None}]


def test_claude_returns_none_when_no_search():
    resp = _ns(content=[_ns(type="text", text="plain answer")])
    assert _extract_claude_citations(resp) is None


def test_claude_handles_tool_error_dict_content():
    # web_search_tool_result.content can be a dict (error), not a list — must not crash
    bad = _ns(type="web_search_tool_result", content={"type": "error"})
    resp = _ns(content=[bad])
    assert _extract_claude_citations(resp) is None


def test_claude_handles_empty_content():
    assert _extract_claude_citations(_ns(content=None)) is None
    assert _extract_claude_citations(_ns(content=[])) is None


# ── Gemini (B0.2) ──────────────────────────────────────────────────────────────

def test_gemini_captures_domain_hint_from_title():
    web = _ns(uri="https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
              title="reddit.com")
    resp = _ns(candidates=[_ns(grounding_metadata=_ns(grounding_chunks=[_ns(web=web)]))])
    assert _extract_gemini_citations(resp) == [{
        "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
        "title": "reddit.com",
        "domain_hint": "reddit.com",
    }]


def test_gemini_no_hint_when_not_a_redirect():
    web = _ns(uri="https://reddit.com/r/x", title="reddit.com")
    resp = _ns(candidates=[_ns(grounding_metadata=_ns(grounding_chunks=[_ns(web=web)]))])
    out = _extract_gemini_citations(resp)
    assert out == [{"url": "https://reddit.com/r/x", "title": "reddit.com"}]


def test_gemini_no_grounding_metadata_returns_none():
    resp = _ns(candidates=[_ns(grounding_metadata=None)])
    assert _extract_gemini_citations(resp) is None


# ── Domain-hint classification (B0.2 consumption) ───────────────────────────────

def test_structured_hint_classifies_real_domain():
    proxy = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x"
    with_hint = {"url": proxy, "domain_hint": "reddit.com"}
    assert classify_structured_citation(with_hint, proxy, None, {}).domain == "reddit.com"
    # Without the hint, the proxy URL resolves to google.com (the bug we fixed)
    no_hint = {"url": proxy}
    assert classify_structured_citation(no_hint, proxy, None, {}).domain == "google.com"


def test_structured_hint_page_title_falls_back_not_garbage():
    # Gemini web.title is sometimes a page title, not a bare domain — must NOT be
    # turned into a garbage domain; fall back to classifying the proxy URL.
    proxy = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x"
    bad = {"url": proxy, "domain_hint": "Best CRMs in 2026 | TechRadar"}
    cls = classify_structured_citation(bad, proxy, None, {})
    assert cls.domain == "google.com"   # fell back to the URL, not the title
    assert " " not in cls.domain and "|" not in cls.domain
