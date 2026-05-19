"""Tests for tier gating + rolling-30-day caps."""
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, User, WikipediaCandidate, WikipediaScan
from app.services.wikipedia.caps import (
    WIKIPEDIA_ENABLED_TIERS,
    is_tier_eligible,
    remaining_drafts_in_window,
    remaining_scans_in_window,
)


@pytest_asyncio.fixture
async def caps_brand(db_session: AsyncSession) -> tuple[User, Brand]:
    user = User(email="caps@example.com", password_hash="x", name="C", email_verified=True, subscription_tier="starter")
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="caps-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    return user, brand


def test_tier_eligibility() -> None:
    assert is_tier_eligible("starter", brand_type="standard")
    assert is_tier_eligible("pro", brand_type="standard")
    assert not is_tier_eligible(None, brand_type="standard")  # Free
    assert not is_tier_eligible("basic", brand_type="standard")  # Starter UI = basic key
    # Agency brands always eligible regardless of subscription
    assert is_tier_eligible(None, brand_type="agency")
    assert is_tier_eligible("basic", brand_type="agency")


def test_enabled_tiers_constant_matches_spec() -> None:
    assert WIKIPEDIA_ENABLED_TIERS == {"starter", "pro"}


@pytest.mark.asyncio
async def test_remaining_scans_pro_unlimited(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    user.subscription_tier = "pro"
    await db_session.commit()
    assert await remaining_scans_in_window(db_session, brand_id=brand.id, tier="pro", brand_type="standard") is None  # unlimited


@pytest.mark.asyncio
async def test_remaining_scans_growth_caps_at_4(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC).replace(tzinfo=None)
    for i in range(3):
        db_session.add(
            WikipediaScan(
                brand_id=brand.id,
                status="completed",
                triggered_by=user.id,
                started_at=now - timedelta(days=i),
            )
        )
    await db_session.commit()
    remaining = await remaining_scans_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 1


@pytest.mark.asyncio
async def test_remaining_scans_growth_old_scans_dont_count(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC).replace(tzinfo=None)
    db_session.add(
        WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id, started_at=now - timedelta(days=31))
    )
    await db_session.commit()
    remaining = await remaining_scans_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 4


@pytest.mark.asyncio
async def test_remaining_drafts_growth_counts_last_drafted_at(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC).replace(tzinfo=None)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    for i in range(5):
        db_session.add(
            WikipediaCandidate(
                brand_id=brand.id,
                scan_id=scan.id,
                article_title=f"Article_{i}",
                article_url=f"https://en.wikipedia.org/wiki/Article_{i}",
                pageid=i + 1,
                article_summary="x",
                legitimacy_score=0.9,
                legitimacy_reasoning="ok",
                status="drafted",
                last_drafted_at=now - timedelta(days=i),
            )
        )
    await db_session.commit()
    remaining = await remaining_drafts_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 25  # 30 cap - 5 used
