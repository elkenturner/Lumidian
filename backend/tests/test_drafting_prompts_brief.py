"""Tests for build_prompt() brief context block."""
from app.services.drafting.prompts import build_prompt


def _spec() -> dict:
    return {
        "format": "post",
        "tone": "professional",
        "word_range": (150, 300),
        "rules": ["Be concise.", "No CTAs."],
    }


def test_build_prompt_without_brief_context_unchanged() -> None:
    out = build_prompt(
        brand_name="Acme",
        platform="linkedin",
        prompt_text="What is X?",
        visibility_pct=42.0,
        profile_context="Name: Acme",
        response_analysis="Competitors win",
        platform_spec=_spec(),
    )
    assert "CLUSTER BRIEF" not in out


def test_build_prompt_with_brief_includes_cluster_section() -> None:
    brief_ctx = """POSITIONING: Acme is the leader.
CANONICAL PHRASINGS (use at least 1 verbatim):
  - Acme tracks X across Y
KEY CLAIMS:
  - Claim 1
SIBLING PLATFORMS in this cluster (reference by platform name, not URL):
  - medium, reddit, quora, x"""

    out = build_prompt(
        brand_name="Acme",
        platform="linkedin",
        prompt_text="What is X?",
        visibility_pct=42.0,
        profile_context="Name: Acme",
        response_analysis="Competitors win",
        platform_spec=_spec(),
        brief_context=brief_ctx,
    )
    assert "CLUSTER BRIEF" in out
    assert "Acme tracks X across Y" in out
    assert "SIBLING PLATFORMS" in out
