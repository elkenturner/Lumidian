"""
Tests for:
  GET /api/dashboard/{brand_id}/analytics  — SOV, sentiment, model breakdown, access control
"""
from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from app.database import AsyncSessionLocal
from app.models import QueryResult, RunModelScore, TrackingRun
from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


# ── Helper ────────────────────────────────────────────────────────────────────

async def _insert_run_with_result(
    brand_id: int,
    prompt_id: int,
    *,
    response_text: str = "A response that mentions the brand.",
    mentioned: bool = True,
    model: str = "chatgpt",
    sentiment: str | None = None,
) -> int:
    """Insert a completed TrackingRun with one QueryResult and one RunModelScore.
    Returns the run id."""
    async with AsyncSessionLocal() as db:
        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            overall_score=80.0 if mentioned else 0.0,
            total_queries=1,
            total_mentions=1 if mentioned else 0,
            has_content_influence=False,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.flush()

        qr = QueryResult(
            tracking_run_id=run.id,
            prompt_id=prompt_id,
            model=model,
            run_number=1,
            response_text=response_text,
            mentioned=mentioned,
            sentiment=sentiment,
        )
        db.add(qr)

        ms = RunModelScore(
            tracking_run_id=run.id,
            model=model,
            total_queries=1,
            total_mentions=1 if mentioned else 0,
            score=80.0 if mentioned else 0.0,
        )
        db.add(ms)
        await db.commit()
        return run.id


# ── No runs ───────────────────────────────────────────────────────────────────

async def test_analytics_no_runs_no_competitors(client: httpx.AsyncClient):
    """With no runs and no competitors, SOV = 100%."""
    await register_and_login(client, email="dash_empty@example.com")
    brand = await create_brand(client, name="Dash Empty Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sov"]["percentage"] == 100.0
    assert data["sov"]["has_competitors"] is False
    assert data["total_responses_analyzed"] == 0


