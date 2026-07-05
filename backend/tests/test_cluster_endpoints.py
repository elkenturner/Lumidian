import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    ContentBrief, ContentCluster, ContentClusterSource, ContentDraft,
    ContentDraftCitation, ContentEvidencePack,
)
from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_status_endpoint_returns_lightweight_payload(client):
    await register_and_login(client, "se@x.com")
    brand = await create_brand(client, "B")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "generating"
        await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    r = await client.get(f"/api/clusters/{brand['id']}/{cluster_id}/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "generating"
    assert "pieces" in body
    assert "failure_reason" in body


@pytest.mark.asyncio
async def test_regenerate_pieces_endpoint_reuses_brief(client, monkeypatch):
    await register_and_login(client, "rp@x.com")
    brand = await create_brand(client, "B")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        await db.flush()
        brief = ContentBrief(
            cluster_id=cluster.id, version=1, positioning="p", canonical_phrasings=[],
            key_claims=[], stats=[], competitor_context={}, narrative_spine="", tone_notes="",
        )
        db.add(brief); await db.flush()
        cluster.last_brief_id = brief.id
        await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    called_with = {}
    async def fake_regen(db, *, cluster_id, tier, rebuild_brief=True):
        called_with["rebuild_brief"] = rebuild_brief
        return await db.get(ContentCluster, cluster_id)
    monkeypatch.setattr("app.routers.clusters.regenerate_cluster", fake_regen)

    r = await client.post(f"/api/clusters/{brand['id']}/{cluster_id}/regenerate-pieces")
    assert r.status_code == 200, r.text
    assert called_with["rebuild_brief"] is False


@pytest.mark.asyncio
async def test_sources_endpoint_returns_spine(client):
    await register_and_login(client, "src@x.com")
    brand = await create_brand(client, "B")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        await db.flush()
        pack = ContentEvidencePack(
            cluster_id=cluster.id, version=1, sources=[],
            total_t1=1, total_t2=1, total_t3=0,
        )
        db.add(pack); await db.flush()
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://reuters.com/a", domain="reuters.com",
            tier="T1", title="A", times_cited=2,
        ))
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://techcrunch.com/b", domain="techcrunch.com",
            tier="T2", title="B", times_cited=1,
        ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(f"/api/clusters/{brand['id']}/{cluster_id}/sources")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_t1"] == 1
    assert body["total_t2"] == 1
    assert len(body["sources"]) == 2
    assert body["sources"][0]["tier"] == "T1"  # T1 first


@pytest.mark.asyncio
async def test_sources_endpoint_reports_real_usage_counts(client):
    """times_cited must be computed from ContentDraftCitation rows, not the dead column."""
    await register_and_login(client, "srcusage@x.com")
    brand = await create_brand(client, "SrcUsage")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        await db.flush()
        pack = ContentEvidencePack(
            cluster_id=cluster.id, version=1, sources=[],
            total_t1=1, total_t2=1, total_t3=0,
        )
        db.add(pack); await db.flush()
        # One source cited by 2 drafts, one uncited. Both seeded with a stale
        # times_cited=0 column value that the endpoint must not trust.
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://reuters.com/a", domain="reuters.com",
            tier="T1", title="A", times_cited=0,
        ))
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://techcrunch.com/b", domain="techcrunch.com",
            tier="T2", title="B", times_cited=0,
        ))
        d1 = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
            platform="medium", status="draft", content_text="x", source="cluster",
        )
        d2 = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
            platform="quora", status="draft", content_text="y", source="cluster",
        )
        db.add_all([d1, d2]); await db.flush()
        for d in (d1, d2):
            db.add(ContentDraftCitation(
                draft_id=d.id, source_ref="S1",
                url="https://www.techcrunch.com/b", title="B",
                position_marker=0, tier="T2",
            ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(f"/api/clusters/{brand['id']}/{cluster_id}/sources")
    assert r.status_code == 200, r.text
    sources = r.json()["sources"]
    by_domain = {s["domain"]: s for s in sources}
    # www. prefix must not defeat the URL match
    assert by_domain["techcrunch.com"]["times_cited"] == 2
    assert by_domain["reuters.com"]["times_cited"] == 0
    # cited-first ordering beats tier ordering
    assert sources[0]["domain"] == "techcrunch.com"


@pytest.mark.asyncio
async def test_brief_history_endpoint(client):
    await register_and_login(client, "hist@x.com")
    brand = await create_brand(client, "B")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        await db.flush()
        for v in (1, 2, 3):
            db.add(ContentBrief(
                cluster_id=cluster.id, version=v, positioning=f"v{v}",
                canonical_phrasings=[], key_claims=[], stats=[],
                competitor_context={}, narrative_spine="", tone_notes="",
            ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(f"/api/clusters/{brand['id']}/{cluster_id}/briefs")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [b["version"] for b in body] == [3, 2, 1]  # descending


@pytest.mark.asyncio
async def test_detail_survives_attribution_with_null_score(client):
    """A DraftAttribution row with score_at_posting=None (created when a draft
    is posted before any tracking run measured the prompt) must not 500 the
    cluster detail endpoint — cluster_delta degrades to None instead."""
    await register_and_login(client, "nullattr@x.com")
    brand = await create_brand(client, "NullAttr")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster.status = "ready"
        from app.models import ContentDraft, DraftAttribution
        draft = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster.id,
            platform="owned_site", status="posted", content_text="x",
            source="cluster", posted_url="https://ex.com/p",
        )
        db.add(draft)
        await db.flush()
        from app.models import utcnow
        db.add(DraftAttribution(
            draft_id=draft.id, brand_id=brand["id"], prompt_id=prompt_id,
            score_at_posting=None, current_score=None, delta=None,
            posted_at=utcnow(),
        ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(f"/api/clusters/{brand['id']}/{cluster_id}")
    assert r.status_code == 200, r.text
    assert r.json()["cluster_delta"] is None
