"""Tests for LinkedIn and X platform spec completeness."""
from app.services.drafting.platforms import (
    ALL_PLATFORMS,
    CONTENT_PLATFORMS,
    PLATFORM_MAX_TOKENS,
    PLATFORM_SPECS,
)

REQUIRED_KEYS = {"format", "word_range", "tone", "rules", "posting_tip"}


def test_linkedin_article_spec_exists():
    assert "linkedin_article" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["linkedin_article"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "long_form_article"
    lo, hi = spec["word_range"]
    assert 400 <= lo <= 800 and 1000 <= hi <= 2000


def test_linkedin_post_spec_exists():
    assert "linkedin_post" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["linkedin_post"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "short_form_post"


def test_x_thread_spec_exists():
    assert "x_thread" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["x_thread"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "thread"


def test_x_post_spec_exists():
    assert "x_post" in PLATFORM_SPECS
    spec = PLATFORM_SPECS["x_post"]
    assert REQUIRED_KEYS.issubset(spec.keys())
    assert spec["format"] == "single_post"


def test_content_platforms_includes_linkedin_and_x():
    assert "linkedin_article" in CONTENT_PLATFORMS
    assert "linkedin_post" in CONTENT_PLATFORMS
    assert "x_thread" in CONTENT_PLATFORMS
    assert "x_post" in CONTENT_PLATFORMS


def test_content_platforms_excludes_reply_variants():
    assert "reddit_reply" not in CONTENT_PLATFORMS


def test_all_platforms_includes_all_variants():
    assert "reddit_reply" in ALL_PLATFORMS
    assert "linkedin_article" in ALL_PLATFORMS
    assert "linkedin_post" in ALL_PLATFORMS
    assert "x_thread" in ALL_PLATFORMS
    assert "x_post" in ALL_PLATFORMS


def test_max_tokens_set_for_all_new_specs():
    for key in ("linkedin_article", "linkedin_post",
                "x_thread", "x_post"):
        assert key in PLATFORM_MAX_TOKENS, f"Missing max_tokens for {key}"
        assert PLATFORM_MAX_TOKENS[key] > 0
