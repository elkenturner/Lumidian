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
async def test_persist_pack_is_idempotent_across_regenerations():
    """ContentClusterSource has UNIQUE(cluster_id, url) — without clearing the
    old rows on regen, the second build_cluster_pack would crash on integrity.
    """
    from app.services.cluster_evidence import build_cluster_pack
    from app.models import ContentClusterSource as CCS, ContentEvidencePack
    brand_id, prompt_id, run_id, cluster_id = await _seed_brand_with_run("pack-idempo")
    fake_serper = AsyncMock(return_value=[
        {"url": "https://reuters.com/x", "title": "R", "snippet": "..."},
        {"url": "https://nytimes.com/y", "title": "N", "snippet": "..."},
        {"url": "https://techcrunch.com/z", "title": "T", "snippet": "..."},
    ])
    with patch("app.services.cluster_evidence.fetch_and_dedupe", new=fake_serper):
        async with AsyncSessionLocal() as db:
            cluster = await db.get(ContentCluster, cluster_id)
            await build_cluster_pack(db, cluster=cluster, prompt_text="q",
                                     key_claims=[], version=1)
        # Second regen — same URL set — should succeed, not raise IntegrityError.
        async with AsyncSessionLocal() as db:
            cluster = await db.get(ContentCluster, cluster_id)
            await build_cluster_pack(db, cluster=cluster, prompt_text="q",
                                     key_claims=[], version=2)
    async with AsyncSessionLocal() as db:
        sources = (await db.execute(
            select(CCS).where(CCS.cluster_id == cluster_id)
        )).scalars().all()
        assert len(sources) == 3  # cleared + reinserted, not stacked


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


# ---------------------------------------------------------------------------
# Task 8: never hard-fail to nothing — ungated low-evidence fallback
# ---------------------------------------------------------------------------


def test_gate_error_carries_sources():
    """gate_pack raises PackGateError with .sources == the pack it rejected."""
    from app.services.cluster_evidence import PackGateError, gate_pack

    pack = [
        {"url": "https://techcrunch.com/c", "title": "t", "snippet": "s",
         "domain": "techcrunch.com", "tier": "T2"},
        {"url": "https://forbes.com/d", "title": "t", "snippet": "s",
         "domain": "forbes.com", "tier": "T2"},
    ]
    with pytest.raises(PackGateError) as exc:
        gate_pack(pack)
    assert exc.value.sources == pack


@pytest.mark.asyncio
async def test_regenerate_falls_back_to_ungated_t3_pack(monkeypatch):
    """Serper returns only T3 sources, no citations, no profile, no audit —
    the cluster must NOT be briefing_failed. It proceeds to generation and
    lands on ready_low_evidence once pieces succeed.
    """
    from app.services import cluster_evidence
    from app.services.clustering_service import regenerate_cluster

    async def fake_fetch(queries):
        return [
            {"url": "https://blog-a.example.com/1", "title": "A", "snippet": "..."},
            {"url": "https://blog-b.example.com/2", "title": "B", "snippet": "..."},
            {"url": "https://blog-c.example.com/3", "title": "C", "snippet": "..."},
            {"url": "https://blog-d.example.com/4", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_gen(*args, **kwargs):
        return "Piece title", "Piece body [S1]", 0.9, [], False
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )

    async def fake_owned(**kwargs):
        return ("ok", "owned_site", "Piece title", "Piece body [S1]", 0.9, [], False)
    monkeypatch.setattr(
        "app.services.clustering_service._gen_owned_site_piece", fake_owned,
    )

    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({
            "positioning": "p", "key_claims": [], "canonical_phrasings": [],
            "stats": [], "narrative_spine": "", "tone_notes": "",
        })
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="ungated-t3")

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status != "briefing_failed"
        assert cluster.status == "ready_low_evidence"
        pack_rows = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster_id)
        )).scalars().all()
        assert len(pack_rows) == 1
        domains = {s["domain"] for s in pack_rows[0].sources}
        assert "blog-a.example.com" in domains


