"""Tests for /api/clusters/* endpoints."""
from unittest.mock import AsyncMock, patch

import pytest
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, ContentBrief, ContentCluster, ContentDraft, Prompt, User
from tests.conftest import register_and_login

SAMPLE_BRIEF_JSON = '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],"stats":[],"narrative_spine":"n","tone_notes":"t"}'

_FAKE_EVIDENCE = [
    {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
    {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
    {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
    {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
]

pytestmark = pytest.mark.asyncio


async def test_list_clusters_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/clusters/1")
    assert r.status_code in (401, 403)


async def test_list_clusters_returns_empty_for_new_brand(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    await register_and_login(client, "ck-list@test.com")
    user = (await db_session.execute(select(User).where(User.email == "ck-list@test.com"))).scalar_one()
    brand = Brand(name="Acme", slug="ck-list-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    r = await client.get(f"/api/clusters/{brand.id}")
    assert r.status_code == 200
    assert r.json() == []


async def test_regenerate_cluster_endpoint_creates_pieces(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    await register_and_login(client, "ck-regen@test.com", subscription_tier="starter")
    user = (await db_session.execute(select(User).where(User.email == "ck-regen@test.com"))).scalar_one()
    brand = Brand(name="Acme", slug="ck-regen-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.cluster_evidence.fetch_and_dedupe", new=AsyncMock(return_value=_FAKE_EVIDENCE)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("T", "Body.", None, [], False))):
        r = await client.post(
            f"/api/clusters/{brand.id}/by-prompt/{prompt.id}/regenerate",
        )

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert len(body["drafts"]) == 5


async def test_regenerate_piece_endpoint(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    await register_and_login(client, "ck-piece@test.com", subscription_tier="starter")
    user = (await db_session.execute(select(User).where(User.email == "ck-piece@test.com"))).scalar_one()
    brand = Brand(name="Acme", slug="ck-piece-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("T2", "B2", None, [], False))):
        r = await client.post(
            f"/api/clusters/{brand.id}/{cluster.id}/regenerate-piece",
            json={"platform": "linkedin"},
        )

    assert r.status_code == 200
    assert r.json()["title"] == "T2"


async def test_failed_pieces_not_counted_as_drafts_in_summary(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    """Cluster with 2 done + 3 failed pieces: list endpoint's draft/piece counts
    reflect 2; detail endpoint still returns all 5 pieces with failure_reason."""
    await register_and_login(client, "ck-failed@test.com", subscription_tier="starter")
    user = (await db_session.execute(select(User).where(User.email == "ck-failed@test.com"))).scalar_one()
    brand = Brand(name="Acme", slug="ck-failed-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="generation_partial")
    db_session.add(cluster)
    await db_session.flush()

    done_platforms = ["linkedin", "medium"]
    failed_platforms = ["reddit", "quora", "x"]
    for platform in done_platforms:
        db_session.add(ContentDraft(
            brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
            platform=platform, status="draft", title="T", content_text="Body.",
            source="cluster", generation_state="done",
        ))
    for platform in failed_platforms:
        db_session.add(ContentDraft(
            brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
            platform=platform, status="failed", title=None, content_text="",
            source="cluster", generation_state="failed", failure_reason="timeout after 60s",
        ))
    await db_session.commit()

    list_resp = await client.get(f"/api/clusters/{brand.id}")
    assert list_resp.status_code == 200
    summary = list_resp.json()[0]
    assert len(summary["pieces"]) == 2
    assert {p["platform"] for p in summary["pieces"]} == set(done_platforms)

    detail_resp = await client.get(f"/api/clusters/{brand.id}/{cluster.id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert len(detail["drafts"]) == 5
    failed_out = [d for d in detail["drafts"] if d["platform"] in failed_platforms]
    assert len(failed_out) == 3
    assert all(d["generation_state"] == "failed" for d in failed_out)
    assert all(d["failure_reason"] == "timeout after 60s" for d in failed_out)


async def test_edit_brief_endpoint(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    await register_and_login(client, "ck-edit@test.com")
    user = (await db_session.execute(select(User).where(User.email == "ck-edit@test.com"))).scalar_one()
    brand = Brand(name="Acme", slug="ck-edit-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.flush()
    brief = ContentBrief(cluster_id=cluster.id, version=1, positioning="old")
    db_session.add(brief)
    await db_session.flush()
    cluster.last_brief_id = brief.id
    await db_session.commit()

    r = await client.patch(
        f"/api/clusters/{brand.id}/{cluster.id}/brief",
        json={"positioning": "new positioning"},
    )
    assert r.status_code == 200
    assert r.json()["positioning"] == "new positioning"


async def test_cross_user_isolation_404(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    """User A cannot access User B's cluster."""
    await register_and_login(client, "ck-iso-a@test.com")
    # Register user B via a fresh client so we can create their brand directly
    user_b = User(email="ck-iso-b@test.com", password_hash="x", email_verified=1)
    db_session.add(user_b)
    await db_session.flush()
    brand_b = Brand(name="B", slug="ck-iso-b-brand", user_id=user_b.id)
    db_session.add(brand_b)
    await db_session.commit()

    # user A (currently logged in) should get 404 for user B's brand
    r = await client.get(f"/api/clusters/{brand_b.id}")
    assert r.status_code in (403, 404)
