"""Test that editing a brief creates a new ContentBrief version row
without updating cluster.last_brief_id."""
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ContentBrief, ContentCluster
from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_edit_brief_creates_new_version_does_not_promote(client):
    await register_and_login(client, "brief@v.com")
    brand = await create_brand(client, "BV")
    # Add a tracked prompt (the brand was created with a default prompt; reuse it)
    r = await client.get(f"/api/brands/{brand['id']}")
    assert r.status_code == 200
    prompts = r.json().get("prompts") or []
    assert len(prompts) >= 1, "Brand should have a default prompt"
    prompt_id = prompts[0]["id"]

    # Seed a cluster with an initial brief manually
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster); await db.flush()
        brief_v1 = ContentBrief(
            cluster_id=cluster.id, version=1, positioning="v1",
            canonical_phrasings=[], key_claims=[], stats=[],
            competitor_context={}, narrative_spine="", tone_notes="",
        )
        db.add(brief_v1); await db.flush()
        cluster.last_brief_id = brief_v1.id
        await db.commit()
        cluster_id = cluster.id
        brief_v1_id = brief_v1.id

    # PATCH brief — edits must create v2, leave last_brief_id pointing at v1
    r = await client.patch(
        f"/api/clusters/{brand['id']}/{cluster_id}/brief",
        json={"positioning": "v2"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["positioning"] == "v2"
    assert body["version"] == 2

    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.id == cluster_id)
        )).scalar_one()
        # last_brief_id still v1 (pieces were generated from v1; not auto-promoted)
        assert cluster.last_brief_id == brief_v1_id

        all_briefs = (await db.execute(
            select(ContentBrief).where(ContentBrief.cluster_id == cluster_id)
        )).scalars().all()
        assert len(all_briefs) == 2
        assert {b.version for b in all_briefs} == {1, 2}
