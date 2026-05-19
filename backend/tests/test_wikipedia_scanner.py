"""Tests for the Wikipedia scanner orchestrator."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.wikipedia.scanner import is_obviously_illegitimate, run_scan


@pytest_asyncio.fixture
async def scan_setup(db_session: AsyncSession) -> tuple[User, Brand, list[Prompt]]:
    user = User(email="wiki_scanner@example.com", password_hash="x", name="S", email_verified=True)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="scanner-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompts = [
        Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard"),
        Prompt(brand_id=brand.id, text="AI search citations", prompt_type="standard"),
    ]
    for p in prompts:
        db_session.add(p)
    await db_session.commit()
    return user, brand, prompts


def test_pre_filter_disambiguation() -> None:
    assert is_obviously_illegitimate(
        title="Visibility (disambiguation)", summary="A disambiguation page.", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_list_page() -> None:
    assert is_obviously_illegitimate(
        title="List of search engines", summary="...", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_brand_self() -> None:
    assert is_obviously_illegitimate(
        title="Acme (company)", summary="Acme is a company that…", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_competitor() -> None:
    assert is_obviously_illegitimate(
        title="OpenAI", summary="OpenAI is…", brand_name="Acme", competitor_names=["OpenAI"]
    )


def test_pre_filter_thin_summary() -> None:
    assert is_obviously_illegitimate(
        title="Topic", summary="short.", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_passes_legitimate() -> None:
    assert not is_obviously_illegitimate(
        title="Brand visibility in LLMs",
        summary="Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers across ChatGPT, Claude, Perplexity, and Gemini. Practitioners use specialized tools to monitor citation rates.",
        brand_name="Acme",
        competitor_names=[],
    )


@pytest.mark.asyncio
async def test_run_scan_persists_candidates(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup

    search_results = [
        {"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."},
    ]
    extract = (
        "Brand visibility in LLMs",
        "Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers across ChatGPT, Claude, Perplexity, and Gemini. Practitioners use specialized tools to monitor citation rates.",
    )

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.82, "Topic squarely matches the brand's domain.")),
    ):
        scan = await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    assert scan.status == "completed"
    candidates = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand.id))).scalars().all()
    assert len(candidates) == 1
    c = candidates[0]
    assert c.article_title == "Brand visibility in LLMs"
    assert c.pageid == 1001
    assert c.legitimacy_score == pytest.approx(0.82)
    assert c.status == "new"


@pytest.mark.asyncio
async def test_run_scan_drops_below_threshold(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup
    search_results = [{"title": "Unrelated topic", "pageid": 2002, "snippet": "..."}]
    extract = ("Unrelated topic", "A long enough summary " * 20)

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.3, "Topic unrelated.")),
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    candidates = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand.id))).scalars().all()
    assert candidates == []


@pytest.mark.asyncio
async def test_run_scan_preserves_user_status_on_rescan(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup

    search_results = [{"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."}]
    extract = ("Brand visibility in LLMs", "A long enough summary " * 20)

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate", new=AsyncMock(return_value=(0.8, "ok"))
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    candidate = (await db_session.execute(select(WikipediaCandidate))).scalars().first()
    candidate.status = "submitted"
    await db_session.commit()

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate", new=AsyncMock(return_value=(0.7, "still ok"))
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    refreshed = (await db_session.execute(select(WikipediaCandidate))).scalars().first()
    assert refreshed.status == "submitted"
    assert refreshed.legitimacy_score == pytest.approx(0.7)
