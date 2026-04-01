"""
Tests for:
  _parse_serper_date      — parses Serper.dev date strings into UTC-naive datetimes
  _score_question         — relevance scorer (keyword overlap)
  scan_brand_opportunities — integration tests (mocked via quora_search_service)

Mock boundary: patch("app.services.quora_search_service.search_quora_questions", ...)
because search_quora_questions is imported inside scan_brand_opportunities at call time.
"""
from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.quora_scanner_service import _parse_serper_date, _score_question


# ── _parse_serper_date ────────────────────────────────────────────────────────

def test_parse_serper_date_none():
    assert _parse_serper_date(None) is None


def test_parse_serper_date_empty():
    assert _parse_serper_date("") is None


def test_parse_serper_date_unparseable():
    assert _parse_serper_date("not a date at all") is None


def test_parse_serper_date_relative_days():
    result = _parse_serper_date("3 days ago")
    assert result is not None
    expected = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=3)
    assert abs((result - expected).total_seconds()) < 5


def test_parse_serper_date_relative_weeks():
    result = _parse_serper_date("2 weeks ago")
    assert result is not None
    expected = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(weeks=2)
    assert abs((result - expected).total_seconds()) < 5


def test_parse_serper_date_relative_months():
    result = _parse_serper_date("1 month ago")
    assert result is not None
    expected = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    assert abs((result - expected).total_seconds()) < 5


def test_parse_serper_date_absolute_short_month():
    result = _parse_serper_date("Dec 15, 2023")
    assert result == datetime(2023, 12, 15)


def test_parse_serper_date_absolute_full_month():
    result = _parse_serper_date("December 15, 2023")
    assert result == datetime(2023, 12, 15)


def test_parse_serper_date_absolute_no_comma():
    result = _parse_serper_date("Mar 5 2024")
    assert result == datetime(2024, 3, 5)


# ── _score_question ───────────────────────────────────────────────────────────

def test_score_high_overlap():
    """High keyword overlap between prompt and question title → score >= 40."""
    score = _score_question(
        "What is the best project management SaaS tool for remote teams",
        "looking for project management tools for distributed teams",
        "what is the best project management saas tool",
    )
    assert score >= 40.0


def test_score_low_overlap_returns_zero():
    """Fewer than 2 matching keywords → 0.0 (hard floor in implementation)."""
    score = _score_question(
        "How do cats sleep so much each day",
        "cats love napping in the sun",
        "what is the best project management saas tool",
    )
    assert score == 0.0


def test_score_empty_prompt_returns_zero():
    """Empty prompt_text → no keywords → 0.0."""
    score = _score_question("What is the best SaaS tool", "some snippet", "")
    assert score == 0.0


def test_score_snippet_contributes():
    """Keyword match in snippet counts toward overlap."""
    score_with = _score_question(
        "What tools help productivity",
        "project management saas tool for remote teams",
        "what is the best project management saas tool",
    )
    score_without = _score_question(
        "What tools help productivity",
        "",
        "what is the best project management saas tool",
    )
    assert score_with >= score_without


# ── New threshold tests ───────────────────────────────────────────────────────

def test_score_question_two_matches_returns_zero():
    """Exactly 2 keyword matches now returns 0 (new minimum is 3)."""
    score = _score_question(
        title="advisory platform review",
        snippet="short snippet here",
        prompt_text="what is the best reg a+ advisory platform for direct listings and capital raise",
    )
    assert score == 0.0

def test_score_question_three_matches_nonzero():
    """3 keyword matches returns nonzero score."""
    score = _score_question(
        title="how to use reg a+ advisory platform for capital raise",
        snippet="guide for raising capital",
        prompt_text="what is the best reg a+ advisory platform for capital raise",
    )
    assert score > 0.0


# ── scan_brand_opportunities ──────────────────────────────────────────────────

def _make_question(url: str, title: str, snippet: str = "") -> dict:
    """Build a mock search result dict matching the shape search_quora_questions returns."""
    return {"url": url, "title": title, "snippet": snippet}


