from app.services.drafting.citations import render_citations
from app.services.drafting.evidence import EvidencePack, EvidenceSource


def _pack(*sources):
    return EvidencePack(
        sources=[EvidenceSource(ref=f"S{i+1}", kind="web", url=u, title=t, snippet="")
                 for i, (u, t) in enumerate(sources)],
        query="q", brand_name="b",
    )


def test_linkedin_post_now_uses_end_block_not_inline_domain():
    pack = _pack(
        ("https://reuters.com/a", "Reuters story"),
        ("https://nytimes.com/b", "NYT story"),
    )
    rendered, used = render_citations(
        text="Claim one [S1]. Claim two [S2].",
        pack=pack,
        platform="linkedin_post",
    )
    # Inline parenthetical removed
    assert "(source:" not in rendered
    # End-of-post Sources block present
    assert "Sources" in rendered
    assert "Reuters story" in rendered or "reuters.com" in rendered
    assert len(used) == 2


def test_reddit_uses_conversational_woven_block_not_inline_domain():
    pack = _pack(
        ("https://reuters.com/a", "Reuters story"),
        ("https://nytimes.com/b", "NYT story"),
    )
    rendered, used = render_citations(
        text="Claim one [S1]. Claim two [S2].",
        pack=pack,
        platform="reddit",
    )
    # No inline parenthetical
    assert "(source:" not in rendered
    # Trailing conversational line
    assert "More on this:" in rendered or "Sources:" in rendered
    # Both domains surface in the trailing block
    assert "reuters.com" in rendered
    assert "nytimes.com" in rendered


def test_medium_footer_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, used = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="medium",
    )
    assert "Sources" in rendered
    assert "Reuters story" in rendered


def test_x_strips_markers_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, _ = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="x_post",
    )
    assert "[S1]" not in rendered
    assert "(source:" not in rendered


def test_wikipedia_ref_tag_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, _ = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="wikipedia",
    )
    assert "<ref>" in rendered
