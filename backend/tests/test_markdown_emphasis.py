"""strip_markdown_emphasis: social platforms get plain text, markdown platforms keep formatting."""
from app.services.drafting.pipeline import strip_markdown_emphasis
from app.services.drafting.platforms import PLATFORM_SPECS
from app.services.drafting.prompts import build_prompt


def test_bold_markers_removed_content_kept():
    assert strip_markdown_emphasis("Use **lane history** to quote.", "linkedin_article") == "Use lane history to quote."
    assert strip_markdown_emphasis("__Key point__: rates move.", "reddit") == "Key point: rates move."
    assert strip_markdown_emphasis("***Really*** important.", "quora") == "Really important."


def test_multiple_and_multiline_bold():
    text = "**One** and **two**.\n\n**Section Header**\nBody."
    out = strip_markdown_emphasis(text, "medium")
    assert "**" not in out
    assert "One and two." in out and "Section Header" in out


def test_links_headers_and_bullets_survive():
    text = "## Heading\n- item one\n* item two\nSee [the study](https://ex.com/a) for data."
    assert strip_markdown_emphasis(text, "linkedin_post") == text


def test_owned_site_and_wikipedia_untouched():
    text = "## H2\n**bold** stays."
    assert strip_markdown_emphasis(text, "owned_site") == text
    assert strip_markdown_emphasis(text, "wikipedia") == text


def test_unbalanced_markers_left_alone():
    assert strip_markdown_emphasis("a ** b", "x_post") == "a ** b"


def test_linkedin_article_rule_no_longer_mandates_bold():
    rules = " ".join(PLATFORM_SPECS["linkedin_article"]["rules"]).lower()
    assert "using bold text" not in rules
    assert "asterisks" in rules  # explains why plain-text section breaks


def test_writing_rules_ban_markdown_emphasis():
    p = build_prompt(
        brand_name="Acme", platform="linkedin_article", prompt_text="q?",
        visibility_pct=1.0, profile_context="", response_analysis="",
        platform_spec=PLATFORM_SPECS["linkedin_article"],
    )
    assert "markdown emphasis" in p.lower() or "**bold**" in p
