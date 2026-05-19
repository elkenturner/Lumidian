"""Tests for build_wikipedia_prompt locked-article kwargs."""
from app.services.drafting.prompts import build_wikipedia_prompt


def test_unlocked_call_unchanged() -> None:
    out = build_wikipedia_prompt(
        brand_name="Acme",
        prompt_text="What is X?",
        profile_context="Name: Acme",
        response_analysis="...",
    )
    assert "FIXED ARTICLE" not in out
    assert "ARTICLE SELECTION" in out or "specific, real, existing Wikipedia article" in out


def test_locked_title_replaces_article_selection() -> None:
    out = build_wikipedia_prompt(
        brand_name="Acme",
        prompt_text="What is X?",
        profile_context="Name: Acme",
        response_analysis="...",
        locked_article_title="Brand visibility in LLMs",
        article_section_list=["History", "Methodology"],
        citation_needed_hints=["…tracking emerged in the 2020s.{{citation needed}}"],
    )
    assert "FIXED ARTICLE" in out
    assert "Brand visibility in LLMs" in out
    assert "History" in out
    assert "Methodology" in out
    assert "CITATION NEEDED" in out
