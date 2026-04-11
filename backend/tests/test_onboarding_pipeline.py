"""
Tests for _onboarding_post_process:
  - Calls auto_draft_top_gaps with tier-aware max_gaps (free=5, starter=20, pro=20)
  - Then scans Reddit and Quora (via asyncio.gather)
  - Manages state.generating_brands and state.scanning_brands correctly
  - Does NOT fire for non-onboarding run types
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Brand, User
from tests.conftest import AsyncSessionLocal

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_brand_with_tier(tier: str | None) -> int:
    """Create a user with the given subscription_tier and a brand. Returns brand_id."""
    import secrets
    async with AsyncSessionLocal() as db:
        user = User(email=f"{secrets.token_hex(4)}@test.com", password_hash="x",
                    email_verified=True, subscription_tier=tier)
        db.add(user)
        await db.flush()
        brand = Brand(name="TestBrand", slug=f"test-{secrets.token_hex(4)}",
                      user_id=user.id, tier="basic", brand_type="standard", prompt_limit=25)
        db.add(brand)
        await db.commit()
        return brand.id


async def test_onboarding_post_process_calls_drafting_then_scanning():
    """_onboarding_post_process: drafts first, then both scanners."""
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier("starter")
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
        await _onboarding_post_process(brand_id=brand_id)

    assert call_order[0] == "drafts", "Drafting must run before scanning"
    assert set(call_order[1:]) == {"reddit", "quora"}, "Both scanners must run"


async def test_onboarding_post_process_pro_gets_20():
    """Pro user gets max_gaps=20 during onboarding."""
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier("pro")
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
        await _onboarding_post_process(brand_id=brand_id)

    assert captured["brand_id"] == brand_id
    assert captured["max_gaps"] == 20
    assert captured["clear_existing"] is False
    assert captured["source"] == "onboarding"


async def test_onboarding_post_process_starter_gets_20():
    """Starter user gets max_gaps=20 during onboarding."""
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier("starter")
    captured = {}

    async def mock_draft(db, brand_id, max_gaps, clear_existing, source):
        captured.update({"max_gaps": max_gaps})
        return []

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", new_callable=AsyncMock),
        patch("app.services.tracking_service.quora_scan", new_callable=AsyncMock),
    ):
        await _onboarding_post_process(brand_id=brand_id)

    assert captured["max_gaps"] == 20


async def test_onboarding_post_process_free_gets_5():
    """Free user (no subscription) gets max_gaps=5 during onboarding."""
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier(None)
    captured = {}

    async def mock_draft(db, brand_id, max_gaps, clear_existing, source):
        captured.update({"max_gaps": max_gaps})
        return []

    with (
        patch("app.services.tracking_service.auto_draft_top_gaps", side_effect=mock_draft),
        patch("app.services.tracking_service.reddit_scan", new_callable=AsyncMock),
        patch("app.services.tracking_service.quora_scan", new_callable=AsyncMock),
    ):
        await _onboarding_post_process(brand_id=brand_id)

    assert captured["max_gaps"] == 5


async def test_onboarding_post_process_state_cleared_after_drafts():
    """State sets are correctly managed: set before, cleared after each phase."""
    from app import state
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier("starter")
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
        await _onboarding_post_process(brand_id=brand_id)

    assert drafting_state_snapshot.get("in_generating") is True, "brand must be in generating_brands while drafting"
    assert scanning_state_snapshot.get("in_scanning") is True, "brand must be in scanning_brands while scanning"
    assert brand_id not in state.generating_brands, "generating_brands must be cleared after drafting"
    assert brand_id not in state.scanning_brands, "scanning_brands must be cleared after scanning"


async def test_onboarding_post_process_non_fatal_on_draft_failure():
    """A drafting exception does not prevent the scan from running."""
    from app.services.tracking_service import _onboarding_post_process

    brand_id = await _create_brand_with_tier("starter")
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
        await _onboarding_post_process(brand_id=brand_id)  # must not raise

    assert scan_called["reddit"], "Reddit scan must run even when drafting fails"
    assert scan_called["quora"], "Quora scan must run even when drafting fails"
