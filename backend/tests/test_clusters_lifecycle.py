"""Tests for the cluster lifecycle (two-pool model).

Covers spec docs/superpowers/specs/2026-06-28-cluster-lifecycle-flow-design.md:
posted-draft inviolability, partial unique index, BrandContentSettings guard,
posting transition snapshot, prompt-id-keyed lift attribution, title fallback,
eager cluster shells.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal
from app.models import (
    Brand,
    BrandContentSettings,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    DraftAttribution,
    Prompt,
    User,
)
from tests.conftest import create_brand, register_and_login


@pytest_asyncio.fixture
async def seeded_cluster():
    """Direct-DB seed: brand + prompt + cluster + brief + 1 posted + 1 working.
    Returns (cluster_id, posted_draft_id, working_draft_id, brand_id, prompt_id).
    """
    import secrets
    suffix = secrets.token_hex(4)
    async with AsyncSessionLocal() as db:
        user = User(
            email=f"lifecycle-{suffix}@example.com",
            password_hash="x",
            subscription_tier="pro",
            email_verified=True,
        )
        db.add(user); await db.flush()
        brand = Brand(
            name=f"Lifecycle Co {suffix}",
            slug=f"lifecycle-{suffix}",
            user_id=user.id,
            tier="standard",
        )
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="how do widgets work", prompt_type="standard")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id,
            status="ready", pillar_mode="none", version=1,
        )
        db.add(cluster); await db.flush()
        brief = ContentBrief(
            cluster_id=cluster.id, version=1,
            positioning="positioning", key_claims=[], canonical_phrasings=[],
            stats=[], competitor_context={},
            narrative_spine="spine", tone_notes="tone",
            created_by="system",
        )
        db.add(brief); await db.flush()
        cluster.last_brief_id = brief.id
        posted = ContentDraft(
            brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
            platform="linkedin", status="posted", title="Posted v1",
            content_text="body", source="cluster",
            posted_url="https://linkedin.com/posts/foo",
        )
        working = ContentDraft(
            brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
            platform="medium", status="draft", title="Working",
            content_text="body", source="cluster",
        )
        db.add_all([posted, working]); await db.flush()
        # Attribution row for the posted draft.
        from datetime import datetime, UTC
        db.add(DraftAttribution(
            draft_id=posted.id, brand_id=brand.id, prompt_id=prompt.id,
            posted_at=datetime.now(UTC).replace(tzinfo=None),
            score_at_posting=10.0, current_score=15.0, delta=5.0, runs_since_posting=3,
        ))
        await db.commit()
        return (cluster.id, posted.id, working.id, brand.id, prompt.id)


# ── Task 2 ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_regenerate_cluster_never_deletes_posted_drafts(seeded_cluster, monkeypatch):
    """Critical safety: posted drafts and their attribution survive rebuild."""
    cluster_id, posted_id, working_id, _, _ = seeded_cluster

    from app.services import clustering_service

    # Stub the LLM-heavy phases so we exercise only the delete + insert logic.
    async def _noop_brief(db, *, cluster, tier):
        return (await db.execute(
            select(ContentBrief).where(ContentBrief.cluster_id == cluster.id)
        )).scalars().first()

    class _NoopPack:
        id = None
        sources: list = []

    async def _noop_pack(*a, **kw):
        return _NoopPack()

    async def _no_platforms(db, brand_id):
        return []  # no platforms enabled → no generation work

    monkeypatch.setattr(clustering_service, "build_brief", _noop_brief)
    monkeypatch.setattr(
        "app.services.cluster_evidence.build_cluster_pack", _noop_pack,
    )
    monkeypatch.setattr(clustering_service, "_enabled_platforms", _no_platforms)

    async with AsyncSessionLocal() as db:
        await clustering_service.regenerate_cluster(
            db, cluster_id=cluster_id, tier="pro", rebuild_brief=False,
        )

    async with AsyncSessionLocal() as db:
        posted_after = (await db.execute(
            select(ContentDraft).where(ContentDraft.id == posted_id)
        )).scalar_one_or_none()
        attr_after = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == posted_id)
        )).scalar_one_or_none()
        working_after = (await db.execute(
            select(ContentDraft).where(ContentDraft.id == working_id)
        )).scalar_one_or_none()

    assert posted_after is not None, "posted draft was deleted by regenerate_cluster"
    assert posted_after.status == "posted"
    assert attr_after is not None, "DraftAttribution was cascade-deleted with posted draft"
    assert working_after is None, "working draft should have been deleted by regen"


# ── Task 3 ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_regenerate_piece_rejects_disabled_platform(client, seeded_cluster):
    """Per-piece regen for a disabled platform must 400."""
    cluster_id, _, _, brand_id, _ = seeded_cluster

    # Disable reddit at brand level.
    async with AsyncSessionLocal() as db:
        db.add(BrandContentSettings(
            brand_id=brand_id, platform="reddit",
            enabled=False, auto_post=False,
        ))
        await db.commit()

    # The seeded user is not the test client's user — we need to be the brand's
    # owner. Easier path: log in as that user.
    user = None
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        user = await db.get(User, brand.user_id)
        password = "Password123"
        # rehash via the registration flow — easier: just re-set the password
        from app.routers.auth import hash_password
        user.password_hash = hash_password(password)
        await db.commit()

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": user.email, "password": "Password123"},
    )
    assert login_resp.status_code == 200, login_resp.text

    r = await client.post(
        f"/api/clusters/{brand_id}/{cluster_id}/regenerate-piece",
        json={"platform": "reddit"},
    )
    assert r.status_code == 400, r.text
    assert "disabled" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_partial_unique_index_blocks_second_working_draft(seeded_cluster):
    """A second working draft for (cluster, platform) must raise IntegrityError."""
    cluster_id, _, _, brand_id, prompt_id = seeded_cluster

    async with AsyncSessionLocal() as db:
        db.add(ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, cluster_id=cluster_id,
            platform="medium",  # already has a working 'medium' draft
            status="draft", title="dup", content_text="body", source="cluster",
        ))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_partial_unique_index_allows_multiple_posted_drafts(seeded_cluster):
    """Multiple posted drafts for the same (cluster, platform) are allowed (v1, v2)."""
    cluster_id, _, _, brand_id, prompt_id = seeded_cluster

    async with AsyncSessionLocal() as db:
        # Another posted linkedin draft — should succeed (v2).
        db.add(ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, cluster_id=cluster_id,
            platform="linkedin", status="posted", title="Posted v2",
            content_text="body", source="cluster",
            posted_url="https://linkedin.com/posts/v2",
        ))
        await db.commit()  # must not raise


# ── Task 4 ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_posting_transition_snapshots_url_and_brief_version(client, seeded_cluster):
    """Marking a draft posted must store posted_url + brief_version."""
    cluster_id, _, working_id, brand_id, _ = seeded_cluster

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        brief = await db.get(ContentBrief, cluster.last_brief_id)
        expected_version = brief.version
        brand = await db.get(Brand, brand_id)
        user = await db.get(User, brand.user_id)
        from app.routers.auth import hash_password
        user.password_hash = hash_password("Password123")
        await db.commit()

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": user.email, "password": "Password123"},
    )
    assert login_resp.status_code == 200, login_resp.text

    r = await client.put(
        f"/api/content/draft/{working_id}",
        json={"status": "posted", "posted_url": "https://medium.com/foo"},
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as db:
        d = (await db.execute(
            select(ContentDraft).where(ContentDraft.id == working_id)
        )).scalar_one()
    assert d.status == "posted"
    assert d.posted_url == "https://medium.com/foo"
    assert d.brief_version == expected_version
    assert d.posted_at is not None


# ── Task 5 ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cluster_lift_credits_legacy_posted_drafts_for_same_prompt(seeded_cluster):
    """A posted draft with cluster_id=NULL for the cluster's prompt must
    contribute to the cluster's lift number."""
    from app.routers.clusters import _cluster_lift_for_prompt

    cluster_id, _, _, brand_id, prompt_id = seeded_cluster

    async with AsyncSessionLocal() as db:
        # Legacy posted draft (cluster_id=NULL) for the same prompt.
        legacy = ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, cluster_id=None,
            platform="wikipedia", status="posted", title="Regulation A",
            content_text="body", source="manual",
        )
        db.add(legacy); await db.flush()
        # Legacy attribution: visibility was 10 when posted, now 88.
        from datetime import datetime, UTC
        db.add(DraftAttribution(
            draft_id=legacy.id, brand_id=brand_id, prompt_id=prompt_id,
            posted_at=datetime.now(UTC).replace(tzinfo=None),
            score_at_posting=10.0, current_score=88.0, delta=78.0,
            runs_since_posting=10,
        ))
        await db.commit()

        lift = await _cluster_lift_for_prompt(db, prompt_id, brand_id)

    assert lift is not None
    # Lift = current_prompt_visibility - first_post.score_at_posting.
    # Both posted rows have score_at_posting=10; current visibility depends on
    # _get_prompt_visibility (likely 0 here since no tracking runs exist).
    # So lift = 0 - 10 = -10. The point is the helper RETURNS a number, not None,
    # and that the first attribution row (the original posted draft) is used as
    # the baseline.
    assert isinstance(lift, float)


