"""Tests for the citation_gaps section of GET /api/dashboard."""
from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Prompt, QueryResult, TrackingRun
from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def _seed_run(brand_id: int, rows: list[dict]) -> int:
    """Insert a TrackingRun + QueryResult rows for a brand.

    Each row dict supports: response_text, mentioned (default False),
    model (default "perplexity"), prompt_id.
    Returns the run_id.
    """
    async with AsyncSessionLocal() as db:
        prompt_q = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt = prompt_q.scalars().first()
        if prompt is None:
            prompt = Prompt(brand_id=brand_id, text="seed prompt", prompt_type="standard")
            db.add(prompt)
            await db.commit()
            await db.refresh(prompt)

        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            total_queries=len(rows),
            total_mentions=sum(1 for r in rows if r.get("mentioned")),
            overall_score=0.0,
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        for r in rows:
            db.add(
                QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=r.get("prompt_id", prompt.id),
                    model=r.get("model", "perplexity"),
                    run_number=1,
                    response_text=r["response_text"],
                    mentioned=r.get("mentioned", False),
                )
            )
        await db.commit()
        return run.id


async def _setup_brand(client: httpx.AsyncClient) -> int:
    """Register, login, create a brand. Returns brand_id.

    Auth cookies are set on the `client` instance by `register_and_login`,
    so callers should keep using the same client for subsequent requests.
    """
    await register_and_login(client)
    brand = await create_brand(client, name="Acme")
    return brand["id"]


@pytest.mark.asyncio
async def test_twitter_com_normalized_to_x_com(client: httpx.AsyncClient):
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "See https://twitter.com/example for more.", "mentioned": False},
        {"response_text": "See https://twitter.com/another for context.", "mentioned": False},
        {"response_text": "Also https://x.com/yet_another offers details.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    x_rows = [g for g in gaps if g["domain"] == "x.com"]
    twitter_rows = [g for g in gaps if g["domain"] == "twitter.com"]
    assert len(x_rows) == 1, f"expected single x.com row, got {gaps}"
    assert x_rows[0]["cited_total"] == 3
    assert twitter_rows == [], "twitter.com should not appear after normalization"


@pytest.mark.asyncio
async def test_wikipedia_subdomains_normalized(client: httpx.AsyncClient):
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "Per https://en.wikipedia.org/wiki/Foo it's clear.", "mentioned": False},
        {"response_text": "And https://fr.wikipedia.org/wiki/Foo agrees.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    wiki_rows = [g for g in gaps if g["domain"] == "wikipedia.org"]
    assert len(wiki_rows) == 1
    assert wiki_rows[0]["cited_total"] == 2


@pytest.mark.asyncio
async def test_same_response_twitter_and_x_count_once(client: httpx.AsyncClient):
    """A single response containing both twitter.com and x.com counts as one x.com citation."""
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "Both https://twitter.com/a and https://x.com/b appear here.", "mentioned": False},
        {"response_text": "Just https://x.com/c on its own.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    x_rows = [g for g in gaps if g["domain"] == "x.com"]
    assert len(x_rows) == 1
    assert x_rows[0]["cited_total"] == 2  # NOT 3 — the first response dedupes twitter+x to a single x.com count


@pytest.mark.asyncio
async def test_non_actionable_domains_excluded(client: httpx.AsyncClient):
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "Per https://techcrunch.com/article and https://reddit.com/r/foo it's clear.", "mentioned": False},
        {"response_text": "Also https://nytimes.com/x noted.", "mentioned": False},
        {"response_text": "https://reddit.com/r/bar adds context.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    domains = [g["domain"] for g in gaps]
    assert "reddit.com" in domains
    assert "techcrunch.com" not in domains
    assert "nytimes.com" not in domains


@pytest.mark.asyncio
async def test_no_actionable_citations_returns_empty_list(client: httpx.AsyncClient):
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "https://techcrunch.com/a and https://nytimes.com/b only.", "mentioned": False},
        {"response_text": "https://forbes.com/c is also relevant.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    assert resp.status_code == 200
    assert resp.json()["citation_gaps"] == []


@pytest.mark.asyncio
async def test_platform_field_populated(client: httpx.AsyncClient):
    brand_id = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "https://reddit.com/r/x and https://medium.com/p/y.", "mentioned": False},
        {"response_text": "https://reddit.com/r/z and https://medium.com/p/w again.", "mentioned": False},
    ])
    resp = await client.get(f"/api/dashboard/{brand_id}/analytics")
    gaps = resp.json()["citation_gaps"]
    by_domain = {g["domain"]: g for g in gaps}
    assert by_domain["reddit.com"]["platform"] == "reddit"
    assert by_domain["medium.com"]["platform"] == "medium"
