# Content Tab Collapse + Cluster UX Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `/content/[brandId]` to two tabs (Clusters · Visibility Opportunities), retire Drafts/Posted, surface attribution inside the cluster, and clean up the cluster page UX.

**Architecture:** Backend extends two cluster schemas with attribution fields (`cluster_delta`, `posted_count`, per-piece `attribution_delta`) populated from existing `DraftAttribution` rows — no new tables, no migration. Frontend tears out the `DraftsPanel` / `ScheduledPanel` / `PostedPanel` tabs and replaces them with an `ImpactStrip` above the cluster grid plus a `PostedHistoryModal` for long-tail. Cluster card + detail page get UX adjustments only — no changes to clustering logic.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (backend), Next.js 15 + React 18 + Tailwind + framer-motion (frontend), pytest (backend tests; no frontend test framework — manual browser smoke).

**Spec:** [`docs/superpowers/specs/2026-05-22-content-tab-collapse-design.md`](../specs/2026-05-22-content-tab-collapse-design.md)

**Pre-existing fact worth noting:** `_bg_generate_drafts` (backend/app/routers/content.py:79) already routes through `get_or_create_cluster` + `regenerate_cluster`. The `/generate-now` flow therefore already produces cluster-attached drafts — no rewiring needed there. The "route every draft through clusters" wording in the spec is largely already true; this plan only adds the attribution surfacing + UI collapse work.

---

## File Map

**Backend — modify:**
- `backend/app/schemas.py` — add fields to `ContentClusterSummary` (~line 1341) and `ContentClusterDetail` (~line 1386) and `ContentClusterDraft` (~line 1367)
- `backend/app/routers/clusters.py` — populate new fields in `list_clusters` (~line 71) and `get_cluster` (~line 102)

**Backend — create:**
- `backend/tests/test_cluster_attribution_summary.py` — new test file for cluster_delta / posted_count / attribution_delta projections

**Frontend — modify:**
- `frontend/lib/api.ts` — extend `ContentClusterSummary`, `ContentClusterDetail`, `ContentClusterDraft` types
- `frontend/components/content/cluster/ClusterCard.tsx` — headline number → cluster_delta; sub-line → posted_count; regenerate → kebab menu
- `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` — reorder sections (pieces first), conditional pillar
- `frontend/components/content/cluster/PieceCard.tsx` — status + attribution chip
- `frontend/components/content/cluster/BriefPanel.tsx` — add collapsible disclosure wrapper (default collapsed)
- `frontend/components/content/ContentHub.tsx` — drop `content_drafts` + `posted` primary tabs, mount `ImpactStrip` above cluster grid, silent URL-param fallback

**Frontend — create:**
- `frontend/components/content/ImpactStrip.tsx` — cross-cluster top-delta strip with Legacy block
- `frontend/components/content/PostedHistoryModal.tsx` — full posted-draft list, scrollable

**Frontend — delete (after verifying no other consumers):**
- `frontend/components/content/DraftsPanel.tsx`
- `frontend/components/content/ScheduledPanel.tsx`
- `frontend/components/content/PostedPanel.tsx`
- `frontend/components/content/ContentTabPanels.tsx`
- `frontend/components/content/cards/DraftCard.tsx` *(verify — not the `app/review/[token]/DraftCard.tsx`)*
- `frontend/components/content/cards/ScheduledCard.tsx`
- `frontend/components/content/cards/PostedCard.tsx`
- `frontend/components/content/cards/WikipediaDraftCard.tsx` *(verify — Wikipedia surface uses its own components at `/wiki/[brandId]`)*

---

## Task 1: Backend — extend `ContentClusterSummary` with `cluster_delta` + `posted_count`

**Files:**
- Modify: `backend/app/schemas.py:1341-1355`
- Modify: `backend/app/routers/clusters.py:71-99`
- Test: `backend/tests/test_cluster_attribution_summary.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cluster_attribution_summary.py`:

```python
"""Tests for cluster_delta and posted_count fields on the cluster list endpoint."""
import pytest
from sqlalchemy import select

from app.models import (
    Brand,
    ContentCluster,
    ContentDraft,
    DraftAttribution,
    Prompt,
)
from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_cluster_summary_includes_zero_delta_when_no_posted_drafts(client, db_session):
    token = await register_and_login(client, "u1@example.com")
    brand = await create_brand(client, token, name="Acme")

    async with db_session() as db:
        prompt = Prompt(brand_id=brand["id"], text="how to X", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}", headers={"Cookie": f"clarity_token={token}"})
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["posted_count"] == 0
    assert payload[0]["cluster_delta"] is None


@pytest.mark.asyncio
async def test_cluster_summary_sums_attribution_delta_across_posted_pieces(client, db_session):
    token = await register_and_login(client, "u2@example.com")
    brand = await create_brand(client, token, name="Acme")

    async with db_session() as db:
        prompt = Prompt(brand_id=brand["id"], text="how to X", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        # Two posted pieces, one with delta +5.0, one with delta +3.5
        for platform, delta in [("reddit", 5.0), ("linkedin", 3.5)]:
            draft = ContentDraft(
                brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
                platform=platform, status="posted", content_text="...",
            )
            db.add(draft)
            await db.flush()
            db.add(DraftAttribution(
                draft_id=draft.id, brand_id=brand["id"], prompt_id=prompt.id,
                score_at_posting=20.0, current_score=20.0 + delta, delta=delta,
                runs_since_posting=1,
            ))
        # One unposted draft — should not contribute
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="medium", status="draft", content_text="...",
        ))
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}", headers={"Cookie": f"clarity_token={token}"})
    assert resp.status_code == 200
    summary = resp.json()[0]
    assert summary["posted_count"] == 2
    assert summary["cluster_delta"] == pytest.approx(8.5)


@pytest.mark.asyncio
async def test_cluster_summary_delta_null_when_posted_but_no_attribution(client, db_session):
    """Posted draft with no DraftAttribution row (legacy or fresh post) — delta is None."""
    token = await register_and_login(client, "u3@example.com")
    brand = await create_brand(client, token, name="Acme")

    async with db_session() as db:
        prompt = Prompt(brand_id=brand["id"], text="how to X", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="reddit", status="posted", content_text="...",
        ))
        await db.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}", headers={"Cookie": f"clarity_token={token}"})
    summary = resp.json()[0]
    assert summary["posted_count"] == 1
    assert summary["cluster_delta"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_cluster_attribution_summary.py -v`
