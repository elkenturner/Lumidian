from app.services.drafting.citations import render_citations
from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.clustering_service import append_pillar_reference


def _pack():
    return EvidencePack(
        sources=[
            EvidenceSource(ref="S1", kind="web", url="https://reuters.com/a", title="Reuters piece", snippet="x"),
        ],
        query="q",
        brand_name="b",
    )


def test_reddit_render_strips_markers_and_has_no_footer():
    text = "Widgets cut costs 30% per a Reuters analysis [S1]. That matched our experience."
    rendered, used = render_citations(text, _pack(), "reddit")
    assert "[S1]" not in rendered
    assert "More on this" not in rendered
    assert "reuters.com" not in rendered          # no link footer at all
    assert len(used) == 1                         # citation still recorded for the UI


def test_reddit_reply_render_also_linkless():
    rendered, _ = render_citations("Costs fell [S1].", _pack(), "reddit_reply")
    assert "http" not in rendered


def test_reddit_comment_render_also_linkless():
    rendered, _ = render_citations("Costs fell [S1].", _pack(), "reddit_comment")
    assert "http" not in rendered
    assert "[S1]" not in rendered


def test_pillar_reference_not_appended_on_reddit():
    for platform in ("reddit", "reddit_reply", "reddit_comment"):
        out = append_pillar_reference(text="body", platform=platform, pillar_url="https://ex.com/p")
        assert out == "body"


def test_pillar_reference_still_appended_on_linkedin():
    out = append_pillar_reference(text="body", platform="linkedin_post", pillar_url="https://ex.com/p")
    assert "https://ex.com/p" in out
