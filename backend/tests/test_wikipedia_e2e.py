"""End-to-end smoke test: scan → list → draft → status."""
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, BrandProfile, Prompt, User


@pytest_asyncio.fixture
async def e2e_setup(db_session: AsyncSession, client: AsyncClient) -> tuple[User, Brand, Prompt]:
    import jwt as pyjwt
    user = User(
        email="wiki_e2e@example.com",
        password_hash="x",
        name="E",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="wiki-e2e-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()
    secret = os.getenv("JWT_SECRET", "test-secret-key-for-wiki-e2e-32+chars")
    token = pyjwt.encode({"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(hours=1)}, secret, algorithm="HS256")
    client.cookies.set("clarity_token", token)
    return user, brand, prompt


@pytest.mark.asyncio
async def test_full_wikipedia_lifecycle(client: AsyncClient, db_session: AsyncSession, e2e_setup) -> None:
    user, brand, prompt = e2e_setup

    search_results = [{"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."}]
    extract = (
        "Brand visibility in LLMs",
        "Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers. Practitioners use specialized tools to monitor citation rates across ChatGPT, Claude, Perplexity, and Gemini.",
    )

    # 1. Trigger scan
    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.82, "Topic matches.")),
    ):
        r1 = await client.post(f"/api/wikipedia/{brand.id}/scan")
        assert r1.status_code == 202

    # 2. List candidates — should have 1
    r2 = await client.get(f"/api/wikipedia/{brand.id}/candidates")
    assert r2.status_code == 200
    candidates = r2.json()
    assert len(candidates) == 1
    candidate_id = candidates[0]["id"]
    assert candidates[0]["status"] == "new"

    # 3. Generate draft
    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("== History ==\nFoo.", ["History"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft",
        return_value=("Brand visibility in LLMs", "url", "History", "end of section", "Suggested text."),
    ):
        r3 = await client.post(f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/draft")
    assert r3.status_code == 200
    assert r3.json()["suggested_wikitext"] == "Suggested text."
    assert r3.json()["status"] == "drafted"

    # 4. Mark as submitted
    r4 = await client.patch(
        f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/status",
        json={"status": "submitted"},
    )
    assert r4.status_code == 200
    assert r4.json()["status"] == "submitted"

    # 5. Mark as accepted
    r5 = await client.patch(
        f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/status",
        json={"status": "accepted"},
    )
    assert r5.status_code == 200
    assert r5.json()["status"] == "accepted"
