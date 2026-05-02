"""
Tests for brand CRUD endpoints and multi-tenant ownership isolation:
  GET/POST/PUT/DELETE /api/brands
  POST/DELETE /api/brands/{id}/prompts
  GET/POST/DELETE /api/brands/{id}/competitors
  Ownership: user A cannot access user B's brand
"""
import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


# ── List brands ───────────────────────────────────────────────────────────────

async def test_list_brands_empty(client: httpx.AsyncClient):
    await register_and_login(client, email="list@example.com")
    resp = await client.get("/api/brands")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_brands_unauthenticated(client: httpx.AsyncClient):
    resp = await client.get("/api/brands")
    assert resp.status_code == 401


# ── Create brand ──────────────────────────────────────────────────────────────

async def test_create_brand_success(client: httpx.AsyncClient):
    await register_and_login(client, email="create@example.com")
    resp = await client.post(
        "/api/brands",
        json={"name": "Acme Corp", "tier": "basic", "website_url": "https://acme.com", "prompts": ["Best CRM tools?"]},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Acme Corp"
    assert data["slug"] == "acme-corp"
    assert len(data["prompts"]) == 1


async def test_create_brand_slugifies_name(client: httpx.AsyncClient):
    await register_and_login(client, email="slug@example.com")
    resp = await client.post(
        "/api/brands",
        json={"name": "Hello World! 123", "tier": "basic", "website_url": "https://helloworld.com", "prompts": []},
    )
    assert resp.status_code == 201
    assert resp.json()["slug"] == "hello-world-123"


async def test_create_brand_duplicate_slug(client: httpx.AsyncClient):
    # Use a starter user (allows 1 standard brand) + free user for slug collision test
    await register_and_login(client, email="dupslug@example.com", subscription_tier="starter")
    resp1 = await client.post(
        "/api/brands",
        json={"name": "Duplicate Brand", "tier": "basic", "website_url": "https://duplicate1.com", "prompts": []},
    )
    assert resp1.status_code == 201, resp1.text
    # Second brand with same name from a different user should get 409 (slug conflict)
    await register_and_login(client, email="dupslug2@example.com", subscription_tier="starter")
    resp = await client.post(
        "/api/brands",
        json={"name": "Duplicate Brand", "tier": "basic", "website_url": "https://duplicate2.com", "prompts": []},
    )
    assert resp.status_code == 409


async def test_create_brand_multiple_prompts(client: httpx.AsyncClient):
    await register_and_login(client, email="mprompts@example.com")
    resp = await client.post(
        "/api/brands",
        json={
            "name": "Multi Prompt Co",
            "tier": "basic",
            "website_url": "https://multiprompt.com",
            "prompts": ["Prompt A", "Prompt B", "Prompt C"],
        },
    )
    assert resp.status_code == 201
    assert len(resp.json()["prompts"]) == 3


# ── Get brand ─────────────────────────────────────────────────────────────────

async def test_get_brand_success(client: httpx.AsyncClient):
    await register_and_login(client, email="get@example.com")
    brand = await create_brand(client, name="Get Brand")
    resp = await client.get(f"/api/brands/{brand['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == brand["id"]


async def test_get_brand_not_found(client: httpx.AsyncClient):
    await register_and_login(client, email="notfound@example.com")
    resp = await client.get("/api/brands/99999")
    assert resp.status_code == 404


# ── Update brand ──────────────────────────────────────────────────────────────

async def test_update_brand_name(client: httpx.AsyncClient):
    await register_and_login(client, email="update@example.com")
    brand = await create_brand(client, name="Old Name")
    resp = await client.put(
        f"/api/brands/{brand['id']}",
        json={"name": "New Name"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


async def test_update_brand_website(client: httpx.AsyncClient):
    await register_and_login(client, email="website@example.com")
    brand = await create_brand(client)
    resp = await client.put(
        f"/api/brands/{brand['id']}",
        json={"website_url": "https://example.com"},
    )
    assert resp.status_code == 200
    assert resp.json()["website_url"] == "https://example.com"


# ── Delete brand ──────────────────────────────────────────────────────────────

async def test_delete_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="delete@example.com")
    brand = await create_brand(client, name="Delete Me")
    resp = await client.delete(f"/api/brands/{brand['id']}")
    assert resp.status_code == 204

    # Confirm gone
    resp = await client.get(f"/api/brands/{brand['id']}")
    assert resp.status_code == 404


# ── Multi-tenant ownership isolation ─────────────────────────────────────────

async def test_user_b_cannot_read_user_a_brand(client: httpx.AsyncClient):
    """User A creates a brand. User B should get 403 when trying to access it."""
    # User A
    await register_and_login(client, email="usera@example.com")
    brand = await create_brand(client, name="User A Brand")
    brand_id = brand["id"]

    # User B logs in (overwriting cookies)
    await register_and_login(client, email="userb@example.com")

    resp = await client.get(f"/api/brands/{brand_id}")
    assert resp.status_code == 403


async def test_user_b_cannot_update_user_a_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="usera2@example.com")
    brand = await create_brand(client, name="A Brand 2")
    brand_id = brand["id"]

    await register_and_login(client, email="userb2@example.com")
    resp = await client.put(f"/api/brands/{brand_id}", json={"name": "Hacked"})
    assert resp.status_code == 403


async def test_user_b_cannot_delete_user_a_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="usera3@example.com")
    brand = await create_brand(client, name="A Brand 3")
    brand_id = brand["id"]

    await register_and_login(client, email="userb3@example.com")
    resp = await client.delete(f"/api/brands/{brand_id}")
    assert resp.status_code == 403


async def test_user_only_sees_own_brands(client: httpx.AsyncClient):
    """List endpoint returns only the authenticated user's brands."""
    await register_and_login(client, email="owner@example.com")
    await create_brand(client, name="Owner Brand")

    await register_and_login(client, email="other@example.com")
    await create_brand(client, name="Other Brand")

    # other@example.com should only see "Other Brand"
    resp = await client.get("/api/brands")
    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()]
    assert "Other Brand" in names
    assert "Owner Brand" not in names


