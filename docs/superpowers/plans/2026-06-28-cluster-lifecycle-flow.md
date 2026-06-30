# Cluster Lifecycle Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ContentCluster` a long-lived workspace with immutable posted drafts and a mutable working pool, prompt-id-keyed lift attribution that covers legacy/Wikipedia posts, eager cluster shells per tracked prompt, and a composed posted↔working progress bar in place of an opaque `Ready` enum.

**Architecture:** Two-pool model in the existing `content_drafts` table (posted vs working, distinguished by `status`). Working pool guarded by a partial unique index on `(cluster_id, platform) WHERE status IN ('draft','approved','failed')`. Posting transition snapshots `posted_url` + `brief_version` on the draft row and writes a `DraftAttribution`. Cluster lift = `current_visibility − score_at_first_posted_draft_for_prompt`. Eager cluster shells per `Prompt` insert so the grid always shows 1 card per prompt. Frontend renders two halves of a progress bar derived live from row state.

**Tech Stack:** FastAPI + async SQLAlchemy 2.0, SQLite (partial indexes via `WHERE` clause), Next.js 15 + TypeScript, Tailwind, Radix.

**Spec:** `docs/superpowers/specs/2026-06-28-cluster-lifecycle-flow-design.md`

---

## Task 1: Schema migration + model columns

**Files:**
- Modify: `backend/app/models.py:328-379` (add `brief_version`, `posted_url` to `ContentDraft`)
- Modify: `backend/app/database.py:691` (append new migration section before `cleanup_stale_runs`)

- [ ] **Step 1: Add columns to `ContentDraft` model**

Insert two new columns into the `ContentDraft` class right after `visibility_at_post: Mapped[float | None] = mapped_column(Float, nullable=True)` (line 355):

