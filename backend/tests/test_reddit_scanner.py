# backend/tests/test_reddit_scanner.py
import time

import pytest

from app.services.reddit_scanner_service import (
    _build_search_query,
    _haiku_relevance_check,
    _is_blocked_subreddit,
    _score_thread,
)

# ── _is_blocked_subreddit ─────────────────────────────────────────────────────

def test_blocked_medical_sub():
    assert _is_blocked_subreddit("depression") is True

def test_blocked_nsfw_signal_in_name():
    assert _is_blocked_subreddit("nsfw_something") is True

def test_blocked_news_mega_sub():
    assert _is_blocked_subreddit("worldnews") is True

def test_blocked_askreddit():
    assert _is_blocked_subreddit("askreddit") is True

def test_unblocked_saas_sub():
    assert _is_blocked_subreddit("SaaS") is False

def test_unblocked_fitness_sub():
    assert _is_blocked_subreddit("fitness") is False

def test_blocked_case_insensitive():
    assert _is_blocked_subreddit("Depression") is True


# ── _score_thread recency ─────────────────────────────────────────────────────

def _ts(days_ago: float) -> float:
    return time.time() - days_ago * 86400


def test_score_recent_post_higher_than_old():
    title = "how does machine learning detect patterns in data"
    prompt = "how does machine learning detect patterns"
    score_new = _score_thread(title, "", prompt, _ts(3), num_comments=5, brand_name="Acme")
    score_old = _score_thread(title, "", prompt, _ts(75), num_comments=5, brand_name="Acme")
    assert score_new > score_old

def test_score_old_post_not_zero():
    """No hard age cutoff — old evergreen threads still get a score if relevant."""
    title = "comparing saas tools for project management workflow"
    prompt = "comparing saas tools for project management"
    score = _score_thread(title, "", prompt, _ts(100), num_comments=50, brand_name="Acme")
    assert score > 0


# ── _score_thread engagement ──────────────────────────────────────────────────

def test_score_more_comments_higher():
    title = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    score_busy = _score_thread(title, "", prompt, _ts(10), num_comments=100, brand_name="Acme")
    score_quiet = _score_thread(title, "", prompt, _ts(10), num_comments=1, brand_name="Acme")
    assert score_busy > score_quiet

def test_score_zero_comments_not_filtered():
    """0-comment posts pass scoring — first-mover opportunity."""
    title = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    score = _score_thread(title, "", prompt, _ts(2), num_comments=0, brand_name="Acme")
    assert score > 0


# ── _score_thread brand mention bonus ─────────────────────────────────────────

def test_brand_mention_in_title_scores_higher():
    title_with = "acme is one of the best tools for tracking brand visibility online"
    title_without = "what are the best tools for tracking brand visibility online"
    prompt = "what are the best tools for tracking brand visibility"
    ts = _ts(5)
    score_with = _score_thread(title_with, "", prompt, ts, num_comments=10, brand_name="Acme")
    score_without = _score_thread(title_without, "", prompt, ts, num_comments=10, brand_name="Acme")
    assert score_with > score_without

def test_brand_mention_in_body_scores_higher():
    title = "what are the best tools for tracking brand visibility online"
    body_with = "I've been using Acme for a few months"
    body_without = ""
    prompt = "what are the best tools for tracking brand visibility"
    ts = _ts(5)
    score_with = _score_thread(title, body_with, prompt, ts, num_comments=10, brand_name="Acme")
    score_without = _score_thread(title, body_without, prompt, ts, num_comments=10, brand_name="Acme")
    assert score_with > score_without


# ── _score_thread existing filters still work ─────────────────────────────────

def test_fiction_sub_scores_zero():
    title = "how does machine learning detect patterns"
    score = _score_thread(title, "", "machine learning detect patterns", _ts(1),
                          num_comments=10, brand_name="Acme", subreddit="nosleep")
    assert score == 0.0

def test_spam_title_scores_zero():
    title = "Top 10 Best SaaS Tools for 2025"
    score = _score_thread(title, "", "saas tools for project management", _ts(1),
                          num_comments=10, brand_name="Acme")
    assert score == 0.0

def test_low_relevance_scores_zero():
    """Post that shares fewer than 3 prompt words returns 0."""
    title = "cats and dogs are great pets"
    score = _score_thread(title, "", "what saas tools help with brand tracking analytics", _ts(1),
                          num_comments=20, brand_name="Acme")
    assert score == 0.0


# ── scan_brand_opportunities integration tests ────────────────────────────────