# ── Prompts ───────────────────────────────────────────────────────────────────

async def test_add_prompt(client: httpx.AsyncClient):
    await register_and_login(client, email="addprompt@example.com")
    brand = await create_brand(client, name="Prompt Brand", prompts=[])
    resp = await client.post(
        f"/api/brands/{brand['id']}/prompts",
        json={"text": "What is the best option?"},
    )
    assert resp.status_code == 201
    assert resp.json()["text"] == "What is the best option?"


async def test_add_empty_prompt_rejected(client: httpx.AsyncClient):
    await register_and_login(client, email="emptyprompt@example.com")
    brand = await create_brand(client, name="Empty Prompt Brand", prompts=[])
    resp = await client.post(
        f"/api/brands/{brand['id']}/prompts",
        json={"text": "   "},
    )
    assert resp.status_code == 422


async def test_delete_prompt(client: httpx.AsyncClient):
    await register_and_login(client, email="delprompt@example.com")
    brand = await create_brand(client, name="Del Prompt Brand", prompts=["Delete me"])
    prompt_id = brand["prompts"][0]["id"]

    resp = await client.delete(f"/api/brands/{brand['id']}/prompts/{prompt_id}")
    assert resp.status_code == 204


async def test_user_b_cannot_add_prompt_to_user_a_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="owner_prompt@example.com")
    brand = await create_brand(client, name="Owned Prompt Brand", prompts=[])

    await register_and_login(client, email="intruder_prompt@example.com")
    resp = await client.post(
        f"/api/brands/{brand['id']}/prompts",
        json={"text": "Hacked prompt"},
    )
    assert resp.status_code == 403


# ── Competitors ───────────────────────────────────────────────────────────────

