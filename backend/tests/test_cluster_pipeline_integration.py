"""End-to-end test: cluster generation flows through the content-quality pipeline.

Verifies that when ``regenerate_cluster`` runs at a paid tier:
  1. ``_generate_with_new_pipeline`` is invoked (Evidence + critic + voice layers
     are reachable per tier matrix).
  2. The cluster's ``brief_context`` is forwarded into ``build_prompt``.
  3. ``quality_score`` is persisted on each ContentDraft when the critic ran.
  4. ``ContentDraftCitation`` rows are inserted for any ``[SN]`` citations the
     writer produced.

We mock the *outer* drafting-pipeline call (rather than ``_generate_piece_text``)
so the bridge between clustering_service and drafting_service is exercised.
"""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    ContentDraftCitation,
    Prompt,
    User,
)
from app.services.clustering_service import regenerate_cluster
from app.services.drafting.citations import RenderedCitation


SAMPLE_BRIEF_JSON = """{
  "positioning": "Pos",
  "key_claims": ["c1"],
  "canonical_phrasings": ["Acme does X"],
  "stats": [],
  "narrative_spine": "spine",
  "tone_notes": "neutral"
}"""


@pytest_asyncio.fixture
async def pro_brand_with_prompt(db_session: AsyncSession) -> tuple[User, Brand, Prompt]:
    user = User(
        email="cluster-pipe@test.com",
        password_hash="x",
        email_verified=1,
        subscription_tier="pro",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="cluster-pipe-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="how does acme work")
    db_session.add(prompt)
    await db_session.commit()
    return user, brand, prompt


@pytest.mark.asyncio
async def test_cluster_pieces_route_through_content_quality_pipeline(
    db_session: AsyncSession,
    pro_brand_with_prompt: tuple[User, Brand, Prompt],
) -> None:
    user, brand, prompt = pro_brand_with_prompt
    cluster = ContentCluster(
        brand_id=brand.id,
        prompt_id=prompt.id,
        status="pending",
        pillar_mode="none",
        version=1,
    )
    db_session.add(cluster)
    await db_session.commit()

    # Capture brief_context forwarded into the pipeline.
    seen_brief_contexts: list[str] = []
    seen_tiers: list[str | None] = []
    seen_platforms: list[str] = []

    async def fake_pipeline(**kwargs):
        seen_brief_contexts.append(kwargs.get("brief_context") or "")
        seen_tiers.append(kwargs.get("tier"))
        seen_platforms.append(kwargs.get("platform_key"))
        # Simulate Layer-2 critic running on Pro: returns a body, a passing
        # score, and one citation that would have been resolved from the pack.
        body = f"Body for {kwargs['platform_key']}. [S1]"
        return (
            body,
            7.5,
            [RenderedCitation(
                source_ref="S1",
                url="https://nature.com/study",
                title="Nature study",
                position_marker=10,
            )],
        )

    async def fake_summary(*, draft_text: str, query: str) -> str:
        return "Acme reduces X by 40%."

    # Mock build_brief to skip the brief LLM call. The brief content needs
    # to flow through clustering_service._build_brief_context — return a stub.
    async def fake_build_brief(db, *, cluster, tier):
        from datetime import UTC, datetime
        brief = ContentBrief(
            cluster_id=cluster.id,
            positioning="Pos",
            key_claims=["c1"],
            canonical_phrasings=["Acme does X"],
            stats=[],
            narrative_spine="spine",
            tone_notes="neutral",
            created_by="test",
            created_at=datetime.now(UTC),
        )
        db.add(brief)
        await db.flush()
        cluster.last_brief_id = brief.id
        await db.flush()
        return brief

    _FAKE_EVIDENCE = [
        {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
        {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
        {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
    ]

    with patch(
        "app.services.clustering_service.build_brief",
        new=AsyncMock(side_effect=fake_build_brief),
    ), patch(
        "app.services.cluster_evidence.fetch_and_dedupe",
        new=AsyncMock(return_value=_FAKE_EVIDENCE),
    ), patch(
        "app.services.drafting_service._generate_with_new_pipeline",
        new=AsyncMock(side_effect=fake_pipeline),
    ), patch(
        "app.services.clustering_service.generate_draft_summary",
        new=AsyncMock(side_effect=fake_summary),
    ), patch(
        "app.services.clustering_service.propose_pillar",
        new=AsyncMock(return_value=None),
    ), patch(
        # Avoid touching prompt analytics that require completed tracking runs.
        "app.services.drafting_service._analyze_responses_for_prompt",
        new=AsyncMock(return_value="(no responses)"),
    ), patch(
        "app.services.drafting_service._get_prompt_visibility",
        new=AsyncMock(return_value=0.0),
    ), patch(
        "app.services.drafting_service._load_profile_context",
        new=AsyncMock(return_value="profile ctx"),
    ):
        result = await regenerate_cluster(db_session, cluster_id=cluster.id, tier="pro")

    assert result.status == "ready"

    # Every piece reached the new pipeline with tier='pro' and a brief context.
    assert len(seen_tiers) == 5
    assert all(t == "pro" for t in seen_tiers)
    assert all("POSITIONING: Pos" in ctx for ctx in seen_brief_contexts)
    # All 5 cluster platforms exercised — names are the resolved platform keys
    # (e.g. `linkedin` → `linkedin_article`, `x` → `x_thread`).
    assert set(seen_platforms) == {"linkedin_article", "medium", "reddit", "quora", "x_thread"}

    # Every draft has the critic's quality_score persisted.
    drafts = (
        await db_session.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
        )
    ).scalars().all()
    assert len(drafts) == 5
    assert all(d.quality_score == 7.5 for d in drafts)
    assert all(d.summary == "Acme reduces X by 40%." for d in drafts)

    # Citation rows exist for every piece (one [S1] each in this fixture).
    citations = (
        await db_session.execute(
            select(ContentDraftCitation).where(
                ContentDraftCitation.draft_id.in_([d.id for d in drafts])
            )
        )
    ).scalars().all()
    assert len(citations) == 5
    assert all(c.url == "https://nature.com/study" for c in citations)


@pytest.mark.asyncio
async def test_free_tier_cluster_still_persists_no_quality_or_citations(
    db_session: AsyncSession,
) -> None:
    """tier=None → pipeline runs with no Evidence Pack, no critic, no citations.
    Drafts still get created, but quality_score and ContentDraftCitation
    rows stay empty.
    """
    user = User(email="free-cluster@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Free", slug="free-cluster", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="q")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(
        brand_id=brand.id, prompt_id=prompt.id, status="pending",
        pillar_mode="none", version=1,
    )
    db_session.add(cluster)
    await db_session.commit()

    async def fake_pipeline(**kwargs):
        # No critic, no citations on tier=None.
        return (f"Body for {kwargs['platform_key']}.", None, [])

    async def fake_build_brief(db, *, cluster, tier):
        from datetime import UTC, datetime
        brief = ContentBrief(
            cluster_id=cluster.id,
            positioning="Pos",
            key_claims=[],
            canonical_phrasings=[],
            stats=[],
            narrative_spine="",
            tone_notes="",
            created_by="test",
            created_at=datetime.now(UTC),
        )
        db.add(brief)
        await db.flush()
        cluster.last_brief_id = brief.id
        await db.flush()
        return brief

    _FAKE_EVIDENCE_FREE = [
        {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
        {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
        {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
    ]

    with patch(
        "app.services.clustering_service.build_brief",
        new=AsyncMock(side_effect=fake_build_brief),
    ), patch(
        "app.services.cluster_evidence.fetch_and_dedupe",
        new=AsyncMock(return_value=_FAKE_EVIDENCE_FREE),
    ), patch(
        "app.services.drafting_service._generate_with_new_pipeline",
        new=AsyncMock(side_effect=fake_pipeline),
    ), patch(
        "app.services.clustering_service.generate_draft_summary",
        new=AsyncMock(return_value=""),
    ), patch(
        "app.services.clustering_service.propose_pillar",
        new=AsyncMock(return_value=None),
    ), patch(
        "app.services.drafting_service._analyze_responses_for_prompt",
        new=AsyncMock(return_value=""),
    ), patch(
        "app.services.drafting_service._get_prompt_visibility",
        new=AsyncMock(return_value=0.0),
    ), patch(
        "app.services.drafting_service._load_profile_context",
        new=AsyncMock(return_value=""),
    ):
        result = await regenerate_cluster(db_session, cluster_id=cluster.id, tier=None)

    assert result.status == "ready"
    drafts = (
        await db_session.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
        )
    ).scalars().all()
    assert len(drafts) == 5
    assert all(d.quality_score is None for d in drafts)
    citations = (
        await db_session.execute(
            select(ContentDraftCitation).where(
                ContentDraftCitation.draft_id.in_([d.id for d in drafts])
            )
        )
    ).scalars().all()
    assert citations == []
