"""Tests for WikipediaCandidate and WikipediaScan ORM models."""
import pytest
import pytest_asyncio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)


@pytest_asyncio.fixture
async def wiki_user(db_session: AsyncSession) -> User:
    user = User(
        email="wiki_models@example.com",
        password_hash="x",
        name="Wiki",
        email_verified=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_wikipedia_scan_creation(db_session: AsyncSession, wiki_user: User) -> None:
    brand = Brand(name="Acme", slug="wiki-acme-1", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()

    scan = WikipediaScan(
        brand_id=brand.id,
        status="running",
        triggered_by=wiki_user.id,
        prompts_searched=0,
        total_candidates_found=0,
        candidates_persisted=0,
    )
    db_session.add(scan)
    await db_session.flush()

    assert scan.id is not None
    assert scan.status == "running"
    assert scan.completed_at is None


@pytest.mark.asyncio
async def test_wikipedia_candidate_creation(db_session: AsyncSession, wiki_user: User) -> None:
    brand = Brand(name="Acme", slug="wiki-acme-2", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is X?", prompt_type="standard")
    db_session.add(prompt)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=wiki_user.id)
    db_session.add(scan)
    await db_session.flush()

    candidate = WikipediaCandidate(
        brand_id=brand.id,
        prompt_id=prompt.id,
        scan_id=scan.id,
        article_title="Brand_visibility_in_LLMs",
        article_url="https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        pageid=12345,
        article_summary="Brand visibility tracking is a discipline focused on…",
        legitimacy_score=0.84,
        legitimacy_reasoning="Topic squarely matches the brand's domain.",
        status="new",
    )
    db_session.add(candidate)
    await db_session.flush()

    assert candidate.id is not None
    assert candidate.status == "new"
    assert candidate.suggested_wikitext is None
    assert candidate.evidence_pack_used is None


@pytest.mark.asyncio
async def test_unique_brand_article(db_session: AsyncSession, wiki_user: User) -> None:
    """One candidate per (brand, article_title)."""
    brand = Brand(name="Acme", slug="wiki-acme-3", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=wiki_user.id)
    db_session.add(scan)
    await db_session.commit()

    db_session.add(
        WikipediaCandidate(
            brand_id=brand.id,
            scan_id=scan.id,
            article_title="Same_Article",
            article_url="https://en.wikipedia.org/wiki/Same_Article",
            pageid=1,
            article_summary="...",
            legitimacy_score=0.7,
            legitimacy_reasoning="r",
            status="new",
        )
    )
    await db_session.commit()

    db_session.add(
        WikipediaCandidate(
            brand_id=brand.id,
            scan_id=scan.id,
            article_title="Same_Article",
            article_url="https://en.wikipedia.org/wiki/Same_Article",
            pageid=1,
            article_summary="...",
            legitimacy_score=0.8,
            legitimacy_reasoning="r2",
            status="new",
        )
    )
    with pytest.raises((IntegrityError, Exception)):
        await db_session.commit()