async def test_analytics_no_runs_with_competitor(client: httpx.AsyncClient):
    """With no runs but a competitor present, SOV = 0% (no data yet — unknown share)."""
    await register_and_login(client, email="dash_comp_empty@example.com")
    brand = await create_brand(client, name="Dash Comp Empty Brand")
    await client.post(
        f"/api/brands/{brand['id']}/competitors",
        json={"name": "Rival Co"},
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sov"]["percentage"] == 0.0
    assert data["sov"]["has_competitors"] is True
    assert data["total_responses_analyzed"] == 0


# ── Sentiment ─────────────────────────────────────────────────────────────────

async def test_analytics_sentiment_unclassified_mentions_flagged(client: httpx.AsyncClient):
    """Mentions whose sentiment was never classified (e.g. the classifier
    failed during a degraded run) must NOT read as "no mentions" — the UI needs
    to distinguish 'no mentions' from 'sentiment unavailable'."""
    await register_and_login(client, email="dash_sent_unclass@example.com")
    brand = await create_brand(
        client, name="Sent Unclass Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="Sent Unclass Brand is great.",
        mentioned=True,
        sentiment=None,   # classifier never ran
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    sent = resp.json()["sentiment"]
    assert sent["has_data"] is False
    assert sent["unclassified_mentions"] == 1


async def test_analytics_sentiment_classified_has_no_unclassified(client: httpx.AsyncClient):
    await register_and_login(client, email="dash_sent_class@example.com")
    brand = await create_brand(
        client, name="Sent Class Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="Sent Class Brand is great.",
        mentioned=True,
        sentiment="positive",
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    sent = resp.json()["sentiment"]
    assert sent["has_data"] is True
    assert sent["positive_pct"] == 100.0
    assert sent["unclassified_mentions"] == 0


# ── Top cited domains ─────────────────────────────────────────────────────────

async def test_analytics_top_domains_from_citation_sources(client: httpx.AsyncClient):
    """The card is titled "across all tracked prompts" and must read the
    citation_sources table — not just regex-extract URLs from the latest
    window's response text (which is empty when a run degrades)."""
    from app.models import CitationSource

    await register_and_login(client, email="dash_domains_cit@example.com")
    brand = await create_brand(
        client, name="Domains Cit Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    # Latest-window response contains NO urls...
    run_id = await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="Domains Cit Brand is great. No links here.",
        mentioned=True,
    )
    # ...but the brand has accumulated citation rows from tracking runs.
    async with AsyncSessionLocal() as db:
        for i in range(3):
            db.add(CitationSource(
                brand_id=brand["id"], tracking_run_id=run_id, prompt_id=prompt_id,
                model="perplexity", url=f"https://techcrunch.com/article-{i}",
                domain="techcrunch.com", kind="third_party",
            ))
        db.add(CitationSource(
            brand_id=brand["id"], tracking_run_id=run_id, prompt_id=prompt_id,
            model="gemini", url="https://wikipedia.org/wiki/Thing",
            domain="wikipedia.org", kind="third_party",
        ))
        await db.commit()

    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    domains = {d["domain"]: d for d in resp.json()["top_domains"]}
    assert "techcrunch.com" in domains
    assert domains["techcrunch.com"]["count"] == 3
    assert "wikipedia.org" in domains


async def test_analytics_top_domains_falls_back_to_response_text(client: httpx.AsyncClient):
    """Brands with no citation_sources rows keep the legacy text-extraction."""
    await register_and_login(client, email="dash_domains_txt@example.com")
    brand = await create_brand(
        client, name="Domains Txt Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="See https://example.com/post for Domains Txt Brand.",
        mentioned=True,
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    domains = {d["domain"] for d in resp.json()["top_domains"]}
    assert "example.com" in domains


# ── SOV ───────────────────────────────────────────────────────────────────────

async def test_analytics_sov_brand_mentioned(client: httpx.AsyncClient):
    """Brand mentioned in response → SOV = 100% with no competitors."""
    await register_and_login(client, email="dash_sov100@example.com")
    brand = await create_brand(
        client, name="SOV Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="SOV Brand is the top AI visibility tool.",
        mentioned=True,
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sov"]["percentage"] == 100.0
    assert data["sov"]["brand_mentions"] == 1
    assert data["total_responses_analyzed"] == 1
    assert data["sov"]["has_competitors"] is False


async def test_analytics_sov_competitor_mentioned_brand_not(client: httpx.AsyncClient):
    """Competitor is mentioned but brand is not → SOV = 0%."""
    await register_and_login(client, email="dash_sov_comp@example.com")
    brand = await create_brand(
        client, name="SOV Comp Brand", prompts=["Best AI visibility tools?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await client.post(
        f"/api/brands/{brand['id']}/competitors",
        json={"name": "Rival Inc"},
    )
    # Response mentions competitor but NOT the brand
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="Rival Inc is the top AI visibility tool. Brand not mentioned.",
        mentioned=False,
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sov"]["percentage"] == 0.0
    assert data["sov"]["has_competitors"] is True


async def test_analytics_sov_fallback_no_mentions_with_competitor(client: httpx.AsyncClient):
    """
    Regression: when runs exist but neither brand nor competitor is mentioned,
    SOV must be 0% — not 100% — when a competitor is present.

    Bug: `else 100.0` on dashboard.py line 259 returned 100% whenever
    total_mentions == 0, even when competitors existed.
    """
    await register_and_login(client, email="dash_sov_bug@example.com")
    brand = await create_brand(
        client, name="SOV Bug Brand", prompts=["Totally unrelated question?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await client.post(
        f"/api/brands/{brand['id']}/competitors",
        json={"name": "Rival Inc"},
    )
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="This response mentions neither brand nor competitor.",
        mentioned=False,
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    # Was 100.0 before fix, must be 0.0 when competitors present and no mentions
    assert data["sov"]["percentage"] == 0.0
    assert data["sov"]["has_competitors"] is True


async def test_analytics_sov_fallback_no_mentions_no_competitor(client: httpx.AsyncClient):
    """When runs exist but no mentions and no competitors, SOV = 100%."""
    await register_and_login(client, email="dash_sov_nocomp@example.com")
    brand = await create_brand(
        client, name="SOV No Comp Brand", prompts=["Totally unrelated question?"]
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_run_with_result(
        brand["id"], prompt_id,
        response_text="This response mentions neither brand nor competitor.",
        mentioned=False,
    )
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sov"]["percentage"] == 100.0
    assert data["sov"]["has_competitors"] is False


# ── Access control ────────────────────────────────────────────────────────────

async def test_analytics_access_control(client: httpx.AsyncClient):
    """User cannot access another user's brand analytics."""
    await register_and_login(client, email="dash_owner@example.com")
    brand = await create_brand(client, name="Dash Owner Brand")

    await register_and_login(client, email="dash_thief@example.com")
    resp = await client.get(f"/api/dashboard/{brand['id']}/analytics")
    assert resp.status_code == 403


async def test_analytics_unauthenticated(client: httpx.AsyncClient):
    """Unauthenticated request returns 401."""
    resp = await client.get("/api/dashboard/1/analytics")
    assert resp.status_code == 401
