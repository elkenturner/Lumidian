"""
Tests for opportunity listing: staleness filtering and recency-blended sort.
"""
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def _seed_opportunity(db, brand_id: int, platform: str, relevance: float,
                            posted_at: datetime, prompt_id: int | None = None,
                            status: str = "new"):
    """Insert a ContentOpportunity directly into the DB."""
    from app.models import ContentOpportunity
    opp = ContentOpportunity(
        brand_id=brand_id,
        platform=platform,
        thread_url=f"https://example.com/{platform}/{relevance}",
        thread_title=f"Test {platform} opportunity",
        relevance_score=relevance,
        posted_at=posted_at,
        prompt_id=prompt_id,
        status=status,
    )
    db.add(opp)
    await db.commit()
    await db.refresh(opp)
    return opp


async def test_opportunities_excludes_older_than_90_days(client: httpx.AsyncClient, db_session):
    """Opportunities posted more than 90 days ago should not appear."""
    tokens = await register_and_login(client, email="stale@example.com")
    brand = await create_brand(client, name="Stale Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    # One fresh (5 days old), one stale (100 days old)
    await _seed_opportunity(db_session, brand_id, "reddit", 80.0, now - timedelta(days=5))
    await _seed_opportunity(db_session, brand_id, "quora", 90.0, now - timedelta(days=100))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    assert len(opps) == 1
    assert opps[0]["platform"] == "reddit"


async def test_opportunities_recency_boosts_fresh_over_stale(client: httpx.AsyncClient, db_session):
    """A moderately relevant fresh opportunity should rank above a highly relevant old one."""
    tokens = await register_and_login(client, email="recency@example.com")
    brand = await create_brand(client, name="Recency Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    # Old high-relevance: 80 * 0.7 + 20 * 0.3 = 62
    await _seed_opportunity(db_session, brand_id, "quora", 80.0, now - timedelta(days=80))
    # Fresh moderate-relevance: 60 * 0.7 + 100 * 0.3 = 72
    await _seed_opportunity(db_session, brand_id, "reddit", 60.0, now - timedelta(days=2))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    # Both on different platforms so interleaving puts one of each, but
    # with only 2 items the first should be the fresh one (higher blended score)
    assert len(opps) == 2
    assert opps[0]["platform"] == "reddit"


async def test_opportunities_90_day_boundary(client: httpx.AsyncClient, db_session):
    """Opportunity at exactly 89 days should appear, 91 days should not."""
    tokens = await register_and_login(client, email="boundary@example.com")
    brand = await create_brand(client, name="Boundary Test Brand")
    brand_id = brand["id"]

    now = datetime.now(UTC).replace(tzinfo=None)
    await _seed_opportunity(db_session, brand_id, "reddit", 70.0, now - timedelta(days=89))
    await _seed_opportunity(db_session, brand_id, "quora", 70.0, now - timedelta(days=91))

    resp = await client.get(f"/api/opportunities/{brand_id}")
    assert resp.status_code == 200
    opps = resp.json()
    assert len(opps) == 1
    assert opps[0]["platform"] == "reddit"
