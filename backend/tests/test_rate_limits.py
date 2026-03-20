"""
Tests for per-user rate limiting.
  - Manual tracking runs: limit 3/min
  - Draft generation: limit 10/min
  - Scan: limit 3/min

Rate limit state is in-memory (_rate_store), so we reset it between tests
by patching check_rate_limit or by directly clearing the store.
"""
import pytest
import httpx
from unittest.mock import patch, AsyncMock
from tests.conftest import register_and_login, create_brand


pytestmark = pytest.mark.asyncio


def _reset_rate_store():
    """Clear the in-memory rate limit store between tests."""
    from app.dependencies import _rate_store
    _rate_store.clear()


async def test_tracking_rate_limit(client: httpx.AsyncClient):
    """4th manual run within 1 minute should return 429."""
    _reset_rate_store()
    await register_and_login(client, email="ratelimit@example.com")
    brand = await create_brand(client, name="Rate Limit Brand")

    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        # First 3 should succeed
        for _ in range(3):
            resp = await client.post(f"/api/tracking/run/{brand['id']}")
            assert resp.status_code == 202, f"Expected 202, got {resp.status_code}"

        # 4th should be rate limited
        resp = await client.post(f"/api/tracking/run/{brand['id']}")
        assert resp.status_code == 429


async def test_rate_limit_resets_per_user(client: httpx.AsyncClient):
    """Two different users each get their own rate limit window."""
    _reset_rate_store()

    # User A hits limit
    await register_and_login(client, email="rluser_a@example.com")
    brand_a = await create_brand(client, name="RL User A Brand")
    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        for _ in range(3):
            await client.post(f"/api/tracking/run/{brand_a['id']}")
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
    from app.dependencies import check_rate_limit, _rate_store
    from fastapi import HTTPException
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
    from app.dependencies import check_rate_limit, _rate_store
    from time import monotonic
    _reset_rate_store()

    user_id = 8888
    limit = 1

    # Use up the limit
    check_rate_limit(user_id, limit)

    # Manually backdate the window start by > 60 seconds
    count, start = _rate_store[user_id]
    _rate_store[user_id] = (count, start - 61.0)

    # Should now pass again (new window)
    check_rate_limit(user_id, limit)
    assert _rate_store[user_id][0] == 1  # counter reset to 1
