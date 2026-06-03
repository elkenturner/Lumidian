"""The cluster pack now has a three-tier fallback chain:

  1. CitationSource rows from recent tracking runs (third_party only)
  2. Live Serper search (existing behaviour)
  3. Brand-as-authority soft-fail (BrandProfile + crawled site pages)

These tests cover the new fallback transitions — the original Serper-only
behaviour is already covered in test_cluster_evidence.py.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, BrandProfile, CitationSource, ContentBrief, ContentCluster,
    ContentEvidencePack, Prompt, TrackingRun, User, WebsiteAudit, WebsiteAuditPage,
)


async def _seed_brand_with_run(slug: str):
    """Helper — minimal brand + prompt + one completed tracking run."""
    async with AsyncSessionLocal() as db:
        user = User(email=f"{slug}@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug=slug, user_id=user.id, website_url="https://acme.com")
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        run = TrackingRun(
            brand_id=brand.id, status="completed", run_type="manual",
            total_queries=1, total_mentions=0, overall_score=0.0,
        )
        db.add(run); await db.flush()
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id,
            status="briefing", pillar_mode="none", version=1,
        )
        db.add(cluster); await db.commit(); await db.refresh(cluster)
        return brand.id, prompt.id, run.id, cluster.id


async def _seed_citations(brand_id: int, prompt_id: int, run_id: int, urls: list[tuple[str, str]]):
    async with AsyncSessionLocal() as db:
        for url, domain in urls:
            db.add(CitationSource(
                brand_id=brand_id, tracking_run_id=run_id, prompt_id=prompt_id,
                model="perplexity", url=url, domain=domain, kind="third_party",
            ))
        await db.commit()


@pytest.mark.asyncio
async def test_pack_built_from_citations_when_they_clear_gate():
    """Citations path: tracking-run third_party citations alone clear the gate."""
    from app.services.cluster_evidence import build_cluster_pack
    brand_id, prompt_id, run_id, cluster_id = await _seed_brand_with_run("pack-cit-pass")
    await _seed_citations(brand_id, prompt_id, run_id, [
        ("https://www.nih.gov/cancer-screening", "nih.gov"),       # T1 via .gov
        ("https://nytimes.com/cancer-news", "nytimes.com"),        # T1
        ("https://techcrunch.com/biotech", "techcrunch.com"),      # T2
    ])
    # Serper is NOT called — patch it so a real Serper call would fail loudly.
    with patch("app.services.cluster_evidence.fetch_and_dedupe",
               new=AsyncMock(side_effect=RuntimeError("should not reach Serper"))):
        async with AsyncSessionLocal() as db:
            cluster = await db.get(ContentCluster, cluster_id)
            pack = await build_cluster_pack(
                db, cluster=cluster, prompt_text="q", key_claims=[], version=1,
            )
    assert pack.total_t1 >= 1
    domains = {s["domain"] for s in pack.sources}
    assert "nih.gov" in domains
    assert "nytimes.com" in domains


@pytest.mark.asyncio
async def test_pack_falls_through_to_serper_when_citations_fail_gate():
    """Citations exist but don't clear the gate → fall through to Serper."""
    from app.services.cluster_evidence import build_cluster_pack
    brand_id, prompt_id, run_id, cluster_id = await _seed_brand_with_run("pack-fall-serper")
    # Citations are all T3 — won't clear MIN_T1=1
    await _seed_citations(brand_id, prompt_id, run_id, [
        ("https://example.com/a", "example.com"),
        ("https://randomblog.example.com/b", "randomblog.example.com"),
    ])
    fake_serper = AsyncMock(return_value=[
        {"url": "https://reuters.com/x", "title": "R", "snippet": "..."},
        {"url": "https://nytimes.com/y", "title": "N", "snippet": "..."},
        {"url": "https://techcrunch.com/z", "title": "T", "snippet": "..."},
    ])
    with patch("app.services.cluster_evidence.fetch_and_dedupe", new=fake_serper):
        async with AsyncSessionLocal() as db:
            cluster = await db.get(ContentCluster, cluster_id)
            pack = await build_cluster_pack(
                db, cluster=cluster, prompt_text="q", key_claims=[], version=1,
            )
    fake_serper.assert_called()
    domains = {s["domain"] for s in pack.sources}
    assert "reuters.com" in domains


@pytest.mark.asyncio
async def test_brand_authority_pack_when_profile_present():
    """Soft-fail path: build_cluster_pack_from_brand_authority synthesizes a pack."""
    from app.services.cluster_evidence import build_cluster_pack_from_brand_authority

    async with AsyncSessionLocal() as db:
        user = User(email="ba-pack@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="ba-pack-brand", user_id=user.id,
                      website_url="https://acme.com")
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        profile = BrandProfile(
            brand_id=brand.id,
            company_description="Acme makes widgets.",
            key_stats="100M users",
        )
        db.add(profile)
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id,
            status="briefing", pillar_mode="none", version=1,
        )
        db.add(cluster)
        await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        pack = await build_cluster_pack_from_brand_authority(
            db, cluster=cluster, version=1,
        )
    assert pack is not None
    tiers = {s["tier"] for s in pack.sources}
    assert tiers == {"brand"}
    assert any(s["url"] == "internal://brand-profile" for s in pack.sources)


@pytest.mark.asyncio
async def test_brand_authority_pack_returns_none_when_profile_and_audit_missing():
    """Genuinely nothing to ground with — return None so caller hard-fails."""
    from app.services.cluster_evidence import build_cluster_pack_from_brand_authority

    async with AsyncSessionLocal() as db:
        user = User(email="ba-none@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="ba-none-brand", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id,
            status="briefing", pillar_mode="none", version=1,
        )
        db.add(cluster); await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        pack = await build_cluster_pack_from_brand_authority(
            db, cluster=cluster, version=1,
        )
    assert pack is None
