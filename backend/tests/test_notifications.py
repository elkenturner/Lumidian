"""
Tests for the notifications router.

Covers:
- GET  /api/notifications          — list + unread count
- POST /api/notifications/read-all — mark all as read
- POST /api/notifications/{id}/read — mark one as read
- Multi-tenancy: users only see their own notifications
"""
from __future__ import annotations

from sqlalchemy import text

from tests.conftest import AsyncSessionLocal, register_and_login

# ── Helpers ──────────────────────────────────────────────────────────────────

async def _insert_notification(
    user_id: int,
    title: str = "Test notification",
    type_: str = "info",
    read: bool = False,
    body: str | None = None,
    link: str | None = None,
) -> int:
    """Insert a notification directly and return its id."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                "INSERT INTO notifications (user_id, type, title, body, link, read, created_at) "
                "VALUES (:uid, :type, :title, :body, :link, :read, datetime('now')) "
                "RETURNING id"
            ),
            {"uid": user_id, "type": type_, "title": title, "body": body, "link": link, "read": read},
        )
        nid = result.scalar_one()
        await db.commit()
        return nid


async def _get_user_id(email: str = "user@example.com") -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})
        return result.scalar_one()


# ── GET /api/notifications ───────────────────────────────────────────────────

async def test_get_notifications_empty(client):
    await register_and_login(client)
    resp = await client.get("/api/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert data["notifications"] == []
    assert data["unread_count"] == 0


async def test_get_notifications_returns_items(client):
    await register_and_login(client)
    uid = await _get_user_id()
    await _insert_notification(uid, title="First", read=False)
    await _insert_notification(uid, title="Second", read=True)

    resp = await client.get("/api/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["notifications"]) == 2
    assert data["unread_count"] == 1


async def test_get_notifications_limited_to_20(client):
    await register_and_login(client)
    uid = await _get_user_id()
    for i in range(25):
        await _insert_notification(uid, title=f"Notif {i}")

    resp = await client.get("/api/notifications")
    assert resp.status_code == 200
    assert len(resp.json()["notifications"]) == 20


async def test_get_notifications_requires_auth(client):
    resp = await client.get("/api/notifications")
    assert resp.status_code == 401


# ── Multi-tenancy ────────────────────────────────────────────────────────────

async def test_notifications_isolation(client):
    """User A cannot see User B's notifications."""
    await register_and_login(client, email="a@example.com")
    uid_a = await _get_user_id("a@example.com")
    await _insert_notification(uid_a, title="A's notification")

    # Register and login as user B
    await register_and_login(client, email="b@example.com")
    uid_b = await _get_user_id("b@example.com")
    await _insert_notification(uid_b, title="B's notification")

    resp = await client.get("/api/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["notifications"]) == 1
    assert data["notifications"][0]["title"] == "B's notification"


# ── POST /api/notifications/read-all ─────────────────────────────────────────

async def test_mark_all_read(client):
    await register_and_login(client)
    uid = await _get_user_id()
    await _insert_notification(uid, title="Unread 1")
    await _insert_notification(uid, title="Unread 2")

    resp = await client.post("/api/notifications/read-all")
    assert resp.status_code == 200
    data = resp.json()
    assert data["unread_count"] == 0
    assert all(n["read"] for n in data["notifications"])


async def test_mark_all_read_only_affects_own(client):
    """Mark-all-read should not touch another user's notifications."""
    await register_and_login(client, email="owner@example.com")
    uid_owner = await _get_user_id("owner@example.com")
    await _insert_notification(uid_owner, title="Owner notif")

    await register_and_login(client, email="other@example.com")
    uid_other = await _get_user_id("other@example.com")
    await _insert_notification(uid_other, title="Other notif")

    # Other marks all read
    await client.post("/api/notifications/read-all")

    # Verify owner's notification is still unread by checking DB directly
    # (can't re-register an existing user within the same test)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT read FROM notifications WHERE user_id = :uid"),
            {"uid": uid_owner},
        )
        row = result.scalar_one_or_none()
        assert row is not None
        assert row == 0  # still unread (SQLite stores False as 0)


# ── POST /api/notifications/{id}/read ────────────────────────────────────────

async def test_mark_one_read(client):
    await register_and_login(client)
    uid = await _get_user_id()
    nid = await _insert_notification(uid, title="Read me")

    resp = await client.post(f"/api/notifications/{nid}/read")
    assert resp.status_code == 200
    data = resp.json()
    assert data["read"] is True
    assert data["title"] == "Read me"


async def test_mark_one_read_not_found(client):
    await register_and_login(client)
    resp = await client.post("/api/notifications/99999/read")
    assert resp.status_code == 404


async def test_mark_one_read_other_user(client):
    """Cannot mark another user's notification as read."""
    await register_and_login(client, email="victim@example.com")
    uid_victim = await _get_user_id("victim@example.com")
    nid = await _insert_notification(uid_victim, title="Victim notif")

    await register_and_login(client, email="attacker@example.com")
    resp = await client.post(f"/api/notifications/{nid}/read")
    assert resp.status_code == 404


async def test_notification_response_shape(client):
    """Verify all expected fields are present in notification output."""
    await register_and_login(client)
    uid = await _get_user_id()
    await _insert_notification(uid, title="Shape test", body="A body", link="/reports", type_="report_ready")

    resp = await client.get("/api/notifications")
    n = resp.json()["notifications"][0]
    assert set(n.keys()) >= {"id", "type", "title", "body", "link", "read", "created_at"}
    assert n["type"] == "report_ready"
    assert n["body"] == "A body"
    assert n["link"] == "/reports"
