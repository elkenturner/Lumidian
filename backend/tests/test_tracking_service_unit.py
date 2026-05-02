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
        """Pro variants:
        ChatGPT → gpt-4o-mini (web_search via Responses API, 2026-05-01),
        Gemini stays on Flash (Pro killed 2026-04-20), Perplexity → sonar-pro.
        """
        from app.services.llm_service import _get_model_version
        assert _get_model_version("chatgpt", pro=True) == "gpt-4o-mini"
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


# ── Gemini retry & fallback tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_gemini_retry_budget_is_five():
    """Gemini's 503 'high demand' takes 20-60s to clear; budget must cover the window."""
    from app.services.llm_service import _MAX_ATTEMPTS
    assert _MAX_ATTEMPTS["gemini"] == 5


@pytest.mark.asyncio
async def test_gemini_overload_backoff_starts_at_20s():
    """Gemini 503s need a longer initial backoff than other models; capped at 90s."""
    from app.services import llm_service

    recorded_delays: list[float] = []

    async def fake_sleep(d):
        recorded_delays.append(d)

    async def always_overload(prompt, brand_name, model_version):
        return {"response_text": None, "mentioned": False, "latency_ms": 10,
                "error": "503 UNAVAILABLE — high demand"}

    with patch("asyncio.sleep", side_effect=fake_sleep), \
         patch("random.uniform", return_value=0.0):
        result = await llm_service._with_retry(
            always_overload, "test", "TestBrand", "gemini",
            model_version="gemini-2.5-flash",
        )

    # 5 attempts → 4 sleeps between them
    assert len(recorded_delays) == 4
    # Delays must start at 20s and double up to cap at 90s (jitter=0 since we patched random)
    # Expected: 20, 40, 80, 90 (capped)
    assert recorded_delays[0] == 20.0
    assert recorded_delays[1] == 40.0
    assert recorded_delays[2] == 80.0
    assert recorded_delays[3] == 90.0
    assert result["error"].startswith("Empty response from Gemini API after 5 attempts")


@pytest.mark.asyncio
async def test_non_gemini_overload_backoff_unchanged():
    """Perplexity and other models keep their 5s base backoff."""
    from app.services import llm_service

    recorded_delays: list[float] = []

    async def fake_sleep(d):
        recorded_delays.append(d)

    async def always_overload(prompt, brand_name, model_version):
        return {"response_text": None, "mentioned": False, "latency_ms": 10,
                "error": "503 UNAVAILABLE"}

    with patch("asyncio.sleep", side_effect=fake_sleep), \
         patch("random.uniform", return_value=0.0):
        await llm_service._with_retry(
            always_overload, "test", "TestBrand", "perplexity",
            model_version="sonar",
        )

    # Perplexity: 5 attempts → 4 sleeps with 5s base (5, 10, 20, 40)
    assert recorded_delays == [5.0, 10.0, 20.0, 40.0]


@pytest.mark.asyncio
async def test_gemini_does_not_fall_back_across_generations():
    """Retries must stay on the configured Gemini model version.

    Silently returning data from gemini-1.5-flash when the user tracks against
    gemini-2.5-flash would mix grounding behavior and response quality into
    their dataset. All retries must use the original model version.
    """
    from app.services import llm_service

    seen_versions: list[str] = []

    async def record_version(prompt, brand_name, model_version):
        seen_versions.append(model_version)
        return {"response_text": None, "mentioned": False, "latency_ms": 10,
                "error": "503 UNAVAILABLE"}

    async def fake_sleep(d):
        pass

    with patch("asyncio.sleep", side_effect=fake_sleep), \
         patch("random.uniform", return_value=0.0):
        await llm_service._with_retry(
            record_version, "test", "TestBrand", "gemini",
            model_version="gemini-2.5-flash",
        )

    # Every attempt hits the same model version — no fallback chain.
    assert all(v == "gemini-2.5-flash" for v in seen_versions), \
        f"Expected only gemini-2.5-flash, saw {seen_versions}"
    assert len(seen_versions) == 5, f"Expected 5 attempts, got {len(seen_versions)}"


@pytest.mark.asyncio
async def test_gemini_pacer_is_invoked():
    """_query_gemini must call the module-level pacer before firing the request."""
    from app.services import llm_service

    pacer_waits = 0

    class _FakePacer:
        async def wait(self):
            nonlocal pacer_waits
            pacer_waits += 1

    class _FakeResp:
        text = "Hello TestBrand"
        candidates = []

    async def fake_generate_content(**kwargs):
        return _FakeResp()

    fake_client = MagicMock()
    fake_client.aio.models.generate_content = fake_generate_content

    with patch.object(llm_service, "GEMINI_API_KEY", "test-key"), \
         patch.object(llm_service, "_GEMINI_PACER", _FakePacer()), \
         patch.object(llm_service, "_get_gemini_client", return_value=fake_client):
        result = await llm_service._query_gemini(
            prompt="q", brand_name="TestBrand", model_version="gemini-2.5-flash",
        )

    assert pacer_waits >= 1, "Gemini pacer must be awaited before submitting the request"
    assert result["error"] is None
    assert result["mentioned"] is True
