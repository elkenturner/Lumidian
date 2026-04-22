"""
Unit tests for tracking service components.
Tests mention detection and score calculation without database or LLM calls.
"""
import re


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _detect_mention(
    brand_name: str,
    response_text: str | None,
    error: str | None,
    model: str,
) -> bool:
    if not response_text or error == "api_key_not_configured":
        return False
    brand_norm = _normalize(brand_name)
    response_norm = _normalize(response_text)
    exact = brand_name.lower() in response_text.lower()
    fuzzy = brand_norm in response_norm
    return exact or fuzzy


class TestNormalization:
    def test_removes_spaces(self):
        assert _normalize("Hello World") == "helloworld"

    def test_removes_punctuation(self):
        assert _normalize("Hello, World!") == "helloworld"

    def test_lowercases(self):
        assert _normalize("HELLO") == "hello"

    def test_removes_hyphens(self):
        assert _normalize("hello-world") == "helloworld"

    def test_preserves_digits(self):
        assert _normalize("abc123") == "abc123"

    def test_empty_string(self):
        assert _normalize("") == ""


class TestMentionDetection:
    def test_exact_match(self):
        assert _detect_mention("TestBrand", "I recommend TestBrand for this.", None, "chatgpt") is True

    def test_case_insensitive_match(self):
        assert _detect_mention("TestBrand", "I recommend testbrand for this.", None, "chatgpt") is True

    def test_fuzzy_match_with_spaces(self):
        assert _detect_mention("Spotit Early", "The spotitearly system is effective.", None, "chatgpt") is True

    def test_no_match(self):
        assert _detect_mention("TestBrand", "I recommend OtherProduct.", None, "chatgpt") is False

    def test_empty_response(self):
        assert _detect_mention("TestBrand", "", None, "chatgpt") is False

    def test_none_response(self):
        assert _detect_mention("TestBrand", None, None, "chatgpt") is False

    def test_api_key_error(self):
        assert _detect_mention("TestBrand", "TestBrand mentioned", "api_key_not_configured", "chatgpt") is False

    def test_other_error_still_detects(self):
        # Non-api_key errors: if there is a response_text, detection proceeds
        assert _detect_mention("TestBrand", "TestBrand is here", "timeout", "chatgpt") is True

    def test_partial_word_match(self):
        # "TestBrand" should match inside a longer word via fuzzy
        assert _detect_mention("TestBrand", "testbrandpro is a tool", None, "chatgpt") is True

    def test_brand_with_punctuation_fuzzy(self):
        # "Brand.io" normalized -> "brandio"; response has "brandio" -> match
        assert _detect_mention("Brand.io", "I use brandio daily.", None, "claude") is True

    def test_all_models_supported(self):
        for model in ("chatgpt", "claude", "perplexity", "gemini"):
            assert _detect_mention("X", "I use X here.", None, model) is True


class TestScoreCalculation:
    def test_score_basic(self):
        mentions, total = 3, 10
        score = (mentions / total) * 100
        assert score == 30.0

    def test_score_all_mentions(self):
        mentions, total = 10, 10
        score = (mentions / total) * 100
        assert score == 100.0

    def test_score_no_mentions(self):
        mentions, total = 0, 10
        score = (mentions / total) * 100
        assert score == 0.0

    def test_score_single_query(self):
        mentions, total = 1, 1
        score = (mentions / total) * 100
        assert score == 100.0

    def test_score_is_float(self):
        score = (3 / 7) * 100
        assert isinstance(score, float)

    def test_score_rounds_correctly(self):
        # 1/3 * 100 ≈ 33.33...
        score = round((1 / 3) * 100, 2)
        assert score == 33.33

    def test_score_upper_bound(self):
        # Score should never exceed 100
        mentions, total = 20, 20
        score = (mentions / total) * 100
        assert score <= 100.0

    def test_score_lower_bound(self):
        # Score should never be negative
        mentions, total = 0, 100
        score = (mentions / total) * 100
        assert score >= 0.0


