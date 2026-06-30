"""Tests for cluster_delta and posted_count fields on the cluster list endpoint."""
import pytest
from datetime import datetime, timezone
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    ContentCluster,
    ContentDraft,
    DraftAttribution,
    Prompt,
)
from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_cluster_summary_includes_zero_delta_when_no_posted_drafts(client, db_session):
    await register_and_login(client, "u1@example.com")
    brand = await create_brand(client, "Acme")

    # Get the auto-created prompt id
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        cluster.pillar_mode = "none"
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["posted_count"] == 0
    assert payload[0]["cluster_delta"] is None


@pytest.mark.asyncio
async def test_cluster_summary_sums_attribution_delta_across_posted_pieces(client, db_session):
    await register_and_login(client, "u2@example.com")
    brand = await create_brand(client, "Acme")

    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        cluster.pillar_mode = "none"
        await db.flush()

        # Two posted pieces, one with delta +5.0, one with delta +3.5
        for platform, delta in [("reddit", 5.0), ("linkedin", 3.5)]:
            draft = ContentDraft(
                brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
                platform=platform, status="posted", content_text="...",
            )
            db.add(draft)
            await db.flush()
            db.add(DraftAttribution(
                draft_id=draft.id, brand_id=brand["id"], prompt_id=prompt_id,
                posted_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                score_at_posting=20.0, current_score=20.0 + delta, delta=delta,
                runs_since_posting=1,
            ))
        # One unposted draft — should not contribute
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
            platform="medium", status="draft", content_text="...",
        ))
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}")
    assert resp.status_code == 200
    summary = resp.json()[0]
    assert summary["posted_count"] == 2
    # cluster_delta semantic changed: it is now
    #   current_prompt_visibility − score_at_posting of the FIRST posted draft
    # (not the sum of per-draft deltas). With no completed tracking runs in
    # this test, current visibility is 0.0; first posted draft was at score 20.0,
    # so the lift is 0.0 - 20.0 = -20.0.
    assert summary["cluster_delta"] == pytest.approx(-20.0)


@pytest.mark.asyncio
async def test_cluster_summary_delta_null_when_posted_but_no_attribution(client, db_session):
    """Posted draft with no DraftAttribution row (legacy or fresh post) — delta is None."""
    await register_and_login(client, "u3@example.com")
    brand = await create_brand(client, "Acme")

    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        cluster.pillar_mode = "none"
        await db.flush()
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
            platform="reddit", status="posted", content_text="...",
        ))
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}")
    summary = resp.json()[0]
    assert summary["posted_count"] == 1
    assert summary["cluster_delta"] is None


@pytest.mark.asyncio
async def test_cluster_detail_includes_cluster_delta_and_posted_count(client, db_session):
    await register_and_login(client, "u4@example.com")
    brand = await create_brand(client, "Acme")

    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=brand["id"], text="how to X", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        draft = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="reddit", status="posted", content_text="...",
        )
        db.add(draft)
        await db.flush()
        db.add(DraftAttribution(
            draft_id=draft.id, brand_id=brand["id"], prompt_id=prompt.id,
            posted_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            score_at_posting=20.0, current_score=24.0, delta=4.0,
            runs_since_posting=1,
        ))
        await db.commit()
        cluster_id = cluster.id

    resp = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}",
    )
    assert resp.status_code == 200
    detail = resp.json()
    # cluster_delta semantic changed: it is now
    #   current_prompt_visibility − score_at_posting of the FIRST posted draft
    # (not the per-draft delta). With no completed tracking runs in this test,
    # current visibility is 0.0; first posted draft was at score 20.0,
    # so the lift is 0.0 - 20.0 = -20.0. The per-draft attribution_delta
    # column is unchanged (still 4.0).
    assert detail["cluster_delta"] == pytest.approx(-20.0)
    assert detail["posted_count"] == 1
    assert len(detail["drafts"]) == 1
    assert detail["drafts"][0]["attribution_delta"] == pytest.approx(4.0)


@pytest.mark.asyncio
async def test_cluster_detail_draft_attribution_delta_null_without_row(client, db_session):
    await register_and_login(client, "u5@example.com")
    brand = await create_brand(client, "Acme")

    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=brand["id"], text="x", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="medium", status="draft", content_text="...",
        ))
        await db.commit()
        cluster_id = cluster.id

    resp = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}",
    )
    detail = resp.json()
    assert detail["drafts"][0]["attribution_delta"] is None
    assert detail["cluster_delta"] is None
    assert detail["posted_count"] == 0


@pytest.mark.asyncio
async def test_cluster_detail_posted_draft_without_attribution(client, db_session):
    """Posted draft at detail endpoint with no DraftAttribution row → cluster_delta None, posted_count 1."""
    await register_and_login(client, "u6@example.com")
    brand = await create_brand(client, "Acme")

    async with AsyncSessionLocal() as db:
        prompt = Prompt(brand_id=brand["id"], text="x", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="reddit", status="posted", content_text="...",
        ))
        await db.commit()
        cluster_id = cluster.id

    resp = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}",
    )
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert detail["cluster_delta"] is None
    assert detail["posted_count"] == 1
    assert detail["drafts"][0]["attribution_delta"] is None