```python
    posted_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    brief_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

- [ ] **Step 2: Add migration section to `database.py`**

Append a new `async with engine.begin() as conn:` block at the bottom of `run_migrations()` (just before the `cleanup_stale_runs` function definition, around line 720). This handles all six migration steps from the spec:

```python
    # --- Migration: cluster lifecycle flow (2026-06-28) ---
    async with engine.begin() as conn:
        # Step 1+2: new columns on content_drafts
        for col_sql in (
            "ALTER TABLE content_drafts ADD COLUMN posted_url VARCHAR(1024)",
            "ALTER TABLE content_drafts ADD COLUMN brief_version INTEGER",
        ):
            try:
                await conn.execute(text(col_sql))
            except Exception as exc:
                if "duplicate column" not in str(exc).lower():
                    raise

        # Step 3a: dedupe working drafts before adding the unique index.
        # For each (cluster_id, platform) with multiple working drafts, keep the
        # row with the highest id and delete the rest. Posted drafts untouched.
        await conn.execute(text("""
            DELETE FROM content_drafts
            WHERE id IN (
                SELECT cd.id FROM content_drafts cd
                WHERE cd.cluster_id IS NOT NULL
                  AND cd.status IN ('draft','approved','failed')
                  AND cd.id < (
                    SELECT MAX(cd2.id) FROM content_drafts cd2
                    WHERE cd2.cluster_id = cd.cluster_id
                      AND cd2.platform = cd.platform
                      AND cd2.status IN ('draft','approved','failed')
                  )
            )
        """))

        # Step 3b: drop working drafts on currently-disabled platforms.
        # Posted drafts on disabled platforms stay (historical facts).
        await conn.execute(text("""
            DELETE FROM content_drafts
            WHERE cluster_id IS NOT NULL
              AND status IN ('draft','approved','failed')
              AND id IN (
                SELECT cd.id FROM content_drafts cd
                JOIN content_clusters cc ON cc.id = cd.cluster_id
                JOIN brand_content_settings bcs
                  ON bcs.brand_id = cc.brand_id AND bcs.platform = cd.platform
                WHERE bcs.enabled = 0
              )
        """))

        # Step 3c: partial unique index on the working pool
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_platform_working
              ON content_drafts(cluster_id, platform)
              WHERE status IN ('draft','approved','failed') AND cluster_id IS NOT NULL
        """))

        # Step 4: backfill posted_url from the latest ContentPost.post_url per draft
        await conn.execute(text("""
            UPDATE content_drafts AS cd
            SET posted_url = (
                SELECT cp.post_url FROM content_posts cp
                WHERE cp.draft_id = cd.id AND cp.post_url IS NOT NULL
                ORDER BY cp.posted_at DESC LIMIT 1
            )
            WHERE cd.status = 'posted' AND cd.posted_url IS NULL
        """))

        # Step 5: eager cluster shells for every Prompt without one
        await conn.execute(text("""
            INSERT INTO content_clusters (brand_id, prompt_id, status, pillar_mode, version, created_at)
            SELECT p.brand_id, p.id, 'pending', 'none', 0, CURRENT_TIMESTAMP
            FROM prompts p
            LEFT JOIN content_clusters cc ON cc.prompt_id = p.id
            WHERE cc.id IS NULL
        """))

        # Step 6: drop legacy partial_failed status
        await conn.execute(text(
            "UPDATE content_clusters SET status = 'generation_partial' WHERE status = 'partial_failed'"
        ))

        logger.info("Migration applied: cluster lifecycle flow (columns + unique index + backfills)")
```

- [ ] **Step 3: Verify migration runs cleanly against a copy of prod DB**

```bash
cd /Users/ken/Desktop/Lumidian
railway ssh "cp /data/lumidian.db /tmp/lumidian_test.db"
railway ssh "python3 -c \"
import asyncio, os
os.environ['DATABASE_URL'] = 'sqlite+aiosqlite:////tmp/lumidian_test.db'
os.environ['JWT_SECRET'] = 'test'*8
from app.database import run_migrations, create_tables
async def main():
    await create_tables()
    await run_migrations()
    import sqlite3
    c = sqlite3.connect('/tmp/lumidian_test.db')
    cur = c.cursor()
    cur.execute('SELECT COUNT(*) FROM content_clusters WHERE brand_id = 2')
    print('MSC cluster count after migration:', cur.fetchone()[0])
    cur.execute(\\\"SELECT name FROM sqlite_master WHERE type='index' AND name='uq_cluster_platform_working'\\\")
    print('Unique index present:', cur.fetchone())
asyncio.run(main())
\""
```
Expected: cluster count = 13 (was 10, +3 orphan shells), unique index present.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(clusters): schema for two-pool lifecycle + orphan shell backfill"
```

---

## Task 2: Posted-draft inviolability in `regenerate_cluster`

**Files:**
- Modify: `backend/app/services/clustering_service.py:432-436`
- Test: `backend/tests/test_clusters_lifecycle.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_clusters_lifecycle.py`:

```python
"""Tests for the cluster lifecycle (two-pool model)."""
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    DraftAttribution,
    Prompt,
    User,
)


async def _seed_cluster_with_posted_and_working(db) -> tuple[int, int, int]:
    """Create a brand + prompt + cluster + 1 posted draft + 1 working draft.
    Returns (cluster_id, posted_draft_id, working_draft_id).
    """
    user = User(email=f"lifecycle{pytest.__hash__()}@example.com", password_hash="x", subscription_tier="pro")
    db.add(user); await db.flush()
    brand = Brand(name="Lifecycle Co", slug=f"lifecycle-{user.id}", user_id=user.id, tier="pro")
    db.add(brand); await db.flush()
    prompt = Prompt(brand_id=brand.id, text="how do widgets work", prompt_type="standard")
    db.add(prompt); await db.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready", pillar_mode="none", version=1)
    db.add(cluster); await db.flush()
    brief = ContentBrief(
        cluster_id=cluster.id, version=1,
        positioning="positioning", key_claims=[], canonical_phrasings=[],
        stats=[], competitor_context={}, narrative_spine="spine", tone_notes="tone",
        created_by="system",
    )
    db.add(brief); await db.flush()
    cluster.last_brief_id = brief.id
    posted = ContentDraft(
        brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
        platform="linkedin", status="posted", title="Posted v1", content_text="body",
        source="cluster", posted_url="https://linkedin.com/posts/foo",
    )
    working = ContentDraft(
        brand_id=brand.id, prompt_id=prompt.id, cluster_id=cluster.id,
        platform="medium", status="draft", title="Working", content_text="body",
        source="cluster",
    )
    db.add_all([posted, working]); await db.flush()
    await db.commit()
    return cluster.id, posted.id, working.id


@pytest.mark.asyncio
async def test_regenerate_cluster_never_deletes_posted_drafts(monkeypatch):
    """Critical safety test: posted drafts and their attribution survive rebuild."""
    from app.services import clustering_service

    async with AsyncSessionLocal() as db:
        cluster_id, posted_id, working_id = await _seed_cluster_with_posted_and_working(db)
        db.add(DraftAttribution(
            draft_id=posted_id, brand_id=1, prompt_id=1,
            score_at_posting=10.0, current_score=15.0, delta=5.0, runs_since_posting=3,
        ))
        await db.commit()

    # Stub out the LLM-heavy phases so we exercise only the delete + insert logic.
    async def _noop_brief(*a, **kw):
        from app.models import ContentBrief
        async with AsyncSessionLocal() as d:
            b = (await d.execute(select(ContentBrief).where(ContentBrief.cluster_id == cluster_id))).scalars().first()
            return b
    async def _noop_pack(*a, **kw):
        class _P:
            id = None; sources = []
        return _P()
    monkeypatch.setattr(clustering_service, "build_brief", _noop_brief)
    monkeypatch.setattr("app.services.cluster_evidence.build_cluster_pack", _noop_pack)
    monkeypatch.setattr(clustering_service, "_enabled_platforms",
                        lambda db, brand_id: _async_return([]))

    async with AsyncSessionLocal() as db:
        await clustering_service.regenerate_cluster(db, cluster_id=cluster_id, tier="pro", rebuild_brief=False)

    async with AsyncSessionLocal() as db:
        posted_after = (await db.execute(select(ContentDraft).where(ContentDraft.id == posted_id))).scalar_one_or_none()
        attr_after = (await db.execute(select(DraftAttribution).where(DraftAttribution.draft_id == posted_id))).scalar_one_or_none()
        working_after = (await db.execute(select(ContentDraft).where(ContentDraft.id == working_id))).scalar_one_or_none()

    assert posted_after is not None, "posted draft was deleted by regenerate_cluster"
    assert posted_after.status == "posted"
    assert attr_after is not None, "DraftAttribution was cascade-deleted with the posted draft"
    assert working_after is None, "working draft should have been replaced/deleted"


async def _async_return(v):
    return v
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd backend && source venv/bin/activate
pytest tests/test_clusters_lifecycle.py::test_regenerate_cluster_never_deletes_posted_drafts -v
```
Expected: FAIL (posted draft is deleted by the current `delete(...).where(cluster_id=X)`).

- [ ] **Step 3: Fix `regenerate_cluster` to skip posted drafts**

In `backend/app/services/clustering_service.py` around line 432-436, change:

```python
    # Drop existing drafts before regen
    await db.execute(
        delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )
    await db.flush()
```

to:

```python
    # Drop ONLY working drafts; posted drafts are immutable historical record.
    await db.execute(
        delete(ContentDraft).where(
            ContentDraft.cluster_id == cluster.id,
            ContentDraft.status.in_(["draft", "approved", "failed"]),
        )
    )
    await db.flush()
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py::test_regenerate_cluster_never_deletes_posted_drafts -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_clusters_lifecycle.py
git commit -m "fix(clusters): regenerate never touches posted drafts (was data-loss bug)"
```

---

## Task 3: `regenerate_piece` honors BrandContentSettings + UPSERT

**Files:**
- Modify: `backend/app/services/clustering_service.py:550-637` (`regenerate_piece`)
- Modify: `backend/app/routers/clusters.py:226-247` (`regenerate_piece_endpoint`)
- Test: `backend/tests/test_clusters_lifecycle.py` (add 2 cases)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_clusters_lifecycle.py`:

```python
@pytest.mark.asyncio
async def test_regenerate_piece_rejects_disabled_platform(client, auth_headers):
    """Per-piece regen for a platform disabled in BrandContentSettings must 400."""
    from app.models import BrandContentSettings
    async with AsyncSessionLocal() as db:
        cluster_id, _, _ = await _seed_cluster_with_posted_and_working(db)
        cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
        db.add(BrandContentSettings(
            brand_id=cluster.brand_id, platform="reddit", enabled=False, auto_post=False,
        ))
        await db.commit()
        brand_id = cluster.brand_id

    r = await client.post(
        f"/api/clusters/{brand_id}/{cluster_id}/regenerate-piece",
        json={"platform": "reddit"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "disabled" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_partial_unique_index_blocks_second_working_draft():
    """Inserting a second working draft for the same (cluster, platform) must fail."""
    from sqlalchemy.exc import IntegrityError
    async with AsyncSessionLocal() as db:
        cluster_id, _, working_id = await _seed_cluster_with_posted_and_working(db)
        cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
        # Try to add a second 'medium' working draft — must raise
        db.add(ContentDraft(
            brand_id=cluster.brand_id, prompt_id=cluster.prompt_id, cluster_id=cluster_id,
            platform="medium", status="draft", title="dup", content_text="body", source="cluster",
        ))
        with pytest.raises(IntegrityError):
            await db.commit()
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pytest tests/test_clusters_lifecycle.py -v -k "disabled_platform or unique_index"
```
Expected: both FAIL (no disabled check; index doesn't yet exist if running against fresh test DB).

- [ ] **Step 3: Add the disabled-platform guard to the router endpoint**

In `backend/app/routers/clusters.py` find `regenerate_piece_endpoint` (around line 226). After the existing `if request.platform not in CLUSTER_PLATFORMS` check, add:

```python
    # Honor BrandContentSettings: a platform disabled at the brand level
    # cannot have its working draft regenerated.
    from app.models import BrandContentSettings
    bcs = (await db.execute(
        select(BrandContentSettings).where(
            BrandContentSettings.brand_id == brand.id,
            BrandContentSettings.platform == request.platform,
        )
    )).scalar_one_or_none()
    if bcs is not None and not bcs.enabled:
        raise HTTPException(
            400,
            f"Platform {request.platform} is disabled in brand settings. Enable it before regenerating.",
        )
```

Also import `BrandContentSettings` at the top of the file if not already imported.

- [ ] **Step 4: Replace `regenerate_piece` insert/update with UPSERT-friendly path**

In `backend/app/services/clustering_service.py:597-628` the existing code already does SELECT-then-INSERT-or-UPDATE for the working draft. That's fine for correctness once the unique index exists (concurrent calls will serialize on the constraint and one will retry/fail cleanly). No code change needed in `regenerate_piece` itself — the index is enough.

- [ ] **Step 5: Run tests — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py -v -k "disabled_platform or unique_index"
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/clusters.py backend/tests/test_clusters_lifecycle.py
git commit -m "feat(clusters): regenerate-piece honors brand platform settings + unique-index guard"
```

---

## Task 4: Posting transition writes `posted_url` + `brief_version`

**Files:**
- Modify: `backend/app/schemas.py` (extend `UpdateDraftRequest` with `posted_url`)
- Modify: `backend/app/routers/content.py:437-525` (posting branch)
- Test: `backend/tests/test_clusters_lifecycle.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_posting_transition_snapshots_url_and_brief_version(client, auth_headers):
    """Marking a draft as posted must store posted_url + brief_version."""
    async with AsyncSessionLocal() as db:
        cluster_id, _, working_id = await _seed_cluster_with_posted_and_working(db)
        cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
        brief = (await db.execute(select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id))).scalar_one()
        expected_version = brief.version

    r = await client.patch(
        f"/api/content/drafts/{working_id}",
        json={"status": "posted", "posted_url": "https://medium.com/foo"},
        headers=auth_headers,
    )
    assert r.status_code == 200

    async with AsyncSessionLocal() as db:
        d = (await db.execute(select(ContentDraft).where(ContentDraft.id == working_id))).scalar_one()
    assert d.status == "posted"
    assert d.posted_url == "https://medium.com/foo"
    assert d.brief_version == expected_version
    assert d.posted_at is not None
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pytest tests/test_clusters_lifecycle.py::test_posting_transition_snapshots_url_and_brief_version -v
```
Expected: FAIL (schema rejects `posted_url`, or the field isn't persisted).

- [ ] **Step 3: Add `posted_url` to `UpdateDraftRequest` schema**

Find `UpdateDraftRequest` in `backend/app/schemas.py` and add an optional field:

```python
class UpdateDraftRequest(BaseModel):
    # ... existing fields ...
    posted_url: Optional[str] = Field(None, max_length=1024)
```

(Use `Field(None, max_length=1024)` exactly so we catch ungodly URLs at the boundary. Match the existing style — `Optional[str]` vs `str | None` — that the file uses.)

- [ ] **Step 4: Update the posting branch in `content.py`**

In `backend/app/routers/content.py` inside the `update_draft` PATCH handler, in the `if request.status == "posted" and old_status != "posted":` block (starts ~line 468), add immediately after `draft.posted_at = utcnow()`:

```python
            # NEW: store posting URL if provided
            if request.posted_url is not None:
                draft.posted_url = request.posted_url
            # NEW: snapshot brief version if this is a cluster-sourced draft
            if draft.cluster_id is not None:
                from app.models import ContentBrief, ContentCluster
                cluster_row = await db.get(ContentCluster, draft.cluster_id)
                if cluster_row is not None and cluster_row.last_brief_id is not None:
                    brief_row = await db.get(ContentBrief, cluster_row.last_brief_id)
                    if brief_row is not None:
                        draft.brief_version = brief_row.version
```

- [ ] **Step 5: Run — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py::test_posting_transition_snapshots_url_and_brief_version -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/content.py backend/tests/test_clusters_lifecycle.py
git commit -m "feat(content): posting transition stores posted_url + brief_version snapshot"
```

---

## Task 5: Lift attribution keyed on `prompt_id`

**Files:**
- Modify: `backend/app/routers/clusters.py:73-117` (`list_clusters`)
- Modify: `backend/app/routers/clusters.py:120-210` (`get_cluster`)
- Test: `backend/tests/test_clusters_lifecycle.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_cluster_lift_credits_legacy_posted_drafts_for_same_prompt():
    """A posted draft with cluster_id=NULL (legacy/Wikipedia) for the cluster's
    prompt must contribute to the cluster's lift number."""
    from app.routers.clusters import _cluster_lift_for_prompt  # to be added

    async with AsyncSessionLocal() as db:
        cluster_id, _, _ = await _seed_cluster_with_posted_and_working(db)
        cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()

        # Legacy posted draft (cluster_id=NULL) for the same prompt
        legacy = ContentDraft(
            brand_id=cluster.brand_id, prompt_id=cluster.prompt_id, cluster_id=None,
            platform="wikipedia", status="posted", title="Regulation A",
            content_text="body", source="manual",
        )
        db.add(legacy); await db.flush()
        db.add(DraftAttribution(
            draft_id=legacy.id, brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
            score_at_posting=10.0, current_score=88.0, delta=78.0, runs_since_posting=10,
        ))
        await db.commit()

        lift = await _cluster_lift_for_prompt(db, cluster.prompt_id, cluster.brand_id)
    assert lift is not None
    assert lift == pytest.approx(78.0, abs=0.01)
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pytest tests/test_clusters_lifecycle.py::test_cluster_lift_credits_legacy_posted_drafts_for_same_prompt -v
```
Expected: FAIL — `_cluster_lift_for_prompt` doesn't exist yet.

- [ ] **Step 3: Add `_cluster_lift_for_prompt` helper to `clusters.py`**

In `backend/app/routers/clusters.py` add this helper after the imports (around line 47):

```python
async def _cluster_lift_for_prompt(
    db: AsyncSession, prompt_id: int, brand_id: int,
) -> float | None:
    """Cluster lift = current visibility for the prompt minus the visibility
    at the time the FIRST posted draft for this prompt went live.

    Includes every posted draft for the prompt — cluster-sourced, legacy
    gap-driven, Wikipedia surface — keyed on prompt_id, not cluster id.
    Returns None if no posted drafts exist for the prompt.
    """
    first_attr = (await db.execute(
        select(DraftAttribution)
        .join(ContentDraft, ContentDraft.id == DraftAttribution.draft_id)
        .where(
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
        )
        .order_by(DraftAttribution.id.asc())
        .limit(1)
    )).scalar_one_or_none()
    if first_attr is None:
        return None
    current = await _get_prompt_visibility(db, prompt_id)
    return round(current - first_attr.score_at_posting, 2)