async def test_add_and_list_competitors(client: httpx.AsyncClient):
    await register_and_login(client, email="comp@example.com")
    brand = await create_brand(client, name="Comp Brand")

    resp = await client.post(
        f"/api/brands/{brand['id']}/competitors",
        json={"name": "Rival Corp"},
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Rival Corp"

    resp = await client.get(f"/api/brands/{brand['id']}/competitors")
    assert resp.status_code == 200
    assert any(c["name"] == "Rival Corp" for c in resp.json())


async def test_delete_competitor(client: httpx.AsyncClient):
    await register_and_login(client, email="delcomp@example.com")
    brand = await create_brand(client, name="Del Comp Brand")
    resp = await client.post(
        f"/api/brands/{brand['id']}/competitors",
        json={"name": "Old Rival"},
    )
    competitor_id = resp.json()["id"]

    resp = await client.delete(
        f"/api/brands/{brand['id']}/competitors/{competitor_id}"
    )
    assert resp.status_code == 204


async def test_competitor_access_control(client: httpx.AsyncClient):
    await register_and_login(client, email="compa@example.com")
    brand = await create_brand(client, name="Comp Control Brand")

    await register_and_login(client, email="compb@example.com")
    resp = await client.get(f"/api/brands/{brand['id']}/competitors")
    assert resp.status_code == 403


# ── Brand Profile: market_scope and geography ─────────────────────────────────

async def test_brand_profile_persists_market_scope_and_geography(client: httpx.AsyncClient):
    await register_and_login(client, email="scope_persist@example.com")
    brand = await create_brand(client, name="Scope Brand")

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"market_scope": "local", "geography": "Portland, OR"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["market_scope"] == "local"
    assert resp.json()["geography"] == "Portland, OR"

    # Round-trip via GET
    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert get_resp.status_code == 200
    assert get_resp.json()["market_scope"] == "local"
    assert get_resp.json()["geography"] == "Portland, OR"


async def test_brand_profile_rejects_invalid_market_scope(client: httpx.AsyncClient):
    await register_and_login(client, email="scope_bad@example.com")
    brand = await create_brand(client, name="Bad Scope")
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"market_scope": "interplanetary"},
    )
    assert resp.status_code == 422


# ── Question-mark enforcement on suggested prompts ────────────────────────────


def _mock_anthropic_returning(json_text: str):
    """Patch context manager that makes anthropic.AsyncAnthropic return json_text from messages.create."""
    msg = MagicMock()
    msg.content = [MagicMock(text=json_text)]
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=msg)
    return patch("anthropic.AsyncAnthropic", return_value=fake_client), patch.dict(
        "os.environ", {"ANTHROPIC_API_KEY": "test-key"}
    )


@pytest.mark.asyncio
async def test_suggest_prompts_appends_missing_question_mark(client: httpx.AsyncClient):
    await register_and_login(client, email="qmark@example.com")
    brand = await create_brand(client, name="QMark Brand")

    bad_payload = '["Best CRM for startups", "Top sales tools.", "Comparison of A and B!"]'
    anth_patch, env_patch = _mock_anthropic_returning(bad_payload)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/suggest-prompts")
    assert resp.status_code == 200, resp.text
    suggestions = resp.json()
    assert len(suggestions) == 3
    for s in suggestions:
        assert s.endswith("?"), f"Suggestion missing '?': {s!r}"
    # Trailing punctuation should be cleaned, not duplicated
    assert "?" in suggestions[1] and not suggestions[1].endswith(".?")
    assert not suggestions[2].endswith("!?")


@pytest.mark.asyncio
async def test_suggest_prompts_preview_appends_missing_question_mark(client: httpx.AsyncClient):
    await register_and_login(client, email="qmark2@example.com")
    bad_payload = '["What about X", "Y comparison"]'
    anth_patch, env_patch = _mock_anthropic_returning(bad_payload)
    with anth_patch, env_patch:
        resp = await client.post(
            "/api/brands/suggest-prompts-preview",
            json={"name": "Acme", "description": "", "website_context": ""},
        )
    assert resp.status_code == 200, resp.text
    for s in resp.json():
        assert s.endswith("?")
