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

from app.models import Brand, ContentCluster, ContentDraft, Prompt, User, utcnow
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
        new=AsyncMock(return_value=("Title", "Body content.", None, [], False)),
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
        new=AsyncMock(return_value=("T", "B", None, [], False)),
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


@pytest.mark.asyncio
async def test_sweep_uses_fresh_session_per_cluster(
    db_session: AsyncSession,
    brand_with_two_prompts,
) -> None:
    """A regenerate_cluster failure for prompt N must not prevent prompt N+1
    from being processed with a working session: record the session object
    ids passed to the stubbed regenerate_cluster; assert they differ per
    call and that a raise on call 1 still lets call 2 happen.
    """
    brand, prompts = brand_with_two_prompts

    seen_session_ids: list[int] = []
    call_count = {"n": 0}

    async def fake_regenerate_cluster(db, *, cluster_id, tier, rebuild_brief=True):
        call_count["n"] += 1
        seen_session_ids.append(id(db))
        if call_count["n"] == 1:
            raise Exception("database is locked")
        return None

    with patch(
        "app.services.clustering_service.regenerate_cluster",
        new=AsyncMock(side_effect=fake_regenerate_cluster),
    ):
        await _bg_generate_drafts(brand_id=brand.id, max_gaps=10, source="manual")

    assert call_count["n"] == 2
    assert len(seen_session_ids) == 2
    assert seen_session_ids[0] != seen_session_ids[1]


@pytest.mark.asyncio
async def test_retry_failed_only_processes_failed_and_pending(
    db_session: AsyncSession,
) -> None:
    """Seed clusters with statuses ready / briefing_failed / generation_partial /
    pending; run sweep with retry_failed=True; assert stub called only for
    briefing_failed, generation_partial, pending.
    """
    user = User(
        email="retry_failed@example.com",
        password_hash="x",
        name="RetryFailed",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-retry-failed", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    statuses = ["ready", "briefing_failed", "generation_partial", "pending"]
    prompts = []
    for i, st in enumerate(statuses):
        p = Prompt(brand_id=brand.id, text=f"Prompt {i}", prompt_type="standard")
        db_session.add(p)
        await db_session.flush()
        prompts.append(p)
        db_session.add(
            ContentCluster(
                brand_id=brand.id,
                prompt_id=p.id,
                status=st,
                pillar_mode="none",
                version=1,
                created_at=utcnow(),
            )
        )
    await db_session.commit()

    called_prompt_ids: list[int] = []

    async def fake_regenerate_cluster(db, *, cluster_id, tier, rebuild_brief=True):
        cluster = (
            await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))
        ).scalar_one()
        called_prompt_ids.append(cluster.prompt_id)
        return cluster

    with patch(
        "app.services.clustering_service.regenerate_cluster",
        new=AsyncMock(side_effect=fake_regenerate_cluster),
    ):
        await _bg_generate_drafts(
            brand_id=brand.id, max_gaps=10, source="manual", retry_failed=True
        )

    assert set(called_prompt_ids) == {prompts[1].id, prompts[2].id, prompts[3].id}


@pytest.mark.asyncio
async def test_retry_failed_takes_precedence_over_skip_ready(
    db_session: AsyncSession,
) -> None:
    """When both skip_ready and retry_failed are set, retry_failed wins:
    a generation_partial cluster IS processed and a ready cluster is NOT.
    """
    user = User(
        email="both_flags@example.com",
        password_hash="x",
        name="BothFlags",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-both-flags", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    statuses = ["ready", "generation_partial"]
    prompts = []
    for i, st in enumerate(statuses):
        p = Prompt(brand_id=brand.id, text=f"Prompt {i}", prompt_type="standard")
        db_session.add(p)
        await db_session.flush()
        prompts.append(p)
        db_session.add(
            ContentCluster(
                brand_id=brand.id,
                prompt_id=p.id,
                status=st,
                pillar_mode="none",
                version=1,
                created_at=utcnow(),
            )
        )
    await db_session.commit()

    called_prompt_ids: list[int] = []

    async def fake_regenerate_cluster(db, *, cluster_id, tier, rebuild_brief=True):
        cluster = (
            await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))
        ).scalar_one()
        called_prompt_ids.append(cluster.prompt_id)
        return cluster

    with patch(
        "app.services.clustering_service.regenerate_cluster",
        new=AsyncMock(side_effect=fake_regenerate_cluster),
    ):
        await _bg_generate_drafts(
            brand_id=brand.id,
            max_gaps=10,
            source="manual",
            skip_ready=True,
            retry_failed=True,
        )

    assert called_prompt_ids == [prompts[1].id]


