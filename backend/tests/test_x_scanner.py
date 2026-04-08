"""
Tests for the X/Twitter scanner service.

Mock boundary: patch("app.services.x_scanner_service._search_x_posts", ...)
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.services.x_scanner_service import _POST_URL_RE, _score_post as _score_result


def _is_valid_x_url(url: str) -> bool:
    """Test helper — wraps the regex used by the X scanner."""
    return bool(_POST_URL_RE.match(url))


# ── URL validation ────────────────────────────────────────────────────────────

def test_valid_x_status_url():
    assert _is_valid_x_url("https://x.com/user/status/123456789") is True


def test_valid_twitter_status_url():
    assert _is_valid_x_url("https://twitter.com/user/status/123456789") is True


def test_reject_x_profile_url():
    assert _is_valid_x_url("https://x.com/username") is False


def test_reject_x_lists_url():
    assert _is_valid_x_url("https://x.com/i/lists/12345") is False


def test_reject_non_x_url():
    assert _is_valid_x_url("https://www.example.com/status/123") is False


# ── Scoring ──────────────────────────────────────────────────────────────────

def test_score_high_relevance_recent():
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    score = _score_result(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams collaboration",
        "what is the best project management saas tool",
        posted_at=recent,
    )
    assert score >= 50.0


def test_score_low_overlap_returns_zero():
    score = _score_result(
        "How do cats sleep so much",
        "cats love napping in the sun",
        "what is the best project management saas tool",
    )
    assert score == 0.0


def test_score_no_date_penalized():
    score_with = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5),
    )
    score_without = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=None,
    )
    assert score_with > score_without
    assert score_without > 0


# ── Integration ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_nonexistent_brand_returns_zero():
    from app.services import x_scanner_service
    with patch("app.services.x_scanner_service._search_x_posts", return_value=[]):
        count = await x_scanner_service.scan_brand_opportunities(brand_id=99999)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_stores_relevant_tweet(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XTest",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Best project management saas tool for distributed teams",
        "url": "https://x.com/expert/status/123456789",
        "snippet": "project management saas tool remote teams collaboration platform workflow",
        "date": "2 days ago",
    }]
    with patch("app.services.x_scanner_service._search_x_posts", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count >= 1


@pytest.mark.asyncio
async def test_scan_filters_profile_urls(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XProfile",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "SaaS Expert - Project Management",
        "url": "https://x.com/saas_expert",
        "snippet": "project management saas tool expert",
        "date": "",
    }]
    with patch("app.services.x_scanner_service._search_x_posts", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_filters_short_snippets(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XMedia",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "pic related",
        "url": "https://x.com/user/status/999",
        "snippet": "pic",
        "date": "1 day ago",
    }]
    with patch("app.services.x_scanner_service._search_x_posts", return_value=results):
        count = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_deduplication(tmp_db):
    from app.services import x_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="XDedup",
        prompt="what is the best project management saas tool",
    )
    result = [{
        "title": "Best project management saas tool for teams",
        "url": "https://x.com/expert/status/123456789",
        "snippet": "project management saas tool remote teams collaboration",
        "date": "3 days ago",
    }]
    with patch("app.services.x_scanner_service._search_x_posts", return_value=result):
        await x_scanner_service.scan_brand_opportunities(brand_id)
        count2 = await x_scanner_service.scan_brand_opportunities(brand_id)
    assert count2 == 0
