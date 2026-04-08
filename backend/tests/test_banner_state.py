"""Tests for banner state management during manual opportunity scans."""
import asyncio
from unittest.mock import patch

import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def test_manual_scan_sets_scanning_state(client: httpx.AsyncClient):
    """Manual scan should add brand to state.scanning_brands during execution."""
    await register_and_login(client, email="scanstate@test.com", subscription_tier="starter")
    brand = await create_brand(client, name="ScanStateBrand")
    brand_id = brand["id"]

    from app import state

    # Clear any residual state
    state.scanning_brands.clear()

    # Track whether the brand was in scanning_brands when _scan_and_log ran
    scanning_during_call = []

    async def mock_scan_and_log(bid, **kwargs):
        scanning_during_call.append(bid in state.scanning_brands)

    with patch("app.routers.opportunities._scan_and_log", side_effect=mock_scan_and_log):
        resp = await client.post(f"/api/opportunities/{brand_id}/scan")
        assert resp.status_code == 202

    # Give the background task a moment to execute
    await asyncio.sleep(0.1)

    assert len(scanning_during_call) > 0, "Mock scan was never called"
    assert scanning_during_call[0] is True, "Brand was not in scanning_brands during scan"


async def test_scanning_state_cleared_after_scan(client: httpx.AsyncClient):
    """scanning_brands should be empty after the scan task completes."""
    await register_and_login(client, email="scanclear@test.com", subscription_tier="starter")
    brand = await create_brand(client, name="ScanClearBrand")
    brand_id = brand["id"]

    from app import state

    state.scanning_brands.clear()

    async def mock_scan_and_log(bid, **kwargs):
        pass  # instant completion

    with patch("app.routers.opportunities._scan_and_log", side_effect=mock_scan_and_log):
        resp = await client.post(f"/api/opportunities/{brand_id}/scan")
        assert resp.status_code == 202

    # Wait for the background task to finish and clean up
    await asyncio.sleep(0.15)

    assert brand_id not in state.scanning_brands, "Brand was not removed from scanning_brands after scan"


async def test_scanning_state_cleared_after_scan_error(client: httpx.AsyncClient):
    """scanning_brands should be cleared even if the scan raises an exception."""
    await register_and_login(client, email="scanerr@test.com", subscription_tier="starter")
    brand = await create_brand(client, name="ScanErrBrand")
    brand_id = brand["id"]

    from app import state

    state.scanning_brands.clear()

    async def mock_scan_and_log_raises(bid, **kwargs):
        raise RuntimeError("simulated scan failure")

    with patch("app.routers.opportunities._scan_and_log", side_effect=mock_scan_and_log_raises):
        resp = await client.post(f"/api/opportunities/{brand_id}/scan")
        assert resp.status_code == 202

    await asyncio.sleep(0.15)

    assert brand_id not in state.scanning_brands, "Brand was not removed from scanning_brands after scan error"


async def test_background_status_reflects_scanning(client: httpx.AsyncClient):
    """Background status API should show scanning=True when brand is in scanning_brands."""
    await register_and_login(client, email="bgstatus@test.com")
    brand = await create_brand(client, name="BgStatusBrand")
    brand_id = brand["id"]

    from app import state

    # Initially scanning should be false
    resp = await client.get("/api/tracking/background-status")
    assert resp.status_code == 200
    assert resp.json()["scanning"] is False

    # Manually inject into scanning state
    state.scanning_brands.add(brand_id)
    try:
        resp = await client.get("/api/tracking/background-status")
        assert resp.status_code == 200
        assert resp.json()["scanning"] is True
    finally:
        state.scanning_brands.discard(brand_id)
