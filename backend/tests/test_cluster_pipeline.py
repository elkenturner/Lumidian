# backend/tests/test_cluster_pipeline.py
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    ContentBrief, ContentCluster, ContentDraft, ContentEvidencePack, Prompt,
)
from app.services.clustering_service import regenerate_cluster


@pytest.mark.asyncio
async def test_regenerate_uses_shared_pack_and_sets_last_brief_id(monkeypatch):
    """Pack is built once and shared; last_brief_id is updated on success."""
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    # Mock the per-piece writer to return a fixed body.
    async def fake_gen(*args, **kwargs):
        return "Piece title", "Piece body [S1]", 0.9, [], False
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )
    # Mock brief LLM to return valid JSON
    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({
            "positioning": "p", "key_claims": ["k1"], "canonical_phrasings": ["Acme leads X"],
            "stats": [], "narrative_spine": "", "tone_notes": "",
        })
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-x")

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="pro")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        packs = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster_id)
        )).scalars().all()
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster_id)
        )).scalars().all()
        assert cluster.status == "ready"
        assert cluster.last_brief_id is not None
        assert len(packs) == 1  # ONE pack, not 5
        assert len(drafts) == 5


@pytest.mark.asyncio
async def test_regenerate_marks_briefing_failed_when_authority_too_low(monkeypatch):
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        # Only T3
        return [
            {"url": "https://blog.example.com/a", "title": "A", "snippet": "..."},
            {"url": "https://blog2.example.com/b", "title": "B", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({"positioning": "p", "key_claims": [], "canonical_phrasings": [],
                          "stats": [], "narrative_spine": "", "tone_notes": ""})
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-fail")

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert "insufficient" in (cluster.failure_reason or "").lower()
        # No drafts created
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster_id)
        )).scalars().all()
        assert drafts == []


@pytest.mark.asyncio
async def test_partial_generation_marks_generation_partial(monkeypatch):
    """One piece fails; cluster reaches generation_partial; piece has failure_reason."""
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_gen(*args, **kwargs):
        if kwargs.get("platform") == "reddit":
            raise RuntimeError("simulated reddit failure")
        return "T", "B", 0.5, []
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )
    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({"positioning": "p", "key_claims": [],
                          "canonical_phrasings": [], "stats": [],
                          "narrative_spine": "", "tone_notes": ""})
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-partial")

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "generation_partial"
        # Failed piece recorded its reason
        failed = (await db.execute(
            select(ContentDraft).where(
                ContentDraft.cluster_id == cluster_id,
                ContentDraft.platform == "reddit",
                ContentDraft.generation_state == "failed",
            )
        )).scalars().first()
        assert failed is not None
        assert "simulated" in (failed.failure_reason or "")
