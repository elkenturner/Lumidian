import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_draft_endpoint_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/site-audit/recommendation/9999/draft")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_draft_endpoint_returns_404_for_missing_rec():
    """When authed and rec doesn't exist, returns 404 — not 501."""
    from tests.conftest import register_and_login
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await register_and_login(ac, email="draft-404@test.com")
        r = await ac.post("/api/site-audit/recommendation/9999/draft")
    assert r.status_code == 404
