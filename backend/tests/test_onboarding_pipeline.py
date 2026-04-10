"""
Tests for _onboarding_post_process:
  - Calls auto_draft_top_gaps with source="onboarding", max_gaps=5
  - Then scans Reddit and Quora (via asyncio.gather)
  - Manages state.generating_brands and state.scanning_brands correctly
  - Does NOT fire for non-onboarding run types
"""
from unittest.mock import AsyncMock, patch

import pytest

pytestmark = pytest.mark.asyncio


async def test_onboarding_post_process_calls_drafting_then_scanning():
    """_onboarding_post_process: drafts first, then both scanners."""
    from app.services.tracking_service import _onboarding_post_process

    call_order = []

    async def mock_draft(*args, **kwargs):
        call_order.append("drafts")
        return []

    async def mock_reddit(brand_id, **kwargs):
        call_order.append("reddit")

    async def mock_quora(brand_id, **kwargs):
        call_order.append("quora")

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=42)

    assert call_order[0] == "drafts", "Drafting must run before scanning"
    assert set(call_order[1:]) == {"reddit", "quora"}, "Both scanners must run"


async def test_onboarding_post_process_drafting_kwargs():
    """_onboarding_post_process passes correct kwargs to auto_draft_top_gaps."""
    from app.services.tracking_service import _onboarding_post_process

    captured = {}

    async def mock_draft(db, brand_id, max_gaps, clear_existing, source):
        captured.update({"brand_id": brand_id, "max_gaps": max_gaps,
                         "clear_existing": clear_existing, "source": source})
        return []

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", new_callable=AsyncMock),
        patch("app.services.tracking_service.quora_scan", new_callable=AsyncMock),
    ):
        await _onboarding_post_process(brand_id=7)

    assert captured["brand_id"] == 7
    assert captured["max_gaps"] == 20
    assert captured["clear_existing"] is False
    assert captured["source"] == "onboarding"


async def test_onboarding_post_process_state_cleared_after_drafts():
    """State sets are correctly managed: set before, cleared after each phase."""
    from app import state
    from app.services.tracking_service import _onboarding_post_process

    drafting_state_snapshot = {}
    scanning_state_snapshot = {}

    async def mock_draft(db, brand_id, **kwargs):
        drafting_state_snapshot["in_generating"] = brand_id in state.generating_brands
        return []

    async def mock_reddit(brand_id, **kwargs):
        scanning_state_snapshot["in_scanning"] = brand_id in state.scanning_brands

    async def mock_quora(brand_id, **kwargs):
        pass

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=99)

    assert drafting_state_snapshot.get("in_generating") is True, "brand must be in generating_brands while drafting"
    assert scanning_state_snapshot.get("in_scanning") is True, "brand must be in scanning_brands while scanning"
    assert 99 not in state.generating_brands, "generating_brands must be cleared after drafting"
    assert 99 not in state.scanning_brands, "scanning_brands must be cleared after scanning"


async def test_onboarding_post_process_non_fatal_on_draft_failure():
    """A drafting exception does not prevent the scan from running."""
    from app.services.tracking_service import _onboarding_post_process

    scan_called = {"reddit": False, "quora": False}

    async def mock_draft(*args, **kwargs):
        raise RuntimeError("LLM timeout")

    async def mock_reddit(brand_id, **kwargs):
        scan_called["reddit"] = True

    async def mock_quora(brand_id, **kwargs):
        scan_called["quora"] = True

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", side_effect=mock_reddit),
        patch("app.services.tracking_service.quora_scan", side_effect=mock_quora),
    ):
        await _onboarding_post_process(brand_id=55)  # must not raise

    assert scan_called["reddit"], "Reddit scan must run even when drafting fails"
    assert scan_called["quora"], "Quora scan must run even when drafting fails"
