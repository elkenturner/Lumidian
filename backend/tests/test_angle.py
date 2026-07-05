import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ContentCluster
from app.services.drafting import PLATFORM_SPECS, build_prompt
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


# ── build_prompt rendering ────────────────────────────────────────────────

def _prompt(angle=None):
    return build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="best early cancer screening startups",
        visibility_pct=12.0,
        profile_context="Brand: Acme",
        response_analysis="(none)",
        platform_spec=PLATFORM_SPECS["medium"],
        angle_directive=angle,
    )


def test_angle_directive_appears_before_voice_and_platform_rules():
    p = _prompt(angle_directive("insider", "Acme"))
    assert "ANGLE — INSIDER" in p
    assert "BRAND VOICE" not in p  # no voice_directive passed here
    assert p.index("ANGLE — INSIDER") < p.index("PLATFORM RULES")


def test_angle_directive_before_brand_voice_section():
    p = build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="best early cancer screening startups",
        visibility_pct=12.0,
        profile_context="Brand: Acme",
        response_analysis="(none)",
        platform_spec=PLATFORM_SPECS["medium"],
        voice_directive="Tone: terse, clinical.",
        angle_directive=angle_directive("insider", "Acme"),
    )
    assert "ANGLE — INSIDER" in p
    assert "BRAND VOICE" in p
    assert p.index("ANGLE — INSIDER") < p.index("BRAND VOICE") < p.index("PLATFORM RULES")


def test_no_angle_directive_no_section():
    p = _prompt(None)
    assert "ANGLE —" not in p


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


@pytest.mark.asyncio
async def test_patch_cluster_angle_wrong_brand_same_user_404(client):
    await register_and_login(client, "angle-owner@x.com")
    # Flip is_admin to bypass the 1-standard-brand tier cap so this single
    # user can own two brands (needed to prove cross-brand isolation).
    async with AsyncSessionLocal() as db:
        from sqlalchemy import update
        from app.models import User
        await db.execute(
            update(User).where(User.email == "angle-owner@x.com").values(is_admin=True)
        )
        await db.commit()

    brand1 = await create_brand(client, "AngleOne")
    brand2 = await create_brand(client, "AngleTwo")
    r = await client.get(f"/api/brands/{brand2['id']}")
    prompt2_id = r.json()["prompts"][0]["id"]
    async with AsyncSessionLocal() as db:
        # Cluster belongs to brand2, but we address it via brand1 in the URL.
        cluster2 = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt2_id)
        )).scalar_one()
        cluster2_id = cluster2.id

    r = await client.patch(
        f"/api/clusters/{brand1['id']}/{cluster2_id}", json={"angle": "neutral"}
    )
    assert r.status_code == 404, r.text
