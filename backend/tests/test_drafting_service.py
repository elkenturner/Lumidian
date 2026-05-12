"""
Unit tests for drafting service components.
Tests prompt construction, sanitization, and platform rules without LLM calls.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.drafting.pipeline import (
    estimate_visibility_impact,
    extract_title_and_body,
    remove_hedging,
)
from app.services.drafting.platforms import (
    PLATFORM_SPECS,
    build_subreddit_strategy,
    classify_subreddit,
)
from app.services.drafting.prompts import build_prompt
from app.services.reddit_scanner_service import (
    find_first_valid_subreddit,
    validate_subreddit_exists,
)


class TestSubredditClassification:
    def test_restricted_subreddit_by_name(self):
        assert classify_subreddit("personalfinance") == "restricted"
        assert classify_subreddit("r/legaladvice") == "restricted"
        assert classify_subreddit("AskDocs") == "restricted"

    def test_restricted_subreddit_by_signal(self):
        assert classify_subreddit("cancersupport") == "restricted"
        assert classify_subreddit("r/depressionhelp") == "restricted"

    def test_allowed_subreddit(self):
        assert classify_subreddit("entrepreneur") == "allowed"
        assert classify_subreddit("r/startups") == "allowed"

    def test_cautious_subreddit(self):
        assert classify_subreddit("randomsubreddit") == "cautious"
        assert classify_subreddit("r/photography") == "cautious"


class TestSubredditStrategy:
    def test_restricted_strategy_prohibits_brand(self):
        result = build_subreddit_strategy("personalfinance", "TestBrand", "restricted")
        assert "CRITICAL" in result
        assert "TestBrand" in result
        assert "strictly prohibits" in result.lower()

    def test_allowed_strategy_permits_brand_mention(self):
        result = build_subreddit_strategy("entrepreneur", "TestBrand", "allowed")
        assert "TestBrand" in result
        assert "allows relevant brand mentions" in result

    def test_cautious_strategy_defaults_value_first(self):
        result = build_subreddit_strategy("randomsub", "TestBrand", "cautious")
        assert "TestBrand" in result
        assert "value-first" in result

    def test_all_strategies_return_strings(self):
        for strategy in ("restricted", "allowed", "cautious"):
            result = build_subreddit_strategy("sub", "Brand", strategy)
            assert isinstance(result, str)
            assert len(result) > 0


class TestHedgingRemoval:
    def test_removes_hedging_phrases(self):
        # "it's worth noting" is an unambiguous AI-tell and still removed.
        # "additionally" was dropped from the regex (prompt + critic now catch it).
        text = "It's worth noting that the product works. Additionally, it's fast."
        result = remove_hedging(text)
        assert "worth noting" not in result.lower()

    def test_preserves_content(self):
        text = "The product increases efficiency by 50%."
        result = remove_hedging(text)
        assert "increases efficiency by 50%" in result

    def test_handles_empty_string(self):
        assert remove_hedging("") == ""

    def test_removes_furthermore(self):
        # "furthermore" was removed from the narrowed regex; prompt + critic now
        # catch it.  Verify the function doesn't corrupt the surrounding content.
        text = "Furthermore, the product is reliable."
        result = remove_hedging(text)
        assert "product is reliable" in result

    def test_removes_em_dash(self):
        text = "The product — well tested — works great."
        result = remove_hedging(text)
        assert "—" not in result

    def test_removes_markdown_headers(self):
        text = "## Section Title\nSome body text."
        result = remove_hedging(text)
        assert "##" not in result
        assert "Section Title" in result


class TestTitleExtraction:
    def test_reddit_title_extraction(self):
        text = "My Experience with Product X\n\nHere is the body content..."
        title, body = extract_title_and_body(text, "reddit")
        assert title == "My Experience with Product X"
        assert "body content" in body

    def test_medium_title_extraction(self):
        text = "Why AI Visibility Matters for Brands\n\nThis article explores the topic."
        title, body = extract_title_and_body(text, "medium")
        assert title == "Why AI Visibility Matters for Brands"
        assert "explores the topic" in body

    def test_quora_no_title(self):
        text = "The answer is straightforward. Here's what you need to know..."
        title, body = extract_title_and_body(text, "quora")
        assert title is None
        assert "answer is straightforward" in body

    def test_wikipedia_no_title(self):
        text = "Some encyclopedic content about a topic."
        title, body = extract_title_and_body(text, "wikipedia")
        assert title is None
        assert "encyclopedic content" in body

    def test_reddit_fallback_to_first_line(self):
        text = "Short Title\nBody text follows here without a blank line."
        title, body = extract_title_and_body(text, "reddit")
        assert title == "Short Title"
        assert "Body text" in body

    def test_title_strips_markdown_bold(self):
        text = "**My Bold Title**\n\nBody text here."
        title, body = extract_title_and_body(text, "reddit")
        assert title == "My Bold Title"

    def test_title_strips_title_prefix(self):
        text = "Title: My Explicit Title\n\nBody text here."
        title, body = extract_title_and_body(text, "reddit")
        assert title == "My Explicit Title"


class TestEstimateVisibilityImpact:
    def test_high_gap_low_posts_gives_high_score(self):
        result = estimate_visibility_impact(80.0, 20.0, 0)
        assert result > 80.0

    def test_result_capped_at_100(self):
        result = estimate_visibility_impact(100.0, 0.0, 0)
        assert result <= 100.0

    def test_many_recent_posts_reduces_score(self):
        result_no_posts = estimate_visibility_impact(50.0, 50.0, 0)
        result_many_posts = estimate_visibility_impact(50.0, 50.0, 10)
        assert result_no_posts > result_many_posts

    def test_returns_float(self):
        result = estimate_visibility_impact(50.0, 50.0, 3)
        assert isinstance(result, float)

    def test_zero_gap_score(self):
        result = estimate_visibility_impact(0.0, 50.0, 0)
        assert result >= 0.0


class TestPlatformSpecs:
    def test_all_platforms_have_required_fields(self):
        required = ["format", "word_range", "tone", "rules"]
        for platform, spec in PLATFORM_SPECS.items():
            for field in required:
                assert field in spec, f"{platform} missing {field}"

    def test_word_ranges_are_valid(self):
        for platform, spec in PLATFORM_SPECS.items():
            min_words, max_words = spec["word_range"]
            assert min_words < max_words
            assert min_words > 0

    def test_rules_are_non_empty_lists(self):
        for platform, spec in PLATFORM_SPECS.items():
            assert isinstance(spec["rules"], list), f"{platform} rules not a list"
            assert len(spec["rules"]) > 0, f"{platform} has no rules"

    def test_known_platforms_present(self):
        assert "reddit" in PLATFORM_SPECS
        assert "quora" in PLATFORM_SPECS
        assert "medium" in PLATFORM_SPECS
        assert "wikipedia" in PLATFORM_SPECS


class TestBuildPrompt:
    def test_includes_brand_name(self):
        spec = PLATFORM_SPECS["reddit"]
        result = build_prompt(
            brand_name="TestBrand",
            platform="reddit",
            prompt_text="What tools help with X?",
            visibility_pct=30.0,
            profile_context="TestBrand is a tool for X.",
            response_analysis="Current responses mention X without specifics.",
            platform_spec=spec,
        )
        assert "TestBrand" in result

    def test_includes_prompt_text(self):
        spec = PLATFORM_SPECS["quora"]
        result = build_prompt(
            brand_name="MyBrand",
            platform="quora",
            prompt_text="How do I solve problem Y?",
            visibility_pct=10.0,
            profile_context="MyBrand solves Y.",
            response_analysis="No good answers exist yet.",
            platform_spec=spec,
        )
        assert "How do I solve problem Y?" in result

    def test_includes_opportunity_context(self):
        spec = PLATFORM_SPECS["reddit"]
        result = build_prompt(
            brand_name="BrandX",
            platform="reddit",
            prompt_text="Best tools for Z?",
            visibility_pct=25.0,
            profile_context="BrandX helps with Z.",
            response_analysis="Responses lack specifics.",
            platform_spec=spec,
            opportunity_context="Thread asking about Z tools",
        )
        assert "Thread asking about Z tools" in result

    def test_returns_string(self):
        spec = PLATFORM_SPECS["medium"]
        result = build_prompt(
            brand_name="Brand",
            platform="medium",
            prompt_text="Why does X matter?",
            visibility_pct=50.0,
            profile_context="Brand context.",
            response_analysis="Analysis here.",
            platform_spec=spec,
        )
        assert isinstance(result, str)
        assert len(result) > 100


def _mock_serper_response(status_code: int, organic: list[dict] | None):
    """Build a mocked httpx.Response from a Serper search."""
    resp = MagicMock()
    resp.status_code = status_code
    if status_code >= 400:
        import httpx as _httpx
        resp.raise_for_status.side_effect = _httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp,
        )
    else:
        resp.raise_for_status.return_value = None
    resp.json.return_value = {"organic": organic or []}
    return resp


class TestValidateSubredditExists:
    @pytest.mark.asyncio
    async def test_valid_subreddit_returns_true(self):
        resp = _mock_serper_response(200, [
            {"link": "https://www.reddit.com/r/startups/comments/abc/foo/", "title": "..."},
            {"link": "https://www.reddit.com/r/startups/", "title": "r/startups"},
        ])
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("startups") is True

    @pytest.mark.asyncio
    async def test_no_matching_results_returns_false(self):
        # Hallucinated subreddit: Serper returns no URLs under reddit.com/r/{sub}/
        resp = _mock_serper_response(200, [
            {"link": "https://www.reddit.com/r/AskReddit/comments/xyz/", "title": "..."},
        ])
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("medical_technology") is False

    @pytest.mark.asyncio
    async def test_empty_organic_returns_false(self):
        resp = _mock_serper_response(200, [])
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("nonexistentsubreddit") is False

    @pytest.mark.asyncio
    async def test_serper_error_fails_open(self):
        # Serper transient failures must not block draft creation.
        resp = _mock_serper_response(500, None)
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("startups") is True

    @pytest.mark.asyncio
    async def test_missing_api_key_fails_open(self):
        # No SERPER_API_KEY → can't validate, fail-open to preserve old behavior.
        with patch.dict("os.environ", {"SERPER_API_KEY": ""}, clear=False):
            assert await validate_subreddit_exists("anything") is True

    @pytest.mark.asyncio
    async def test_strips_r_prefix(self):
        resp = _mock_serper_response(200, [
            {"link": "https://www.reddit.com/r/startups/comments/abc/foo/", "title": "..."},
        ])
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ) as mock_factory, patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("r/startups") is True
            # Verify the query doesn't have 'r/r/'
            call = mock_factory.return_value.post.call_args
            query = call.kwargs["json"]["q"]
            assert "r/r/" not in query
            assert "site:reddit.com/r/startups" in query

    @pytest.mark.asyncio
    async def test_empty_string_returns_false(self):
        # Should short-circuit without making an HTTP call.
        assert await validate_subreddit_exists("") is False
        assert await validate_subreddit_exists("   ") is False
        assert await validate_subreddit_exists("r/") is False

    @pytest.mark.asyncio
    async def test_network_error_fails_open(self):
        # Transient network failures must not block draft creation.
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(side_effect=Exception("network down"))
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("anything") is True

    @pytest.mark.asyncio
    async def test_other_subreddit_results_dont_match(self):
        # Serper returned results, but none under the requested subreddit's URL.
        resp = _mock_serper_response(200, [
            {"link": "https://www.reddit.com/r/different/comments/abc/", "title": "..."},
            {"link": "https://www.reddit.com/r/another_one/", "title": "..."},
        ])
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=resp)
        with patch(
            "app.services.reddit_scanner_service.httpx.AsyncClient",
            return_value=client,
        ), patch.dict("os.environ", {"SERPER_API_KEY": "test-key"}):
            assert await validate_subreddit_exists("madeupname") is False


class TestFindFirstValidSubreddit:
    @pytest.mark.asyncio
    async def test_returns_first_valid(self):
        async def fake_validate(sub):
            return sub == "real_sub"

        with patch(
            "app.services.reddit_scanner_service.validate_subreddit_exists",
            side_effect=fake_validate,
        ):
            result = await find_first_valid_subreddit(["fake1", "fake2", "real_sub", "real2"])
            assert result == "real_sub"

    @pytest.mark.asyncio
    async def test_returns_none_when_all_invalid(self):
        async def fake_validate(_):
            return False

        with patch(
            "app.services.reddit_scanner_service.validate_subreddit_exists",
            side_effect=fake_validate,
        ):
            result = await find_first_valid_subreddit(["a", "b", "c"])
            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_list(self):
        result = await find_first_valid_subreddit([])
        assert result is None

    @pytest.mark.asyncio
    async def test_strips_r_prefix_from_result(self):
        async def fake_validate(_):
            return True

        with patch(
            "app.services.reddit_scanner_service.validate_subreddit_exists",
            side_effect=fake_validate,
        ):
            result = await find_first_valid_subreddit(["r/startups"])
            assert result == "startups"
