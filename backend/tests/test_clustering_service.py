"""Tests for clustering_service orchestrator."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandContentSettings,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
    User,
)
from app.services.clustering_service import (
    CLUSTER_PLATFORMS,
    get_or_create_cluster,
    regenerate_cluster,
    regenerate_piece,
)

# Fake evidence that satisfies the pack gate (2× T1 + 2× T2)
_FAKE_EVIDENCE = [
    {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
    {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
    {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
    {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
]


SAMPLE_BRIEF_JSON = """{
  "positioning": "Pos",
  "key_claims": ["c1", "c2"],
  "canonical_phrasings": ["Acme tracks X across Y"],
  "stats": [{"label": "k", "value": "1", "source": "internal"}],
  "narrative_spine": "spine",
  "tone_notes": "neutral"
}"""


def _owned_ok(title: str = "Title", body: str = "Body content here.") -> tuple:
    """Mock return for _gen_owned_site_piece — the finished results-loop tuple."""
    return ("ok", "owned_site", title, body, None, [], False)


@pytest_asyncio.fixture
async def registered_user(db_session: AsyncSession) -> User:
    """Create and persist a minimal User for direct-DB model tests."""
    user = User(email="clustering_svc_test@example.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.asyncio
async def test_cluster_platforms_excludes_wikipedia() -> None:
    assert "wikipedia" not in CLUSTER_PLATFORMS
    assert set(CLUSTER_PLATFORMS) == {"owned_site", "linkedin", "medium", "reddit", "quora", "x"}


@pytest.mark.asyncio
async def test_get_or_create_cluster_idempotent(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme1", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    c1 = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)
    c2 = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)
    assert c1.id == c2.id


@pytest.mark.asyncio
async def test_regenerate_cluster_produces_piece_per_platform(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme2", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.cluster_evidence.fetch_and_dedupe", new=AsyncMock(return_value=_FAKE_EVIDENCE)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Title", "Body content here.", None, [], False))), \
         patch("app.services.clustering_service._gen_owned_site_piece", new=AsyncMock(return_value=_owned_ok())):
        result = await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    assert result.status == "ready"
    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    assert len(drafts) == len(CLUSTER_PLATFORMS)
    assert {d.platform for d in drafts} == set(CLUSTER_PLATFORMS)
    assert all(d.cluster_id == cluster.id for d in drafts)


@pytest.mark.asyncio
async def test_regenerate_cluster_respects_disabled_platform(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme3", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    db_session.add(BrandContentSettings(brand_id=brand.id, platform="x", enabled=False, auto_post=False))
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.cluster_evidence.fetch_and_dedupe", new=AsyncMock(return_value=_FAKE_EVIDENCE)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Title", "Body.", None, [], False))), \
         patch("app.services.clustering_service._gen_owned_site_piece", new=AsyncMock(return_value=_owned_ok())):
        await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    platforms = {d.platform for d in drafts}
    assert "x" not in platforms
    assert len(drafts) == len(CLUSTER_PLATFORMS) - 1


@pytest.mark.asyncio
async def test_failed_piece_persists_with_failed_status(db_session: AsyncSession, registered_user: User) -> None:
    """Force one piece to fail; assert its ContentDraft row has status='failed'
    (not 'draft') and cluster.status == 'generation_partial'."""
    brand = Brand(name="Acme", slug="c-acme5", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    async def _fake_generate(*args, **kwargs):
        if kwargs.get("platform") == "reddit":
            raise RuntimeError("boom")
        return ("Title", "Body content here.", None, [], False)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.cluster_evidence.fetch_and_dedupe", new=AsyncMock(return_value=_FAKE_EVIDENCE)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(side_effect=_fake_generate)), \
         patch("app.services.clustering_service._gen_owned_site_piece", new=AsyncMock(return_value=_owned_ok())):
        result = await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    assert result.status == "generation_partial"
    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    assert len(drafts) == len(CLUSTER_PLATFORMS)
    failed = next(d for d in drafts if d.platform == "reddit")
    assert failed.status == "failed"
    assert failed.generation_state == "failed"
    assert failed.content_text == ""
    assert failed.title is None
    ok_drafts = [d for d in drafts if d.platform != "reddit"]
    assert all(d.status == "draft" for d in ok_drafts)


@pytest.mark.asyncio
async def test_regenerate_piece_replaces_only_target(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme4", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.cluster_evidence.fetch_and_dedupe", new=AsyncMock(return_value=_FAKE_EVIDENCE)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("First", "First body.", None, [], False))), \
         patch("app.services.clustering_service._gen_owned_site_piece", new=AsyncMock(return_value=_owned_ok(title="First", body="First body."))):
        await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    with patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Updated", "Updated body.", None, [], False))):
        await regenerate_piece(db_session, cluster_id=cluster.id, platform="linkedin", tier="starter")

    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    li = next(d for d in drafts if d.platform == "linkedin")
    others = [d for d in drafts if d.platform != "linkedin"]
    assert li.title == "Updated"
    assert all(d.title == "First" for d in others)