Expected: All three tests FAIL with `KeyError: 'cluster_delta'` or `'posted_count'` (the fields don't exist yet in the response).

- [ ] **Step 3: Add fields to schema**

Edit `backend/app/schemas.py:1341-1355`. Replace the `ContentClusterSummary` class with:

```python
class ContentClusterSummary(BaseModel):
    """Compact representation for the cluster list view."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    pieces: list[ClusterPieceSummary]
    version: int
    last_generated_at: datetime | None
    # New: cluster-effect signal aggregated from DraftAttribution rows
    cluster_delta: float | None  # sum of delta across posted pieces with attribution; None if no posted attribution data
    posted_count: int  # count of pieces with status='posted' in this cluster

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 4: Populate the new fields in `list_clusters`**

Edit `backend/app/routers/clusters.py:71-99`. Replace the `list_clusters` body with:

```python
@router.get("/{brand_id}", response_model=list[ContentClusterSummary])
async def list_clusters(brand_id: int, db: DbDep, user: CurrentUser) -> list[dict]:
    from app.models import DraftAttribution
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    rows = (await db.execute(
        select(ContentCluster).where(ContentCluster.brand_id == brand.id)
    )).scalars().all()

    out: list[dict] = []
    for cluster in rows:
        prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
        )).scalars().all()
        posted_drafts = [d for d in drafts if d.status == "posted"]
        posted_count = len(posted_drafts)

        cluster_delta: float | None = None
        if posted_drafts:
            attribution_rows = (await db.execute(
                select(DraftAttribution).where(
                    DraftAttribution.draft_id.in_([d.id for d in posted_drafts])
                )
            )).scalars().all()
            deltas = [a.delta for a in attribution_rows if a.delta is not None]
            if deltas:
                cluster_delta = float(sum(deltas))

        out.append({
            "id": cluster.id,
            "brand_id": cluster.brand_id,
            "prompt_id": cluster.prompt_id,
            "prompt_text": prompt.text,
            "status": cluster.status,
            "pillar_mode": cluster.pillar_mode,
            "pillar_url": cluster.pillar_url,
            "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
            "pieces": _summarize_pieces(drafts),
            "version": cluster.version,
            "last_generated_at": cluster.last_generated_at,
            "cluster_delta": cluster_delta,
            "posted_count": posted_count,
        })
    # Sort by visibility ascending (lowest needs most attention)
    out.sort(key=lambda c: c["visibility_pct"])
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_cluster_attribution_summary.py -v`
Expected: All three tests PASS.

- [ ] **Step 6: Run full cluster test suite to confirm no regression**

Run: `cd backend && pytest tests/test_cluster_endpoints.py tests/test_cluster_e2e.py -v`
Expected: All existing cluster tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/clusters.py backend/tests/test_cluster_attribution_summary.py
git commit -m "feat(clusters): expose cluster_delta + posted_count on summary endpoint"
```

---

## Task 2: Backend — extend `ContentClusterDetail` + `ContentClusterDraft` with attribution

**Files:**
- Modify: `backend/app/schemas.py:1367-1401`
- Modify: `backend/app/routers/clusters.py:102-165`
- Test: `backend/tests/test_cluster_attribution_summary.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_cluster_attribution_summary.py`:

```python
@pytest.mark.asyncio
async def test_cluster_detail_includes_cluster_delta_and_posted_count(client, db_session):
    token = await register_and_login(client, "u4@example.com")
    brand = await create_brand(client, token, name="Acme")

    async with db_session() as db:
        prompt = Prompt(brand_id=brand["id"], text="how to X", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        draft = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="reddit", status="posted", content_text="...",
        )
        db.add(draft)
        await db.flush()
        db.add(DraftAttribution(
            draft_id=draft.id, brand_id=brand["id"], prompt_id=prompt.id,
            score_at_posting=20.0, current_score=24.0, delta=4.0,
            runs_since_posting=1,
        ))
        await db.commit()
        cluster_id = cluster.id

    resp = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}",
        headers={"Cookie": f"clarity_token={token}"},
    )
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["cluster_delta"] == pytest.approx(4.0)
    assert detail["posted_count"] == 1
    # Per-draft attribution_delta surfaces on the draft itself
    assert len(detail["drafts"]) == 1
    assert detail["drafts"][0]["attribution_delta"] == pytest.approx(4.0)


@pytest.mark.asyncio
async def test_cluster_detail_draft_attribution_delta_null_without_row(client, db_session):
    token = await register_and_login(client, "u5@example.com")
    brand = await create_brand(client, token, name="Acme")

    async with db_session() as db:
        prompt = Prompt(brand_id=brand["id"], text="x", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt.id, status="ready", pillar_mode="none",
        )
        db.add(cluster)
        await db.flush()
        # Drafted but not posted — no attribution row
        db.add(ContentDraft(
            brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
            platform="medium", status="draft", content_text="...",
        ))
        await db.commit()
        cluster_id = cluster.id

    resp = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}",
        headers={"Cookie": f"clarity_token={token}"},
    )
    detail = resp.json()
    assert detail["drafts"][0]["attribution_delta"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_cluster_attribution_summary.py::test_cluster_detail_includes_cluster_delta_and_posted_count tests/test_cluster_attribution_summary.py::test_cluster_detail_draft_attribution_delta_null_without_row -v`