@pytest.mark.asyncio
async def test_skip_ready_budget_not_consumed_by_skipped_clusters(
    db_session: AsyncSession,
) -> None:
    """Regression: skipped (ready) clusters must not eat into max_gaps.

    Seed 4 prompts with clusters [ready, ready, briefing_failed, pending] and
    call with max_gaps=2, skip_ready=True. Previously the loop sliced
    prompt_ids[:max_gaps] up front, so with max_gaps=2 only the two `ready`
    prompts would ever be examined — and since both are skipped, NEITHER of
    the two non-ready prompts would ever get processed. The fix must walk the
    full prompt list and only count actually-processed (non-skipped)
    clusters against the budget, so briefing_failed and pending both run.
    """
    user = User(
        email="skip_budget@example.com",
        password_hash="x",
        name="SkipBudget",
        email_verified=True,
        subscription_tier="pro",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-skip-budget", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    statuses = ["ready", "ready", "briefing_failed", "pending"]
    prompts = []
    for i, st in enumerate(statuses):
        p = Prompt(brand_id=brand.id, text=f"Prompt {i}", prompt_type="standard")
        db_session.add(p)
        await db_session.flush()
        prompts.append(p)
        db_session.add(
            ContentCluster(
                brand_id=brand.id,
                prompt_id=p.id,
                status=st,
                pillar_mode="none",
                version=1,
                created_at=utcnow(),
            )
        )
    await db_session.commit()

    called_prompt_ids: list[int] = []

    async def fake_regenerate_cluster(db, *, cluster_id, tier, rebuild_brief=True):
        cluster = (
            await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))
        ).scalar_one()
        called_prompt_ids.append(cluster.prompt_id)
        return cluster

    with patch(
        "app.services.clustering_service.regenerate_cluster",
        new=AsyncMock(side_effect=fake_regenerate_cluster),
    ):
        await _bg_generate_drafts(
            brand_id=brand.id, max_gaps=2, source="manual", skip_ready=True
        )

    assert set(called_prompt_ids) == {prompts[2].id, prompts[3].id}


@pytest.mark.asyncio
async def test_retry_failed_budget_not_consumed_by_skipped_clusters(
    db_session: AsyncSession,
) -> None:
    """Same regression as above but for retry_failed: a `ready` cluster in
    front of the queue must not eat the budget meant for failed/pending ones.
    """
    user = User(
        email="retry_budget@example.com",
        password_hash="x",
        name="RetryBudget",
        email_verified=True,
        subscription_tier="pro",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-retry-budget", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    statuses = ["ready", "briefing_failed", "generation_partial"]
    prompts = []
    for i, st in enumerate(statuses):
        p = Prompt(brand_id=brand.id, text=f"Prompt {i}", prompt_type="standard")
        db_session.add(p)
        await db_session.flush()
        prompts.append(p)
        db_session.add(
            ContentCluster(
                brand_id=brand.id,
                prompt_id=p.id,
                status=st,
                pillar_mode="none",
                version=1,
                created_at=utcnow(),
            )
        )
    await db_session.commit()

    called_prompt_ids: list[int] = []

    async def fake_regenerate_cluster(db, *, cluster_id, tier, rebuild_brief=True):
        cluster = (
            await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))
        ).scalar_one()
        called_prompt_ids.append(cluster.prompt_id)
        return cluster

    with patch(
        "app.services.clustering_service.regenerate_cluster",
        new=AsyncMock(side_effect=fake_regenerate_cluster),
    ):
        await _bg_generate_drafts(
            brand_id=brand.id, max_gaps=2, source="manual", retry_failed=True
        )

    assert set(called_prompt_ids) == {prompts[1].id, prompts[2].id}
