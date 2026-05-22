"""Tests for ContentCluster and ContentBrief models."""
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentClusterSource,
    ContentDraft,
    ContentEvidencePack,
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


@pytest.mark.asyncio
async def test_evidence_pack_persists():
    async with AsyncSessionLocal() as db:
        user = User(email="e@example.com", password_hash="x", name="t")
        db.add(user)
        await db.flush()
        brand = Brand(name="Acme", slug="acme-test-modelchk", user_id=user.id)
        db.add(brand)
        await db.flush()
        prompt = Prompt(brand_id=brand.id, text="best CRM")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id, status="pending",
        )
        db.add(cluster)
        await db.flush()
        pack = ContentEvidencePack(
            cluster_id=cluster.id, version=1,
            sources=[{"url": "https://reuters.com/x", "tier": "T1"}],
            total_t1=1, total_t2=0, total_t3=0,
        )
        db.add(pack)
        await db.flush()
        src = ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://reuters.com/x", domain="reuters.com",
            tier="T1", title="X", times_cited=0,
        )
        db.add(src)
        await db.commit()

        # Re-fetch and verify
        loaded = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster.id)
        )).scalar_one()
        assert loaded.total_t1 == 1
        assert loaded.sources[0]["url"] == "https://reuters.com/x"


@pytest.mark.asyncio
async def test_cluster_failure_reason_field():
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(
            brand_id=1, prompt_id=1, status="briefing_failed",
            failure_reason="insufficient_t1_sources",
        )
        # Just construct; ensure attribute exists
        assert cluster.failure_reason == "insufficient_t1_sources"


@pytest.mark.asyncio
async def test_draft_generation_state_default():
    draft = ContentDraft(
        brand_id=1, platform="medium", content_text="x", source="cluster",
    )
    # default kicked in only after flush; here just assert the column is present
    from app.models import ContentDraft as M
    assert hasattr(M, "generation_state")
    assert hasattr(M, "failure_reason")