```

- [ ] **Step 4: Use the new helper in `list_clusters` and `get_cluster`**

In `list_clusters` (line 89-99), replace the `cluster_delta` calculation with:

```python
        cluster_delta = await _cluster_lift_for_prompt(db, cluster.prompt_id, cluster.brand_id)
        # posted_count: every posted draft for the prompt (incl. legacy + Wikipedia)
        posted_count_row = (await db.execute(
            select(sqla_func.count(ContentDraft.id)).where(
                ContentDraft.prompt_id == cluster.prompt_id,
                ContentDraft.brand_id == cluster.brand_id,
                ContentDraft.status == "posted",
            )
        )).scalar_one() or 0
        posted_count = int(posted_count_row)
```

Add `from sqlalchemy import func as sqla_func` to the imports if not present.

Make the same substitution in `get_cluster` (around line 182-193) for the `cluster_delta` and `posted_count` block.

- [ ] **Step 5: Run — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py::test_cluster_lift_credits_legacy_posted_drafts_for_same_prompt -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/clusters.py backend/tests/test_clusters_lifecycle.py
git commit -m "feat(clusters): lift attribution keyed on prompt_id (covers legacy + Wikipedia)"
```

---

## Task 6: Title fallback (no more "(untitled)")

**Files:**
- Modify: `backend/app/services/clustering_service.py:144-193` (`_generate_piece_text`)
- Test: `backend/tests/test_clusters_lifecycle.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_title_fallback_never_returns_untitled():
    """Short-form drafts (x/reddit/quora) without an h1 must get a non-"(untitled)" title."""
    from app.services.clustering_service import _derive_title_fallback

    body = "Reg A+ lets startups raise up to $75M from public investors. Most companies skip it because the cost-of-marketing reality is hidden."
    title = _derive_title_fallback(body, prompt_text="how to raise $75M", platform="x")
    assert title and "untitled" not in title.lower()
    # Should derive something from the body's first sentence
    assert "Reg A+" in title or "raise" in title.lower()

    empty = _derive_title_fallback("", prompt_text="how to raise $75M", platform="x")
    assert empty and "untitled" not in empty.lower()
    assert "how to raise" in empty.lower()
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pytest tests/test_clusters_lifecycle.py::test_title_fallback_never_returns_untitled -v
```
Expected: FAIL — function doesn't exist.

