from app.models import ContentBrief
from app.services.clustering_service import _build_brief_context


def test_brief_context_requires_verbatim_phrasings():
    brief = ContentBrief(
        positioning="x",
        canonical_phrasings=["Acme is the fastest", "Acme uses ML for matching"],
        key_claims=["fast"],
        stats=[], narrative_spine="", tone_notes="",
        competitor_context={},
    )
    ctx = _build_brief_context(brief, sibling_platforms=["medium"])
    # "verbatim required" phrasing must be stronger than the previous "at least 1"
    assert "VERBATIM" in ctx.upper()
    assert "Acme is the fastest" in ctx
    assert "Acme uses ML for matching" in ctx


def test_brief_context_no_sibling_platform_references_in_writer():
    # Sibling platforms are no longer dangled in the writer prompt — they
    # invite hallucinated cross-references.
    brief = ContentBrief(
        positioning="x", canonical_phrasings=[], key_claims=[],
        stats=[], narrative_spine="", tone_notes="",
        competitor_context={},
    )
    ctx = _build_brief_context(brief, sibling_platforms=["medium", "reddit"])
    assert "SIBLING" not in ctx.upper()
