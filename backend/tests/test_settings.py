"""
Tests for the settings router.

Covers:
- GET  /api/settings/scheduler  — get scheduler status
- POST /api/settings/scheduler  — pause / resume scheduler (admin only)
- State persistence across calls
"""
from __future__ import annotations

from tests.conftest import register_and_login

# Admin helper — uses the admin@test.com address from conftest ADMIN_EMAILS
ADMIN_EMAIL = "admin@test.com"
ADMIN_PASS = "AdminPass123"


async def _login_admin(client):
    """Register and log in as an admin user."""
    await register_and_login(client, email=ADMIN_EMAIL, password=ADMIN_PASS)


# ── GET /api/settings/scheduler ──────────────────────────────────────────────

async def test_scheduler_default_active(client):
    """Scheduler should be active by default (no SystemSetting row exists)."""
    await register_and_login(client)
    resp = await client.get("/api/settings/scheduler")
    assert resp.status_code == 200
    data = resp.json()
    assert data["paused"] is False
    assert data["status"] == "active"


# ── POST /api/settings/scheduler — pause ─────────────────────────────────────

async def test_pause_scheduler(client):
    await _login_admin(client)
    resp = await client.post("/api/settings/scheduler", json={"paused": True})
    assert resp.status_code == 200
    data = resp.json()
    assert data["paused"] is True
    assert data["status"] == "paused"


async def test_pause_persists(client):
    """After pausing, GET should reflect the new state."""
    await _login_admin(client)
    await client.post("/api/settings/scheduler", json={"paused": True})
    resp = await client.get("/api/settings/scheduler")
    assert resp.status_code == 200
    assert resp.json()["paused"] is True


# ── POST /api/settings/scheduler — resume ────────────────────────────────────

async def test_resume_scheduler(client):
    await _login_admin(client)
    await client.post("/api/settings/scheduler", json={"paused": True})
    resp = await client.post("/api/settings/scheduler", json={"paused": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["paused"] is False
    assert data["status"] == "active"


async def test_resume_persists(client):
    await _login_admin(client)
    await client.post("/api/settings/scheduler", json={"paused": True})
    await client.post("/api/settings/scheduler", json={"paused": False})
    resp = await client.get("/api/settings/scheduler")
    assert resp.json()["paused"] is False


# ── Idempotent operations ────────────────────────────────────────────────────

async def test_pause_twice_is_idempotent(client):
    await _login_admin(client)
    await client.post("/api/settings/scheduler", json={"paused": True})
    resp = await client.post("/api/settings/scheduler", json={"paused": True})
    assert resp.status_code == 200
    assert resp.json()["paused"] is True


async def test_resume_without_pause(client):
    """Resuming when already active should succeed."""
    await _login_admin(client)
    resp = await client.post("/api/settings/scheduler", json={"paused": False})
    assert resp.status_code == 200
    assert resp.json()["paused"] is False


# ── Validation ───────────────────────────────────────────────────────────────

async def test_scheduler_missing_body(client):
    await _login_admin(client)
    resp = await client.post("/api/settings/scheduler", json={})
    assert resp.status_code == 422


async def test_scheduler_invalid_body(client):
    await _login_admin(client)
    resp = await client.post("/api/settings/scheduler", json={"paused": "not-a-bool"})
    assert resp.status_code == 422


# ── Non-admin cannot pause ────────────────────────────────────────────────────

async def test_non_admin_cannot_pause(client):
    """Regular users should get 403 when trying to pause the scheduler."""
    await register_and_login(client)
    resp = await client.post("/api/settings/scheduler", json={"paused": True})
    assert resp.status_code == 403
