"""Tests for the Wikipedia drafter."""
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
from app.services.wikipedia.drafter import (
    ArticleNotFoundError,
    TitleMismatchError,
    draft_candidate,
)


@pytest_asyncio.fixture
async def drafter_setup(db_session: AsyncSession) -> tuple[Brand, Prompt, WikipediaCandidate]:
    user = User(
        email="wiki_drafter@example.com",
        password_hash="x",
        name="D",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="drafter-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id,
        prompt_id=prompt.id,
        scan_id=scan.id,
        article_title="Brand visibility in LLMs",
        article_url="https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        pageid=1001,
        article_summary="...",
        legitimacy_score=0.82,
        legitimacy_reasoning="ok",
        status="new",
    )
    db_session.add(candidate)
    await db_session.commit()
    return brand, prompt, candidate


@pytest.mark.asyncio
async def test_draft_candidate_happy_path(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup
    parsed = (
        "Brand visibility in LLMs",
        "https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        "History",
        "end of section",
        "Brand visibility tracking emerged in the early 2020s.<ref>{{cite web|url=https://acme.example|title=…}}</ref>",
    )

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("== History ==\nFoo.\n", ["History", "Methodology"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw-llm-output")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=parsed
    ):
        result = await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.suggested_wikitext.startswith("Brand visibility tracking emerged")
    assert refreshed.suggested_section == "History"
    assert refreshed.suggested_insert_location == "end of section"
    assert refreshed.status == "drafted"
    assert refreshed.last_drafted_at is not None
    assert result.id == candidate.id


@pytest.mark.asyncio
async def test_draft_candidate_preserves_user_status(db_session: AsyncSession, drafter_setup) -> None:
    """Regenerating a draft for a 'submitted' candidate must not reset status."""
    brand, prompt, candidate = drafter_setup
    candidate.status = "submitted"
    await db_session.commit()

    parsed = ("Brand visibility in LLMs", "url", "Methodology", "after lead paragraph", "New text.")

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("body", ["History", "Methodology"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch("app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=parsed):
        await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.status == "submitted"
    assert refreshed.suggested_wikitext == "New text."


@pytest.mark.asyncio
async def test_draft_candidate_article_missing(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("", [])),
    ):
        with pytest.raises(ArticleNotFoundError):
            await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.status == "dismissed"


@pytest.mark.asyncio
async def test_draft_candidate_title_mismatch_retries_then_errors(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup
    mismatch_parsed = ("Some other article", "url", "Section", "loc", "text")

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("body", ["S"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=mismatch_parsed
    ):
        with pytest.raises(TitleMismatchError):
            await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")