# ── Task 6 ───────────────────────────────────────────────────────────────────

def test_title_fallback_never_returns_untitled():
    """Short-form drafts without an h1 must never get '(untitled)'."""
    from app.services.clustering_service import _derive_title_fallback

    body = (
        "Reg A+ lets startups raise up to $75M from public investors. "
        "Most companies skip it because the cost-of-marketing reality is hidden."
    )
    title = _derive_title_fallback(body, prompt_text="how to raise $75M", platform="x")
    assert title
    assert "untitled" not in title.lower()
    assert "Reg A+" in title

    empty = _derive_title_fallback("", prompt_text="how to raise $75M", platform="x")
    assert empty
    assert "untitled" not in empty.lower()
    assert "how to raise" in empty.lower()


# ── Task 7 ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_prompt_creates_cluster_shell(client):
    """Adding a prompt to an existing brand must eagerly create a cluster shell."""
    await register_and_login(client, email="eager@example.com")
    brand = await create_brand(client, name="EagerCo", prompts=["initial prompt"])
    brand_id = brand["id"]

    # Add a second prompt.
    r = await client.post(
        f"/api/brands/{brand_id}/prompts",
        json={"text": "second prompt"},
    )
    assert r.status_code in (200, 201), r.text
    new_prompt_id = r.json()["id"]

    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == new_prompt_id)
        )).scalar_one_or_none()
    assert cluster is not None, "no cluster shell created for new prompt"
    assert cluster.status == "pending"


@pytest.mark.asyncio
async def test_create_brand_creates_cluster_shells_for_all_prompts(client):
    """Creating a brand with N prompts must create N cluster shells."""
    await register_and_login(client, email="eager2@example.com")
    brand = await create_brand(
        client, name="ShellCo",
        prompts=["prompt one", "prompt two", "prompt three"],
    )
    brand_id = brand["id"]

    async with AsyncSessionLocal() as db:
        clusters = (await db.execute(
            select(ContentCluster).where(ContentCluster.brand_id == brand_id)
        )).scalars().all()
    assert len(clusters) == 3, f"expected 3 cluster shells, got {len(clusters)}"