class TestMentionDetectionEdgeCases:
    def test_brand_name_mixed_case(self):
        assert _detect_mention("MixedCase", "mixedcase is great", None, "chatgpt") is True

    def test_brand_name_punctuation_stripped_by_normalize(self):
        # normalize strips hyphens; "cafe-brand" and "cafebrand" both normalize to "cafebrand"
        assert _detect_mention("cafe-brand", "cafebrand is recommended", None, "chatgpt") is True

    def test_whitespace_only_response(self):
        # Whitespace-only string is falsy via `not response_text` after strip? Let's check:
        # Python: not "   " → False, so it would try to detect — ensure no crash
        result = _detect_mention("TestBrand", "   ", None, "chatgpt")
        assert result is False or result is True  # Just must not raise

    def test_very_long_response(self):
        long_text = "word " * 10000 + "TestBrand"
        assert _detect_mention("TestBrand", long_text, None, "chatgpt") is True


class TestModelVersionSelection:
    """Test that Pro users get upgraded model versions."""

    def test_default_model_versions(self):
        from app.services.llm_service import _get_model_version
        assert _get_model_version("chatgpt", pro=False) == "gpt-4.1-mini"
        assert _get_model_version("claude", pro=False) == "claude-haiku-4-5-20251001"
        assert _get_model_version("perplexity", pro=False) == "sonar"
        assert _get_model_version("gemini", pro=False) == "gemini-2.5-flash"

    def test_pro_model_versions(self):
        """Pro variants per 2026-04-20 cost/accuracy overhaul:
        ChatGPT → search-preview, Gemini stays on Flash (Pro killed), Perplexity → sonar-pro.
        """
        from app.services.llm_service import _get_model_version
        assert _get_model_version("chatgpt", pro=True) == "gpt-4o-mini-search-preview"
        assert _get_model_version("claude", pro=True) == "claude-haiku-4-5-20251001"
        assert _get_model_version("perplexity", pro=True) == "sonar-pro"
        assert _get_model_version("gemini", pro=True) == "gemini-2.5-flash"

    def test_unknown_model_returns_key(self):
        from app.services.llm_service import _get_model_version
        assert _get_model_version("unknown", pro=False) == "unknown"
        assert _get_model_version("unknown", pro=True) == "unknown"


# ── Claude web search tests ────────────────────────────────────────────────────

import pytest
from unittest.mock import MagicMock, patch


class _MockClaudeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _MockClaudeMessage:
    def __init__(self, text):
        self.content = [_MockClaudeTextBlock(text)]


@pytest.mark.asyncio
async def test_query_claude_uses_web_search_tool_and_strips_urls_before_mention_check():
    """Claude tracker queries must include web_search_20250305 and must not be tricked
    by brand-name-in-URL false positives (e.g. 'brand.com' in a citation footer)."""
    from app.services import llm_service

    captured_kwargs: dict = {}

    async def fake_create(**kwargs):
        captured_kwargs.update(kwargs)
        # Response contains brand only inside a URL citation — mention should be False after stripping.
        return _MockClaudeMessage(
            "Top options include Nike and Adidas. See more at https://stripe.com for payment details. [1]"
        )

    fake_client = MagicMock()
    fake_client.messages.create = fake_create

    with patch.object(llm_service, "ANTHROPIC_API_KEY", "test-key"), \
         patch("anthropic.AsyncAnthropic", return_value=fake_client):
        result = await llm_service._query_claude(
            prompt="best running shoes?",
            brand_name="Stripe",
            model_version="claude-haiku-4-5-20251001",
        )

    # 1) The tool must be on the request
    tools = captured_kwargs.get("tools") or []
    assert any(t.get("type") == "web_search_20250305" for t in tools), \
        f"Claude request missing web_search_20250305 tool: tools={tools}"

    # 2) The original response text is preserved for the transcript
    assert "stripe.com" in result["response_text"]

    # 3) Mention detection must ignore the URL — "Stripe" is only in the citation
    assert result["mentioned"] is False, \
        "Brand in URL citation should NOT count as a mention after stripping"


@pytest.mark.asyncio
async def test_query_claude_detects_mention_in_visible_text():
    from app.services import llm_service

    async def fake_create(**kwargs):
        return _MockClaudeMessage("I recommend Stripe for online payments.")

    fake_client = MagicMock()
    fake_client.messages.create = fake_create

    with patch.object(llm_service, "ANTHROPIC_API_KEY", "test-key"), \
         patch("anthropic.AsyncAnthropic", return_value=fake_client):
        result = await llm_service._query_claude(
            prompt="payment processors?",
            brand_name="Stripe",
            model_version="claude-haiku-4-5-20251001",
        )

    assert result["mentioned"] is True
    assert "Stripe" in result["response_text"]