- [ ] **Step 3: Add `_derive_title_fallback` and use it**

In `backend/app/services/clustering_service.py` add at the top after imports (around line 38):

```python
def _derive_title_fallback(body: str, *, prompt_text: str, platform: str) -> str:
    """Title fallback for platforms whose body has no h1 (x/reddit/quora).

    Order: first sentence of body trimmed to 80 chars → "<platform> draft for <prompt>".
    Never returns "(untitled)".
    """
    body_clean = (body or "").strip()
    if body_clean:
        # First sentence: up to first . ! ? or first newline, whichever is sooner
        import re
        m = re.split(r"(?<=[.!?])\s+|\n", body_clean, maxsplit=1)
        first = (m[0] if m else body_clean).strip()
        if first:
            return first[:80].rstrip()
    label = platform.replace("_", " ").title()
    fallback = f"{label} draft for {prompt_text}"
    return fallback[:80].rstrip()
```

Then in `_generate_piece_text` (line 193), change the return line from:

```python
    return (title or "(untitled)"), body, quality_score, citations, low_evidence
```

to:

```python
    final_title = title or _derive_title_fallback(body, prompt_text=prompt_text, platform=platform)
    return final_title, body, quality_score, citations, low_evidence
```

- [ ] **Step 4: Run — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py::test_title_fallback_never_returns_untitled -v
```
Expected: PASS.

- [ ] **Step 5: Also update the "(untitled)" literal at line 513**

In `clustering_service.py:513` the success-path draft insert still uses `title=title or "(untitled)"`. Replace with:

```python
                status="draft", title=title or _derive_title_fallback(body, prompt_text=prompt_row.text, platform=platform),
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_clusters_lifecycle.py
git commit -m "feat(clusters): title fallback uses first sentence or prompt context, never (untitled)"
```

---

## Task 7: Eager cluster shell on Prompt insert

**Files:**
- Modify: `backend/app/routers/brands.py:347` (inside `create_brand` prompt insert loop)
- Modify: `backend/app/routers/brands.py:507` (inside `add_prompt` endpoint)
- Test: `backend/tests/test_clusters_lifecycle.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_add_prompt_creates_cluster_shell(client, auth_headers):
    """Adding a prompt to an existing brand must eagerly create a cluster shell."""
    # Create a brand first
    r = await client.post(
        "/api/brands",
        json={"name": "EagerCo", "prompts": ["initial prompt"]},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    brand_id = r.json()["id"]

    # Add a second prompt
    r2 = await client.post(
        f"/api/brands/{brand_id}/prompts",
        json={"text": "second prompt"},
        headers=auth_headers,
    )
    assert r2.status_code in (200, 201), r2.text
    new_prompt_id = r2.json()["id"]

    # Cluster should exist for the new prompt
    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == new_prompt_id)
        )).scalar_one_or_none()
    assert cluster is not None, "no cluster shell created for new prompt"
    assert cluster.status == "pending"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pytest tests/test_clusters_lifecycle.py::test_add_prompt_creates_cluster_shell -v
