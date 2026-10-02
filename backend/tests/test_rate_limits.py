"""
Tests for per-user rate limiting.
  - Manual tracking runs: limit 3/min
  - Draft generation: limit 10/min
  - Scan: limit 3/min

Rate limit state is in-memory (_rate_store), so we reset it between tests
by patching check_rate_limit or by directly clearing the store.
"""
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.dependencies import _rate_store, check_rate_limit
from tests.conftest import create_brand, register_and_login, register_user

pytestmark = pytest.mark.asyncio


def _reset_rate_store():
    """Clear the in-memory rate limit store between tests."""
    from app.dependencies import _rate_store
    _rate_store.clear()


async def _complete_pending_runs(db, brand_id: int):
    """Mark all pending/running tracking runs as completed so the concurrent guard doesn't block."""
    from sqlalchemy import update
    from app.models import TrackingRun
    await db.execute(
        update(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status.in_(["pending", "running"]))
        .values(status="completed")
    )
    await db.commit()


async def test_failed_logins_are_rate_limited(client: httpx.AsyncClient):
    """Repeated failed logins (wrong password) must count toward the login
    rate limit and eventually return 429 — this is the core brute-force
    protection. Regression: the DB rate-check used to only flush() its INSERT
    on the request session, which get_db rolled back on every 401, so failed
    attempts were never recorded and /login was never rate-limited.
    """
    from app.routers.auth import _MAX_LOGIN

    await register_user(client, email="bruteforce@example.com", password="CorrectPass123")

    statuses = []
    for _ in range(_MAX_LOGIN + 2):
        resp = await client.post(
            "/api/auth/login",
            json={"email": "bruteforce@example.com", "password": "WrongPass999"},
        )
        statuses.append(resp.status_code)

    # Every attempt up to the limit is a normal 401; once the limit is hit the
    # endpoint must start returning 429 instead of accepting more guesses.
    assert statuses[:_MAX_LOGIN] == [401] * _MAX_LOGIN, statuses
    assert 429 in statuses[_MAX_LOGIN:], statuses


async def test_tracking_rate_limit(client: httpx.AsyncClient, db_session):
    """4th manual run within 1 minute should return 429."""
    _reset_rate_store()
    await register_and_login(client, email="ratelimit@example.com")
    brand = await create_brand(client, name="Rate Limit Brand")

    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        # First 3 should succeed
        for _ in range(3):
            resp = await client.post(f"/api/tracking/run/{brand['id']}")
            assert resp.status_code == 202, f"Expected 202, got {resp.status_code}"
            await _complete_pending_runs(db_session, brand["id"])

        # 4th should be rate limited
        resp = await client.post(f"/api/tracking/run/{brand['id']}")
        assert resp.status_code == 429


async def test_rate_limit_resets_per_user(client: httpx.AsyncClient, db_session):
    """Two different users each get their own rate limit window."""
    _reset_rate_store()

    # User A hits limit
    await register_and_login(client, email="rluser_a@example.com")
    brand_a = await create_brand(client, name="RL User A Brand")
    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        for _ in range(3):
            await client.post(f"/api/tracking/run/{brand_a['id']}")
            await _complete_pending_runs(db_session, brand_a["id"])
        resp = await client.post(f"/api/tracking/run/{brand_a['id']}")
        assert resp.status_code == 429

    # User B should NOT be rate limited
    await register_and_login(client, email="rluser_b@example.com")
    brand_b = await create_brand(client, name="RL User B Brand")
    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        resp = await client.post(f"/api/tracking/run/{brand_b['id']}")
        assert resp.status_code == 202


async def test_check_rate_limit_function_directly():
    """Unit test the check_rate_limit helper directly."""
    from fastapi import HTTPException

    from app.dependencies import check_rate_limit
    _reset_rate_store()

    user_id = 9999
    limit = 2

    # First two calls should pass
    check_rate_limit(user_id, limit)
    check_rate_limit(user_id, limit)

    # Third call should raise 429
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit(user_id, limit)
    assert exc_info.value.status_code == 429


async def test_rate_limit_window_resets():
    """After the window expires, the counter resets."""

    from app.dependencies import _rate_store, check_rate_limit
    _reset_rate_store()

    user_id = 8888
    limit = 1

    # Use up the limit
    check_rate_limit(user_id, limit)

    # Manually backdate the window start by > 60 seconds
    count, start = _rate_store[(user_id, "default")]
    _rate_store[(user_id, "default")] = (count, start - 61.0)

    # Should now pass again (new window)
    check_rate_limit(user_id, limit)
    assert _rate_store[(user_id, "default")][0] == 1  # counter reset to 1


def test_rate_store_prunes_stale_entries():
    """Old entries must be removed from _rate_store after the window expires."""
    _rate_store.clear()

    # Simulate a user who hit the limit 2 minutes ago (stale)
    _rate_store[(9999, "default")] = (10, time.monotonic() - 200)

    # A new call for the same user should succeed (not 429) and reset their slot
    check_rate_limit(9999, limit=5)  # should not raise

    # The old stale entry must be gone — count reset to 1
    count, _ = _rate_store[(9999, "default")]
    assert count == 1


def test_rate_store_does_not_grow_unbounded():
    """After many distinct users, _rate_store should not retain stale entries."""
    import time

    from app.dependencies import _RATE_WINDOW, _rate_store, check_rate_limit

    _rate_store.clear()

    # Inject 100 stale user entries (window expired)
    stale_time = time.monotonic() - (_RATE_WINDOW + 10)
    for uid in range(1000, 1100):
        _rate_store[uid] = (1, stale_time)

    # One fresh call should trigger pruning pass
    check_rate_limit(9998, limit=5)

    # Stale entries must be gone after the pruning sweep runs
    stale_count = sum(
        1 for uid, (cnt, start) in _rate_store.items()
        if uid in range(1000, 1100)
    )
    assert stale_count == 0, f"Expected 0 stale entries, got {stale_count}"


def test_auth_rate_check_prunes_stale_ips():
    """_rate_check must remove stale entries for inactive IPs, not just empty lists."""
    import time

    from app.routers.auth import _RATE_WINDOW, _login_attempts, _rate_check

    _login_attempts.clear()

    # Seed 50 IPs with stale timestamps (window expired)
    stale_time = time.monotonic() - (_RATE_WINDOW + 10)
    for i in range(50):
        _login_attempts[f"192.168.1.{i}"] = [stale_time, stale_time]

    # Call from a different IP to trigger the pruning sweep
    _rate_check("10.0.0.1", _login_attempts, limit=10)

    # All 50 stale IPs must be gone
    stale_remaining = [ip for ip in _login_attempts if ip.startswith("192.168.1.")]
    assert len(stale_remaining) == 0, f"Expected 0 stale IPs, got {len(stale_remaining)}"
