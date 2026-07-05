import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ContentCluster
from app.services.drafting.angle import angle_directive, effective_angle
from tests.conftest import register_and_login, create_brand


@pytest.mark.parametrize("platform,angle,sub_cls,expected", [
    ("owned_site", "auto", None, None),
    ("owned_site", "neutral", None, None),          # owned_site ignores overrides
    ("linkedin_article", "auto", None, "insider"),
    ("medium", "auto", None, "insider"),
    ("x_thread", "auto", None, "insider"),
    ("quora", "auto", None, "neutral"),
    ("reddit", "auto", "allowed", "insider"),
    ("reddit", "auto", "cautious", "neutral"),
    ("reddit", "auto", "restricted", "neutral"),
    ("reddit_comment", "auto", "allowed", "insider"),
    ("reddit", "insider", "restricted", "insider"),  # explicit overrides classification
    ("medium", "neutral", None, "neutral"),
])
def test_effective_angle_matrix(platform, angle, sub_cls, expected):
    assert effective_angle(platform, angle, sub_cls) == expected


def test_insider_directive_contents():
    d = angle_directive("insider", "Acme")
    assert "works at Acme" in d or "work at Acme" in d
    assert "full disclosure" in d.lower()
    assert "customer" in d.lower()          # fake-customer ban restated


def test_neutral_directive_contents():
    d = angle_directive("neutral", "Acme")
    assert "independent" in d.lower() or "practitioner" in d.lower()
    assert "among" in d.lower()             # brand as one option among alternatives
    assert "claim of independence" in d.lower() or "claim independence" in d.lower()  # astroturf guard
    assert "disclosure" in d.lower()        # explains none is needed


def test_no_directive_for_none():
    assert angle_directive(None, "Acme") is None


@pytest.mark.asyncio
async def test_patch_cluster_angle(client):
    await register_and_login(client, "angle@x.com")
    brand = await create_brand(client, "AngleCo")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Eager shell from create_brand already exists — mutate it.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster_id = cluster.id
        assert cluster.angle == "auto"

    r = await client.patch(
        f"/api/clusters/{brand['id']}/{cluster_id}", json={"angle": "neutral"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["angle"] == "neutral"

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.angle == "neutral"

    r = await client.patch(
        f"/api/clusters/{brand['id']}/{cluster_id}", json={"angle": "bogus"}
    )
    assert r.status_code == 422, r.text
