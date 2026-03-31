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
    """Post that shares fewer than 2 prompt words returns 0."""
    title = "cats and dogs are great pets"
    score = _score_thread(title, "", "what saas tools help with brand tracking analytics", _ts(1),
                          num_comments=20, brand_name="Acme")
    assert score == 0.0
