"""Tests for wikipedia_plan document template."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import (
    AgencyClient,
    Brand,
    BrandProfile,
    User,
    WebsiteAudit,
    WebsiteAuditRecommendation,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.document_engine import wikipedia_plan, site_plan  # noqa: F401 — import registers
from app.services.document_engine.registry import get_template
from tests.conftest import register_and_login


# ── Auth bootstrap ────────────────────────────────────────────────────────────

async def _make_agency_admin(client, email: str = "doc-test-admin@example.com") -> None:
    """Register, verify, log in, then flip is_agency_staff=True + is_admin=True."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True, is_admin=True)
        )
        await db.commit()


@pytest.fixture(autouse=True)
async def _agency_admin_logged_in(client):
    """Ensure the test client is authenticated as an agency admin before each test."""
    await _make_agency_admin(client, "doc-test-admin@example.com")
    yield


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
async def seeded_agency_client_with_brand(client) -> tuple[int, int]:
    """Returns (agency_client_id, brand_id)."""
    res = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert res.status_code == 201, res.text
    payload = res.json()
    cid = payload["id"]
    bid = payload.get("brand_id")
    if bid is None:
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            b = await db.execute(
                select(Brand).where(Brand.agency_client_id == cid).limit(1)
            )
            bid = b.scalar_one().id
    return cid, bid


@pytest.fixture
async def seeded_brand_with_wiki_scan(seeded_agency_client_with_brand) -> tuple[int, int]:
    cid, bid = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        scan = WikipediaScan(
            brand_id=bid,
            status="completed",
            triggered_by=None,
            prompts_searched=5,
            total_candidates_found=12,
            candidates_persisted=4,
            started_at=datetime.utcnow() - timedelta(hours=2),
            completed_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(scan)
        await db.flush()
        for i in range(2):
            cand = WikipediaCandidate(
                brand_id=bid,
                scan_id=scan.id,
                article_title=f"Article {i}",
                article_url=f"https://en.wikipedia.org/wiki/Article_{i}",
                pageid=1000 + i,
                article_summary="Summary",
                legitimacy_score=0.75,
                legitimacy_reasoning="Plausible fit",
                status="new",
                suggested_section="History",
            )
            db.add(cand)
        await db.commit()
    return cid, bid


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_wikipedia_plan_registered():
    assert get_template("wikipedia_plan") is not None


@pytest.mark.asyncio
async def test_wikipedia_plan_fetch_data_with_scan(seeded_brand_with_wiki_scan):
    client_id, brand_id = seeded_brand_with_wiki_scan
    async with AsyncSessionLocal() as db:
        client_obj = await db.get(AgencyClient, client_id)
        template = get_template("wikipedia_plan")
        data = await template.fetch_data(db, client_obj)
    assert data["scan"] is not None
    assert data["scan"]["candidates_persisted"] >= 1
    assert len(data["candidates"]) >= 1
    assert "client" in data
    assert "publications" in data


@pytest.mark.asyncio
async def test_wikipedia_plan_fetch_data_no_scan(seeded_agency_client_with_brand):
    client_id, _brand_id = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        client_obj = await db.get(AgencyClient, client_id)
        template = get_template("wikipedia_plan")
        data = await template.fetch_data(db, client_obj)
    assert data["scan"] is None
    assert data["candidates"] == []


# ── site_plan fixtures ────────────────────────────────────────────────────────

@pytest.fixture
async def seeded_brand_with_site_audit(seeded_agency_client_with_brand) -> tuple[int, int]:
    cid, bid = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        audit = WebsiteAudit(
            brand_id=bid,
            status="completed",
            triggered_by="user",
            started_at=datetime.utcnow() - timedelta(hours=2),
            completed_at=datetime.utcnow() - timedelta(hours=1),
            total_pages=42,
            overall_score=58,
            bot_access_score=80,
            content_score=55,
            schema_score=40,
            technical_score=60,
            render_mode="server",
            llms_txt_present=False,
            llms_txt_valid=False,
        )
        db.add(audit)
        await db.flush()
        for i in range(3):
            rec = WebsiteAuditRecommendation(
                audit_id=audit.id,
                priority="high",
                priority_score=90 - i * 10,
                effort="low",
                category="schema",
                title=f"Fix {i}",
                body=f"Body of fix {i}",
                expected_impact="medium",
                llm_generated=True,
            )
            db.add(rec)
        await db.commit()
    return cid, bid


# ── site_plan tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_site_plan_registered():
    assert get_template("site_plan") is not None


@pytest.mark.asyncio
async def test_site_plan_fetch_data_with_audit(seeded_brand_with_site_audit):
    client_id, _brand_id = seeded_brand_with_site_audit
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("site_plan")
        data = await template.fetch_data(db, client)
    assert data["audit"] is not None
    assert data["audit"]["overall_score"] is not None
    assert len(data["top_fixes"]) >= 1
    # No code blocks / paste-ready artifacts — those stay internal.
    for fix in data["top_fixes"]:
        assert "artifact" not in fix


@pytest.mark.asyncio
async def test_site_plan_fetch_data_no_audit(seeded_agency_client_with_brand):
    client_id, _brand_id = seeded_agency_client_with_brand
    async with AsyncSessionLocal() as db:
        client = await db.get(AgencyClient, client_id)
        template = get_template("site_plan")
        data = await template.fetch_data(db, client)
    assert data["audit"] is None
    assert data["top_fixes"] == []
