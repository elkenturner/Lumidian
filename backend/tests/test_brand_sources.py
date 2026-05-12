"""
Tests for BrandSource CRUD endpoints on the brand_profile router.

Covers:
- POST   /api/brands/{id}/sources               — create
- GET    /api/brands/{id}/sources               — list (ownership-scoped)
- DELETE /api/brands/{id}/sources/{source_id}   — delete
- Ownership isolation
- BRAND_SOURCE_LIMIT cap enforcement
"""
from __future__ import annotations

import pytest

from tests.conftest import create_brand, register_and_login


@pytest.mark.asyncio
async def test_create_brand_source(client):
    await register_and_login(client, email="src1@test.com")
    brand = await create_brand(client, name="Acme", prompts=["what is breath analysis"])
    r = await client.post(
        f"/api/brands/{brand['id']}/sources",
        json={
            "url": "https://nature.com/articles/study",
            "title": "Breath analysis study",
            "snippet": "A 2024 study found...",
            "source_type": "paper",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"] == "https://nature.com/articles/study"
    assert body["source_type"] == "paper"
    assert body["title"] == "Breath analysis study"


@pytest.mark.asyncio
async def test_list_brand_sources_returns_only_own(client):
    await register_and_login(client, email="src2@test.com")
    brand = await create_brand(client, name="A", prompts=["q"])
    await client.post(
        f"/api/brands/{brand['id']}/sources",
        json={"url": "https://x.com", "title": "X", "snippet": "s", "source_type": "article"},
    )
    r = await client.get(f"/api/brands/{brand['id']}/sources")
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_other_user_cannot_access_sources(client):
    # User 1 creates a brand
    await register_and_login(client, email="src3@test.com")
    brand = await create_brand(client, name="A", prompts=["q"])
    brand_id = brand["id"]
    # User 2 logs in — should not be able to see user 1's sources
    await register_and_login(client, email="src4@test.com")
    r = await client.get(f"/api/brands/{brand_id}/sources")
    assert r.status_code in (403, 404)


@pytest.mark.asyncio
async def test_delete_brand_source(client):
    await register_and_login(client, email="src5@test.com")
    brand = await create_brand(client, name="A", prompts=["q"])
    create_r = await client.post(
        f"/api/brands/{brand['id']}/sources",
        json={"url": "https://x.com", "title": "X", "snippet": "s", "source_type": "article"},
    )
    assert create_r.status_code == 200, create_r.text
    src_id = create_r.json()["id"]
    r = await client.delete(f"/api/brands/{brand['id']}/sources/{src_id}")
    assert r.status_code == 204
    list_r = await client.get(f"/api/brands/{brand['id']}/sources")
    assert list_r.json() == []


@pytest.mark.asyncio
async def test_source_cap_enforced(client):
    from app.services.drafting.evidence import BRAND_SOURCE_LIMIT

    await register_and_login(client, email="src6@test.com")
    brand = await create_brand(client, name="A", prompts=["q"])
    for i in range(BRAND_SOURCE_LIMIT):
        r = await client.post(
            f"/api/brands/{brand['id']}/sources",
            json={
                "url": f"https://x.com/{i}",
                "title": f"T{i}",
                "snippet": "s",
                "source_type": "article",
            },
        )
        assert r.status_code == 200, r.text
    # The next one should be rejected
    r = await client.post(
        f"/api/brands/{brand['id']}/sources",
        json={
            "url": "https://x.com/over",
            "title": "Over",
            "snippet": "s",
            "source_type": "article",
        },
    )
    assert r.status_code == 400
