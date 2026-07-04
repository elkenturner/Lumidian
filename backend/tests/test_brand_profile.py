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

from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import create_brand, register_and_login


def _mock_anthropic_returning(json_text: str):
    """Patch context manager that makes anthropic.AsyncAnthropic return json_text from messages.create."""
    msg = MagicMock()
    msg.content = [MagicMock(text=json_text)]
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=msg)
    return patch("anthropic.AsyncAnthropic", return_value=fake_client), patch.dict(
        "os.environ", {"ANTHROPIC_API_KEY": "test-key"}
    )

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

    # Fill 3 of 7 fields (company_description, tone_of_voice, key_stats,
    # target_audience are counted; target_audience left blank here)
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
    # 3/7 = 42.9%
    assert pct == 42.9


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
            "target_audience": "mid-market trucking ops leaders",
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
        "created_at", "updated_at", "target_audience",
    }
    assert set(data.keys()) >= expected_keys


# ── Blank-overwrite guard + clear_fields ─────────────────────────────────────

async def test_put_empty_does_not_wipe_filled_field(client):
    """Filling company_description via PUT, then PUTting an empty string,
    must not wipe the stored value (2026-07-04 blank-overwrite incident)."""
    await register_and_login(client)
    brand = await create_brand(client)

    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "We build AI tools."},
    )
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": ""},
    )
    assert resp.status_code == 200
    assert resp.json()["company_description"] == "We build AI tools."


async def test_put_clear_fields_explicitly_wipes(client):
    """When the client explicitly lists a field in clear_fields, an empty
    incoming value DOES overwrite a non-empty stored value."""
    await register_and_login(client)
    brand = await create_brand(client)

    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "We build AI tools."},
    )
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"company_description": "", "clear_fields": ["company_description"]},
    )
    assert resp.status_code == 200
    assert resp.json()["company_description"] == ""


async def test_target_audience_roundtrip(client):
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"target_audience": "mid-market trucking ops leaders"},
    )
    assert resp.status_code == 200
    assert resp.json()["target_audience"] == "mid-market trucking ops leaders"

    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    data = get_resp.json()
    assert data["target_audience"] == "mid-market trucking ops leaders"
    # 1 of 7 fields filled
    assert data["completion_pct"] == 14.3


# ── AI-fill persistence ──────────────────────────────────────────────────────

async def test_ai_fill_persists_into_empty_fields(client):
    """Mock the LLM to return description/tone/key_stats/target_audience.
    POST ai-fill on an empty profile -> GET shows them persisted;
    response.persisted_fields lists all four."""
    await register_and_login(client)
    brand = await create_brand(client)

    # Pre-seed cached website context so ai-fill skips the Jina fetch.
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"internal_brand_context": "Scraped homepage copy about the company."},
    )

    fake_json = (
        '{"company_description": "We build AI tools for logistics.", '
        '"tone_of_voice": "Confident and direct.", '
        '"key_stats": ["100K users", "$10M ARR"], '
        '"target_audience": "mid-market trucking ops leaders"}'
    )
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/profile/ai-fill")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["persisted_fields"]) == {
        "company_description", "tone_of_voice", "key_stats", "target_audience",
    }
    assert body["target_audience"] == "mid-market trucking ops leaders"

    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    data = get_resp.json()
    assert data["company_description"] == "We build AI tools for logistics."
    assert data["tone_of_voice"] == "Confident and direct."
    assert data["key_stats"] == ["100K users", "$10M ARR"]
    assert data["target_audience"] == "mid-market trucking ops leaders"


async def test_ai_fill_never_overwrites_filled_fields(client):
    """Pre-fill tone_of_voice; ai-fill suggests a different tone ->
    stored tone unchanged; persisted_fields excludes tone_of_voice."""
    await register_and_login(client)
    brand = await create_brand(client)

    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={
            "tone_of_voice": "Playful and irreverent",
            "internal_brand_context": "Scraped homepage copy about the company.",
        },
    )

    fake_json = (
        '{"company_description": "We build AI tools for logistics.", '
        '"tone_of_voice": "Serious and formal.", '
        '"key_stats": [], '
        '"target_audience": null}'
    )
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/profile/ai-fill")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "tone_of_voice" not in body["persisted_fields"]
    assert "company_description" in body["persisted_fields"]

    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    data = get_resp.json()
    assert data["tone_of_voice"] == "Playful and irreverent"
    assert data["company_description"] == "We build AI tools for logistics."


async def test_ai_fill_persists_key_stats_over_cleared_empty_list(client):
    """A stored key_stats value of '[]' (from an explicit clear via PUT's
    clear_fields path) must not block ai-fill from persisting newly
    suggested key_stats. The raw-string truthiness check `not profile.key_stats`
    treats the string '[]' as truthy (non-empty), incorrectly blocking writes."""
    await register_and_login(client)
    brand = await create_brand(client)

    # Fill then explicitly clear key_stats, leaving the stored column == "[]"
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"key_stats": ["old stat"]},
    )
    clear_resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"key_stats": [], "clear_fields": ["key_stats"]},
    )
    assert clear_resp.json()["key_stats"] == []

    # Pre-seed cached website context so ai-fill skips the Jina fetch.
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"internal_brand_context": "Scraped homepage copy about the company."},
    )

    fake_json = (
        '{"company_description": null, '
        '"tone_of_voice": null, '
        '"key_stats": ["100K users", "$10M ARR"], '
        '"target_audience": null}'
    )
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/profile/ai-fill")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "key_stats" in body["persisted_fields"]
    assert body["key_stats"] == ["100K users", "$10M ARR"]

    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert get_resp.json()["key_stats"] == ["100K users", "$10M ARR"]


async def test_ai_fill_locked_db_returns_503(client):
    """A 'database is locked' OperationalError raised during ai-fill's
    persistence commit must translate to HTTP 503 (mirroring the
    update_brand_profile PUT handler), not propagate as an unhandled 500."""
    await register_and_login(client)
    brand = await create_brand(client)

    # Pre-seed cached website context so ai-fill skips the Jina fetch, and
    # ensure the profile row already exists so the only commit inside the
    # request is the final persistence commit we're targeting.
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"internal_brand_context": "Scraped homepage copy about the company."},
    )

    fake_json = (
        '{"company_description": "We build AI tools for logistics.", '
        '"tone_of_voice": "Confident and direct.", '
        '"key_stats": ["100K users", "$10M ARR"], '
        '"target_audience": "mid-market trucking ops leaders"}'
    )
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)

    from sqlalchemy.exc import OperationalError
    from sqlalchemy.ext.asyncio import AsyncSession

    async def boom(self, *args, **kwargs):
        raise OperationalError("COMMIT", {}, Exception("database is locked"))

    with anth_patch, env_patch, patch.object(AsyncSession, "commit", boom):
        resp = await client.post(f"/api/brands/{brand['id']}/profile/ai-fill")
    assert resp.status_code == 503, resp.text


async def test_internal_brand_context_writable(client):
    """internal_brand_context is currently only ever written internally
    (Jina fetch, ai-fill); the PUT handler must also accept it directly
    (e.g. onboarding writes it explicitly)."""
    await register_and_login(client)
    brand = await create_brand(client)

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"internal_brand_context": "Scraped homepage copy about the company."},
    )
    assert resp.status_code == 200
    assert resp.json()["internal_brand_context"] == "Scraped homepage copy about the company."

    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert get_resp.json()["internal_brand_context"] == "Scraped homepage copy about the company."
