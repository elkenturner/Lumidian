"""Tests for cluster_delta and posted_count fields on the cluster list endpoint."""
import pytest
from datetime import datetime, timezone

from app.database import AsyncSessionLocal
from app.models import (
    ContentCluster,
    ContentDraft,
    DraftAttribution,
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
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt_id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
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
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt_id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
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
    assert summary["cluster_delta"] == pytest.approx(8.5)


@pytest.mark.asyncio
async def test_cluster_summary_delta_null_when_posted_but_no_attribution(client, db_session):
    """Posted draft with no DraftAttribution row (legacy or fresh post) — delta is None."""
    await register_and_login(client, "u3@example.com")
    brand = await create_brand(client, "Acme")

    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt_id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
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