def test_pack_meets_gate_false_for_all_t3_pack():
    """An all-T3 pack (e.g. a persisted ungated fallback) never clears the gate."""
    from app.services.cluster_evidence import pack_meets_gate

    pack = [
        {"url": "https://blog-a.example.com/1", "title": "A", "snippet": "...",
         "domain": "blog-a.example.com", "tier": "T3"},
        {"url": "https://blog-b.example.com/2", "title": "B", "snippet": "...",
         "domain": "blog-b.example.com", "tier": "T3"},
    ]
    assert pack_meets_gate(pack) is False


def test_pack_meets_gate_false_for_brand_authority_pack():
    """A brand-authority pack (synthetic 'brand' tier) counts zero T1/T2 —
    still fails the gate, so low_evidence semantics are unchanged for this path.
    """
    from app.services.cluster_evidence import pack_meets_gate

    pack = [
        {"url": "internal://brand-profile", "title": "Brand profile", "snippet": "...",
         "domain": "brand-profile", "tier": "brand"},
        {"url": "https://acme.com/about", "title": "About", "snippet": "...",
         "domain": "acme.com", "tier": "brand"},
    ]
    assert pack_meets_gate(pack) is False


def test_pack_meets_gate_true_for_authoritative_pack():
    """1x T1 + 2x T2 clears both the min-T1 and min-T1+T2 floors."""
    from app.services.cluster_evidence import pack_meets_gate

    pack = [
        {"url": "https://www.nih.gov/x", "title": "N", "snippet": "...",
         "domain": "nih.gov", "tier": "T1"},
        {"url": "https://techcrunch.com/y", "title": "T", "snippet": "...",
         "domain": "techcrunch.com", "tier": "T2"},
        {"url": "https://forbes.com/z", "title": "F", "snippet": "...",
         "domain": "forbes.com", "tier": "T2"},
    ]
    assert pack_meets_gate(pack) is True


@pytest.mark.asyncio
async def test_regenerate_pieces_preserves_low_evidence_for_reused_ungated_pack(monkeypatch):
    """Regen-without-rebuild-brief ('Regenerate pieces') reuses an existing pack.
    If that pack is an ungated T3-only pack (from build_cluster_pack_ungated),
    the cluster must land on ready_low_evidence, not ready — the old
    `tier == "brand"` sniff missed this case entirely.
    """
    from app.services.clustering_service import regenerate_cluster

    async def fake_gen(*args, **kwargs):
        return "Piece title", "Piece body [S1]", 0.9, [], False
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )

    async def fake_owned(**kwargs):
        return ("ok", "owned_site", "Piece title", "Piece body [S1]", 0.9, [], False)
    monkeypatch.setattr(
        "app.services.clustering_service._gen_owned_site_piece", fake_owned,
    )

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="reuse-ungated-t3")

        pack = ContentEvidencePack(
            cluster_id=cluster_id, version=1,
            sources=[
                {"url": "https://blog-a.example.com/1", "title": "A", "snippet": "...",
                 "domain": "blog-a.example.com", "tier": "T3"},
                {"url": "https://blog-b.example.com/2", "title": "B", "snippet": "...",
                 "domain": "blog-b.example.com", "tier": "T3"},
            ],
            total_t1=0, total_t2=0, total_t3=2,
        )
        db.add(pack); await db.flush()

        brief = ContentBrief(
            cluster_id=cluster_id, version=1,
            positioning="p", key_claims=[], canonical_phrasings=[], stats=[],
            narrative_spine="", tone_notes="", created_by="system",
            evidence_pack_id=pack.id,
        )
        db.add(brief)
        await db.commit()

    async with AsyncSessionLocal() as db:
        cluster = await regenerate_cluster(
            db, cluster_id=cluster_id, tier="basic", rebuild_brief=False,
        )
        assert cluster.status == "ready_low_evidence"

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "ready_low_evidence"


@pytest.mark.asyncio
async def test_truly_zero_sources_fails_with_no_sources_found(monkeypatch):
    """Serper empty + no citations + no profile + no audit -> briefing_failed,
    failure_reason == 'no_sources_found'.
    """
    from app.services import cluster_evidence
    from app.services.clustering_service import regenerate_cluster

    async def fake_fetch(queries):
        return []
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({
            "positioning": "p", "key_claims": [], "canonical_phrasings": [],
            "stats": [], "narrative_spine": "", "tone_notes": "",
        })
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="zero-sources")

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert cluster.failure_reason == "no_sources_found"
