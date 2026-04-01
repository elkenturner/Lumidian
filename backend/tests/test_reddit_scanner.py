# backend/tests/test_reddit_scanner.py
import math
import time
import pytest
from app.services.reddit_scanner_service import (
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

import asyncio
from unittest.mock import AsyncMock, patch


def _make_post(permalink, title, subreddit="SaaS", created_utc=None, num_comments=5, selftext=""):
    return {
        "permalink": permalink,
        "title": title,
        "subreddit": subreddit,
        "created_utc": created_utc or (time.time() - 86400),
        "num_comments": num_comments,
        "selftext": selftext,
        "score": 10,
    }


def _reddit_response(*posts):
    """Wrap posts in the Reddit listing envelope."""
    return {"data": {"children": [{"data": p} for p in posts]}}


@pytest.mark.asyncio
async def test_scan_uses_prompt_text_as_search_query(tmp_db):
    """Global search URL must contain the prompt text."""
    from app.services import reddit_scanner_service

    fetched_urls: list[str] = []

    async def fake_fetch(url: str):
        fetched_urls.append(url)
        return _reddit_response()

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("project" in u and "management" in u or "project%20management" in u or "project+management" in u for u in fetched_urls), \
        f"No query contained prompt text. URLs: {fetched_urls}"
    # Global search (no restrict_sr) must be used
    assert any("reddit.com/search.json" in u for u in fetched_urls)


@pytest.mark.asyncio
async def test_brand_name_is_also_searched(tmp_db):
    """Brand name must appear as a separate search query."""
    from app.services import reddit_scanner_service

    fetched_urls: list[str] = []

    async def fake_fetch(url: str):
        fetched_urls.append(url)
        return _reddit_response()

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert any("Rhythm" in u or "rhythm" in u.lower() for u in fetched_urls), \
        f"Brand name not in any URL. URLs: {fetched_urls}"


@pytest.mark.asyncio
async def test_blocked_subreddit_not_stored(tmp_db):
    """Posts from blocked subreddits must not be stored."""
    from app.services import reddit_scanner_service

    relevant_post = _make_post(
        "/r/depression/comments/abc/post/",
        "what is the best project management saas tool for teams",
        subreddit="depression",
        num_comments=10,
    )

    async def fake_fetch(url: str):
        return _reddit_response(relevant_post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count == 0


@pytest.mark.asyncio
async def test_relevant_post_stored(tmp_db):
    """A relevant, unblocked post must be stored as a ContentOpportunity."""
    from app.services import reddit_scanner_service

    relevant_post = _make_post(
        "/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
        num_comments=15,
    )

    async def fake_fetch(url: str):
        return _reddit_response(relevant_post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    assert count >= 1


@pytest.mark.asyncio
async def test_deduplication(tmp_db):
    """Same URL returned by two queries is stored only once."""
    from app.services import reddit_scanner_service

    post = _make_post(
        "/r/SaaS/comments/xyz/post/",
        "what is the best project management saas tool for remote teams",
        subreddit="SaaS",
        num_comments=15,
    )

    async def fake_fetch(url: str):
        return _reddit_response(post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Acme", prompt="what is the best project management saas tool"
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Multiple queries all return the same URL — should store it once
    assert count == 1


@pytest.mark.asyncio
async def test_works_with_no_industry_match(tmp_db):
    """A brand in an unmapped industry (e.g. music) must not return 0 due to missing subreddits."""
    from app.services import reddit_scanner_service

    post = _make_post(
        "/r/WeAreTheMusicMakers/comments/abc/post/",
        "best tools for tracking music streaming royalties and visibility analytics",
        subreddit="WeAreTheMusicMakers",
        num_comments=8,
    )

    async def fake_fetch(url: str):
        return _reddit_response(post)

    brand_id = await tmp_db.create_brand_with_prompt(
        name="Rhythm",
        prompt="best tools for tracking music streaming royalties and visibility analytics",
    )

    with patch.object(reddit_scanner_service, "_fetch", side_effect=fake_fetch), \
         patch("asyncio.sleep"):
        count = await reddit_scanner_service.scan_brand_opportunities(brand_id)

    # Must not skip due to missing industry — should attempt scan and find the post
    assert count >= 1


# ── New scoring formula tests ─────────────────────────────────────────────────

def test_engagement_weight_reduced():
    """High-engagement irrelevant post should NOT score >= 65 with new formula."""
    # Generic words stripped by QUERY_STOP; only 1 specific word matches
    title = "one year thoughts on my journey"
    prompt = "what is the best reg a+ capital raise platform advisory service"
    score = _score_thread(title, "", prompt, _ts(1), num_comments=500, brand_name="CapCo")
    assert score == 0.0

def test_high_relevance_post_passes_new_threshold():
    """Highly relevant post (3+ matches, high relevance) scores >= 65."""
    title = "how to choose a reg a+ advisory platform for capital raises"
    prompt = "what is the best reg a+ advisory platform for capital raises"
    score = _score_thread(title, "", prompt, _ts(3), num_comments=10, brand_name="CapCo")
    assert score >= 65.0

def test_two_matches_now_scores_zero():
    """Post with exactly 2 keyword matches returns 0 under new min-matches=3 rule."""
    title = "advisory platform review"
    prompt = "what is the best reg a+ advisory platform for direct listings and capital"
    score = _score_thread(title, "", prompt, _ts(1), num_comments=50, brand_name="CapCo")
    assert score == 0.0