from unittest.mock import AsyncMock, patch


def _make_serper_result(url, title, subreddit="SaaS", snippet="", date="1 day ago"):
    """Create a Serper-format result dict for test mocking."""
    return {
        "title": title,
        "url": url,
        "snippet": snippet,
        "date": date,
        "subreddit": subreddit,
    }


@pytest.mark.asyncio
async def test_scan_uses_prompt_text_as_search_query(tmp_db):
    """Serper search queries must contain prompt keywords."""
    from app.services import reddit_scanner_service

    searched_queries: list[str] = []
    orig_search = reddit_scanner_service._search_reddit_posts

    def fake_search(query, num_results=10, cache_key=None):
        searched_queries.append(query)
        return []

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[]):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("project" in q.lower() or "management" in q.lower() or "saas" in q.lower() for q in searched_queries), \
        f"No query contained prompt keywords. Queries: {searched_queries}"


@pytest.mark.asyncio
async def test_brand_name_is_also_searched(tmp_db):
    """Brand name must appear as a separate search query."""
    from app.services import reddit_scanner_service

    searched_queries: list[str] = []

    def fake_search(query, num_results=10, cache_key=None):
        searched_queries.append(query)
        return []

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[]):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("Rhythm" in q for q in searched_queries), \
        f"Brand name not in any query. Queries: {searched_queries}"


@pytest.mark.asyncio
async def test_blocked_subreddit_not_stored(tmp_db):
    """Posts from blocked subreddits must not be stored."""
    from app.services import reddit_scanner_service

    result = _make_serper_result(
        "https://www.reddit.com/r/depression/comments/abc/post/",
        "what is the best project management saas tool for teams",
        subreddit="depression",
    )

    def fake_search(query, num_results=10, cache_key=None):
        return [result]

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[]):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count == 0


@pytest.mark.asyncio
async def test_relevant_post_stored(tmp_db):
    """A relevant, unblocked post must be stored as a ContentOpportunity."""
    from app.services import reddit_scanner_service

    result = _make_serper_result(
        "https://www.reddit.com/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
    )

    def fake_search(query, num_results=10, cache_key=None):
        return [result]

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[True]):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count >= 1


@pytest.mark.asyncio
async def test_deduplication(tmp_db):
    """Same URL returned by two queries is stored only once."""
    from app.services import reddit_scanner_service

    result = _make_serper_result(
        "https://www.reddit.com/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
    )

    def fake_search(query, num_results=10, cache_key=None):
        return [result]

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[True]):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Multiple queries all return the same URL — should store it once
    assert count == 1


@pytest.mark.asyncio
async def test_works_with_no_industry_match(tmp_db):
    """A brand in an unmapped industry (e.g. music) must not return 0 due to missing subreddits."""
    from app.services import reddit_scanner_service

    result = _make_serper_result(
        "https://www.reddit.com/r/WeAreTheMusicMakers/comments/abc/post/",
        "best tools for tracking music streaming royalties and visibility analytics",
        subreddit="WeAreTheMusicMakers",
    )

    def fake_search(query, num_results=10, cache_key=None):
        return [result]

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm",
        prompt="best tools for tracking music streaming royalties and visibility analytics",
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[True]):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Must not skip due to missing industry — should attempt scan and find the post
    assert count >= 1


# ── New scoring formula tests ─────────────────────────────────────────────────

def test_engagement_weight_reduced():
    """Engagement weight reduced (20→10): high comment count alone cannot push a borderline post over threshold."""
    # A post with exactly 3 keyword matches (relevance ~0.5) + very high engagement
    # Under old formula: relevance*50 + recency*20 + engagement*20 could inflate score
    # Under new formula: engagement*10 has less impact; relevance*70 is the dominant factor
    # This post has moderate relevance (3/6 matching words) — should still pass scoring
    # but the test documents that engagement alone is not the deciding factor
    title = "advisory platform direct listing guide"   # 3 matches: advisory, platform, direct
    prompt = "what is the best reg a+ advisory platform for direct listings and capital raise"
    score_high_engagement = _score_thread(title, "", prompt, _ts(3), num_comments=5000, brand_name="CapCo")
    score_low_engagement  = _score_thread(title, "", prompt, _ts(3), num_comments=0,    brand_name="CapCo")
    # Engagement delta should be at most 10 points (not 20 like before)
    assert score_high_engagement - score_low_engagement <= 10.0, (
        f"Engagement gap too large: {score_high_engagement} vs {score_low_engagement}"
    )

