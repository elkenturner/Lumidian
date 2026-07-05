"""
Tests for the owned-site cluster anchor piece (Task 7):
  - CLUSTER_PLATFORMS puts owned_site first, alongside the 5 existing platforms
  - build_owned_site_prompt accepts a cluster `brief` and folds it into the prompt
  - marking an owned_site cluster draft posted with a URL attaches it as the
    cluster's pillar (pillar_url / pillar_mode)
"""
import httpx

from tests.conftest import create_brand, register_and_login

# asyncio_mode=auto (pytest.ini) runs the async test below without a marker;
# no module-level pytestmark here since this file also has plain sync tests.


def test_owned_site_is_first_cluster_platform():
    from app.services.clustering_service import CLUSTER_PLATFORMS
    assert CLUSTER_PLATFORMS[0] == "owned_site"
    assert set(CLUSTER_PLATFORMS) == {"owned_site", "linkedin", "medium", "reddit", "quora", "x"}


def test_owned_site_prompt_accepts_brief():
    from app.services.drafting.owned_site import build_owned_site_prompt
    p = build_owned_site_prompt(
        {"name": "Acme"}, "best widget?",
        evidence=[{"title": "T", "url": "https://e.com", "snippet": "s"}],
        brief="POSITIONING: the fastest widget",
    )
    assert "the fastest widget" in p


async def test_marking_owned_site_draft_posted_attaches_pillar(client: httpx.AsyncClient):
    """PUT the draft to posted with a posted_url -> cluster.pillar_url/pillar_mode set."""
    await register_and_login(client, email="pillarattach@example.com")
    brand = await create_brand(client, name="Pillar Attach Brand")
    prompt_id = brand["prompts"][0]["id"]

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import ContentCluster, ContentDraft

    async with AsyncSessionLocal() as db:
        # Brand creation auto-provisions a cluster per prompt — reuse it rather
        # than violating the ContentCluster.prompt_id UNIQUE constraint.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one_or_none()
        if cluster is None:
            cluster = ContentCluster(
                brand_id=brand["id"],
                prompt_id=prompt_id,
                status="ready",
                pillar_mode="none",
                version=1,
            )
            db.add(cluster)
            await db.commit()
            await db.refresh(cluster)
        cluster_id = cluster.id

        draft = ContentDraft(
            brand_id=brand["id"],
            prompt_id=prompt_id,
            cluster_id=cluster_id,
            platform="owned_site",
            status="draft",
            title="Best Widget Guide",
            content_text="Body content.",
            source="cluster",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    posted_url = "https://acme.com/answers/widgets"
    resp = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"status": "posted", "posted_url": posted_url},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "posted"

    async with AsyncSessionLocal() as db:
        refreshed_cluster = await db.get(ContentCluster, cluster_id)
        assert refreshed_cluster.pillar_mode == "attached"
        assert refreshed_cluster.pillar_url == posted_url