```
Expected: FAIL.

- [ ] **Step 3: Add eager creation in `create_brand`**

In `backend/app/routers/brands.py` find the `db.add(Prompt(...))` at line 347 (inside create_brand). After the loop that inserts prompts, before the `await db.commit()`, add:

```python
        # Eagerly create a ContentCluster shell for each new prompt so the
        # cluster grid always shows 1 card per tracked prompt.
        await db.flush()  # ensure prompt ids are assigned
        for p in (await db.execute(
            select(Prompt).where(Prompt.brand_id == brand.id)
        )).scalars().all():
            existing = (await db.execute(
                select(ContentCluster).where(ContentCluster.prompt_id == p.id)
            )).scalar_one_or_none()
            if existing is None:
                db.add(ContentCluster(
                    brand_id=brand.id, prompt_id=p.id,
                    status="pending", pillar_mode="none", version=0,
                ))
```

Add `from app.models import ContentCluster` to the imports if not present.

- [ ] **Step 4: Add eager creation in `add_prompt`**

In `add_prompt` (line 448-…), after `prompt = Prompt(...)` and `db.add(prompt)`, add before commit:

```python
    await db.flush()
    db.add(ContentCluster(
        brand_id=brand_id, prompt_id=prompt.id,
        status="pending", pillar_mode="none", version=0,
    ))
