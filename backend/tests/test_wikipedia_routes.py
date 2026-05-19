"""Tests for /api/wikipedia/* endpoints."""
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)


async def _auth_cookie_for(user: User) -> str:
    import jwt as pyjwt
    secret = os.getenv("JWT_SECRET", "test-secret-key-for-wiki-32+chars-please")
    return pyjwt.encode({"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(hours=1)}, secret, algorithm="HS256")


@pytest_asyncio.fixture
async def auth_setup(db_session: AsyncSession, client: AsyncClient) -> tuple[User, Brand, Prompt]:
    user = User(
        email="wiki_routes@example.com",
        password_hash="x",
        name="R",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="routes-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="x"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()
    token = await _auth_cookie_for(user)
    client.cookies.set("clarity_token", token)
    return user, brand, prompt


@pytest.mark.asyncio
async def test_list_candidates_requires_auth(client: AsyncClient) -> None:
    client.cookies.clear()
    r = await client.get("/api/wikipedia/1/candidates")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_candidates_empty(client: AsyncClient, auth_setup) -> None:
    user, brand, prompt = auth_setup
    r = await client.get(f"/api/wikipedia/{brand.id}/candidates")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_free_tier_blocked_with_402(client: AsyncClient, db_session: AsyncSession) -> None:
    user = User(email="free_wiki@example.com", password_hash="x", name="F", email_verified=True, subscription_tier=None)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="free-wiki-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    client.cookies.set("clarity_token", await _auth_cookie_for(user))
    r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_scan_dispatches_background_task(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup

    with patch("app.routers.wikipedia.run_scan", new=AsyncMock()):
        r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "running"


@pytest.mark.asyncio
async def test_scan_cap_exceeded_returns_429(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    now = datetime.now(UTC).replace(tzinfo=None)
    for i in range(4):
        db_session.add(WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id, started_at=now - timedelta(days=i)))
    await db_session.commit()

    r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_draft_candidate_endpoint(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id, prompt_id=prompt.id, scan_id=scan.id,
        article_title="A", article_url="u", pageid=1, article_summary="s" * 200,
        legitimacy_score=0.8, legitimacy_reasoning="r", status="new",
    )
    db_session.add(candidate)
    await db_session.commit()

    async def fake_draft(db, *, candidate_id, tier):
        c = (await db.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate_id))).scalar_one()
        c.suggested_wikitext = "drafted text"
        c.status = "drafted"
        await db.commit()
        return c

    with patch("app.routers.wikipedia.draft_candidate", new=fake_draft):
        r = await client.post(f"/api/wikipedia/{brand.id}/candidates/{candidate.id}/draft")
    assert r.status_code == 200
    assert r.json()["suggested_wikitext"] == "drafted text"


@pytest.mark.asyncio
async def test_update_status_endpoint(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id, prompt_id=prompt.id, scan_id=scan.id,
        article_title="A", article_url="u", pageid=1, article_summary="s" * 200,
        legitimacy_score=0.8, legitimacy_reasoning="r", status="drafted",
        suggested_wikitext="x",
    )
    db_session.add(candidate)
    await db_session.commit()

    r = await client.patch(f"/api/wikipedia/{brand.id}/candidates/{candidate.id}/status", json={"status": "submitted"})
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


@pytest.mark.asyncio
async def test_cross_user_isolation_404(client: AsyncClient, db_session: AsyncSession) -> None:
    a = User(email="iso_a@example.com", password_hash="x", name="A", email_verified=True, subscription_tier="starter")
    b = User(email="iso_b@example.com", password_hash="x", name="B", email_verified=True, subscription_tier="starter")
    db_session.add(a)
    db_session.add(b)
    await db_session.flush()
    brand_b = Brand(name="B", slug="iso-b", user_id=b.id)
    db_session.add(brand_b)
    await db_session.commit()
    client.cookies.set("clarity_token", await _auth_cookie_for(a))
    r = await client.get(f"/api/wikipedia/{brand_b.id}/candidates")
    assert r.status_code == 404
