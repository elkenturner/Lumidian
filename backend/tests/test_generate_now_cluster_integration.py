"""Regression test: legacy /content generate-now triggers the cluster pipeline.

After Task 15 (Content Clusters), the existing "Regenerate Drafts" button on
/content routes through cluster regeneration per prompt rather than the legacy
auto_draft_top_gaps path. This test asserts that flow.
"""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, ContentCluster, ContentDraft, Prompt, User
from app.routers.content import _bg_generate_drafts

BRIEF_JSON = (
    '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],'
    '"stats":[],"narrative_spine":"n","tone_notes":"t"}'
)


@pytest_asyncio.fixture
async def brand_with_two_prompts(db_session: AsyncSession) -> tuple[Brand, list[Prompt]]:
    user = User(
        email="genow_cluster@example.com",
        password_hash="x",
        name="GenNow",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-genow-cluster", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompts = [
        Prompt(brand_id=brand.id, text="Prompt one", prompt_type="standard"),
        Prompt(brand_id=brand.id, text="Prompt two", prompt_type="standard"),
    ]
    for p in prompts:
        db_session.add(p)
    await db_session.commit()
    return brand, prompts


@pytest.mark.asyncio
async def test_bg_generate_drafts_creates_cluster_per_prompt(
    db_session: AsyncSession,
    brand_with_two_prompts,
) -> None:
    brand, prompts = brand_with_two_prompts

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=BRIEF_JSON)), patch(
        "app.services.clustering_service._generate_piece_text",
        new=AsyncMock(return_value=("Title", "Body content.", None, [])),
    ), patch(
        "app.services.cluster_evidence.fetch_and_dedupe",
        new=AsyncMock(return_value=[
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]),
    ):
        await _bg_generate_drafts(brand_id=brand.id, max_gaps=10, source="manual")

    clusters = (
        await db_session.execute(select(ContentCluster).where(ContentCluster.brand_id == brand.id))
    ).scalars().all()
    assert len(clusters) == 2
    assert {c.prompt_id for c in clusters} == {p.id for p in prompts}
    assert all(c.status == "ready" for c in clusters)

    drafts = (
        await db_session.execute(select(ContentDraft).where(ContentDraft.brand_id == brand.id))
    ).scalars().all()
    # 5 platforms × 2 prompts = 10 drafts
    assert len(drafts) == 10
    assert all(d.cluster_id is not None for d in drafts)
    assert all(d.source == "cluster" for d in drafts)


@pytest.mark.asyncio
async def test_bg_generate_drafts_max_gaps_bounds_prompts(
    db_session: AsyncSession,
    brand_with_two_prompts,
) -> None:
    """max_gaps=1 should only process the first prompt."""
    brand, prompts = brand_with_two_prompts

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=BRIEF_JSON)), patch(
        "app.services.clustering_service._generate_piece_text",
        new=AsyncMock(return_value=("T", "B", None, [])),
    ), patch(
        "app.services.cluster_evidence.fetch_and_dedupe",
        new=AsyncMock(return_value=[
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]),
    ):
        await _bg_generate_drafts(brand_id=brand.id, max_gaps=1, source="manual")

    clusters = (
        await db_session.execute(select(ContentCluster).where(ContentCluster.brand_id == brand.id))
    ).scalars().all()
    assert len(clusters) == 1
    assert clusters[0].prompt_id == prompts[0].id


@pytest.mark.asyncio
async def test_bg_generate_drafts_handles_missing_brand(db_session: AsyncSession) -> None:
    # Should not raise; should log a warning and return cleanly.
    await _bg_generate_drafts(brand_id=999999, max_gaps=5, source="manual")
