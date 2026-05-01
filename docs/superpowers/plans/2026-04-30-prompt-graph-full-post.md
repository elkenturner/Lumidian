# Prompt-Impact Graph: Show Full Posted Draft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks a marker on the prompt-impact chart, show the full untruncated post body and a link to the live post — instead of hiding the body behind a second chevron and a 1000-char cap.

**Architecture:** Backend uncaps `content_preview` and surfaces `ContentPost.post_url` on the existing `PromptDraftSnapshot`. Frontend defaults the draft row to expanded when a marker corresponds to a single draft, wraps the body in a max-height scrollable container, and renders a "View on [platform]" link when a URL is present.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (backend), Next.js 15 + React 18 + TypeScript + Recharts (frontend), pytest (backend tests). No frontend tests exist; verify with `tsc --noEmit` and a manual smoke check.

**Spec:** `docs/superpowers/specs/2026-04-30-prompt-graph-full-post-design.md`

---

## Task 1: Backend — uncap body + add post_url to draft snapshots

**Files:**
- Modify: `backend/app/schemas.py:795-802` (the `PromptDraftSnapshot` Pydantic model)
- Modify: `backend/app/routers/results.py:610-629` (the loop that builds `draft_snapshots`)
- Test: `backend/tests/test_prompt_intelligence.py` (add a new test next to `test_prompt_detail_endpoint`)

### Step 1.1: Write the failing test

- [ ] Append this test at the end of `backend/tests/test_prompt_intelligence.py`:

```python
@pytest.mark.asyncio
async def test_prompt_detail_returns_full_body_and_post_url(client, db_session):
    """Posted draft snapshots return the full content_text (not truncated) and the post_url."""
    from datetime import datetime, timezone
    from app.models import ContentDraft, ContentPost

    await register_and_login(client)
    brand_data = await create_brand(client, "FullBodyBrand", ["best CRM software"])
    brand_id = brand_data["id"]

    brand_resp = await client.get(f"/api/brands/{brand_id}")
    prompt_id = brand_resp.json()["prompts"][0]["id"]

    # Create a posted draft with a body longer than the old 1000-char cap.
    long_body = "Lorem ipsum dolor sit amet. " * 100  # ~2700 chars
    draft = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform="reddit",
        status="posted",
        title="long post",
        content_text=long_body,
        content_brief="brief",
        visibility_score_at_draft=0.0,
        estimated_impact=0.0,
        source="manual",
        posted_at=datetime.now(timezone.utc),
    )
    db_session.add(draft)
    await db_session.commit()
    await db_session.refresh(draft)

    post = ContentPost(
        draft_id=draft.id,
        platform="reddit",
        post_url="https://reddit.com/r/test/comments/abc123",
        posted_at=datetime.now(timezone.utc),
    )
    db_session.add(post)
    await db_session.commit()

    resp = await client.get(f"/api/results/{brand_id}/prompt/{prompt_id}/detail")
    assert resp.status_code == 200
    drafts = resp.json()["drafts"]
    snapshot = next(d for d in drafts if d["id"] == draft.id)

    # Body must be the full string (no 1000-char cap).
    assert snapshot["content_preview"] == long_body
    assert len(snapshot["content_preview"]) > 1000

    # post_url is surfaced from the joined ContentPost.
    assert snapshot["post_url"] == "https://reddit.com/r/test/comments/abc123"


@pytest.mark.asyncio
async def test_prompt_detail_post_url_null_when_no_content_post(client, db_session):
    """A posted draft with no ContentPost row returns post_url=None (legacy mark-as-posted)."""
    from datetime import datetime, timezone
    from app.models import ContentDraft

    await register_and_login(client)
    brand_data = await create_brand(client, "NoUrlBrand", ["test query"])
    brand_id = brand_data["id"]

    brand_resp = await client.get(f"/api/brands/{brand_id}")
    prompt_id = brand_resp.json()["prompts"][0]["id"]

    draft = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform="quora",
        status="posted",
        title="no-url post",
        content_text="short body",
        content_brief="brief",
        visibility_score_at_draft=0.0,
        estimated_impact=0.0,
        source="manual",
        posted_at=datetime.now(timezone.utc),
    )
    db_session.add(draft)
    await db_session.commit()
    await db_session.refresh(draft)

    resp = await client.get(f"/api/results/{brand_id}/prompt/{prompt_id}/detail")
    assert resp.status_code == 200
    drafts = resp.json()["drafts"]
    snapshot = next(d for d in drafts if d["id"] == draft.id)
    assert snapshot["post_url"] is None
    assert snapshot["content_preview"] == "short body"
```

### Step 1.2: Run the test to verify it fails

- [ ] Run:

```bash
cd backend && source venv/bin/activate
pytest tests/test_prompt_intelligence.py::test_prompt_detail_returns_full_body_and_post_url -v
pytest tests/test_prompt_intelligence.py::test_prompt_detail_post_url_null_when_no_content_post -v
```

