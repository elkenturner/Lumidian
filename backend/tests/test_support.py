"""
Tests for the support router.

Covers:
- POST /api/support/contact  — submit support request
- Validation (empty subject, empty message, length limits)
- Email failure handling
- Auth requirement
"""
from __future__ import annotations

from unittest.mock import patch

from tests.conftest import register_and_login

# ── POST /api/support/contact — success ──────────────────────────────────────

async def test_submit_support_request_success(client):
    await register_and_login(client)
    with patch("app.services.email_service.send_support_request_email") as mock_email:
        resp = await client.post(
            "/api/support/contact",
            json={"subject": "Help needed", "message": "I have a question about billing."},
        )
    assert resp.status_code == 204
    mock_email.assert_called_once()
    call_kwargs = mock_email.call_args
    assert call_kwargs[1]["subject"] == "Help needed" or call_kwargs[0][2] == "Help needed"


async def test_submit_support_passes_user_info(client):
    await register_and_login(client, email="ken@test.com")
    with patch("app.services.email_service.send_support_request_email") as mock_email:
        await client.post(
            "/api/support/contact",
            json={"subject": "Test", "message": "Hello"},
        )
    args, kwargs = mock_email.call_args
    # The email service receives from_email matching the logged-in user
    assert "ken@test.com" in str(args) + str(kwargs)


# ── Auth required ────────────────────────────────────────────────────────────

async def test_submit_support_requires_auth(client):
    resp = await client.post(
        "/api/support/contact",
        json={"subject": "Help", "message": "Please help"},
    )
    assert resp.status_code == 401


# ── Validation ───────────────────────────────────────────────────────────────

async def test_submit_support_empty_subject(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/support/contact",
        json={"subject": "   ", "message": "Valid message"},
    )
    assert resp.status_code == 422


async def test_submit_support_empty_message(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/support/contact",
        json={"subject": "Valid subject", "message": "   "},
    )
    assert resp.status_code == 422


async def test_submit_support_subject_too_long(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/support/contact",
        json={"subject": "X" * 201, "message": "Valid message"},
    )
    assert resp.status_code == 422


async def test_submit_support_message_too_long(client):
    await register_and_login(client)
    resp = await client.post(
        "/api/support/contact",
        json={"subject": "Valid", "message": "X" * 5001},
    )
    assert resp.status_code == 422


async def test_submit_support_missing_fields(client):
    await register_and_login(client)
    resp = await client.post("/api/support/contact", json={})
    assert resp.status_code == 422


# ── Email service failure ────────────────────────────────────────────────────

async def test_submit_support_email_failure(client):
    await register_and_login(client)
    with patch(
        "app.services.email_service.send_support_request_email",
        side_effect=Exception("SMTP down"),
    ):
        resp = await client.post(
            "/api/support/contact",
            json={"subject": "Help", "message": "My message"},
        )
    assert resp.status_code == 500
    assert "Failed to send" in resp.json()["detail"]