def test_high_relevance_post_passes_new_threshold():
    """Highly relevant post (3+ matches, high relevance) scores >= 65."""
    title = "how to choose a reg a+ advisory platform for capital raises"
    prompt = "what is the best reg a+ advisory platform for capital raises"
    score = _score_thread(title, "", prompt, _ts(3), num_comments=10, brand_name="CapCo")
    assert score >= 65.0

def test_two_matches_scores_nonzero():
    """Post with exactly 2 keyword matches now scores > 0 (aligned with other scanners)."""
    # title has exactly 2 words that appear in prompt (advisory, platform)
    title = "advisory platform overview"
    prompt = "what is the best reg a+ advisory platform for direct listings and capital"
    score = _score_thread(title, "", prompt, _ts(1), num_comments=50, brand_name="CapCo")
    assert score > 0.0

def test_one_match_scores_zero():
    """Post with only 1 keyword match returns 0."""
    title = "random overview of nothing"
    prompt = "what is the best reg a+ advisory platform for direct listings and capital"
    score = _score_thread(title, "", prompt, _ts(1), num_comments=50, brand_name="CapCo")
    assert score == 0.0


# ── _build_search_query ───────────────────────────────────────────────────────

def test_build_search_query_quotes_reg_a_plus():
    """'Reg A+' in prompt → quoted phrase in query."""
    q = _build_search_query("what service will help me raise capital using Reg A+")
    assert '"reg a+"' in q.lower()

def test_build_search_query_strips_filler_words():
    """Filler words like 'help', 'best', 'find' don't appear bare."""
    q = _build_search_query("help me find the best Reg A+ platform")
    bare_words = q.lower().split()
    for word in ("help", "best", "find"):
        assert word not in bare_words, f"'{word}' leaked into query: {q}"

def test_build_search_query_keeps_domain_terms():
    """Domain-specific terms like 'capital', 'raise' survive for site:reddit.com queries."""
    q = _build_search_query("what service will help me raise capital using Reg A+")
    bare_words = q.lower().replace('"', '').split()
    # 'raise' and 'capital' should survive now (no longer in QUERY_STOP)
    assert any(w in bare_words for w in ("raise", "capital", "service")), f"Domain terms stripped: {q}"

def test_build_search_query_returns_nonempty():
    """Always returns something even for generic prompts."""
    q = _build_search_query("what is the best way to do things")
    assert len(q.strip()) > 0

def test_build_search_query_extracts_specific_words():
    """Specific domain words survive after stop-word removal."""
    q = _build_search_query("how do companies complete a direct listing on NYSE")
    assert any(w in q.lower() for w in ("direct", "listing", "nyse"))


# ── _haiku_relevance_check ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_haiku_check_returns_list_same_length():
    """Returns a boolean list of same length as input."""
    from unittest.mock import AsyncMock, MagicMock, patch
    candidates = [
        {"title": "How to raise capital via Reg A+", "subreddit": "startups", "body_preview": ""},
        {"title": "My cat is sick", "subreddit": "cats", "body_preview": ""},
    ]
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text="YES")]
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create = AsyncMock(return_value=mock_msg)
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert len(result) == 2
    assert all(isinstance(r, bool) for r in result)

@pytest.mark.asyncio
async def test_haiku_check_fails_open_on_api_error():
    """If Anthropic API raises, candidate is kept (True), not silently dropped."""
    candidates = [{"title": "Test post", "subreddit": "test", "body_preview": ""}]
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create = AsyncMock(side_effect=Exception("API down"))
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert result == [True]

@pytest.mark.asyncio
async def test_haiku_check_no_api_key_fails_open():
    """Missing ANTHROPIC_API_KEY returns all True (fail open)."""
    import os
    candidates = [{"title": "Test", "subreddit": "test", "body_preview": ""}]
    env_without_key = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    with patch.dict("os.environ", env_without_key, clear=True):
        result = await _haiku_relevance_check("CapCo", "Reg A+ advisory", candidates)
    assert result == [True]


@pytest.mark.asyncio
async def test_haiku_rejected_post_not_stored(tmp_db):
    """A post that passes keyword scoring but fails haiku gate is NOT stored."""
    from app.services import reddit_scanner_service

    result = _make_serper_result(
        "https://www.reddit.com/r/SaaS/comments/abc/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
    )

    def fake_search(query, num_results=10, cache_key=None):
        return [result]

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_search_reddit_posts", side_effect=fake_search), \
         patch.object(reddit_scanner_service, "_haiku_relevance_check", return_value=[False]):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count == 0
