from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.drafting.prompts import build_prompt


def test_build_prompt_includes_evidence_pack():
    pack = EvidencePack(
        sources=[
            EvidenceSource(ref="S1", kind="web", url="https://nature.com/a",
                           title="Nature study", snippet="A 2024 study found..."),
        ],
        query="how does breath analysis detect cancer",
        brand_name="Acme",
    )
    out = build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="how does breath analysis detect cancer",
        visibility_pct=10.0,
        profile_context="Brand: Acme. Approved language: ...",
        response_analysis="Currently no AI responses mention Acme.",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "thought leadership", "rules": []},
        evidence_pack=pack,
    )
    assert "[S1]" in out
    assert "Nature study" in out
    assert "https://nature.com/a" in out
    assert "CITATION RULES" in out


def test_build_prompt_includes_voice_sample_and_related_when_present():
    pack = EvidencePack(sources=[], query="q", brand_name="Acme")
    out = build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="q",
        visibility_pct=0.0,
        profile_context="ctx",
        response_analysis="none",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "x", "rules": []},
        evidence_pack=pack,
        voice_sample="Short concrete writing. Specific facts. Real numbers.",
        related_draft_summary="LinkedIn article: \"Title\" — argues that ...",
    )
    assert "VOICE EXAMPLE" in out
    assert "Short concrete writing" in out
    assert "RELATED PUBLISHED CONTENT" in out


def test_build_prompt_omits_voice_when_none():
    pack = EvidencePack(sources=[], query="q", brand_name="Acme")
    out = build_prompt(
        brand_name="Acme", platform="medium", prompt_text="q",
        visibility_pct=0.0, profile_context="ctx", response_analysis="none",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "x", "rules": []},
        evidence_pack=pack,
        voice_sample=None,
        related_draft_summary=None,
    )
    assert "VOICE EXAMPLE" not in out
    assert "RELATED PUBLISHED CONTENT" not in out