Expected: both fail. The first fails on `assert snapshot["post_url"] == "https://reddit.com/..."` with `KeyError: 'post_url'` (field not yet on the schema). The second fails for the same reason.

### Step 1.3: Add `post_url` to the Pydantic schema

- [ ] In `backend/app/schemas.py`, modify the `PromptDraftSnapshot` model (lines ~795-802) to include the new field:

```python
class PromptDraftSnapshot(BaseModel):
    id: int
    platform: str
    status: str
    posted_at: datetime | None
    visibility_at_post: float | None
    content_preview: str  # full body — historically capped at 1000 chars, now uncapped
    post_url: str | None = None
    score_snapshot: dict
```

### Step 1.4: Update the router to uncap body and join `ContentPost`

- [ ] In `backend/app/routers/results.py`, ensure `ContentPost` is in the imports at line 28:

```python
from app.models import (
    Brand, Competitor, CompetitorMention, ContentAttribution, ContentDraft,
    ContentEvent, ContentPost, DraftAttribution, Prompt, PromptRunScore, QueryResult,
    RunModelScore, TrackingRun,
)
```

- [ ] Replace the snapshot-building block (currently lines ~600-629) with this version. It batches the `ContentPost` lookup, drops the 1000-char cap, and surfaces `post_url`:

```python
    # Batch-fetch DraftAttribution for posted drafts (avoids N+1)
    posted_draft_ids = [d.id for d in drafts if d.status == "posted"]
    attrs_by_draft: dict[int, DraftAttribution] = {}
    posts_by_draft: dict[int, ContentPost] = {}
    if posted_draft_ids:
        attr_result = await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id.in_(posted_draft_ids))
        )
        for attr in attr_result.scalars().all():
            attrs_by_draft[attr.draft_id] = attr

        post_result = await db.execute(
            select(ContentPost)
            .where(ContentPost.draft_id.in_(posted_draft_ids))
            .order_by(ContentPost.posted_at.desc())
        )
        # Most-recent ContentPost wins per draft (rows are ordered desc above).
        for post in post_result.scalars().all():
            posts_by_draft.setdefault(post.draft_id, post)

    draft_snapshots = []
    for d in drafts:
        snapshot = {"at_posting": None, "current": None, "delta": None, "runs_since": None}
        attr = attrs_by_draft.get(d.id)
        if attr:
            snapshot = {
                "at_posting": attr.score_at_posting,
                "current": attr.current_score,
                "delta": attr.delta,
                "runs_since": attr.runs_since_posting,
            }
        post = posts_by_draft.get(d.id)
        draft_snapshots.append(PromptDraftSnapshot(
            id=d.id,
            platform=d.platform,
            status=d.status,
            posted_at=d.posted_at,
            visibility_at_post=d.visibility_at_post,
            content_preview=d.content_text or "",
            post_url=post.post_url if post else None,
            score_snapshot=snapshot,
        ))
```

### Step 1.5: Run the tests to verify they pass

- [ ] Run:

```bash
pytest tests/test_prompt_intelligence.py::test_prompt_detail_returns_full_body_and_post_url tests/test_prompt_intelligence.py::test_prompt_detail_post_url_null_when_no_content_post -v
```

Expected: both PASS.

- [ ] Re-run the full file to confirm no existing test regressed:

```bash
pytest tests/test_prompt_intelligence.py -v
```

Expected: all green.

### Step 1.6: Commit

- [ ] Run:

```bash
git add backend/app/schemas.py backend/app/routers/results.py backend/tests/test_prompt_intelligence.py
git commit -m "$(cat <<'EOF'
feat(results): uncap prompt-detail body, surface post_url

Posted-draft snapshots now return the full content_text (was
truncated to 1000 chars) and the post_url joined from
ContentPost so the UI can link to the live post.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Frontend — extend `PromptDraftSnapshot` TS type

**Files:**
- Modify: `frontend/lib/api.ts:1465-1478` (the `PromptDraftSnapshot` interface)

### Step 2.1: Add `post_url` to the interface

- [ ] In `frontend/lib/api.ts`, replace the `PromptDraftSnapshot` interface so it matches the backend schema:

```typescript
export interface PromptDraftSnapshot {
  id: number;
  platform: string;
  status: string;
  posted_at: string | null;
  visibility_at_post: number | null;
  content_preview: string;
  post_url: string | null;
  score_snapshot: {
    at_posting: number | null;
    current: number | null;
    delta: number | null;
    runs_since: number | null;
  };
}
```

### Step 2.2: Type-check passes

- [ ] Run:

```bash
cd frontend && npx tsc --noEmit
```

Expected: exit code 0, no errors.

### Step 2.3: Commit

- [ ] Run:

```bash
git add frontend/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(api): add post_url to PromptDraftSnapshot type

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend — auto-expand body, max-height scroll, "View on platform" link

**Files:**
- Modify: `frontend/components/PromptImpactTimeline.tsx` (the `DraftExpansionRow` component at lines ~496-538, plus the parent that renders rows around lines ~447-451)

### Step 3.1: Pass single-draft hint into the row