```

- [ ] **Step 5: Run — expect PASS**

```bash
pytest tests/test_clusters_lifecycle.py::test_add_prompt_creates_cluster_shell -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/brands.py backend/tests/test_clusters_lifecycle.py
git commit -m "feat(brands): eager ContentCluster shell on prompt insert (1 card per prompt always)"
```

---

## Task 8: Frontend cluster card — composed progress bar + Push v2 CTA

**Files:**
- Modify: `frontend/components/content/cluster/ClusterCard.tsx`
- Modify: `frontend/lib/api.ts` (extend `ContentClusterSummary` if needed)

- [ ] **Step 1: Verify what fields the backend now returns**

Check `ContentClusterSummary` in `frontend/lib/api.ts` and confirm `posted_count`, `cluster_delta`, `pieces`, `status`, `pillar_mode`, `prompt_text` are all present (they should be — see `list_clusters` return shape). If `enabled_platform_count` is needed for the denominator, derive it from `pieces.length` (server-side `_summarize_pieces` lists drafts; for orphan shells with no drafts, denominator = number of enabled platforms = derived from BrandContentSettings — for simplicity we can use `cluster.pieces.length` for now and accept that orphan shells show "0 of 0 posts live · Generate cluster").

For shell clusters with no pieces yet, the FE shows "Generate cluster" CTA — the denominator quirk doesn't matter visually.

- [ ] **Step 2: Replace the card body with composed progress bar**

Open `frontend/components/content/cluster/ClusterCard.tsx`. Replace the entire JSX inside the outer `<div className="card card-hover flex flex-col gap-4">` with this structure:

```tsx
  // Derived: 1 card per prompt always — pending shells get a Generate CTA
  const isShell = cluster.status === "pending" && cluster.pieces.length === 0;
  const enabledPlatformCount = cluster.pieces.length; // approximation; see Task 8 step 1
  const postedCount = cluster.posted_count;
  const isFullyLive = enabledPlatformCount > 0 && postedCount >= enabledPlatformCount;
  const isPartial = postedCount > 0 && postedCount < enabledPlatformCount;
  const delta = cluster.cluster_delta;
  const hasDelta = delta !== null && delta !== undefined;
  const deltaTone = !hasDelta
    ? "text-[var(--text-faint)]"
    : delta! >= 0
    ? "text-[#4ade80]"
    : "text-[#fb7185]";
  const deltaLabel = !hasDelta
    ? "—"
    : `${delta! >= 0 ? "+" : ""}${delta!.toFixed(1)} pts`;

  return (
    <div className="card card-hover flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 min-w-0 flex-1">
          {cluster.prompt_text}
        </h3>
        <div className="shrink-0 text-right" title="Cluster lift = current visibility minus the visibility at the time the first post for this prompt went live. Includes Wikipedia and legacy posts.">
          <div className={`text-xl font-bold ${deltaTone}`}>{deltaLabel}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            AI visibility lift
          </div>
        </div>
      </div>

      {/* Composed progress bar */}
      {isShell ? (
        <div className="text-sm text-[var(--text-secondary)]">No drafts yet for this prompt.</div>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-[var(--text-secondary)]">
            {Array.from({ length: enabledPlatformCount }).map((_, i) => (
              <span
                key={i}
                className={`inline-block h-2 w-2 rounded-full ${
                  i < postedCount ? "bg-[#4ade80]" : "border border-[var(--border-subtle)]"
                }`}
              />
            ))}
            <span className="ml-1 text-[var(--text-faint)]">
              {postedCount} of {enabledPlatformCount} posts live
            </span>
          </div>
          <span className="text-[var(--text-faint)]">·</span>
          <span className="text-[var(--text-secondary)]">
            {cluster.pieces.length - postedCount} drafts to review
          </span>
        </div>
      )}

      {/* Partial-coverage one-liner */}
      {isPartial && (
        <p className="text-[11px] text-[var(--text-faint)]">
          Lift only counts what's posted. Publish the remaining platforms to capture full impact.
        </p>
      )}

      {/* Footer: View link + Push v2 / Generate CTA */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          {isShell ? "Generate cluster" : "View cluster"} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        {isFullyLive && (
          <button
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(cluster.id)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Generate a fresh round of drafts (v2). Old posts stay live and keep their lift attribution."
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Drafting v2…" : "Push v2"}
          </button>
        )}
        {!isFullyLive && !isShell && (
          <ClusterCardKebab regenerating={regenerating} onRegenerate={() => onRegenerate(cluster.id)} />
        )}
      </div>
    </div>
  );
```

(Keep the existing `ClusterCardKebab` function below — unchanged.)

- [ ] **Step 3: Manual smoke test**

```bash
cd backend && source venv/bin/activate
uvicorn app.main:app --reload --port 3001 &
cd ../frontend && npm run dev -- -p 3002
```

Open `http://localhost:3002/content/2` (MSC) and verify:
- 13 cluster cards visible (was 10 — the 3 orphan shells show "Generate cluster")
- Cluster 5's card shows `+88pts` or similar (was `—`)
- Posted dots render correctly for clusters with posted drafts

If frontend/backend aren't running, that's fine — typecheck instead:

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/ClusterCard.tsx
git commit -m "feat(clusters): composed posted↔working progress bar + Push v2 CTA"
```

---

## Task 9: Frontend cluster detail — posted slot states + posted history strip

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`
- Modify: `frontend/components/content/cluster/PieceCard.tsx` (posted state UI)

- [ ] **Step 1: Update PieceCard for posted-slot affordance**

In `frontend/components/content/cluster/PieceCard.tsx`, ensure that when `draft.status === "posted"`, the card body shows:
- "Posted on {posted_at}" with `posted_url` as a link if present
- A "Generate new draft" button that calls `regenerateClusterPiece(brandId, clusterId, platform)`
- No "Mark posted" button (immutable)

If you need to extend the `ContentDraft` type in `frontend/lib/api.ts` to include `posted_url`, add `posted_url?: string | null` and `brief_version?: number | null` to the interface.

Find the existing "posted" rendering block (likely the `STATUS_TONE.posted` branch or where `status === "posted"` is matched) and ensure the body shows:

```tsx
{draft.status === "posted" && (
  <div className="text-xs text-[var(--text-secondary)] space-y-2">
    <div>
      Posted on {new Date(draft.posted_at!).toLocaleDateString()}
      {draft.posted_url && (
        <>
          {" · "}
          <a
            href={draft.posted_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-foreground)] hover:underline"
          >
            View live post ↗
          </a>
        </>
      )}
    </div>
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        const updated = await regenerateClusterPiece(brandId, clusterId, platform);
        onUpdated(updated);
      }}
    >
      Generate new draft
    </Button>
  </div>
)}
```

- [ ] **Step 2: Add posted history strip on cluster detail page**

In `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`, add a new section below the Posts grid (after the closing `</div>` of the Posts zone, before Zone 2). It enumerates `cluster.drafts.filter(d => d.status === "posted")` and any legacy/Wikipedia posted drafts the backend includes for the prompt.

Backend already returns `cluster.drafts` (cluster-scoped only). For now, posted history shows cluster-scoped posted drafts only. Legacy/Wikipedia coverage shows up in the lift number but not as separate chips in this strip — that's an explicit deferred item.

```tsx
{cluster.drafts.some(d => d.status === "posted") && (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
      Posted history
    </div>
    <div className="space-y-2">
      {cluster.drafts
        .filter(d => d.status === "posted")
        .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
        .map(d => (
          <div key={d.id} className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <PlatformBadge platform={d.platform} size="sm" />
            <span>{new Date(d.posted_at!).toLocaleDateString()}</span>
            {d.posted_url && (
              <a
                href={d.posted_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent-foreground)] hover:underline"
              >
                View ↗
              </a>
            )}
            {d.brief_version != null && (
              <span className="text-[var(--text-faint)]">from brief v{d.brief_version}</span>
            )}
            {d.attribution_delta != null && (
              <span className={d.attribution_delta >= 0 ? "text-[#4ade80]" : "text-[#fb7185]"}>
                {d.attribution_delta >= 0 ? "+" : ""}{d.attribution_delta.toFixed(1)}pts
              </span>
            )}
          </div>
        ))}
    </div>
  </div>
)}
```

Add `import PlatformBadge from "@/components/PlatformBadge";` at the top.

- [ ] **Step 3: Add `posted_url`/`brief_version` to `ContentDraft` type**

In `frontend/lib/api.ts`, find the `ContentDraft` interface and add:

```ts
  posted_url?: string | null;
  brief_version?: number | null;
```

Also update the cluster detail backend serializer to include these — in `backend/app/routers/clusters.py:163-180` (the `drafts_out` loop), add to the dict being appended:

```python
            "posted_url": d.posted_url,
            "brief_version": d.brief_version,
```

And add these to the `ContentDraftSchema` Pydantic class in `backend/app/schemas.py` so they actually round-trip:

```python
class ContentDraftSchema(BaseModel):
    # ... existing fields ...
    posted_url: Optional[str] = None
    brief_version: Optional[int] = None
```

- [ ] **Step 4: Lint pass**

```bash
cd frontend && npm run lint
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx \
        frontend/components/content/cluster/PieceCard.tsx \
        frontend/lib/api.ts \
        backend/app/routers/clusters.py \
        backend/app/schemas.py
git commit -m "feat(clusters): posted slot affordance + posted history strip on detail page"
```

---

## Final verification

- [ ] **Step 1: Run the whole new test file**

```bash
cd backend && source venv/bin/activate
pytest tests/test_clusters_lifecycle.py -v
```
Expected: 6/6 PASS.

- [ ] **Step 2: Run the existing cluster test suite (no regressions)**

```bash
pytest tests/ -v -k "cluster or content or draft"
```
Expected: all previously-passing tests still pass.

- [ ] **Step 3: Frontend lint + typecheck**

```bash
cd frontend && npm run lint
```
Expected: no new errors.

- [ ] **Step 4: Manual sanity in browser (if dev servers are easy to spin up)**

Load `http://localhost:3002/content/2` (MSC) and confirm:
- 13 cluster cards (3 are pending shells with "Generate cluster")
- Cluster 5 shows `+88pts` (Wikipedia lift surfaces)
- No "(untitled)" labels on x/reddit/quora drafts (once any are regenerated; existing rows keep their stored title)
