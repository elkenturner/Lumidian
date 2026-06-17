import pytest
from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.drafting.citations import (
    render_citations,
    extract_used_refs,
    drop_out_of_range_markers,
)


def _pack(*pairs):
    return EvidencePack(
        sources=[EvidenceSource(ref=ref, kind="web", url=url, title=title, snippet="")
                 for ref, url, title in pairs],
        query="q", brand_name="b",
    )


def test_render_medium_emits_inline_links_and_footer():
    text = "Cancer detection accuracy hit 94% [S1]. Subsequent studies confirmed [S2]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"), ("S2", "https://pubmed.gov/b", "PubMed"))
    rendered, citations = render_citations(text=text, pack=pack, platform="medium")
    assert "[1](https://nature.com/a)" in rendered
    assert "[2](https://pubmed.gov/b)" in rendered
    assert "Sources" in rendered
    assert "1. [Nature](https://nature.com/a)" in rendered
    assert len(citations) == 2


def test_render_reddit_uses_conversational_block():
    # Updated 2026-05-20 cluster redesign: Reddit moved from inline
    # "(source: domain)" to a trailing "More on this:" conversational block.
    text = "Studies show 94% accuracy [S1]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"))
    rendered, _ = render_citations(text=text, pack=pack, platform="reddit")
    assert "(source: nature.com)" not in rendered
    assert "More on this:" in rendered
    assert "nature.com" in rendered


def test_render_x_strips_markers():
    text = "Cancer detection hit 94% [S1]. Wow [S2]."
    pack = _pack(("S1", "https://x", "X"), ("S2", "https://y", "Y"))
    rendered, citations = render_citations(text=text, pack=pack, platform="x_post")
    assert "[S1]" not in rendered and "[S2]" not in rendered
    assert len(citations) == 2


def test_render_wikipedia_inserts_ref_tags():
    text = "Cancer detection accuracy hit 94% [S1]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"))
    rendered, _ = render_citations(text=text, pack=pack, platform="wikipedia")
    assert "<ref>" in rendered and "cite web" in rendered
    assert "url=https://nature.com/a" in rendered


def test_unmatched_marker_is_dropped():
    text = "Foo [S1] bar [S9]."
    pack = _pack(("S1", "https://x", "X"))
    rendered, citations = render_citations(text=text, pack=pack, platform="medium")
    assert "[S9]" not in rendered and "[9]" not in rendered
    assert len(citations) == 1


def test_extract_used_refs():
    text = "A [S1] B [S2] C [S2] D [S5]."
    refs = extract_used_refs(text)
    assert refs == ["S1", "S2", "S5"]


def test_drop_out_of_range_markers_removes_high_refs():
    # Writer hallucinated [S5] when only 2 sources exist.
    text = "Foo [S1] bar [S5] baz [S2]."
    cleaned, dropped = drop_out_of_range_markers(text, source_count=2)
    assert "[S5]" not in cleaned
    assert "[S1]" in cleaned and "[S2]" in cleaned
    assert dropped == 1


def test_drop_out_of_range_markers_zero_sources_drops_all():
    text = "Foo [S1] bar [S2]."
    cleaned, dropped = drop_out_of_range_markers(text, source_count=0)
    assert "[S1]" not in cleaned and "[S2]" not in cleaned
    assert dropped == 2


def test_drop_out_of_range_markers_none_to_drop():
    text = "Foo [S1] bar [S2]."
    cleaned, dropped = drop_out_of_range_markers(text, source_count=3)
    assert cleaned == text
    assert dropped == 0


def test_rendered_citation_carries_tier():
    # T1 authority domain vs long-tail T3.
    text = "Accuracy hit 94% [S1]. Also relevant [S2]."
    pack = _pack(
        ("S1", "https://www.nature.com/a", "Nature"),
        ("S2", "https://some-random-blog.example/x", "Blog"),
    )
    _, citations = render_citations(text=text, pack=pack, platform="medium")
    by_ref = {c.source_ref: c for c in citations}
    assert by_ref["S1"].tier == "T1"
    assert by_ref["S2"].tier == "T3"
