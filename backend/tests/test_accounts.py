"""
Tests for the accounts router.

Covers:
- GET    /api/accounts              — list all connections
- POST   /api/accounts/connect      — connect / update account
- GET    /api/accounts/{platform}   — get specific account
- DELETE /api/accounts/{platform}   — disconnect account
- GET    /api/settings/api-keys     — API key status
- Validation (unsupported platforms)
- Authentication required on all endpoints
"""
from __future__ import annotations

import os
from unittest.mock import patch

from tests.conftest import register_and_login


# ── Authentication required ─────────────────────────────────────────────────

async def test_accounts_require_auth(client):
    """All account endpoints should return 401 without authentication."""
    assert (await client.get("/api/accounts")).status_code == 401
    assert (await client.post("/api/accounts/connect", json={"platform": "reddit", "credentials": {}})).status_code == 401
    assert (await client.get("/api/accounts/reddit")).status_code == 401
    assert (await client.delete("/api/accounts/reddit")).status_code == 401
    assert (await client.get("/api/settings/api-keys")).status_code == 401


# ── GET /api/accounts — empty ────────────────────────────────────────────────

async def test_list_accounts_empty(client):
    await register_and_login(client)
    resp = await client.get("/api/accounts")
    assert resp.status_code == 200
    assert resp.json() == []


# ── POST /api/accounts/connect ───────────────────────────────────────────────

async def test_connect_reddit_account(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "testuser", "password": "secret"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["platform"] == "reddit"
    assert data["status"] == "connected"
    assert data["display_name"] == "testuser"


async def test_connect_extracts_display_name_from_email(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/accounts/connect",
        json={"platform": "medium", "credentials": {"email": "writer@blog.com"}},
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "writer@blog.com"


async def test_connect_unsupported_platform(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/accounts/connect",
        json={"platform": "tiktok", "credentials": {"token": "abc"}},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    # Pydantic validator returns list of errors with "platform must be one of" message
    assert any("platform must be one of" in str(e.get("msg", "")) for e in detail)


async def test_connect_update_existing(client):
    """Connecting the same platform twice should update, not duplicate."""
    await register_and_login(client)
    await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "old_user"}},
    )
    resp = await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "new_user"}},
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "new_user"

    # Should still be just one account
    listing = await client.get("/api/accounts")
    assert len(listing.json()) == 1


async def test_connect_all_supported_platforms(client):
    """All four supported platforms should be connectable."""
    await register_and_login(client)
    for platform in ["reddit", "quora", "medium", "wikipedia"]:
        resp = await client.post(
            "/api/accounts/connect",
            json={"platform": platform, "credentials": {"username": f"{platform}_user"}},
        )
        assert resp.status_code == 200, f"Failed for {platform}"


# ── GET /api/accounts — with data ────────────────────────────────────────────

async def test_list_accounts_returns_connected(client):
    await register_and_login(client)
    await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "u1"}},
    )
    await client.post(
        "/api/accounts/connect",
        json={"platform": "quora", "credentials": {"username": "u2"}},
    )
    resp = await client.get("/api/accounts")
    assert resp.status_code == 200
    platforms = {a["platform"] for a in resp.json()}
    assert platforms == {"reddit", "quora"}


# ── GET /api/accounts/{platform} ─────────────────────────────────────────────

async def test_get_specific_account(client):
    await register_and_login(client)
    await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "redditor"}},
    )
    resp = await client.get("/api/accounts/reddit")
    assert resp.status_code == 200
    assert resp.json()["platform"] == "reddit"
    assert resp.json()["display_name"] == "redditor"


async def test_get_specific_account_not_found(client):
    await register_and_login(client)
    resp = await client.get("/api/accounts/reddit")
    assert resp.status_code == 404


# ── DELETE /api/accounts/{platform} ──────────────────────────────────────────

async def test_disconnect_account(client):
    await register_and_login(client)
    await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "redditor"}},
    )
    resp = await client.delete("/api/accounts/reddit")
    assert resp.status_code == 204

    # Should still exist but disconnected
    get_resp = await client.get("/api/accounts/reddit")
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "disconnected"
    assert get_resp.json()["display_name"] is None


async def test_disconnect_nonexistent(client):
    await register_and_login(client)
    resp = await client.delete("/api/accounts/reddit")
    assert resp.status_code == 404


# ── GET /api/settings/api-keys ───────────────────────────────────────────────

async def test_api_key_status_none_configured(client):
    """When no LLM keys are set, all should be False."""
    await register_and_login(client)
    with patch.dict(os.environ, {
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "PERPLEXITY_API_KEY": "",
        "GEMINI_API_KEY": "",
    }):
        resp = await client.get("/api/settings/api-keys")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"openai": False, "anthropic": False, "perplexity": False, "gemini": False}


async def test_api_key_status_some_configured(client):
    await register_and_login(client)
    with patch.dict(os.environ, {
        "OPENAI_API_KEY": "sk-test",
        "ANTHROPIC_API_KEY": "",
        "PERPLEXITY_API_KEY": "pplx-test",
        "GEMINI_API_KEY": "",
    }):
        resp = await client.get("/api/settings/api-keys")
    assert resp.status_code == 200
    data = resp.json()
    assert data["openai"] is True
    assert data["anthropic"] is False
    assert data["perplexity"] is True
    assert data["gemini"] is False


async def test_api_key_status_never_exposes_values(client):
    """API key endpoint must only return booleans, never actual key values."""
    await register_and_login(client)
    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-super-secret-key"}):
        resp = await client.get("/api/settings/api-keys")
    data = resp.json()
    for v in data.values():
        assert isinstance(v, bool), "API key values must be boolean"
    assert "sk-super-secret-key" not in str(data)


# ── Response shape ───────────────────────────────────────────────────────────

async def test_account_response_shape(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/accounts/connect",
        json={"platform": "reddit", "credentials": {"username": "test"}},
    )
    data = resp.json()
    expected_keys = {"id", "platform", "status", "display_name", "connected_at", "last_verified_at", "error_message", "created_at", "updated_at"}
    assert set(data.keys()) >= expected_keys
