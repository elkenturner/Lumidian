"""Tests for ContentCluster and ContentBrief models."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
    User,
)


@pytest_asyncio.fixture
async def registered_user(db_session: AsyncSession) -> User:
    """Create and persist a minimal User for direct-DB model tests."""
    user = User(email="cluster_test@example.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.asyncio
async def test_content_cluster_creation(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-1", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    cluster = ContentCluster(
        brand_id=brand.id,
        prompt_id=prompt.id,
        status="pending",
        pillar_mode="none",
        version=1,
    )
    db_session.add(cluster)
    await db_session.flush()

    assert cluster.id is not None
    assert cluster.status == "pending"
    assert cluster.pillar_mode == "none"
    assert cluster.pillar_url is None
    assert cluster.last_brief_id is None
    assert cluster.version == 1


@pytest.mark.asyncio
async def test_one_cluster_per_prompt_unique(db_session: AsyncSession, registered_user: User) -> None:
    """A prompt can only have one cluster."""
    brand = Brand(name="Acme", slug="acme-2", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    db_session.add(ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready"))
    await db_session.commit()

    db_session.add(ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready"))
    with pytest.raises(Exception):  # IntegrityError; SQLite raises generic
        await db_session.commit()


@pytest.mark.asyncio
async def test_content_brief_creation(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-3", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.flush()

    brief = ContentBrief(
        cluster_id=cluster.id,
        version=1,
        positioning="Position Acme as the leader in X",
        key_claims=["Claim 1", "Claim 2"],
        canonical_phrasings=["Acme tracks X across Y"],
        stats=[{"label": "users", "value": "10k", "source": "internal"}],
        competitor_context={"top": ["Foo", "Bar"]},
        narrative_spine="Through-line text",
        tone_notes="Confident, technical",
        created_by="system",
    )
    db_session.add(brief)
    await db_session.flush()

    assert brief.id is not None
    assert brief.key_claims == ["Claim 1", "Claim 2"]
    assert brief.stats[0]["label"] == "users"


@pytest.mark.asyncio
async def test_content_draft_cluster_id_nullable(db_session: AsyncSession, registered_user: User) -> None:
    """cluster_id is nullable so posted drafts can be retained after migration."""
    brand = Brand(name="Acme", slug="acme-4", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    draft = ContentDraft(
        brand_id=brand.id,
        prompt_id=prompt.id,
        platform="linkedin",
        status="draft",
        title="Title",
        content_text="Body",
        source="manual",
        cluster_id=None,
    )
    db_session.add(draft)
    await db_session.flush()
    assert draft.id is not None
    assert draft.cluster_id is None
