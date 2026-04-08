"""
Tests for the LinkedIn scanner service.

Mock boundary: patch("app.services.linkedin_scanner_service._search_linkedin_posts", ...)
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.services.linkedin_scanner_service import (
    _is_valid_linkedin_url,
    _score_post as _score_result,
)


# ── URL validation ────────────────────────────────────────────────────────────

def test_valid_post_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/posts/john-doe_ai-activity-123") is True


def test_valid_pulse_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/pulse/future-of-ai-john-doe") is True


def test_valid_feed_update_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/feed/update/urn:li:activity:123") is True


def test_reject_job_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/jobs/view/123") is False


def test_reject_profile_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/in/john-doe") is False


def test_reject_company_about_url():
    assert _is_valid_linkedin_url("https://www.linkedin.com/company/acme/about") is False


def test_reject_non_linkedin_url():
    assert _is_valid_linkedin_url("https://www.example.com/posts/something") is False


# ── Scoring ──────────────────────────────────────────────────────────────────

def test_score_high_relevance_recent():
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3)
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


def test_score_old_not_zero():
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=200)
    score = _score_result(
        "Best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score > 0


# ── Integration: scan_brand_opportunities ────────────────────────────────────

@pytest.mark.asyncio
async def test_scan_nonexistent_brand_returns_zero():
    from app.services import linkedin_scanner_service
    with patch("app.services.linkedin_scanner_service._search_linkedin_posts", return_value=[]):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id=99999)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_stores_relevant_post(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedTest",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Best project management saas tool for distributed teams",
        "url": "https://www.linkedin.com/posts/expert_best-project-management-saas-tool-activity-123",
        "snippet": "project management saas tool remote teams collaboration platform",
        "date": "3 days ago",
    }]
    with patch("app.services.linkedin_scanner_service._search_linkedin_posts", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count >= 1


@pytest.mark.asyncio
async def test_scan_filters_irrelevant_post(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedFilter",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "How do cats sleep all day",
        "url": "https://www.linkedin.com/posts/cat-lover_cats-activity-999",
        "snippet": "cats love napping in the sun",
        "date": "",
    }]
    with patch("app.services.linkedin_scanner_service._search_linkedin_posts", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_filters_job_urls(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedJobs",
        prompt="what is the best project management saas tool",
    )
    results = [{
        "title": "Project Management SaaS Tool Engineer",
        "url": "https://www.linkedin.com/jobs/view/project-management-saas-12345",
        "snippet": "project management saas tool remote teams",
        "date": "1 day ago",
    }]
    with patch("app.services.linkedin_scanner_service._search_linkedin_posts", return_value=results):
        count = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_deduplication(tmp_db):
    from app.services import linkedin_scanner_service
    brand_id = await tmp_db.create_brand_with_prompt(
        name="LinkedDedup",
        prompt="what is the best project management saas tool",
    )
    result = [{
        "title": "Best project management saas tool for teams",
        "url": "https://www.linkedin.com/posts/expert_saas-tool-activity-123",
        "snippet": "project management saas tool remote teams",
        "date": "2 days ago",
    }]
    with patch("app.services.linkedin_scanner_service._search_linkedin_posts", return_value=result):
        await linkedin_scanner_service.scan_brand_opportunities(brand_id)
        count2 = await linkedin_scanner_service.scan_brand_opportunities(brand_id)
    assert count2 == 0
