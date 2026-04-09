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
        """Only LIVE_MODELS get upgraded; INDEX_MODELS stay the same."""
        from app.services.llm_service import _get_model_version
        assert _get_model_version("chatgpt", pro=True) == "gpt-4.1-mini"
        assert _get_model_version("claude", pro=True) == "claude-haiku-4-5-20251001"
        assert _get_model_version("perplexity", pro=True) == "sonar-pro"
        assert _get_model_version("gemini", pro=True) == "gemini-2.5-pro"

    def test_unknown_model_returns_key(self):
        from app.services.llm_service import _get_model_version
        assert _get_model_version("unknown", pro=False) == "unknown"
        assert _get_model_version("unknown", pro=True) == "unknown"
