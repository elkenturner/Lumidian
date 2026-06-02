"""A stuck Claude call must not freeze the per-prompt cluster batch.

Regression tests for the SpotitEarly halt-at-prompt-#42 failure: a single
hung LLM call caused `regenerate_cluster`'s `asyncio.gather` to never return,
and `_bg_generate_drafts`' for-loop sat on the await indefinitely, never
processing the remaining 23 prompts. The fix is a per-piece timeout inside
`regenerate_cluster` plus an outer timeout in `_bg_generate_drafts`.
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, ContentCluster, ContentDraft, Prompt, User


_FAKE_PACK = [
    {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
    {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
    {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
    {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
]

BRIEF_JSON = (
    '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],'
    '"stats":[],"narrative_spine":"n","tone_notes":"t"}'
)


@pytest.mark.asyncio
async def test_regenerate_cluster_completes_when_one_piece_hangs(
    db_session: AsyncSession,
):
    """If one platform's writer hangs forever, the cluster still completes."""
    from app.services import clustering_service

    user = User(email="cluster-timeout@x.com", password_hash="x", name="t")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="A", slug="cluster-timeout-brand", user_id=user.id)
    db_session.add(brand); await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="q")
    db_session.add(prompt); await db_session.flush()
    cluster = ContentCluster(
        brand_id=brand.id, prompt_id=prompt.id,
        status="pending", pillar_mode="none", version=1,
    )
    db_session.add(cluster); await db_session.commit(); await db_session.refresh(cluster)
    cluster_id = cluster.id
    brand_id = brand.id

    async def maybe_hang_piece(*args, **kwargs):
        platform = kwargs.get("platform", "")
        if platform == "linkedin":
            # Simulate the buggy Claude hang the SpotitEarly bug exhibited.
            await asyncio.sleep(30)
            return ("title", "body", None, [])
        return ("Title", f"Body for {platform}.", None, [])

    started = time.monotonic()
    with (
        patch.object(clustering_service, "PIECE_TIMEOUT_SECONDS", 0.4),
        patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=BRIEF_JSON)),
        patch("app.services.cluster_evidence.fetch_and_dedupe",
              new=AsyncMock(return_value=_FAKE_PACK)),
        patch.object(clustering_service, "_generate_piece_text",
                     side_effect=maybe_hang_piece),
        patch("app.services.clustering_service.generate_draft_summary",
              new=AsyncMock(return_value="summary")),
        patch("app.services.cluster_pillar.propose_pillar", new=AsyncMock(return_value=None)),
    ):
        result = await clustering_service.regenerate_cluster(
            db_session, cluster_id=cluster_id, tier="basic",
        )

    elapsed = time.monotonic() - started
    assert elapsed < 5.0, f"regenerate_cluster did not enforce timeout: {elapsed=:.2f}s"
    assert result.status == "generation_partial", (
        f"expected generation_partial after timeout, got {result.status}"
    )

    drafts = (await db_session.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster_id)
    )).scalars().all()
    by_platform = {d.platform: d for d in drafts}
    assert by_platform["linkedin"].generation_state == "failed"
    assert "timeout" in (by_platform["linkedin"].failure_reason or "").lower()
    # Successful siblings still committed.
    assert any(d.generation_state == "done" for d in drafts if d.platform != "linkedin")


@pytest.mark.asyncio
async def test_bg_generate_drafts_advances_past_hung_cluster(
    db_session: AsyncSession,
):
    """If one cluster hangs past CLUSTER_TIMEOUT_SECONDS, the loop must advance.

    Reproduces the SpotitEarly halt: orchestrator stuck on prompt #42 forever,
    never processed prompts #43..#65.
    """
    from app.routers import content as content_router

    user = User(email="bg-timeout@x.com", password_hash="x", name="t",
                subscription_tier="basic")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="A", slug="bg-timeout-brand", user_id=user.id)
    db_session.add(brand); await db_session.flush()
    p1 = Prompt(brand_id=brand.id, text="first", prompt_type="standard")
    p2 = Prompt(brand_id=brand.id, text="second", prompt_type="standard")
    db_session.add_all([p1, p2]); await db_session.commit()
    p1_id, p2_id = p1.id, p2.id
    brand_id = brand.id

    call_log: list[int] = []

    async def fake_regen(db, *, cluster_id, tier, rebuild_brief=True):
        # Identify which prompt this cluster belongs to.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.id == cluster_id)
        )).scalar_one()
        call_log.append(cluster.prompt_id)
        if cluster.prompt_id == p1_id:
            await asyncio.sleep(30)  # hang
        cluster.status = "ready"
        cluster.failure_reason = None
        await db.commit()
        return cluster

    with (
        patch.object(content_router, "CLUSTER_TIMEOUT_SECONDS", 0.4),
        patch("app.services.clustering_service.regenerate_cluster",
              side_effect=fake_regen),
    ):
        await content_router._bg_generate_drafts(
            brand_id=brand_id, max_gaps=2, source="manual",
        )

    assert call_log == [p1_id, p2_id], (
        f"orchestrator did not advance past hung cluster: call_log={call_log}"
    )