- [ ] In `PromptImpactTimeline.tsx`, find the `expandedDraft.drafts.map(...)` at lines ~448-450 and pass a new `defaultExpanded` prop based on whether the panel holds exactly one draft:

```tsx
          <div className="flex flex-col">
            {expandedDraft.drafts.map((draft, i) => (
              <DraftExpansionRow
                key={draft.id}
                draft={draft}
                showBorder={i > 0}
                defaultExpanded={expandedDraft.drafts.length === 1}
              />
            ))}
          </div>
```

### Step 3.2: Update the `DraftExpansionRow` component

- [ ] Replace the `DraftExpansionRow` component (lines ~496-538) with this version. It accepts the new `defaultExpanded` prop, renders a "View on [platform]" link when `post_url` is present, and wraps the body in a max-height scrollable container:

```tsx
/** Expandable row showing a single posted draft */
function DraftExpansionRow({
  draft,
  showBorder,
  defaultExpanded = false,
}: {
  draft: PromptDraftSnapshot;
  showBorder: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={showBorder ? 'border-t border-[var(--border-subtle)]' : ''}>
      <button
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[11px] font-medium text-[var(--text-primary)] capitalize">
          {draft.platform}
        </span>
        {draft.posted_at && (
          <span className="text-[10px] text-[var(--text-faint)]">
            {format(parseUTCISO(draft.posted_at), 'MMM d, yyyy')}
          </span>
        )}
        {draft.score_snapshot.delta != null && draft.score_snapshot.delta !== 0 && (
          <span
            className="text-[10px] font-bold"
            style={{
              color: draft.score_snapshot.delta > 0 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {draft.score_snapshot.delta > 0 ? '+' : ''}{Math.round(draft.score_snapshot.delta)}pp
          </span>
        )}
        {draft.post_url && (
          <a
            href={draft.post_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-[var(--accent-light)] hover:text-[var(--accent)] transition-colors"
          >
            <ExternalLink size={10} />
            View on {draft.platform}
          </a>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-[var(--text-faint)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && draft.content_preview && (
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)]">
          <div className="max-h-96 overflow-y-auto">
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
              {draft.content_preview}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 3.3: Confirm `ExternalLink` is imported

- [ ] In `PromptImpactTimeline.tsx`, scroll to the `lucide-react` import block near the top of the file. If `ExternalLink` is already imported, skip this step. Otherwise add it:

```tsx
import { ChevronDown, ExternalLink, X /* …existing imports… */ } from 'lucide-react';
```

(Preserve any other icons already imported — only add `ExternalLink` if it's missing.)

### Step 3.4: Type-check passes

- [ ] Run:

```bash
cd frontend && npx tsc --noEmit
```

Expected: exit code 0.

### Step 3.5: Manual smoke check

- [ ] Start the backend:

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
```

- [ ] Start the frontend in a second terminal:

```bash
cd frontend && npm run dev
```

(Per project memory, frontend runs on port 3002.)

- [ ] In the browser, navigate to a brand whose prompts have at least one posted draft. Open the prompt detail view and click a diamond marker. Verify each of these:

  | Check | Expected |
  | --- | --- |
  | Single-draft marker | Panel opens with the body already visible — no second chevron click needed. |
  | Body length | Posts longer than 1000 chars render in full; the body container scrolls internally instead of pushing the chart down. |
  | `post_url` present | A "View on [platform]" link appears in the header row. Clicking it opens the live post in a new tab. The link click does NOT toggle the row collapse. |
  | `post_url` null | No link rendered; chevron and body still work. |
  | Multi-draft marker | Panel opens with rows collapsed. Clicking a chevron toggles each row independently. |
  | Collapse-back | Clicking the chevron on an auto-expanded row collapses the body. |

### Step 3.6: Commit

- [ ] Run:

```bash
git add frontend/components/PromptImpactTimeline.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): show full posted body + live link on marker click

Single-draft markers now auto-expand the body when the panel
opens. The body scrolls inside a max-h-96 container so long
posts don't push the chart off-screen. When a post_url is
present, a "View on [platform]" link opens the live post.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (already completed by plan author)

- **Spec coverage:** Backend uncap → Task 1.4. `post_url` join → Task 1.4. Schema field → Task 1.3. TS type → Task 2.1. Auto-expand → Task 3.1+3.2. Max-h scroll → Task 3.2. View-on-platform link → Task 3.2. Multi-draft preserves collapse → Task 3.1 (`defaultExpanded={length === 1}`). Edge case "post_url null" → covered by `{draft.post_url && …}` guard in 3.2 plus test 1.1.
- **No placeholders:** every step has runnable commands or a complete code block. No "TBD" / "similar to" references.
- **Type consistency:** `post_url` named identically across `schemas.py`, `results.py`, the `api.ts` interface, and `DraftExpansionRow` reads. `defaultExpanded` introduced in 3.1 and consumed in 3.2.
- **Field reuse:** `content_preview` keeps its name; the spec explicitly chose not to rename to `content_full` to avoid drive-by churn.
