"""Tests for paid-only platform gating (LinkedIn & X)."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.dependencies import is_paid_only_platform, require_paid_for_platform
from tests.conftest import register_and_login


def test_linkedin_is_paid_only():
    assert is_paid_only_platform("linkedin") is True
    assert is_paid_only_platform("linkedin_article") is True
    assert is_paid_only_platform("linkedin_post") is True
    assert is_paid_only_platform("linkedin_reply") is True


def test_x_is_paid_only():
    assert is_paid_only_platform("x") is True
    assert is_paid_only_platform("x_thread") is True
    assert is_paid_only_platform("x_post") is True
    assert is_paid_only_platform("x_reply") is True


def test_existing_platforms_not_paid_only():
    assert is_paid_only_platform("reddit") is False
    assert is_paid_only_platform("quora") is False
    assert is_paid_only_platform("medium") is False
    assert is_paid_only_platform("wikipedia") is False
    assert is_paid_only_platform("reddit_reply") is False


class _FakeUser:
    def __init__(self, tier: str | None):
        self.subscription_tier = tier
        self.is_admin = False


class _FakeAdmin:
    def __init__(self):
        self.subscription_tier = None
        self.is_admin = True


def test_require_paid_allows_pro_user():
    user = _FakeUser("pro")
    require_paid_for_platform("linkedin", user)  # should not raise


def test_require_paid_allows_starter_user():
    user = _FakeUser("starter")
    require_paid_for_platform("linkedin", user)  # should not raise


def test_require_paid_allows_basic_user():
    user = _FakeUser("basic")
    require_paid_for_platform("x_thread", user)  # should not raise


def test_require_paid_blocks_free_user():
    user = _FakeUser(None)
    with pytest.raises(HTTPException) as exc_info:
        require_paid_for_platform("x_thread", user)
    assert exc_info.value.status_code == 403


def test_require_paid_allows_admin_bypass():
    admin = _FakeAdmin()
    require_paid_for_platform("linkedin_article", admin)  # should not raise


def test_require_paid_allows_non_paid_platform():
    user = _FakeUser("starter")
    require_paid_for_platform("reddit", user)  # should not raise


def test_require_paid_allows_non_paid_platform_free():
    user = _FakeUser(None)
    require_paid_for_platform("quora", user)  # should not raise


# ── HTTP-level gate verification per tier ─────────────────────────────────────


async def _seed_brand_and_linkedin_opp(email: str):
    """Seed a brand owned by this user plus a LinkedIn opportunity. Returns (brand_id, opp_id)."""
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, User

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        brand = Brand(name=f"Gate Brand {user.id}", slug=f"gate-brand-{user.id}", user_id=user.id)
        db.add(brand)
        await db.flush()
        opp = ContentOpportunity(
            brand_id=brand.id,
            platform="linkedin",
            thread_url=f"https://linkedin.com/posts/gate-{user.id}",
            thread_title="Test LinkedIn opportunity",
            relevance_score=85.0,
            posted_at=datetime.now(UTC).replace(tzinfo=None),
            status="new",
        )
        db.add(opp)
        await db.commit()
        return brand.id, opp.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tier,expect_linkedin_visible",
    [
        (None, False),       # Free — LinkedIn filtered out of list
        ("basic", True),     # Starter UI — paid, visible
        ("starter", True),   # Growth UI — paid, visible
        ("pro", True),       # Pro — visible
    ],
)
async def test_opportunities_list_filters_linkedin_per_tier(
    client: httpx.AsyncClient, tier: str | None, expect_linkedin_visible: bool
):
    """GET /api/opportunities/{brand_id} filters LinkedIn out for free users, shows for paid."""
    email = f"list-{tier or 'free'}@example.com"
    await register_and_login(client, email=email, subscription_tier=tier)
    brand_id, _opp_id = await _seed_brand_and_linkedin_opp(email)

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200, resp.text
    platforms = {o["platform"] for o in resp.json()}
    if expect_linkedin_visible:
        assert "linkedin" in platforms, f"tier={tier}: expected to see LinkedIn in list"
    else:
        assert "linkedin" not in platforms, f"tier={tier}: should not see LinkedIn in list"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tier,expect_paid_gate_block",
    [
        (None, True),        # Free — 403 "requires a paid plan"
        ("basic", False),    # Starter UI — passes gate
        ("starter", False),  # Growth UI — passes gate
        ("pro", False),      # Pro — passes gate
    ],
)
async def test_opportunity_draft_gate_per_tier(
    client: httpx.AsyncClient, tier: str | None, expect_paid_gate_block: bool
):
    """POST /api/opportunities/{opp_id}/draft — LinkedIn blocked for free, allowed for paid."""
    email = f"draft-{tier or 'free'}@example.com"
    await register_and_login(client, email=email, subscription_tier=tier)
    _brand_id, opp_id = await _seed_brand_and_linkedin_opp(email)

    # Mock the actual draft generation so we only assert on the gate.
    from datetime import UTC, datetime as _dt

    from app.models import ContentDraft

    _now = _dt.now(UTC).replace(tzinfo=None)
    fake_draft = ContentDraft(
        id=9999,
        brand_id=_brand_id,
        platform="linkedin",
        status="draft",
        content_text="mocked linkedin draft",
        source="manual",
        edited_count=0,
        created_at=_now,
        updated_at=_now,
    )
    with patch(
        "app.services.drafting_service.generate_opportunity_draft",
        new=AsyncMock(return_value=fake_draft),
    ):
        resp = await client.post(f"/api/opportunities/{opp_id}/draft")

    detail = (resp.json().get("detail") or "") if resp.headers.get("content-type", "").startswith("application/json") else ""
    is_paid_gate_block = resp.status_code == 403 and "paid plan" in detail.lower()

    if expect_paid_gate_block:
        assert is_paid_gate_block, f"tier={tier}: expected paid-gate 403, got {resp.status_code}: {detail}"
    else:
        assert not is_paid_gate_block, f"tier={tier}: unexpected gate block: {resp.status_code}: {detail}"


@pytest.mark.asyncio
async def test_opportunity_draft_gate_admin_bypass(client: httpx.AsyncClient):
    """Admin users bypass the paid-platform gate even without a subscription."""
    email = "admin-gate@example.com"
    await register_and_login(client, email=email, subscription_tier=None)

    # Mark user as admin directly
    from sqlalchemy import text

    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET is_admin = 1 WHERE email = :email"),
            {"email": email},
        )
        await db.commit()

    brand_id, opp_id = await _seed_brand_and_linkedin_opp(email)

    from datetime import UTC, datetime as _dt

    from app.models import ContentDraft
    _now = _dt.now(UTC).replace(tzinfo=None)
    fake_draft = ContentDraft(
        id=8888, brand_id=brand_id, platform="linkedin",
        status="draft", content_text="admin draft", source="manual",
        edited_count=0, created_at=_now, updated_at=_now,
    )
    with patch(
        "app.services.drafting_service.generate_opportunity_draft",
        new=AsyncMock(return_value=fake_draft),
    ):
        resp = await client.post(f"/api/opportunities/{opp_id}/draft")

    detail = (resp.json().get("detail") or "") if resp.headers.get("content-type", "").startswith("application/json") else ""
    is_paid_gate_block = resp.status_code == 403 and "paid plan" in detail.lower()
    assert not is_paid_gate_block, f"admin was blocked by paid gate: {resp.status_code}: {detail}"