@pytest.mark.asyncio
async def test_scan_nonexistent_brand_returns_zero():
    """Brand id not in DB → returns 0 without error."""
    from app.services import quora_scanner_service
    with patch("app.services.quora_search_service.search_quora_questions", return_value=[]):
        count = await quora_scanner_service.scan_brand_opportunities(brand_id=99999)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_no_prompts_returns_zero():
    """Brand with no prompts → returns 0 without error."""
    from app.services import quora_scanner_service
    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    import secrets

    async with AsyncSessionLocal() as db:
        user = User(
            email=f"quora_{secrets.token_hex(4)}@example.com",
            password_hash="x",
            email_verified=1,
        )
        db.add(user)
        await db.flush()
        brand = Brand(
            name="No Prompts Quora",
            slug=f"no-prompts-{secrets.token_hex(4)}",
            user_id=user.id,
        )
        db.add(brand)
        await db.commit()
        brand_id = brand.id

    with patch("app.services.quora_search_service.search_quora_questions", return_value=[]):
        count = await quora_scanner_service.scan_brand_opportunities(brand_id=brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_stores_relevant_question(tmp_db):
    """Relevant question (score >= 40) is stored as a ContentOpportunity."""
    from app.services import quora_scanner_service

    brand_id = await tmp_db.create_brand_with_prompt(
        name="AcmeSaaS",
        prompt="what is the best project management saas tool",
    )
    questions = [_make_question(
        url="https://www.quora.com/What-is-the-best-project-management-saas-tool-for-teams",
        title="What is the best project management saas tool for teams",
        snippet="project management saas tool remote teams",
    )]
    with patch("app.services.quora_search_service.search_quora_questions", return_value=questions):
        count = await quora_scanner_service.scan_brand_opportunities(brand_id)
    assert count >= 1


@pytest.mark.asyncio
async def test_scan_filters_low_relevance(tmp_db):
    """Question with poor keyword overlap (score < 40) is not stored."""
    from app.services import quora_scanner_service

    brand_id = await tmp_db.create_brand_with_prompt(
        name="AcmeSaaS2",
        prompt="what is the best project management saas tool",
    )
    questions = [_make_question(
        url="https://www.quora.com/How-do-cats-sleep-all-day",
        title="How do cats sleep all day without waking up",
        snippet="Cats are known for sleeping many hours",
    )]
    with patch("app.services.quora_search_service.search_quora_questions", return_value=questions):
        count = await quora_scanner_service.scan_brand_opportunities(brand_id)
    assert count == 0


@pytest.mark.asyncio
async def test_scan_deduplication(tmp_db):
    """Same URL returned on a second scan is not stored again."""
    from app.services import quora_scanner_service

    brand_id = await tmp_db.create_brand_with_prompt(
        name="DupTest",
        prompt="what is the best project management saas tool",
    )
    question = _make_question(
        url="https://www.quora.com/What-is-the-best-project-management-saas-tool-for-teams",
        title="What is the best project management saas tool for teams",
        snippet="project management saas tool remote teams",
    )
    with patch("app.services.quora_search_service.search_quora_questions", return_value=[question]):
        await quora_scanner_service.scan_brand_opportunities(brand_id)
        count2 = await quora_scanner_service.scan_brand_opportunities(brand_id)
    assert count2 == 0  # already stored on first call


@pytest.mark.asyncio
async def test_scan_clear_existing(tmp_db):
    """clear_existing=True deletes old rows before storing new ones; no duplicates."""
    from app.services import quora_scanner_service
    from app.database import AsyncSessionLocal
    from app.models import ContentOpportunity
    from sqlalchemy import select

    brand_id = await tmp_db.create_brand_with_prompt(
        name="ClearTest",
        prompt="what is the best project management saas tool",
    )
    question = _make_question(
        url="https://www.quora.com/What-is-the-best-project-management-saas-tool-for-teams",
        title="What is the best project management saas tool for teams",
        snippet="project management saas tool remote teams",
    )
    with patch("app.services.quora_search_service.search_quora_questions", return_value=[question]):
        await quora_scanner_service.scan_brand_opportunities(brand_id)

    # clear_existing=True: deletes first, then re-inserts
    with patch("app.services.quora_search_service.search_quora_questions", return_value=[question]):
        count = await quora_scanner_service.scan_brand_opportunities(brand_id, clear_existing=True)
    assert count == 1

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "quora",
            )
        )
        rows = result.scalars().all()
    assert len(rows) == 1  # no duplicates