Expected: Both FAIL with `KeyError: 'attribution_delta'` or `'cluster_delta'`.

- [ ] **Step 3: Extend `ContentClusterDraft` schema**

Edit `backend/app/schemas.py:1367-1383`. Replace `ContentClusterDraft` with:

```python
class ContentClusterDraft(BaseModel):
    """ContentDraftSchema + per-draft citations + new redesign fields."""
    id: int
    brand_id: int
    prompt_id: int | None
    cluster_id: int | None
    platform: str
    status: str
    title: str | None
    content_text: str
    quality_score: float | None = None
    posted_at: datetime | None = None
    generation_state: str = "done"
    failure_reason: str | None = None
    citations: list[ContentDraftCitationSchema] = []
    # Per-piece attribution lift (DraftAttribution.delta if a row exists)
    attribution_delta: float | None = None

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 4: Extend `ContentClusterDetail` schema**

Edit `backend/app/schemas.py:1386-1401`. Replace `ContentClusterDetail` with:

```python
class ContentClusterDetail(BaseModel):
    """Full cluster — brief + drafts with citations."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    brief: ContentBriefSchema | None
    drafts: list[ContentClusterDraft]
    version: int
    last_generated_at: datetime | None
    # Mirrors ContentClusterSummary
    cluster_delta: float | None
    posted_count: int

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 5: Populate new fields in `get_cluster`**

Edit `backend/app/routers/clusters.py` `get_cluster` (~line 102). Insert this near the top of the function (after the existing draft fetch around line 117), then update the draft serialization loop and final return.

Replace lines 115-165 (from `drafts = ...` through the `return {...}` block) with:

```python
    drafts = (await db.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )).scalars().all()

    # Per-draft attribution map — single batched query keyed by draft id.
    from app.models import ContentDraftCitation, DraftAttribution
    citation_rows = (await db.execute(
        select(ContentDraftCitation).where(
            ContentDraftCitation.draft_id.in_([d.id for d in drafts] or [-1])
        )
    )).scalars().all()
    cites_by_draft: dict[int, list] = {}
    for c in citation_rows:
        cites_by_draft.setdefault(c.draft_id, []).append({
            "source_ref": c.source_ref,
            "url": c.url,
            "title": c.title,
            "position_marker": c.position_marker,
        })

    attribution_rows = (await db.execute(
        select(DraftAttribution).where(
            DraftAttribution.draft_id.in_([d.id for d in drafts] or [-1])
        )
    )).scalars().all()
    delta_by_draft: dict[int, float | None] = {a.draft_id: a.delta for a in attribution_rows}

    drafts_out = []
    for d in drafts:
        drafts_out.append({
            "id": d.id,
            "brand_id": d.brand_id,
            "prompt_id": d.prompt_id,
            "cluster_id": d.cluster_id,
            "platform": d.platform,
            "status": d.status,
            "title": d.title,
            "content_text": d.content_text,
            "quality_score": d.quality_score,
            "posted_at": d.posted_at,
            "generation_state": d.generation_state,
            "failure_reason": d.failure_reason,
            "citations": cites_by_draft.get(d.id, []),
            "attribution_delta": delta_by_draft.get(d.id),
        })

    posted_count = sum(1 for d in drafts if d.status == "posted")
    posted_deltas = [
        delta_by_draft[d.id]
        for d in drafts
        if d.status == "posted" and delta_by_draft.get(d.id) is not None
    ]
    cluster_delta = float(sum(posted_deltas)) if posted_deltas else None

    return {
        "id": cluster.id,
        "brand_id": cluster.brand_id,
        "prompt_id": cluster.prompt_id,
        "prompt_text": prompt.text,
        "status": cluster.status,
        "pillar_mode": cluster.pillar_mode,
        "pillar_url": cluster.pillar_url,
        "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
        "brief": (
            {
                "id": brief.id,
                "version": brief.version,
                "positioning": brief.positioning,
                "key_claims": brief.key_claims,
                "canonical_phrasings": brief.canonical_phrasings,
                "stats": brief.stats,
                "competitor_context": brief.competitor_context,
                "narrative_spine": brief.narrative_spine,
                "tone_notes": brief.tone_notes,
            }
            if brief
            else None
        ),
        "drafts": drafts_out,
        "version": cluster.version,
        "last_generated_at": cluster.last_generated_at,
        "cluster_delta": cluster_delta,
        "posted_count": posted_count,
    }
```

*(Note: the brief block was previously assembled differently — preserve whatever shape the original code returned. If the existing code returned `brief` directly as the ORM row, keep that. The block above shows the field set; copy the original brief-serialization style from the file.)*

- [ ] **Step 6: Run new tests to verify they pass**

Run: `cd backend && pytest tests/test_cluster_attribution_summary.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 7: Run full cluster suite to confirm no regression**

Run: `cd backend && pytest tests/test_cluster_endpoints.py tests/test_cluster_e2e.py -v`
Expected: All existing cluster tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/clusters.py backend/tests/test_cluster_attribution_summary.py
git commit -m "feat(clusters): expose attribution_delta on cluster detail drafts"
```

---

## Task 3: Frontend — extend `lib/api.ts` types

**Files:**
- Modify: `frontend/lib/api.ts` (find `ContentClusterSummary`, `ContentClusterDetail`, `ContentClusterDraft` interfaces)

- [ ] **Step 1: Locate the existing types**

Run: `grep -n "ContentClusterSummary\|ContentClusterDetail\|ContentClusterDraft" frontend/lib/api.ts`
Expected: shows interface definitions for all three.

- [ ] **Step 2: Add the new fields**

For `ContentClusterSummary`, add (after `last_generated_at: string | null;`):
```ts
  cluster_delta: number | null;
  posted_count: number;
```

For `ContentClusterDetail`, add the same two fields in the same place.

For `ContentClusterDraft`, add (after `citations: ContentDraftCitation[];` or equivalent):
```ts
  attribution_delta: number | null;
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean exit (no errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(content): add cluster_delta + attribution types"
```

---

## Task 4: Frontend — `ClusterCard` headline + sub-line + kebab regen

**Files:**
- Modify: `frontend/components/content/cluster/ClusterCard.tsx`

- [ ] **Step 1: Replace the headline number block**

Edit `frontend/components/content/cluster/ClusterCard.tsx`. Replace lines 34-82 (the `totalEnabled`/`completed`/`visibility`/`visibilityTone`/`statusLabel` block plus the header div) with:

```tsx
  const totalEnabled = cluster.pieces.length || 5;
  const postedCount = cluster.posted_count;
  const delta = cluster.cluster_delta;
  const hasDelta = delta !== null && delta !== undefined;
  const deltaTone = !hasDelta
    ? "text-[var(--text-faint)]"
    : delta! >= 0
    ? "text-[#4ade80]"
    : "text-[#fb7185]";
  const deltaLabel = !hasDelta
    ? "—"
    : `${delta! >= 0 ? "+" : ""}${delta!.toFixed(1)}pp`;
  const statusLabel = STATUS_LABEL[cluster.status] ?? cluster.status.replace("_", " ");

  return (
    <div className="card card-hover flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
            {cluster.prompt_text}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
            <span>
              <span className="text-[var(--text-muted)]">Status</span>{" "}
              <span className="text-[var(--text-secondary)] font-medium">{statusLabel}</span>
            </span>
            <span className="text-[var(--text-faint)]">·</span>
            <span>Posted {postedCount} of {totalEnabled}</span>
            {cluster.pillar_mode === "attached" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#4ade80] font-medium">Pillar attached</span>
              </>
            )}
            {cluster.pillar_mode === "proposed" && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[#fbbf24] font-medium">Pillar proposed</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`flex items-center justify-end gap-1 text-xl font-bold ${deltaTone}`}>
            {deltaLabel}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            Cluster lift
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Move Regenerate into a kebab menu**

Replace the footer block (lines 101-117, the `<div className="flex items-center justify-between pt-1 border-t ...">` block) with:

```tsx
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          View cluster <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <ClusterCardKebab
          regenerating={regenerating}
          onRegenerate={() => onRegenerate(cluster.id)}
        />
      </div>
    </div>
  );
}

function ClusterCardKebab({
  regenerating,
  onRegenerate,
}: {
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Cluster actions"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-56 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-lg z-10"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            disabled={regenerating}
            onClick={() => {
              onRegenerate();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate all pieces"}
          </button>
        </div>
      )}
    </div>
  );
}
```

Update the top imports — replace existing `lucide-react` import with:

```tsx
import { ArrowUpRight, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
```

(Remove `TrendingUp` and `TrendingDown` imports — no longer used.)

- [ ] **Step 3: Type-check + visual sanity**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

Start the dev server (memory says backend=3001, frontend=3002):
Run: `cd frontend && PORT=3002 npm run dev`
Open: `http://localhost:3002/content/{any-brand-id-with-clusters}`
Expected: cluster cards show "Cluster lift" label with `+Npp` or `—`, sub-line shows "Posted X of N", regenerate moved into 3-dot kebab.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/ClusterCard.tsx
git commit -m "feat(content): cluster card shows lift signal + kebab regen"
```

---

## Task 5: Frontend — `PieceCard` status + attribution chip

**Files:**
- Modify: `frontend/components/content/cluster/PieceCard.tsx`

- [ ] **Step 1: Add the chip component inline**

At the top of `PieceCard.tsx` (after imports, before the main component), add:

```tsx
function PieceStatusChip({
  status,
  delta,
}: {
  status: string;
  delta: number | null | undefined;
}) {
  if (status === "draft") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.10)] text-[var(--text-secondary)]">
        Drafted
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.10)] text-[#fbbf24]">
        Approved
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.10)] text-[#fb7185]">
        Failed
      </span>
    );
  }
  if (status === "posted") {
    if (delta === null || delta === undefined) {
      return (
        <span className="text-[11px] px-2 py-0.5 rounded-md border border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.10)] text-[#7dd3fc]">
          Posted, no lift yet
        </span>
      );
    }
    const positive = delta >= 0;
    return (
      <span
        className={`text-[11px] px-2 py-0.5 rounded-md border ${
          positive
            ? "border-[rgba(34,197,94,0.22)] bg-[rgba(34,197,94,0.10)] text-[#4ade80]"
            : "border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.10)] text-[#fb7185]"
        }`}
      >
        Posted {positive ? "+" : ""}{delta.toFixed(1)}pp
      </span>
    );
  }
  return null;
}
```

- [ ] **Step 2: Render the chip in the card header**

Inside the main `PieceCard` component's JSX, find the header / title row of the card body. Add `<PieceStatusChip status={draft?.status ?? "missing"} delta={draft?.attribution_delta} />` next to the platform badge / title.

*(Exact placement: in the section where the platform name and status currently render. The chip should sit alongside whatever status text exists today, replacing duplicative status text if present.)*

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual sanity**

In a brand with a cluster that has at least one posted draft with attribution and one unposted draft, verify chips render correctly on the cluster detail page (`/content/{brand_id}/cluster/{cluster_id}`).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/content/cluster/PieceCard.tsx
git commit -m "feat(content): piece card surfaces status + attribution lift chip"
```

---

## Task 6: Frontend — collapsible `BriefPanel`

**Files:**
- Modify: `frontend/components/content/cluster/BriefPanel.tsx`

- [ ] **Step 1: Wrap the panel body in a controlled disclosure**

Edit `BriefPanel.tsx`. Find the component's root return (the panel wrapper div). Wrap the existing body with a collapsible disclosure:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
// ...existing imports

export function BriefPanel(props: BriefPanelProps) {
  const [open, setOpen] = useState(false);
  // ...existing hooks and state above

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          Brief
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-[var(--text-faint)]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--text-faint)]" />
        )}
      </button>
      {open && (
        <div className="mt-3">
          {/* existing brief body unchanged */}
        </div>
      )}
    </div>
  );
}
```

*(Adapt the existing component shape — keep all current functionality; only add the disclosure. If the file already has its own header/wrapper, drop the header above and integrate the toggle into the existing one.)*

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Visual sanity**

Open a cluster detail page. The Brief section should now be collapsed by default; clicking expands.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/BriefPanel.tsx
git commit -m "feat(content): brief panel collapsed by default"
```

---

## Task 7: Frontend — cluster detail page reorder + conditional pillar

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 1: Reorder sections**

Edit `page.tsx`. Replace the JSX block from `<BriefPanel ... />` through the `<PieceCard>` grid (currently lines 144-174) with the new order: pieces first, brief below, pillar conditional last.

```tsx
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-3">
          Pieces
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORMS.map((platform) => (
            <PieceCard
              key={platform}
              brandId={brandId}
              clusterId={cluster.id}
              platform={platform}
              draft={draftsByPlatform.get(platform) ?? null}
              onUpdated={updateDraft}
            />
          ))}
        </div>
      </div>

      <BriefPanel
        brandId={brandId}
        clusterId={cluster.id}
        brief={cluster.brief}
        onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
      />

      {(cluster.pillar_mode !== "none" || candidate !== null) && (
        <PillarCard
          brandId={brandId}
          cluster={cluster}
          candidate={candidate}
          onClusterUpdated={(c) => setCluster(c)}
        />
      )}
```

- [ ] **Step 2: Update header to show cluster_delta instead of visibility_pct**

In the same file, find the header right-side block (currently shows `visibility`/`visibilityTone`/`TrendingUp/Down` icons, lines 129-141). Replace with:

```tsx
        <div className="shrink-0 text-right">
          {(() => {
            const delta = cluster.cluster_delta;
            const hasDelta = delta !== null && delta !== undefined;
            const tone = !hasDelta
              ? "text-[var(--text-faint)]"
              : delta! >= 0
              ? "text-[#4ade80]"
              : "text-[#fb7185]";
            const label = !hasDelta
              ? "—"
              : `${delta! >= 0 ? "+" : ""}${delta!.toFixed(1)}pp`;
            return (
              <>
                <div className={`flex items-center justify-end gap-1.5 text-3xl font-bold ${tone}`}>
                  {label}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                  Cluster lift
                </div>
              </>
            );
          })()}
        </div>
```

Remove the now-unused `TrendingDown`, `TrendingUp` imports from the top of the file.

Also remove the `visibility`/`visibilityTone` consts (currently lines 73-79) — no longer used.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual sanity**

Open a cluster detail page. Order should now be: Header → Pieces grid → Brief (collapsed) → Pillar (only if relevant). Header right-side shows "Cluster lift" with `+Npp` or `—`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx
git commit -m "feat(content): cluster detail leads with pieces, lift in header"
```

---

## Task 8: Frontend — `ImpactStrip` component

**Files:**
- Create: `frontend/components/content/ImpactStrip.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/content/ImpactStrip.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDrafts, getDraftAttributions, type ContentDraft, type DraftAttribution } from "@/lib/api";
import PlatformBadge from "@/components/PlatformBadge";

interface Props {
  brandId: number;
  onSeeAll: () => void;
}

interface Row {
  draft: ContentDraft;
  delta: number | null;
  isLegacy: boolean;
}

const LIVE_LIMIT = 5;
const LEGACY_LIMIT = 3;

function formatPostedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 1) return "today";
  if (diff < 2) return "1d ago";
  if (diff < 14) return `${Math.floor(diff)}d ago`;
  return d.toLocaleDateString();
}

export function ImpactStrip({ brandId, onSeeAll }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [legacyRows, setLegacyRows] = useState<Row[]>([]);
  const [legacyTotal, setLegacyTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [drafts, attributions] = await Promise.all([
        getDrafts(brandId, undefined, "posted"),
        getDraftAttributions(brandId).catch(() => [] as DraftAttribution[]),
      ]);
      if (cancelled) return;
      const deltaById = new Map<number, number | null>(
        attributions.map((a) => [a.draft_id, a.delta ?? null]),
      );
      const live: Row[] = [];
      const legacy: Row[] = [];
      for (const d of drafts) {
        const row: Row = {
          draft: d,
          delta: deltaById.get(d.id) ?? null,
          isLegacy: d.cluster_id == null,
        };
        if (row.isLegacy) legacy.push(row);
        else live.push(row);
      }
      live.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
      legacy.sort((a, b) => {
        const ad = a.draft.posted_at ?? a.draft.created_at ?? "";
        const bd = b.draft.posted_at ?? b.draft.created_at ?? "";
        return bd.localeCompare(ad);
      });
      setRows(live.slice(0, LIVE_LIMIT));
      setLegacyRows(legacy.slice(0, LEGACY_LIMIT));
      setLegacyTotal(legacy.length);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  if (rows === null) {
    return null;
  }
  if (rows.length === 0 && legacyRows.length === 0) {
    return (
      <div className="card mb-6">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-2">
          Impact
        </div>
        <p className="text-sm text-[var(--text-faint)]">
          No measured impact yet — post a piece and we&apos;ll track lift here after the next tracking run.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          Impact
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
        >
          See all posted →
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.draft.id} className="flex items-center gap-3 text-sm">
            <DeltaChip delta={r.delta} />
            <PlatformBadge platform={r.draft.platform} size="sm" />
            <span className="flex-1 truncate text-[var(--text-secondary)]">
              {r.draft.title || `${r.draft.platform} piece`}
            </span>
            <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
              {formatPostedAt(r.draft.posted_at)}
            </span>
            {r.draft.cluster_id != null && (
              <Link
                href={`/content/${brandId}/cluster/${r.draft.cluster_id}`}
                className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Jump to cluster →
              </Link>
            )}
          </li>
        ))}
        {legacyRows.length > 0 && (
          <>
            <li className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mt-2 mb-1">
              ─── Legacy ───
            </li>
            {legacyRows.map((r) => (
              <li key={r.draft.id} className="flex items-center gap-3 text-sm opacity-70">
                <span className="text-xs text-[var(--text-faint)] px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                  Legacy
                </span>
                <PlatformBadge platform={r.draft.platform} size="sm" />
                <span className="flex-1 truncate text-[var(--text-secondary)]">
                  {r.draft.title || `${r.draft.platform} piece`}
                </span>
                <span className="text-xs text-[var(--text-faint)] whitespace-nowrap">
                  {formatPostedAt(r.draft.posted_at)}
                </span>
              </li>
            ))}
            {legacyTotal > LEGACY_LIMIT && (
              <li className="text-xs text-[var(--text-faint)]">
                +{legacyTotal - LEGACY_LIMIT} more in history
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="text-xs font-medium text-[var(--text-faint)] w-14 text-right">—</span>
    );
  }
  const positive = delta >= 0;
  return (
    <span
      className={`text-xs font-semibold w-14 text-right ${
        positive ? "text-[#4ade80]" : "text-[#fb7185]"
      }`}
    >
      {positive ? "+" : ""}{delta.toFixed(1)}pp
    </span>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/ImpactStrip.tsx
git commit -m "feat(content): add ImpactStrip cross-cluster delta summary"
```

---

## Task 9: Frontend — `PostedHistoryModal` component

**Files:**
- Create: `frontend/components/content/PostedHistoryModal.tsx`

- [ ] **Step 1: Create the modal**

Create `frontend/components/content/PostedHistoryModal.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  getDrafts,
  getDraftAttributions,
  deleteDraft as apiDeleteDraft,
  type ContentDraft,
  type DraftAttribution,
} from "@/lib/api";
import PlatformBadge from "@/components/PlatformBadge";

interface Props {
  brandId: number;
  open: boolean;
  onClose: () => void;
}

interface Row {
  draft: ContentDraft;
  delta: number | null;
}

export function PostedHistoryModal({ brandId, open, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [drafts, attributions] = await Promise.all([
        getDrafts(brandId, undefined, "posted"),
        getDraftAttributions(brandId).catch(() => [] as DraftAttribution[]),
      ]);
      if (cancelled) return;
      const deltaById = new Map<number, number | null>(
        attributions.map((a) => [a.draft_id, a.delta ?? null]),
      );
      const out: Row[] = drafts.map((d) => ({ draft: d, delta: deltaById.get(d.id) ?? null }));
      out.sort((a, b) => {
        const ad = a.draft.posted_at ?? a.draft.created_at ?? "";
        const bd = b.draft.posted_at ?? b.draft.created_at ?? "";
        return bd.localeCompare(ad);
      });
      setRows(out);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId, open]);

  if (!open) return null;

  async function handleDelete(id: number) {
    if (!confirm("Delete this posted record? Attribution data will be lost.")) return;
    await apiDeleteDraft(id);
    setRows((prev) => prev.filter((r) => r.draft.id !== id));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Posted history</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-[var(--text-faint)]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--text-faint)]">Nothing posted yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const positive = r.delta != null && r.delta >= 0;
                return (
                  <li key={r.draft.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={`text-xs font-semibold w-14 text-right ${
                        r.delta == null
                          ? "text-[var(--text-faint)]"
                          : positive
                          ? "text-[#4ade80]"
                          : "text-[#fb7185]"
                      }`}
                    >
                      {r.delta == null ? "—" : `${positive ? "+" : ""}${r.delta.toFixed(1)}pp`}
                    </span>
                    <PlatformBadge platform={r.draft.platform} size="sm" />
                    <span className="flex-1 truncate text-[var(--text-secondary)]">
                      {r.draft.title || `${r.draft.platform} piece`}
                    </span>
                    {r.draft.cluster_id != null ? (
                      <Link
                        href={`/content/${brandId}/cluster/${r.draft.cluster_id}`}
                        className="text-xs text-[var(--accent-foreground)] hover:text-[var(--text-primary)]"
                      >
                        Jump to cluster →
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--text-faint)]">Legacy</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(r.draft.id)}
                      className="text-xs text-[var(--text-faint)] hover:text-[#fb7185]"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/PostedHistoryModal.tsx
git commit -m "feat(content): add PostedHistoryModal for long-tail history"
```

---

## Task 10: Frontend — `ContentHub` tab collapse + mount Impact strip

**Files:**
- Modify: `frontend/components/content/ContentHub.tsx`

- [ ] **Step 1: Audit imports + types**

In `ContentHub.tsx`, locate (run grep to find each):
- Line ~98: `type QueueTab = 'drafts' | 'scheduled' | 'opportunities' | 'posted';`
- Line ~99: `type PrimaryTab = 'clusters' | 'opportunities' | 'content_drafts' | 'posted';`
- Line ~100: `type ContentDraftsSubTab = 'queue' | 'scheduled';`
- Line ~2104: `const PRIMARY_TABS = [...]` definition (4 entries)
- Line ~77: `import { ContentTabPanels } from '@/components/content/ContentTabPanels';`

- [ ] **Step 2: Replace `PrimaryTab` + `QueueTab` types**

Edit `ContentHub.tsx`. Replace the three type lines (~98-100) with:

```ts
type PrimaryTab = 'clusters' | 'opportunities';
```

(Delete `QueueTab` and `ContentDraftsSubTab` — no longer used.)

- [ ] **Step 3: Strip the `activeSubTab` + `activeTab` state**

Find and remove all references to `activeSubTab` and the `activeTab` derivation block (~lines 1461-1467 area). Replace with simpler:

```ts
  const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTab>('clusters');
```

- [ ] **Step 4: Simplify URL-tab sync**

Find the URL-param sync effect (~line 1475). Replace with:

```ts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'opportunities') {
      setActivePrimaryTab('opportunities');
    }
    // anything else (including legacy ?tab=drafts/scheduled/saved/posted) silently falls back to clusters
  }, []);
```

- [ ] **Step 5: Update `PRIMARY_TABS`**

Find `const PRIMARY_TABS` (~line 2104). Replace with:

```ts
  const PRIMARY_TABS: { key: PrimaryTab; label: string }[] = [
    { key: 'clusters', label: 'Clusters' },
    { key: 'opportunities', label: 'Visibility Opportunities' },
  ];
```

- [ ] **Step 6: Remove ContentTabPanels mount; insert ImpactStrip and modal in Clusters tab body**

Find the JSX that mounts `<ContentTabPanels ... />` and the surrounding tab-body switching logic. The Clusters tab body (where it currently renders the cluster grid) should be wrapped so it shows `ImpactStrip` first.

Add new imports at the top of the file:

```tsx
import { ImpactStrip } from '@/components/content/ImpactStrip';
import { PostedHistoryModal } from '@/components/content/PostedHistoryModal';
```

Remove the `ContentTabPanels` import.

Inside the component, add state:

```tsx
const [postedModalOpen, setPostedModalOpen] = useState(false);
```

In the JSX, where `activePrimaryTab === 'clusters'` renders today, replace the body with:

```tsx
{activePrimaryTab === 'clusters' && selectedBrandId != null && (
  <>
    <ImpactStrip brandId={selectedBrandId} onSeeAll={() => setPostedModalOpen(true)} />
    {/* existing cluster grid rendering — keep as-is */}
    <PostedHistoryModal
      brandId={selectedBrandId}
      open={postedModalOpen}
      onClose={() => setPostedModalOpen(false)}
    />
  </>
)}
```

Where `activePrimaryTab === 'opportunities'` renders today, keep the existing Opportunities-tab body untouched (currently lives inside the `<ContentTabPanels>` switch — if so, lift that branch out as a direct `<OpportunitiesPanel {...} />` mount).

Delete any `<ContentTabPanels>` usage. Delete the `drafts`/`scheduled`/`posted` tab-body branches entirely.

- [ ] **Step 7: Tear out flat-list state**

Identify and remove unused state hooks that only existed for the flat-list tabs:
- `pinnedDraftId`
- `draftPlatformFilter`, `setDraftPlatformFilter`
- `scheduledPlatformFilter`, `setScheduledPlatformFilter`, `postedPlatformFilter`, `setPostedPlatformFilter` (if present)
- `visibleDraftItems`, `visibleScheduledItems`, `visiblePostedItems`
- `markPostedModalDraftId`, the mark-posted modal state, the platform-filter ref tracking effect (~line 1570)
- `postingPlatform` (~line 1537) — only used by old approval flow

*Critical:* before deleting any state, grep for its usage inside the file. Some may still be referenced by lingering JSX even after Step 6. Remove progressively, running `tsc --noEmit` after each batch.

- [ ] **Step 8: Type-check after each batch**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (after iterative cleanup).

- [ ] **Step 9: Visual sanity**

- `/content/{brand_id}` shows two tabs only.
- Default tab is Clusters; Impact strip renders above the cluster grid.
- Opportunities tab renders existing content unchanged.
- `?tab=drafts`, `?tab=scheduled`, `?tab=saved`, `?tab=posted` all silently land on Clusters.
- "See all posted" opens the modal.
- No console errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/content/ContentHub.tsx
git commit -m "feat(content): collapse to two tabs + mount ImpactStrip"
```

---

## Task 11: Frontend — delete dead components

**Files:**
- Delete: see list

- [ ] **Step 1: Verify no remaining imports**

For each candidate file, grep for its export name to confirm nothing else imports it.

Run for each:
```bash
grep -rn "from.*DraftsPanel\|from.*ScheduledPanel\|from.*PostedPanel\|from.*ContentTabPanels" frontend/ --include='*.tsx' --include='*.ts'
grep -rn "from.*cards/DraftCard\|from.*cards/ScheduledCard\|from.*cards/PostedCard\|from.*cards/WikipediaDraftCard" frontend/ --include='*.tsx' --include='*.ts'
```

Expected: no results outside of files being deleted themselves.

If `WikipediaDraftCard` or `cards/DraftCard` IS still imported by anything outside `/content/` (e.g., from a Wikipedia surface component or from `/agency/`), do not delete it. Note the consumer; we leave the file alone.

- [ ] **Step 2: Delete confirmed-orphan files**

```bash
rm frontend/components/content/DraftsPanel.tsx
rm frontend/components/content/ScheduledPanel.tsx
rm frontend/components/content/PostedPanel.tsx
rm frontend/components/content/ContentTabPanels.tsx
# Only if Step 1 confirmed no external consumers:
rm frontend/components/content/cards/DraftCard.tsx
rm frontend/components/content/cards/ScheduledCard.tsx
rm frontend/components/content/cards/PostedCard.tsx
rm frontend/components/content/cards/WikipediaDraftCard.tsx
```

- [ ] **Step 3: Type-check + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(content): remove flat-list panel + card components"
```

---

## Task 12: Browser smoke verification

- [ ] **Step 1: Start backend + frontend**

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001 &
cd frontend && PORT=3002 npm run dev &
```

- [ ] **Step 2: Test matrix**

Verify on `http://localhost:3002/content/{brand_id_with_clusters_and_posted_drafts}`:

| Check | Pass |
|---|---|
| Two tabs only: Clusters · Visibility Opportunities | ☐ |
| Impact strip renders above cluster grid | ☐ |
| Live rows sorted by delta desc | ☐ |
| Legacy block appears when `cluster_id=NULL` posts exist | ☐ |
| "See all posted" opens modal, lists all posted, "Jump to cluster" works for non-legacy | ☐ |
| Cluster card headline shows "Cluster lift" with `+Npp` or `—` (not the old `%`) | ☐ |
| Cluster card sub-line shows "Posted X of N" | ☐ |
| Regenerate moved into kebab menu | ☐ |
| Cluster detail: order is Pieces → Brief → Pillar | ☐ |
| Brief is collapsed by default | ☐ |
| Pillar hidden when `pillar_mode='none'` and no candidate | ☐ |
| PieceCard chip shows correct state for `draft` / `approved` / `posted +Npp` / `posted, no lift yet` / `failed` | ☐ |
| `?tab=drafts`, `?tab=posted` silently land on Clusters tab | ☐ |
| Opportunities tab unchanged | ☐ |
| No console errors | ☐ |

- [ ] **Step 3: Update CURRENT_STATE.md**

Edit `CURRENT_STATE.md`:
- Bump `Last updated` to today.
- Replace "Recently Changed (last session)" content with the content-tab-collapse summary.
- Add a one-line entry to "Recent Decisions" at the top:

```
- **2026-05-22** — Shipped **content tab collapse + cluster UX pass** on main. Collapsed `/content/[brandId]` from 4 tabs to 2 (Clusters · Visibility Opportunities). Added cross-cluster Impact strip; cluster card headline now shows real cluster_delta (sum of DraftAttribution.delta across posted pieces) labeled "Cluster lift" instead of the prompt's visibility %. PieceCard surfaces status + attribution chip. Cluster detail reordered (pieces first, brief collapsed, pillar conditional). Backend extended `ContentClusterSummary` + `ContentClusterDetail` schemas with `cluster_delta` + `posted_count` (+ per-draft `attribution_delta`). No new tables, no migration. Deleted flat-list panels: DraftsPanel, ScheduledPanel, PostedPanel, ContentTabPanels + their cards (with grep verification per component).
```

- [ ] **Step 4: Final commit**

```bash
git add CURRENT_STATE.md
git commit -m "docs: update CURRENT_STATE for content tab collapse"
```

---

## Self-Review Pass

Done inline during writing — checked:
- Every spec section maps to a task (1: backend summary; 2: backend detail; 3: types; 4: ClusterCard; 5: PieceCard; 6: Brief collapse; 7: detail reorder; 8: Impact; 9: Modal; 10: ContentHub collapse; 11: deletions; 12: smoke).
- No "TBD" / "implement later" placeholders.
- Type names consistent across tasks (`cluster_delta`, `posted_count`, `attribution_delta` used identically backend → frontend).
- Spec's "out of scope" items respected: Opportunities tab untouched, Wikipedia/Site Audit untouched, agency cockpit untouched.
- One latent risk: Task 10 (`ContentHub.tsx`) is a 2950-line file with many tangled flat-list state hooks. The "iterative cleanup with `tsc --noEmit` between batches" guidance is the right hedge — but expect this task to be the slowest.
