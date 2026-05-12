"""
Tests for VoiceSample CRUD endpoints on the brand_profile router.

Covers:
- POST   /api/brands/{id}/voice-samples           — create (insert at index 0)
- GET    /api/brands/{id}/voice-samples           — list
- DELETE /api/brands/{id}/voice-samples/{index}   — delete by index
- VOICE_SAMPLE_CAP enforcement (cap of 3)
"""
from __future__ import annotations

import pytest

from tests.conftest import create_brand, register_and_login


@pytest.mark.asyncio
async def test_add_voice_sample(client):
    await register_and_login(client, email="vs1@test.com")
    brand = await create_brand(client, name="Acme", prompts=["q"])
    r = await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "CEO blog post", "text": "x" * 200},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "CEO blog post"
    assert body["index"] == 0


@pytest.mark.asyncio
async def test_list_voice_samples(client):
    await register_and_login(client, email="vs2@test.com")
    brand = await create_brand(client, name="Acme", prompts=["q"])
    await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "A", "text": "x" * 200},
    )
    await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "B", "text": "y" * 200},
    )
    r = await client.get(f"/api/brands/{brand['id']}/voice-samples")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2
    # Most-recent-first: "B" was added last → index 0
    assert body[0]["title"] == "B"
    assert body[0]["index"] == 0
    assert body[1]["title"] == "A"
    assert body[1]["index"] == 1


@pytest.mark.asyncio
async def test_delete_voice_sample_by_index(client):
    await register_and_login(client, email="vs3@test.com")
    brand = await create_brand(client, name="Acme", prompts=["q"])
    await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "Keep", "text": "x" * 200},
    )
    await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "Delete", "text": "y" * 200},
    )
    # After two adds, "Delete" is at index 0 (most recent), "Keep" at index 1
    r = await client.delete(f"/api/brands/{brand['id']}/voice-samples/0")
    assert r.status_code == 204
    list_r = await client.get(f"/api/brands/{brand['id']}/voice-samples")
    body = list_r.json()
    assert len(body) == 1
    assert body[0]["title"] == "Keep"


@pytest.mark.asyncio
async def test_voice_sample_cap_is_3(client):
    await register_and_login(client, email="vs4@test.com")
    brand = await create_brand(client, name="Acme", prompts=["q"])
    for i in range(3):
        r = await client.post(
            f"/api/brands/{brand['id']}/voice-samples",
            json={"title": f"T{i}", "text": "x" * 200},
        )
        assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/brands/{brand['id']}/voice-samples",
        json={"title": "Over", "text": "x" * 200},
    )
    assert r.status_code == 400
