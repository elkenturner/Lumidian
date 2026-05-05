"""
Tests for the brand_profile router.

Covers:
- GET  /api/brands/{id}/profile     — get (auto-creates if missing)
- PUT  /api/brands/{id}/profile     — update fields
- Completion percentage calculation
- Ownership isolation
- JSON parsing edge cases
"""
from __future__ import annotations

from tests.conftest import create_brand, register_and_login

# ── GET /api/brands/{id}/profile ─────────────────────────────────────────────

async def test_get_profile_creates_if_missing(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_id"] == brand["id"]
    assert data["company_description"] is None
    assert data["key_stats"] == []
    assert data["completion_pct"] == 0.0


async def test_get_profile_idempotent(client):
    """Calling GET twice should return the same profile (not create duplicates)."""
    await register_and_login(client)
    brand = await create_brand(client)

    resp1 = await client.get(f"/api/brands/{brand['id']}/profile")
    resp2 = await client.get(f"/api/brands/{brand['id']}/profile")
    assert resp1.json()["id"] == resp2.json()["id"]


async def test_get_profile_requires_auth(client):
    resp = await client.get("/api/brands/1/profile")
    assert resp.status_code == 401


async def test_get_profile_nonexistent_brand(client):
    await register_and_login(client)
    resp = await client.get("/api/brands/99999/profile")
    assert resp.status_code == 404


# ── PUT /api/brands/{id}/profile ─────────────────────────────────────────────

async def test_update_profile_company_description(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "We build AI tools."},
    )
    assert resp.status_code == 200
    assert resp.json()["company_description"] == "We build AI tools."


async def test_update_profile_key_stats(client):
    await register_and_login(client)
    brand = await create_brand(client)

    stats = ["100K users", "$10M ARR", "Founded 2020"]
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"key_stats": stats},
    )
    assert resp.status_code == 200
    assert resp.json()["key_stats"] == stats


async def test_update_profile_tone_of_voice(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"tone_of_voice": "Professional but approachable"},
    )
    assert resp.status_code == 200
    assert resp.json()["tone_of_voice"] == "Professional but approachable"


async def test_update_profile_what_not_to_say(client):
    await register_and_login(client)
    brand = await create_brand(client)

    items = ["Never mention competitors by name", "Avoid jargon"]
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"what_not_to_say": items},
    )
    assert resp.status_code == 200
    assert resp.json()["what_not_to_say"] == items


async def test_update_profile_approved_language(client):
    await register_and_login(client)
    brand = await create_brand(client)

    terms = ["AI-powered", "enterprise-grade", "scalable"]
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"approved_language": terms},
    )
    assert resp.status_code == 200
    assert resp.json()["approved_language"] == terms


async def test_update_profile_publications(client):
    await register_and_login(client)
    brand = await create_brand(client)

    pubs = [
        {"url": "https://blog.example.com/post-1", "title": "Our Journey", "publisher": "Company Blog", "date": "2024-01-15"},
    ]
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"publications": pubs},
    )
    assert resp.status_code == 200
    assert len(resp.json()["publications"]) == 1
    assert resp.json()["publications"][0]["title"] == "Our Journey"


async def test_update_multiple_fields_at_once(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={
            "company_description": "We do things.",
            "tone_of_voice": "Casual",
            "what_not_to_say": ["never lie"],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["company_description"] == "We do things."
    assert data["tone_of_voice"] == "Casual"
    assert data["what_not_to_say"] == ["never lie"]


async def test_update_preserves_existing_fields(client):
    """Updating one field should not wipe another."""
    await register_and_login(client)
    brand = await create_brand(client)

    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "First"},
    )
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"tone_of_voice": "Friendly"},
    )
    data = resp.json()
    assert data["company_description"] == "First"
    assert data["tone_of_voice"] == "Friendly"


# ── Completion percentage ────────────────────────────────────────────────────

async def test_completion_zero_when_empty(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert resp.json()["completion_pct"] == 0.0


async def test_completion_increases_with_fields(client):
    await register_and_login(client)
    brand = await create_brand(client)

    # Fill 3 of 6 fields
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={
            "company_description": "Desc",
            "tone_of_voice": "Tone",
            "key_stats": ["stat1"],
        },
    )
    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    pct = resp.json()["completion_pct"]
    # 3/6 = 50.0%
    assert pct == 50.0


async def test_completion_100_when_all_filled(client):
    await register_and_login(client)
    brand = await create_brand(client)

    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={
            "company_description": "Full description",
            "key_stats": ["stat1"],
            "tone_of_voice": "Professional",
            "what_not_to_say": ["nothing bad"],
            "approved_language": ["term1"],
            "publications": [{"url": "https://example.com", "title": "T", "publisher": "P", "date": "2024"}],
        },
    )
    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert resp.json()["completion_pct"] == 100.0


# ── Ownership isolation ──────────────────────────────────────────────────────

async def test_cannot_access_other_users_brand_profile(client):
    await register_and_login(client, email="owner@example.com")
    brand = await create_brand(client, name="Owner Brand")

    await register_and_login(client, email="intruder@example.com")
    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert resp.status_code == 403


async def test_cannot_update_other_users_brand_profile(client):
    await register_and_login(client, email="owner2@example.com")
    brand = await create_brand(client, name="Owner2 Brand")

    await register_and_login(client, email="intruder2@example.com")
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "Hijacked"},
    )
    assert resp.status_code == 403


# ── Response shape ───────────────────────────────────────────────────────────

async def test_profile_response_shape(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.get(f"/api/brands/{brand['id']}/profile")
    data = resp.json()
    expected_keys = {
        "id", "brand_id", "company_description", "key_stats",
        "tone_of_voice", "what_not_to_say",
        "approved_language", "publications", "completion_pct",
        "internal_brand_context", "website_context_last_fetched",
        "created_at", "updated_at",
    }
    assert set(data.keys()) >= expected_keys
