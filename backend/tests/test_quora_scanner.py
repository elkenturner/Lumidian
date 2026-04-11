"""
Tests for:
  _parse_serper_date      — parses Serper.dev date strings into UTC-naive datetimes
  _score_question         — relevance scorer (keyword overlap)
  scan_brand_opportunities — integration tests (mocked via quora_search_service)

Mock boundary: patch("app.services.quora_search_service.search_quora_questions", ...)
because search_quora_questions is imported inside scan_brand_opportunities at call time.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

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
    expected = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3)
    assert abs((result - expected).total_seconds()) < 5


def test_parse_serper_date_relative_weeks():
    result = _parse_serper_date("2 weeks ago")
    assert result is not None
    expected = datetime.now(UTC).replace(tzinfo=None) - timedelta(weeks=2)
    assert abs((result - expected).total_seconds()) < 5


def test_parse_serper_date_relative_months():
    result = _parse_serper_date("1 month ago")
    assert result is not None
    expected = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
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

def test_score_question_two_matches_returns_score():
    """2 keyword matches returns a score (minimum threshold is 2)."""
    score = _score_question(
        title="advisory platform review",
        snippet="short snippet here",
        prompt_text="what is the best reg a+ advisory platform for direct listings and capital raise",
    )
    assert score == 19.0  # relevance=0.25 * 70 + recency=0.05 * 30 (no date → old)

def test_score_question_three_matches_nonzero():
    """3 keyword matches returns nonzero score."""
    score = _score_question(
        title="how to use reg a+ advisory platform for capital raise",
        snippet="guide for raising capital",
        prompt_text="what is the best reg a+ advisory platform for capital raise",
    )
    assert score > 0.0


# ── scan_brand_opportunities ──────────────────────────────────────────────────

def _make_question(url: str, title: str, snippet: str = "", date: str = "") -> dict:
    """Build a mock search result dict matching the shape search_quora_questions returns."""
    return {"url": url, "title": title, "snippet": snippet, "date": date}


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
    import secrets

    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.services import quora_scanner_service

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


async def test_search_quora_passes_date_field():
    """search_quora_questions must include the 'date' field from Serper results."""
    import app.services.quora_search_service as svc

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "organic": [
            {
                "link": "https://www.quora.com/What-is-the-best-SaaS-tool",
                "title": "What is the best SaaS tool - Quora",
                "snippet": "some snippet",
                "date": "3 days ago",
            }
        ]
    }
    fake_response.raise_for_status = MagicMock()

    mock_client_instance = AsyncMock()
    mock_client_instance.post.return_value = fake_response

    with patch.dict("os.environ", {"SERPER_API_KEY": "fake-key"}), \
         patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        results = await svc.search_quora_questions("saas tool", num_results=5)

    assert len(results) == 1
    assert "date" in results[0]
    assert results[0]["date"] == "3 days ago"


def test_score_recent_question_higher_than_old():
    """A recent question should score higher than an identical old one."""
    recent = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=120)
    score_recent = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=recent,
    )
    score_old = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score_recent > score_old


def test_score_no_date_assumes_moderately_old():
    """When posted_at is None (date unknown), score uses a penalty but not zero."""
    score_with_date = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=5),
    )
    score_no_date = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=None,
    )
    assert score_no_date > 0
    assert score_with_date > score_no_date


def test_score_old_question_not_zero():
    """Very old questions still get a non-zero score if relevant (evergreen content)."""
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=365)
    score = _score_question(
        "What is the best project management saas tool for teams",
        "project management saas tool remote teams",
        "what is the best project management saas tool",
        posted_at=old,
    )
    assert score > 0


@pytest.mark.asyncio
async def test_scan_recent_question_scores_higher(tmp_db):
    """A question with a recent date should get a higher relevance_score than one without."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models import ContentOpportunity
    from app.services import quora_scanner_service

    brand_id = await tmp_db.create_brand_with_prompt(
        name="RecencyTest",
        prompt="what is the best project management saas tool",
    )
    questions = [
        {
            "url": "https://www.quora.com/What-is-the-best-project-management-saas-tool-recent",
            "title": "What is the best project management saas tool for teams",
            "snippet": "project management saas tool remote teams",
            "date": "2 days ago",
        },
        {
            "url": "https://www.quora.com/What-is-the-best-project-management-saas-tool-old",
            "title": "What is the best project management saas tool for teams",
            "snippet": "project management saas tool remote teams",
            "date": "",
        },
    ]
    with patch("app.services.quora_search_service.search_quora_questions", return_value=questions):
        await quora_scanner_service.scan_brand_opportunities(brand_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "quora",
            )
        )
        opps = {o.thread_url: o for o in result.scalars().all()}

    recent = opps["https://www.quora.com/What-is-the-best-project-management-saas-tool-recent"]
    old = opps["https://www.quora.com/What-is-the-best-project-management-saas-tool-old"]
    assert recent.relevance_score > old.relevance_score
    assert recent.posted_at is not None


@pytest.mark.asyncio
async def test_scan_clear_existing(tmp_db):
    """clear_existing=True deletes old rows before storing new ones; no duplicates."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import ContentOpportunity
    from app.services import quora_scanner_service

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
