# Content Hub Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the producer→measurement loop inside the Content Hub. Rename "Scheduled" → "Saved", make the Posted tab actually useful (clickable cards that jump to the prompt's timeline with the matching diamond highlighted, delete, summary strip, orphan recovery), and add an in-product explanation of how impact attribution works.

**Architecture:** Frontend copy + UX work on top of a small backend extension. Backend: `UpdateDraftRequest` learns `prompt_id`, a new `POST /api/content/draft/{id}/prompt-suggestions` endpoint ranks tracked prompts by token-overlap similarity, and a late-attach branch in `update_draft` creates null-baseline `DraftAttribution` rows. Frontend: extract + redesign `PostedCard`, introduce a `PostedSummaryStrip`, an `AttachPromptPopover` reused by both the Mark-as-Posted orphan modal and the attach button on orphan posted cards, and deep-link the prompt detail timeline via `?draft=<id>` with a one-shot pulse on the matching diamond marker.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Pydantic on the backend; Next.js 15 + React 18 + TypeScript + Recharts + Tailwind on the frontend. Backend tests via pytest (async mode).

**Spec:** `docs/superpowers/specs/2026-04-23-content-hub-impact-design.md`

**Frontend polish skills:** Apply `impeccable` and `emil-design-eng` during card/popover/modal/pulse work (Tasks 8–14). They cover hover elevation, spring easing, gesture feel, and motion token choices consistent with the rest of the app.

---

## File Structure

### Backend

| File | Change | Responsibility |
|---|---|---|
| `backend/app/services/drafting_service.py` | Modify | Add `rank_prompts_by_similarity` helper + a small stopword set |
| `backend/app/schemas.py` | Modify | Add `prompt_id` field to `UpdateDraftRequest` |
| `backend/app/routers/content.py` | Modify | Extend `update_draft` to accept `prompt_id` (incl. late-attach branch). Add `POST /draft/{id}/prompt-suggestions` endpoint. Add small helper `_create_late_attach_attribution`. |
| `backend/tests/test_content_impact.py` | Create | All tests for this feature |

### Frontend

| File | Change | Responsibility |
|---|---|---|
| `frontend/lib/api.ts` | Modify | Extend `updateDraft` types, add `getPromptSuggestions` |
| `frontend/app/content/page.tsx` | Modify | Scheduled→Saved copy rename; wire summary strip, explainer modal, Mark-as-Posted orphan modal; delete `PostedCard` inline (extracted to its own file) |
| `frontend/app/content/components/PostedCard.tsx` | Create | Redesigned card with whole-card click, attribution-first layout, delete, orphan variant, late-attach variant |
| `frontend/app/content/components/PostedSummaryStrip.tsx` | Create | One-row summary at top of Posted tab |
| `frontend/app/content/components/AttachPromptPopover.tsx` | Create | Shared popover: fetches suggestions, renders top-3 + full list, reports selected prompt id |
| `frontend/app/content/components/MarkAsPostedModal.tsx` | Create | Orphan gate at post time; wraps `AttachPromptPopover` + Skip action |
| `frontend/app/content/components/ImpactExplainerModal.tsx` | Create | Static explainer — what attribution means, confidence tiers, correlation/causation, orphan/late-attach story |
| `frontend/app/content/components/index.ts` | Modify | Export new components |
| `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx` | Modify | Read `?draft=` via `useSearchParams`, pass `highlightDraftId` down |
| `frontend/components/PromptImpactTimeline.tsx` | Modify | Accept `highlightDraftId`, auto-expand panel + pulse the matching diamond; auto-switch timeframe if the draft is outside it |

---

## Testing Strategy

- **Backend:** TDD. One test file at `backend/tests/test_content_impact.py` grouped by function. Uses existing `client`, `register_and_login`, `create_brand` fixtures from `conftest.py`.
- **Frontend:** No frontend tests exist in this repo. Each frontend task ends with a commit; the final task walks through manual browser verification covering all flows.
- **Always run the full `backend/tests/` suite before committing a backend task to catch regressions.**

---

## Task 1: Token similarity helper

**Files:**
- Modify: `backend/app/services/drafting_service.py`
- Test: `backend/tests/test_content_impact.py` (create)

- [ ] **Step 1: Write failing tests for `rank_prompts_by_similarity`**

Create `backend/tests/test_content_impact.py` with this content:

```python
"""Tests for content hub impact feature — orphan matching, late-attach attribution,
suggestion endpoint. Added 2026-04-23."""

import pytest

from app.services.drafting_service import rank_prompts_by_similarity


class _FakePrompt:
    """Stand-in for app.models.Prompt — we only need `id` and `text`."""
    def __init__(self, id: int, text: str) -> None:
        self.id = id
        self.text = text


def test_rank_identical_texts_scores_one():
    prompts = [_FakePrompt(1, "best ai tools for sales teams")]
    result = rank_prompts_by_similarity("best ai tools for sales teams", prompts)
    assert len(result) == 1
    p, score = result[0]
    assert p.id == 1
    assert score == pytest.approx(1.0)


def test_rank_disjoint_texts_scores_zero():
    prompts = [_FakePrompt(1, "submarine navigation deep ocean")]
    result = rank_prompts_by_similarity("vegetarian recipes weeknight dinner", prompts)
    p, score = result[0]
    assert score == 0.0


def test_rank_partial_overlap_between_zero_and_one():
    prompts = [_FakePrompt(1, "ai tools for sales teams")]
    result = rank_prompts_by_similarity("ai tools help founders ship faster", prompts)
    p, score = result[0]
    assert 0.0 < score < 1.0


def test_rank_orders_multiple_prompts_desc():
    prompts = [
        _FakePrompt(1, "submarine navigation"),
        _FakePrompt(2, "best ai tools for sales"),
        _FakePrompt(3, "ai tools for marketing"),
    ]
    result = rank_prompts_by_similarity("ai tools sales teams", prompts)
    ids_in_order = [p.id for p, _ in result]
    # Prompt 2 is most similar (3 tokens overlap), 3 second, 1 last
    assert ids_in_order[0] == 2
    assert ids_in_order[-1] == 1


def test_rank_ignores_short_tokens_and_stopwords():
    # "a", "to", "of" are stopwords; "ai" is too short (<3 chars).
    # Only "tools" remains on each side — full overlap.
    prompts = [_FakePrompt(1, "a tools of")]
    result = rank_prompts_by_similarity("to tools", prompts)
    p, score = result[0]
    assert score == pytest.approx(1.0)


def test_rank_empty_prompts_returns_empty():
    result = rank_prompts_by_similarity("anything", [])
    assert result == []


def test_rank_empty_draft_text_all_zero():
    prompts = [_FakePrompt(1, "ai tools for sales")]
    result = rank_prompts_by_similarity("", prompts)
    p, score = result[0]
    assert score == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_content_impact.py -v`
Expected: FAIL with `ImportError: cannot import name 'rank_prompts_by_similarity'`.

- [ ] **Step 3: Implement `rank_prompts_by_similarity`**

Append to `backend/app/services/drafting_service.py` (before the final newline). Put it near the top of the module, below existing imports and existing constants — not at the bottom of the file. A good home is right after the existing helper section but above `_store_draft`. If unsure, place it just above `# ── Draft creation helpers` (search the file for that comment).

```python
# ── Text similarity (orphan-draft matching) ──────────────────────────────────

_SIMILARITY_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "these", "those",
    "have", "has", "had", "but", "not", "are", "was", "were", "will", "would",
    "can", "could", "should", "may", "might", "about", "into", "onto", "than",
    "what", "when", "where", "which", "who", "why", "how", "all", "any",
    "some", "one", "two", "out", "off", "over", "under", "also", "just",
    "like", "very", "more", "most", "such", "you", "your", "our", "their",
    "his", "her", "its", "them", "they", "his", "been", "being",
})


def _tokenize_for_similarity(text: str) -> set[str]:
    """Lowercase → split on non-alphanumeric → keep tokens length ≥3 that are not stopwords."""
    out: set[str] = set()
    lowered = text.lower()
    buf: list[str] = []
    for ch in lowered:
        if ch.isalnum():
            buf.append(ch)
        else:
            if buf:
                tok = "".join(buf)
                if len(tok) >= 3 and tok not in _SIMILARITY_STOPWORDS:
                    out.add(tok)
                buf = []
    if buf:
        tok = "".join(buf)
        if len(tok) >= 3 and tok not in _SIMILARITY_STOPWORDS:
            out.add(tok)
    return out


def rank_prompts_by_similarity(draft_text: str, prompts: list) -> list[tuple[object, float]]:
    """
    Rank prompts by Jaccard token-overlap similarity to draft_text, descending.

    Returns a list of (prompt, score) tuples. `prompt` is the input object
    unchanged — any object with `.id` and `.text` attributes works.
    Deterministic: no LLM, no external deps.
    """
    draft_tokens = _tokenize_for_similarity(draft_text)
    scored: list[tuple[object, float]] = []
    for p in prompts:
        prompt_tokens = _tokenize_for_similarity(getattr(p, "text", "") or "")
        union = draft_tokens | prompt_tokens
        if not union:
            score = 0.0
        else:
            intersection = draft_tokens & prompt_tokens
            score = len(intersection) / len(union)
        scored.append((p, score))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `cd backend && pytest tests/test_content_impact.py -v`
Expected: 7 passed.

- [ ] **Step 5: Run full backend suite to catch regressions**

Run: `cd backend && pytest tests/ -q`
Expected: all pass (no existing tests touch the new helper, so net-zero change).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/drafting_service.py backend/tests/test_content_impact.py
git commit -m "feat(content-hub): rank_prompts_by_similarity helper for orphan matching"
```

---

## Task 2: Extend UpdateDraftRequest schema for `prompt_id`

**Files:**
- Modify: `backend/app/schemas.py:376-390`
- Test: `backend/tests/test_content_impact.py` (append)

- [ ] **Step 1: Write failing schema tests**

Append to `backend/tests/test_content_impact.py`:

```python
from app.schemas import UpdateDraftRequest


def test_update_draft_request_accepts_prompt_id():
    req = UpdateDraftRequest(prompt_id=42)
    assert req.prompt_id == 42


def test_update_draft_request_prompt_id_defaults_none():
    req = UpdateDraftRequest(title="new title")
    assert req.prompt_id is None


def test_update_draft_request_prompt_id_rejects_negative():
    with pytest.raises(Exception):
        UpdateDraftRequest(prompt_id=-1)


def test_update_draft_request_all_fields_together():
    req = UpdateDraftRequest(prompt_id=7, status="posted", title="hi")
    assert req.prompt_id == 7
    assert req.status == "posted"
    assert req.title == "hi"
```

- [ ] **Step 2: Run tests — verify the first two fail**

Run: `cd backend && pytest tests/test_content_impact.py::test_update_draft_request_accepts_prompt_id tests/test_content_impact.py::test_update_draft_request_prompt_id_defaults_none -v`
Expected: FAIL — the field doesn't exist yet (`ValidationError: extra_forbidden` or attribute missing).

- [ ] **Step 3: Add the field to `UpdateDraftRequest`**

Modify `backend/app/schemas.py`, locating the existing class (around line 376):

```python
class UpdateDraftRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    content_text: str | None = Field(None, max_length=50_000)
    status: str | None = None
    platform_guidelines_applied: str | None = Field(None, max_length=10_000)
    prompt_id: int | None = Field(None, ge=1)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("draft", "approved", "posted", "failed"):
            raise ValueError("status must be one of: draft, approved, posted, failed")
        return v
```

The only change is the new `prompt_id` field. Leave everything else untouched.

- [ ] **Step 4: Run the new tests — expect pass**

Run: `cd backend && pytest tests/test_content_impact.py -v`
Expected: all (Task 1's + Task 2's) pass.

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && pytest tests/ -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/tests/test_content_impact.py
git commit -m "feat(content-hub): UpdateDraftRequest accepts prompt_id"
```

---

## Task 3: `update_draft` handler accepts `prompt_id` (normal attach)

**Files:**
- Modify: `backend/app/routers/content.py:349–440` (the `update_draft` function)
- Test: `backend/tests/test_content_impact.py` (append)

Scope of this task: accept `prompt_id`, validate ownership, assign, log. Late-attach attribution row creation comes in Task 4; they are separated to keep commits small.

- [ ] **Step 1: Write failing integration tests**

Append to `backend/tests/test_content_impact.py`:

```python
# ── Integration tests against /api/content/draft/{id} ────────────────────────

async def _create_draft_direct(db_session, brand_id: int, prompt_id: int | None = None, status: str = "draft"):
    """Insert a ContentDraft row directly — bypasses the draft-generation flow."""
    from app.models import ContentDraft
    d = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform="reddit",
        status=status,
        title="test",
        content_text="test body",
        content_brief="test brief",
        visibility_score_at_draft=0.0,
        estimated_impact=0.0,
        source="manual",
    )
    db_session.add(d)
    await db_session.commit()
    await db_session.refresh(d)
    return d


@pytest.mark.asyncio
async def test_update_draft_attaches_prompt_id(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    token = await register_and_login("attach1@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="B1", slug="b1-attach", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="best ai tools for sales")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None)
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["prompt_id"] == prompt_id


@pytest.mark.asyncio
async def test_update_draft_rejects_prompt_from_different_brand(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    token = await register_and_login("attach2@example.com")
    async with AsyncSessionLocal() as db:
        brand_a = Brand(name="A", slug="a-attach", user_id=1)
        brand_b = Brand(name="B", slug="b-attach", user_id=1)
        db.add_all([brand_a, brand_b]); await db.commit()
        await db.refresh(brand_a); await db.refresh(brand_b)
        prompt_b = Prompt(brand_id=brand_b.id, text="other brand prompt")
        db.add(prompt_b); await db.commit(); await db.refresh(prompt_b)
        draft_a = await _create_draft_direct(db, brand_a.id)
        draft_id, wrong_prompt_id = draft_a.id, prompt_b.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": wrong_prompt_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_update_draft_rejects_nonexistent_prompt(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand

    token = await register_and_login("attach3@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="C", slug="c-attach", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        draft = await _create_draft_direct(db, brand.id)
        draft_id = draft.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": 999999},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_update_draft_attach_and_post_atomic(client, register_and_login):
    """Attach + post in a single request: prompt_id is set BEFORE the status transition
    so visibility_at_post snapshot and _create_draft_attribution see a draft with a prompt."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from sqlalchemy import select

    token = await register_and_login("attach4@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="D", slug="d-attach", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="test prompt")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="approved")
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id, "status": "posted"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["prompt_id"] == prompt_id
    assert body["status"] == "posted"

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        # Attribution row should exist; prompt_id attached before the posted-branch fired
        assert len(rows) == 1
        assert rows[0].prompt_id == prompt_id
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "update_draft"`
Expected: FAIL — the handler silently drops `prompt_id` today.

- [ ] **Step 3: Implement in the handler**

Edit `backend/app/routers/content.py`. Locate `update_draft` at line 349. Add a `prompt_id` handling block **before** the `status` block (so prompt_id is set before the posted-branch fires `_create_draft_attribution`).

Insert after the `platform_guidelines_applied` block (around line 364), before the `if request.status is not None` block:

```python
    if request.prompt_id is not None:
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id == request.prompt_id)
        )
        target_prompt = prompt_result.scalar_one_or_none()
        if target_prompt is None or target_prompt.brand_id != draft.brand_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="prompt_id must reference a prompt on the same brand as the draft",
            )
        draft.prompt_id = request.prompt_id
```

Add the `Prompt` import at the top of `content.py` if not already present (check with Grep — if `Prompt` is not in the imports, add it alongside the other model imports).

Also, at the end of `update_draft` (just before `return`), add an analytics log for attach events:

Find the existing `from app.services.analytics_service import log_event` line (around 412), and alongside the existing `draft_edited` / `draft_approved` logs, add:

```python
    if request.prompt_id is not None:
        await log_event(
            "draft_prompt_attached",
            {
                "draft_id": draft.id,
                "prompt_id": request.prompt_id,
                "late_attach": old_status == "posted",
            },
            brand_id=draft.brand_id,
        )
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "update_draft"`
Expected: all 4 pass.

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && pytest tests/ -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/content.py backend/tests/test_content_impact.py
git commit -m "feat(content-hub): update_draft accepts prompt_id with ownership check"
```

---

## Task 4: Late-attach attribution branch

When `prompt_id` is set on a draft whose `status` is already `'posted'`, create a null-baseline `DraftAttribution` row. Existing tracking-service logic at `tracking_service.py:505` already tolerates null baselines correctly — no change there.

**Files:**
- Modify: `backend/app/routers/content.py:349–440` (add helper + call from `update_draft`)
- Test: `backend/tests/test_content_impact.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_content_impact.py`:

```python
@pytest.mark.asyncio
async def test_late_attach_creates_null_baseline_attribution(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from sqlalchemy import select
    from datetime import datetime, timezone

    token = await register_and_login("late1@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="LA", slug="la-attach", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="prompt text")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        # Draft is ALREADY posted with prompt_id=None (orphan)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="posted")
        draft.posted_at = datetime.now(timezone.utc)
        await db.commit()
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        assert len(rows) == 1
        row = rows[0]
        assert row.prompt_id == prompt_id
        assert row.score_at_posting is None
        assert row.delta is None
        assert row.runs_since_posting == 0


@pytest.mark.asyncio
async def test_late_attach_does_not_create_duplicate_attribution(client, register_and_login):
    """If an attribution row already exists (unlikely but possible), don't create a second."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from datetime import datetime, timezone
    from sqlalchemy import select

    token = await register_and_login("late2@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="LB", slug="lb-attach", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="prompt text")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="posted")
        draft.posted_at = datetime.now(timezone.utc)
        await db.commit()
        # Pre-seed an attribution row (simulate a prior attach that was then undone)
        pre = DraftAttribution(
            draft_id=draft.id, brand_id=brand.id, prompt_id=prompt.id,
            score_at_posting=None, current_score=None, delta=None, runs_since_posting=0,
        )
        db.add(pre); await db.commit()
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        assert len(rows) == 1  # no duplicate
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "late_attach"`
Expected: FAIL — no attribution row is being created in the late-attach path.

- [ ] **Step 3: Add the helper + call it from `update_draft`**

Edit `backend/app/routers/content.py`. Add this helper next to the existing `_create_draft_attribution` function (around line 302):

```python
async def _create_late_attach_attribution(db: AsyncSession, draft: ContentDraft) -> None:
    """Create a null-baseline DraftAttribution row for a draft that was posted
    before having a prompt attached. Safe to call when a row already exists — no-ops."""
    if draft.prompt_id is None:
        return
    from app.models import DraftAttribution

    existing_result = await db.execute(
        select(DraftAttribution).where(DraftAttribution.draft_id == draft.id)
    )
    if existing_result.scalar_one_or_none() is not None:
        return

    attribution = DraftAttribution(
        draft_id=draft.id,
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        score_at_posting=None,
        current_score=None,
        delta=None,
        runs_since_posting=0,
    )
    db.add(attribution)
    await db.commit()
```

Then, in `update_draft`, inside the `if request.prompt_id is not None:` block added in Task 3, append a call at the end of the block:

```python
        draft.prompt_id = request.prompt_id
        # Late attach: draft was already posted — create null-baseline attribution
        if old_status == "posted":
            # Flush the prompt_id assignment so the helper sees the updated draft
            await db.flush()
            await _create_late_attach_attribution(db, draft)
```

Note: `old_status` is already captured earlier in the function (line 355). Leave the existing `await db.commit()` at the end of `update_draft` untouched — the helper does its own commit, the later commit is idempotent.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "late_attach"`
Expected: both pass.

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && pytest tests/ -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/content.py backend/tests/test_content_impact.py
git commit -m "feat(content-hub): late-attach creates null-baseline attribution row"
```

---

## Task 5: `POST /draft/{id}/prompt-suggestions` endpoint

**Files:**
- Modify: `backend/app/routers/content.py` (add new endpoint + response schema)
- Modify: `backend/app/schemas.py` (add response schema)
- Test: `backend/tests/test_content_impact.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_content_impact.py`:

```python
@pytest.mark.asyncio
async def test_prompt_suggestions_returns_ranked_top3(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    token = await register_and_login("sugg1@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="S", slug="s-sugg", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompts = [
            Prompt(brand_id=brand.id, text="best ai tools for sales teams"),
            Prompt(brand_id=brand.id, text="ai tools for marketing automation"),
            Prompt(brand_id=brand.id, text="submarine navigation"),
            Prompt(brand_id=brand.id, text="vegetarian weeknight recipes"),
        ]
        for p in prompts:
            db.add(p)
        await db.commit()
        draft = await _create_draft_direct(db, brand.id, prompt_id=None)
        draft.content_text = "ai tools sales outreach for startup teams"
        await db.commit()
        draft_id = draft.id

    r = await client.post(
        f"/api/content/draft/{draft_id}/prompt-suggestions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) <= 3
    assert len(body) >= 1
    # Top match should be the sales-tools prompt
    assert "sales" in body[0]["text"].lower()
    # Each entry has the expected shape
    for item in body:
        assert "prompt_id" in item
        assert "text" in item
        assert "score" in item
        assert "label" in item
        assert item["label"] in ("very_relevant", "somewhat", "loose")


@pytest.mark.asyncio
async def test_prompt_suggestions_empty_when_no_prompts(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand

    token = await register_and_login("sugg2@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="SE", slug="se-sugg", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None)
        draft_id = draft.id

    r = await client.post(
        f"/api/content/draft/{draft_id}/prompt-suggestions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_prompt_suggestions_labels_match_thresholds(client, register_and_login):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    token = await register_and_login("sugg3@example.com")
    async with AsyncSessionLocal() as db:
        brand = Brand(name="SL", slug="sl-sugg", user_id=1)
        db.add(brand); await db.commit(); await db.refresh(brand)
        # Same text → score 1.0 → "very_relevant"
        p1 = Prompt(brand_id=brand.id, text="ai tools sales")
        db.add(p1); await db.commit()
        draft = await _create_draft_direct(db, brand.id, prompt_id=None)
        draft.content_text = "ai tools sales"
        await db.commit()
        draft_id = draft.id

    r = await client.post(
        f"/api/content/draft/{draft_id}/prompt-suggestions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body[0]["label"] == "very_relevant"
    assert body[0]["score"] >= 0.35
```

- [ ] **Step 2: Run tests — expect failure (404, route does not exist)**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "prompt_suggestions"`
Expected: FAIL — 404 Not Found.

- [ ] **Step 3: Add response schema**

In `backend/app/schemas.py`, append (next to other content-related schemas — roughly after `ContentAttributionSchema`):

```python
class PromptSuggestion(BaseModel):
    prompt_id: int
    text: str
    score: float
    label: str  # "very_relevant" | "somewhat" | "loose"
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/routers/content.py`, add new endpoint alongside the other draft endpoints (place it after the `delete_draft` route near line 486):

```python
# ── Prompt suggestions for orphan drafts ─────────────────────────────────────

from app.schemas import PromptSuggestion  # noqa: E402 — local import keeps this grouped
from app.services.drafting_service import rank_prompts_by_similarity


def _label_for_similarity(score: float) -> str:
    if score >= 0.35:
        return "very_relevant"
    if score >= 0.15:
        return "somewhat"
    return "loose"


@router.post("/draft/{draft_id}/prompt-suggestions", response_model=list[PromptSuggestion])
async def suggest_prompts_for_draft(draft_id: int, db: DbDep, user: CurrentUser):
    """Return up to 3 tracked prompts ranked by similarity to the draft's content."""
    draft = await _get_draft_for_user(db, draft_id, user)
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == draft.brand_id).order_by(Prompt.id)
    )
    prompts = list(prompt_result.scalars().all())
    if not prompts:
        return []
    ranked = rank_prompts_by_similarity(draft.content_text or "", prompts)[:3]
    return [
        PromptSuggestion(
            prompt_id=p.id,
            text=p.text,
            score=round(score, 4),
            label=_label_for_similarity(score),
        )
        for p, score in ranked
    ]
```

If `Prompt` is not already imported at the top of `content.py`, add it with the other model imports.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && pytest tests/test_content_impact.py -v -k "prompt_suggestions"`
Expected: 3 pass.

- [ ] **Step 6: Run full backend suite**

Run: `cd backend && pytest tests/ -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/content.py backend/app/schemas.py backend/tests/test_content_impact.py
git commit -m "feat(content-hub): POST /draft/{id}/prompt-suggestions endpoint"
```

---

## Task 6: Frontend API client extensions

**Files:**
- Modify: `frontend/lib/api.ts`

No tests (this repo has no frontend test harness). Keep the change focused — types + two helpers.

- [ ] **Step 1: Locate the current `updateDraft` signature**

Run: `grep -n "updateDraft" frontend/lib/api.ts`

Read the surrounding types to see how the existing helpers are structured. Expected: there's an `updateDraft` function and a related request type.

- [ ] **Step 2: Extend the request type and add `getPromptSuggestions`**

In `frontend/lib/api.ts`, extend the `updateDraft` request body type (whatever it is currently called — often `UpdateDraftBody`, `UpdateDraftRequest`, or inline) to include an optional `prompt_id`:

```ts
// Existing request body for updateDraft — add `prompt_id?: number`
// Example (adjust to match current type name):
export interface UpdateDraftBody {
  title?: string;
  content_text?: string;
  status?: 'draft' | 'approved' | 'posted' | 'failed';
  platform_guidelines_applied?: string;
  prompt_id?: number;
}
```

Add a new response type and helper:

```ts
export interface PromptSuggestion {
  prompt_id: number;
  text: string;
  score: number;
  label: 'very_relevant' | 'somewhat' | 'loose';
}

export async function getPromptSuggestions(draftId: number): Promise<PromptSuggestion[]> {
  const res = await api.post<PromptSuggestion[]>(`/content/draft/${draftId}/prompt-suggestions`);
  return res.data;
}
```

Place `getPromptSuggestions` next to the other `draft/*` helpers in the file. Do not dedupe `api.post` calls (each helper is standalone — follow existing pattern).

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(content-hub): api typings for prompt attach + suggestions"
```

---

## Task 7: Scheduled → Saved rename (frontend copy only)

**Files:**
- Modify: `frontend/app/content/page.tsx`

- [ ] **Step 1: Enumerate every user-facing occurrence**

Run: `grep -n -E "Scheduled|scheduled" frontend/app/content/page.tsx | head -50`

Expected matches (list not exhaustive — use grep as source of truth):
- `type ContentDraftsSubTab = 'queue' | 'scheduled'` (internal, keep)
- `{ key: 'scheduled' as ContentDraftsSubTab, label: 'Scheduled', count: tabCounts.scheduled }` (label only → "Saved")
- Help modal bullet: `<span ...>Scheduled</span> — approved drafts ready to post...` (→ "Saved")
- Alert / toast strings: `"Scheduled drafts queue is full..."` (→ "Saved drafts queue is full...")
- Tier cap label: `{ label: 'Scheduled', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap }` (label only → "Saved")
- `function ScheduledCard(...)` (rename to `SavedCard` — but that's in Task 10; **skip for now**)
- URL param handling: `else if (tab === 'scheduled') { ... setActiveSubTab('scheduled'); }` — keep internal `'scheduled'` value; also accept `'saved'` (see step 2)
- `// ── Scheduled card ─` comments (rename to `// ── Saved card ─` where they appear next to the component)

- [ ] **Step 2: Edit user-facing strings**

For each of these changes, use Edit with enough surrounding context to be unique. Do not `replace_all` on "Scheduled" — it would break internal type literals.

**Change A — sub-tab label:**

Old:
```tsx
{ key: 'scheduled' as ContentDraftsSubTab, label: 'Scheduled', count: tabCounts.scheduled },
```
New:
```tsx
{ key: 'scheduled' as ContentDraftsSubTab, label: 'Saved', count: tabCounts.scheduled },
```

**Change B — help modal bullet** (inside the `hubHelpOpen` block):

Old:
```tsx
<li><span className="text-[var(--text-primary)] font-medium">Scheduled</span> — approved drafts ready to post. Copy the text, post it manually, then click Mark as Posted.</li>
```
New:
```tsx
<li><span className="text-[var(--text-primary)] font-medium">Saved</span> — approved drafts ready to post. Copy the text, post it manually, then click Mark as Posted.</li>
```

**Change C — tier cap label:**

Old:
```tsx
{ label: 'Scheduled', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap },
```
New:
```tsx
{ label: 'Saved', count: draftStatus.scheduled_count, cap: draftStatus.scheduled_cap },
```

**Change D — alert copy (queue full)**

Search for every string containing `Scheduled drafts queue is full` or `scheduled drafts queue is full` inside `page.tsx` (case-insensitive grep):

Run: `grep -n -i "scheduled drafts queue" frontend/app/content/page.tsx`

For each match, replace "Scheduled" → "Saved" in the user-facing message only. (Some may already say "Saved" — confirm before editing.)

- [ ] **Step 3: Accept `?tab=saved` as an alias for `?tab=scheduled`**

Locate the `useEffect` that reads `tab` from the URL query string (search `new URLSearchParams(window.location.search).get('tab')` in `page.tsx`).

Old:
```tsx
} else if (tab === 'scheduled') {
  setActivePrimaryTab('content_drafts');
  setActiveSubTab('scheduled');
} else if (tab === 'posted') {
```
New:
```tsx
} else if (tab === 'scheduled' || tab === 'saved') {
  setActivePrimaryTab('content_drafts');
  setActiveSubTab('scheduled');
} else if (tab === 'posted') {
```

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "feat(content-hub): rename Scheduled -> Saved in UI copy"
```

---

## Task 8: `ImpactExplainerModal` component

Apply `impeccable` (typography hierarchy, spacing tokens, tonal polish) for this modal.

**Files:**
- Create: `frontend/app/content/components/ImpactExplainerModal.tsx`
- Modify: `frontend/app/content/components/index.ts`

- [ ] **Step 1: Inspect `HelpModal` to reuse its frame**

Run: `cat frontend/app/content/components/HelpModal.tsx | head -40`

This is the base we reuse — same overlay, close button, and spacing.

- [ ] **Step 2: Create the new component**

Create `frontend/app/content/components/ImpactExplainerModal.tsx`:

```tsx
'use client';

import { HelpModal } from './HelpModal';

export function ImpactExplainerModal({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="How impact tracking works" onClose={onClose}>
      <section className="flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">What “at posting → now” means</h4>
          <p className="text-[13px] leading-relaxed">
            <span className="text-[var(--text-muted)]">At posting</span> is the brand&apos;s overall visibility score at the moment you clicked Mark as Posted.{' '}
            <span className="text-[var(--text-muted)]">Now</span> is the most recent score. The delta is the difference — a directional signal, not proof of causation.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Confidence tiers</h4>
          <ul className="text-[13px] leading-relaxed list-disc pl-5 space-y-0.5">
            <li><span className="text-[var(--text-muted)]">Awaiting next report</span> — posted, no tracking run has completed yet.</li>
            <li><span className="text-[var(--text-muted)]">Early data</span> — 1–2 runs since posting.</li>
            <li><span className="text-[var(--text-muted)]">Developing</span> — 3–5 runs, a trend is forming.</li>
            <li><span className="text-[var(--text-muted)]">Established</span> — 6+ runs, enough signal to observe a trend.</li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Correlation, not causation</h4>
          <p className="text-[13px] leading-relaxed">
            Visibility moves for many reasons beyond any single post. Treat the delta as a directional hint. Trends across multiple posts matter more than any one result.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Orphan drafts & late-attach</h4>
          <p className="text-[13px] leading-relaxed">
            Drafts without a tracked prompt can&apos;t appear on a per-prompt graph. You can attach a prompt at post time or any time after. Late-attached drafts start tracking from the attach date — the historical baseline is unavailable.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Where to dig deeper</h4>
          <p className="text-[13px] leading-relaxed">
            Click any posted card to jump to the targeting prompt&apos;s detail timeline. The draft appears as a diamond marker — click it to see a side-by-side of the response before and after.
          </p>
        </div>
      </section>
    </HelpModal>
  );
}
```

If the existing `HelpModal.tsx` uses a default export, adjust the import (`import HelpModal from './HelpModal';`). Run `grep -n "export" frontend/app/content/components/HelpModal.tsx` to confirm which form.

- [ ] **Step 3: Export it from the barrel file**

Modify `frontend/app/content/components/index.ts` by appending:

```ts
export { ImpactExplainerModal } from './ImpactExplainerModal';
```

(Match the export style already used — if the file uses `export *` or default-exports, follow that pattern.)

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/components/ImpactExplainerModal.tsx frontend/app/content/components/index.ts
git commit -m "feat(content-hub): ImpactExplainerModal component"
```

---

## Task 9: `PostedSummaryStrip` component

Apply `impeccable` (typographic row, not a dashboard; muted separators) and `emil-design-eng` (subtle hover on the "How impact works" button).

**Files:**
- Create: `frontend/app/content/components/PostedSummaryStrip.tsx`
- Modify: `frontend/app/content/components/index.ts`

- [ ] **Step 1: Create the component**

Create `frontend/app/content/components/PostedSummaryStrip.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import type { ContentDraft, DraftAttribution } from '@/lib/api';

export interface PostedSummaryStripProps {
  postedItems: ContentDraft[];
  attributions: Record<number, DraftAttribution>; // keyed by draft_id
  onOpenExplainer: () => void;
}

interface Summary {
  count: number;
  avgDelta: number | null;
  best: { delta: number; platform: string; promptHint: string | null } | null;
  awaitingCount: number;
  unattachedCount: number;
}

function computeSummary(
  postedItems: ContentDraft[],
  attributions: Record<number, DraftAttribution>,
): Summary {
  const count = postedItems.length;
  let awaitingCount = 0;
  let unattachedCount = 0;
  const deltas: number[] = [];
  let best: Summary['best'] = null;

  for (const d of postedItems) {
    if (!d.prompt_id) {
      unattachedCount += 1;
    }
    const attr = attributions[d.id];
    if (!attr || attr.runs_since_posting === 0) {
      awaitingCount += 1;
      continue;
    }
    if (attr.delta != null) {
      deltas.push(attr.delta);
      if (!best || attr.delta > best.delta) {
        best = {
          delta: attr.delta,
          platform: d.platform,
          promptHint: d.content_brief ?? null,
        };
      }
    }
  }

  const avgDelta = deltas.length > 0
    ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10
    : null;

  return { count, avgDelta, best, awaitingCount, unattachedCount };
}

function formatDelta(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (rounded > 0) return `+${rounded.toFixed(1)}pp`;
  if (rounded < 0) return `${rounded.toFixed(1)}pp`;
  return '0pp';
}

export function PostedSummaryStrip({
  postedItems,
  attributions,
  onOpenExplainer,
}: PostedSummaryStripProps) {
  const summary = useMemo(
    () => computeSummary(postedItems, attributions),
    [postedItems, attributions],
  );

  if (summary.count === 0) {
    return (
      <div className="mb-3 text-xs text-[var(--text-faint)] italic">
        Posted drafts will appear here with their visibility impact.
      </div>
    );
  }

  const parts: string[] = [`${summary.count} post${summary.count === 1 ? '' : 's'}`];
  if (summary.avgDelta !== null) {
    parts.push(`avg ${formatDelta(summary.avgDelta)}`);
  }
  if (summary.best) {
    const hint = summary.best.promptHint
      ? `${summary.best.platform}, ${summary.best.promptHint.slice(0, 40)}${summary.best.promptHint.length > 40 ? '…' : ''}`
      : summary.best.platform;
    parts.push(`best ${formatDelta(summary.best.delta)} (${hint})`);
  }
  if (summary.awaitingCount > 0) {
    parts.push(`${summary.awaitingCount} awaiting data`);
  }
  if (summary.unattachedCount > 0) {
    parts.push(`${summary.unattachedCount} unattached`);
  }

  return (
    <div className="mb-4 flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
      <span className="leading-relaxed">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5 text-[var(--text-faint)]">·</span>}
            <span className={i === 0 ? 'text-[var(--text-primary)] font-medium' : ''}>{p}</span>
          </span>
        ))}
      </span>
      <button
        onClick={onOpenExplainer}
        className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <HelpCircle size={11} />
        How impact works
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel file**

Append to `frontend/app/content/components/index.ts`:

```ts
export { PostedSummaryStrip } from './PostedSummaryStrip';
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/content/components/PostedSummaryStrip.tsx frontend/app/content/components/index.ts
git commit -m "feat(content-hub): PostedSummaryStrip component"
```

---

## Task 10: Extract + redesign `PostedCard`

Apply `impeccable` (attribution as the visual anchor; single-line top bar; clear orphan/late-attach variants) and `emil-design-eng` (subtle hover elevation on clickable cards — 120ms, opacity + border, no scale).

**Files:**
- Create: `frontend/app/content/components/PostedCard.tsx`
- Modify: `frontend/app/content/page.tsx` (remove inline PostedCard, import new one, wire `onDelete`)
- Modify: `frontend/app/content/components/index.ts`

- [ ] **Step 1: Create the new `PostedCard.tsx` file**

Create `frontend/app/content/components/PostedCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart2, ChevronDown, HelpCircle, Info, Link2, Trash2 } from 'lucide-react';
import type { ContentDraft, DraftAttribution } from '@/lib/api';
import { PlatformBadge } from './PlatformBadge'; // adjust import path if PlatformBadge lives elsewhere

export interface PostedCardProps {
  draft: ContentDraft;
  brandId: number;
  attribution?: DraftAttribution;
  onDelete: (draftId: number) => void;
  onOpenAttach: (draftId: number) => void; // opens AttachPromptPopover anchored to this card
  onOpenExplainer: () => void;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type ConfidenceTier = 'awaiting' | 'early' | 'developing' | 'established';
function getConfidenceTier(runs: number): ConfidenceTier {
  if (runs === 0) return 'awaiting';
  if (runs <= 2) return 'early';
  if (runs <= 5) return 'developing';
  return 'established';
}
const TIER_LABEL: Record<ConfidenceTier, string> = {
  awaiting: 'Awaiting next report',
  early: 'Early data',
  developing: 'Developing',
  established: 'Established',
};
const TIER_COLOR: Record<ConfidenceTier, string> = {
  awaiting: 'var(--text-faint)',
  early: 'var(--text-muted)',
  developing: 'var(--accent-foreground)',
  established: 'var(--success)',
};

export function PostedCard({
  draft,
  brandId,
  attribution,
  onDelete,
  onOpenAttach,
  onOpenExplainer,
}: PostedCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const isOrphan = !draft.prompt_id;
  const isLateAttach = !!attribution && draft.prompt_id != null && attribution.score_at_posting == null;
  const clickable = !isOrphan;
  const title = draft.title ?? draft.content_text.slice(0, 80) + (draft.content_text.length > 80 ? '…' : '');

  const href = draft.prompt_id
    ? `/tracker/${brandId}/prompt/${draft.prompt_id}?draft=${draft.id}`
    : null;

  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    // Do not navigate when the click originated inside an interactive child.
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-nav]')) return;
    if (!href) return;
    router.push(href);
  }

  // Attribution block
  let attributionNode: JSX.Element | null = null;
  if (isLateAttach) {
    const tier = getConfidenceTier(attribution?.runs_since_posting ?? 0);
    attributionNode = (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--text-faint)]">—</span>
          <ArrowRight size={12} className="text-[var(--text-faint)]" />
          <span className="font-mono">
            Now <span className="text-[var(--text-primary)]">{attribution?.current_score != null ? `${attribution.current_score.toFixed(1)}%` : '—'}</span>
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-full border ml-auto" style={{ color: TIER_COLOR[tier], borderColor: `${TIER_COLOR[tier]}40`, backgroundColor: `${TIER_COLOR[tier]}10` }}>
            {TIER_LABEL[tier]}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">Attached late — baseline unavailable</p>
      </div>
    );
  } else if (attribution) {
    const tier = getConfidenceTier(attribution.runs_since_posting);
    const scoreBefore = attribution.score_at_posting;
    const scoreNow = attribution.current_score ?? 0;
    const delta = attribution.delta;
    const deltaColor = delta == null ? 'var(--text-secondary)' : delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-secondary)';
    const deltaLabel = delta == null ? '—' : delta > 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`;
    attributionNode = tier === 'awaiting' ? (
      <div className="flex items-center gap-2">
        <span className="text-xs px-1.5 py-0.5 rounded-full border" style={{ color: TIER_COLOR[tier], borderColor: `${TIER_COLOR[tier]}40`, backgroundColor: `${TIER_COLOR[tier]}10` }}>
          {TIER_LABEL[tier]}
        </span>
        <span className="text-xs text-[var(--text-faint)]">Next tracking run will measure visibility change.</span>
      </div>
    ) : (
      <div className="flex items-center gap-3 flex-wrap text-sm">
        {scoreBefore != null && (
          <span className="font-mono text-[var(--text-secondary)]">At posting <span className="text-[var(--text-muted)]">{scoreBefore.toFixed(1)}%</span></span>
        )}
        {scoreBefore != null && <ArrowRight size={12} className="text-[var(--text-faint)]" />}
        <span className="font-mono">Now <span className="text-[var(--text-primary)] font-semibold">{scoreNow.toFixed(1)}%</span></span>
        {delta != null && (
          <span className="font-semibold" style={{ color: deltaColor }}>{deltaLabel}</span>
        )}
        <span className="text-xs px-1.5 py-0.5 rounded-full border ml-auto" style={{ color: TIER_COLOR[tier], borderColor: `${TIER_COLOR[tier]}40`, backgroundColor: `${TIER_COLOR[tier]}10` }}>
          {TIER_LABEL[tier]}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={clickable ? handleCardClick : undefined}
      className={[
        'card p-4 flex flex-col gap-3 transition-[border-color,transform] duration-[120ms] ease-out',
        clickable ? 'cursor-pointer hover:border-[rgba(255,255,255,0.14)]' : '',
      ].join(' ')}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' && href) router.push(href);
      }}
    >
      {/* Top row: platform · time · actions */}
      <div className="flex items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        <span className="text-xs text-[var(--text-faint)]">{relativeTime(draft.updated_at)}</span>
        <div className="ml-auto flex items-center gap-1" data-no-nav>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenExplainer(); }}
            aria-label="How impact works"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Info size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            aria-label={expanded ? 'Hide draft text' : 'Show draft text'}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this posted draft? Its attribution data will also be removed.')) {
                onDelete(draft.id);
              }
            }}
            aria-label="Delete"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Attribution — the card's visual anchor */}
      {isOrphan ? (
        <div className="flex items-center gap-3 flex-wrap" data-no-nav>
          <span className="text-sm text-[var(--text-muted)]">No prompt attached — impact not trackable</span>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenAttach(draft.id); }}
            className="ml-auto flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] border border-[rgba(255,255,255,0.10)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
          >
            <Link2 size={11} />
            Attach to prompt
          </button>
        </div>
      ) : attributionNode ? (
        <div className="border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] rounded-lg px-3 py-2.5">
          <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 size={9} />
            Visibility change since posting
          </p>
          {attributionNode}
        </div>
      ) : null}

      {/* Title / preview */}
      <p className="text-sm text-[var(--text-secondary)] leading-snug truncate">{title}</p>

      {/* Expandable content */}
      {expanded && (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3" data-no-nav>
          <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed font-mono">{draft.content_text}</pre>
        </div>
      )}
    </div>
  );
}
```

**Note on `PlatformBadge` import:** It's currently defined inline in `frontend/app/content/page.tsx`. Before creating `PostedCard.tsx`, extract `PlatformBadge` to `frontend/app/content/components/PlatformBadge.tsx` (copy the existing function + constants unchanged; export it). Update its import in `page.tsx` to the new location.

Run `grep -n "function PlatformBadge\|const PLATFORM_DISPLAY\|const PLATFORM_COLORS" frontend/app/content/page.tsx` to find the extraction boundaries. Move all three (the component + the two support constants it closes over) in one edit. Leave any *other* uses of those constants in `page.tsx` still working (they're re-imported from the new module — add `import { PLATFORM_DISPLAY } from './components/PlatformBadge';` etc. in `page.tsx`).

- [ ] **Step 2: Export `PostedCard` from the barrel file**

Append to `frontend/app/content/components/index.ts`:

```ts
export { PostedCard } from './PostedCard';
export { PlatformBadge, PLATFORM_DISPLAY } from './PlatformBadge';
```

(Only add the `PlatformBadge` export if Task 10 Step 1's note had you extract it.)

- [ ] **Step 3: Replace inline `PostedCard` usage in `page.tsx`**

In `frontend/app/content/page.tsx`:

1. Delete the inline `function PostedCard(...)` definition (currently around line 1430–1553).
2. Add to the imports at the top of the file: `import { PostedCard, PostedSummaryStrip, ImpactExplainerModal } from './components';` (merge with the existing component imports if one exists).
3. Find the JSX where `PostedCard` is rendered (search for `<PostedCard`). Extend the props passed:

Old:
```tsx
<PostedCard key={draft.id} draft={draft} attribution={attributionMap[draft.id]} />
```
New:
```tsx
<PostedCard
  key={draft.id}
  draft={draft}
  brandId={selectedBrandId!}
  attribution={attributionMap[draft.id]}
  onDelete={(id) => handleDelete(id)}
  onOpenAttach={(id) => setAttachPopoverDraftId(id)}
  onOpenExplainer={() => setExplainerOpen(true)}
/>
```

4. Add state at the top of `ContentHubPage`:

```tsx
const [explainerOpen, setExplainerOpen] = useState(false);
const [attachPopoverDraftId, setAttachPopoverDraftId] = useState<number | null>(null);
```

5. Render `PostedSummaryStrip` above the Posted grid (find the Posted tab panel conditional block):

```tsx
{activePrimaryTab === 'posted' && (
  <>
    <PostedSummaryStrip
      postedItems={visiblePostedItems}
      attributions={attributionMap}
      onOpenExplainer={() => setExplainerOpen(true)}
    />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {visiblePostedItems.map((draft) => (
        <PostedCard {...} />
      ))}
    </div>
  </>
)}
```

6. Render the explainer modal near other modals:

```tsx
{explainerOpen && <ImpactExplainerModal onClose={() => setExplainerOpen(false)} />}
```

7. `attachPopoverDraftId` is consumed in Task 11 (AttachPromptPopover). For now, leave the state in place but do not render the popover yet.

8. Update `handleDelete` (around line 1856) so that when a posted draft is deleted, it's also removed from `postedItems`:

Old:
```tsx
async function handleDelete(id: number) {
  await deleteDraft(id);
  setDraftItems((prev) => prev.filter((d) => d.id !== id));
  setScheduledItems((prev) => prev.filter((d) => d.id !== id));
  setDraftStatus((prev) => { ... });
  setToast({ message: 'Draft dismissed', type: 'info' });
}
```
New:
```tsx
async function handleDelete(id: number) {
  await deleteDraft(id);
  setDraftItems((prev) => prev.filter((d) => d.id !== id));
  setScheduledItems((prev) => prev.filter((d) => d.id !== id));
  setPostedItems((prev) => prev.filter((d) => d.id !== id));
  setDraftStatus((prev) => {
    if (!prev) return prev;
    const newCount = Math.max(0, prev.draft_count - 1);
    return { ...prev, draft_count: newCount, draft_queue_full: newCount >= prev.draft_cap };
  });
  setToast({ message: 'Draft removed', type: 'info' });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/page.tsx frontend/app/content/components/PostedCard.tsx frontend/app/content/components/PlatformBadge.tsx frontend/app/content/components/index.ts
git commit -m "feat(content-hub): redesign PostedCard with whole-card click + delete + orphan variant"
```

---

## Task 11: `AttachPromptPopover` component

Apply `impeccable` (relevance labels colored by tier; scrollable secondary list doesn't fight the primary suggestions visually) and `emil-design-eng` (tiny 100ms fade-in, spring-eased hover on list items).

**Files:**
- Create: `frontend/app/content/components/AttachPromptPopover.tsx`
- Modify: `frontend/app/content/components/index.ts`
- Modify: `frontend/app/content/page.tsx` (render the popover when `attachPopoverDraftId` is set)

- [ ] **Step 1: Create the component**

Create `frontend/app/content/components/AttachPromptPopover.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getPromptSuggestions, type PromptSuggestion, type Prompt } from '@/lib/api';

export interface AttachPromptPopoverProps {
  draftId: number;
  allPrompts: Prompt[]; // brand's tracked prompts
  onAttach: (promptId: number) => Promise<void> | void;
  onClose: () => void;
  /** If true, render tighter (used inside the MarkAsPostedModal). */
  embedded?: boolean;
}

const LABEL_TEXT: Record<PromptSuggestion['label'], string> = {
  very_relevant: 'Very relevant',
  somewhat: 'Somewhat',
  loose: 'Loose match',
};
const LABEL_COLOR: Record<PromptSuggestion['label'], string> = {
  very_relevant: 'var(--success)',
  somewhat: 'var(--accent-foreground)',
  loose: 'var(--text-faint)',
};

export function AttachPromptPopover({
  draftId,
  allPrompts,
  onAttach,
  onClose,
  embedded = false,
}: AttachPromptPopoverProps) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPromptSuggestions(draftId)
      .then((sugs) => { if (!cancelled) setSuggestions(sugs); })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [draftId]);

  const suggestedIds = new Set(suggestions.map((s) => s.prompt_id));
  const rest = allPrompts.filter((p) => !suggestedIds.has(p.id));

  async function handlePick(promptId: number) {
    setAttaching(promptId);
    try {
      await onAttach(promptId);
      onClose();
    } finally {
      setAttaching(null);
    }
  }

  return (
    <div
      className={[
        'bg-[rgba(8,12,20,0.98)] border border-[var(--border-subtle)] rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden',
        embedded ? '' : 'w-[380px] max-h-[420px] flex flex-col',
      ].join(' ')}
    >
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Attach to a prompt</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className={embedded ? '' : 'overflow-y-auto'}>
        {loading ? (
          <div className="px-4 py-4 text-xs text-[var(--text-faint)]">Analyzing draft…</div>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">Suggested</p>
                <ul className="flex flex-col gap-1.5">
                  {suggestions.map((s) => (
                    <li key={s.prompt_id}>
                      <button
                        onClick={() => handlePick(s.prompt_id)}
                        disabled={attaching !== null}
                        className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors disabled:opacity-50"
                      >
                        <span
                          className="mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0"
                          style={{
                            color: LABEL_COLOR[s.label],
                            borderColor: `${LABEL_COLOR[s.label]}40`,
                            backgroundColor: `${LABEL_COLOR[s.label]}10`,
                          }}
                        >
                          {LABEL_TEXT[s.label]}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)] leading-relaxed">{s.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rest.length > 0 && (
              <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">All tracked prompts</p>
                <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {rest.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => handlePick(p.id)}
                        disabled={attaching !== null}
                        className="w-full text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.04)] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        {p.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {suggestions.length === 0 && rest.length === 0 && (
              <div className="px-4 py-4 text-xs text-[var(--text-faint)]">No tracked prompts for this brand.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

Note: the `Prompt` type comes from `@/lib/api`. If it isn't already exported there, add a re-export at the top of that module: `export type { Prompt };` near the other type exports.

- [ ] **Step 2: Export from barrel file**

Append to `frontend/app/content/components/index.ts`:

```ts
export { AttachPromptPopover } from './AttachPromptPopover';
```

- [ ] **Step 3: Render the popover in `page.tsx` when `attachPopoverDraftId` is set**

In `frontend/app/content/page.tsx`, near the other modals, add:

```tsx
{attachPopoverDraftId != null && (
  <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
    <div className="absolute inset-0 bg-black/40" onClick={() => setAttachPopoverDraftId(null)} />
    <div className="relative">
      <AttachPromptPopover
        draftId={attachPopoverDraftId}
        allPrompts={brandPrompts}
        onAttach={async (promptId) => {
          await updateDraft(attachPopoverDraftId, { prompt_id: promptId });
          if (selectedBrandId) loadAll(selectedBrandId);
          setToast({ message: 'Attached to prompt', type: 'success' });
        }}
        onClose={() => setAttachPopoverDraftId(null)}
      />
    </div>
  </div>
)}
```

Add the import: `import { AttachPromptPopover } from './components';`

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/components/AttachPromptPopover.tsx frontend/app/content/components/index.ts frontend/app/content/page.tsx frontend/lib/api.ts
git commit -m "feat(content-hub): AttachPromptPopover for orphan posted drafts"
```

---

## Task 12: `MarkAsPostedModal` orphan flow

Apply `impeccable` (clear radio cards, balanced primary/secondary actions — Skip has equal visual weight, not hidden).

**Files:**
- Create: `frontend/app/content/components/MarkAsPostedModal.tsx`
- Modify: `frontend/app/content/components/index.ts`
- Modify: `frontend/app/content/page.tsx` (update `handleMarkAsPosted` to gate on this modal)

- [ ] **Step 1: Create the modal**

Create `frontend/app/content/components/MarkAsPostedModal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { AttachPromptPopover } from './AttachPromptPopover';
import type { Prompt } from '@/lib/api';

export interface MarkAsPostedModalProps {
  draftId: number;
  allPrompts: Prompt[];
  onAttachAndPost: (promptId: number) => Promise<void>;
  onPostWithoutAttach: () => Promise<void>;
  onClose: () => void;
}

export function MarkAsPostedModal({
  draftId,
  allPrompts,
  onAttachAndPost,
  onPostWithoutAttach,
  onClose,
}: MarkAsPostedModalProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleAttach(promptId: number) {
    setSubmitting(true);
    try {
      await onAttachAndPost(promptId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    try {
      await onPostWithoutAttach();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer" onClick={onClose} />
      <div className="relative w-full max-w-md flex flex-col bg-[rgba(8,12,20,0.98)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.70)] overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Attach to a tracked prompt?</h2>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              Attach a prompt so we can measure this post&apos;s visibility impact. You can also skip.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-3 max-h-[60vh] overflow-y-auto">
          <AttachPromptPopover
            draftId={draftId}
            allPrompts={allPrompts}
            onAttach={handleAttach}
            onClose={() => { /* nested close handled by parent */ }}
            embedded
          />
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="flex-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.08)] rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            Skip — post without attaching
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from barrel file**

Append to `frontend/app/content/components/index.ts`:

```ts
export { MarkAsPostedModal } from './MarkAsPostedModal';
```

- [ ] **Step 3: Wire into `page.tsx`**

In `frontend/app/content/page.tsx`:

1. Add state:

```tsx
const [markPostedModalDraftId, setMarkPostedModalDraftId] = useState<number | null>(null);
```

2. Update `handleMarkAsPosted` to gate on the modal for orphans:

Old:
```tsx
async function handleMarkAsPosted(id: number) {
  await updateDraft(id, { status: 'posted' });
  if (selectedBrandId) loadAll(selectedBrandId);
}
```
New:
```tsx
async function handleMarkAsPosted(id: number) {
  const draft = scheduledItems.find((d) => d.id === id);
  const isOrphan = draft && !draft.prompt_id;
  const hasPromptsToSuggest = brandPrompts.length > 0;
  if (isOrphan && hasPromptsToSuggest) {
    setMarkPostedModalDraftId(id);
    return;
  }
  await updateDraft(id, { status: 'posted' });
  if (selectedBrandId) loadAll(selectedBrandId);
}
```

3. Render the modal near other modals:

```tsx
{markPostedModalDraftId != null && (
  <MarkAsPostedModal
    draftId={markPostedModalDraftId}
    allPrompts={brandPrompts}
    onAttachAndPost={async (promptId) => {
      await updateDraft(markPostedModalDraftId, { prompt_id: promptId, status: 'posted' });
      if (selectedBrandId) loadAll(selectedBrandId);
      setToast({ message: 'Attached and marked as posted', type: 'success' });
    }}
    onPostWithoutAttach={async () => {
      await updateDraft(markPostedModalDraftId, { status: 'posted' });
      if (selectedBrandId) loadAll(selectedBrandId);
    }}
    onClose={() => setMarkPostedModalDraftId(null)}
  />
)}
```

Add the import: `import { MarkAsPostedModal } from './components';`

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit`
Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/components/MarkAsPostedModal.tsx frontend/app/content/components/index.ts frontend/app/content/page.tsx
git commit -m "feat(content-hub): Mark-as-Posted orphan gate with prompt suggestions"
```

---

## Task 13: `PromptDetailPage` reads `?draft=` and passes `highlightDraftId`

**Files:**
- Modify: `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`

- [ ] **Step 1: Wire the query param**

In `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`:

1. Add `useSearchParams` to the `next/navigation` import at line 4:

Old:
```tsx
import { useParams, useRouter } from 'next/navigation';
```
New:
```tsx
import { useParams, useRouter, useSearchParams } from 'next/navigation';
```

2. Inside `PromptDetailPage`, near the other hooks (below `useRouter()`), add:

```tsx
const searchParams = useSearchParams();
const draftParam = searchParams?.get('draft');
const highlightDraftId = draftParam ? Number(draftParam) : undefined;
```

3. Pass it to `PromptImpactTimeline`:

Old:
```tsx
<PromptImpactTimeline
  timeline={data.timeline}
  contentEvents={data.content_events}
  drafts={data.drafts}
/>
```
New:
```tsx
<PromptImpactTimeline
  timeline={data.timeline}
  contentEvents={data.content_events}
  drafts={data.drafts}
  highlightDraftId={Number.isFinite(highlightDraftId as number) ? highlightDraftId : undefined}
/>
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: one new error — `PromptImpactTimeline` doesn't yet accept `highlightDraftId`. That's intentional; fixed in Task 14.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx
git commit -m "feat(content-hub): PromptDetailPage reads ?draft= query param"
```

---

## Task 14: `PromptImpactTimeline` highlight + pulse

Apply `emil-design-eng` for the pulse — one emit + fade, ~1.2s, spring-out easing. No looping.

**Files:**
- Modify: `frontend/components/PromptImpactTimeline.tsx`

- [ ] **Step 1: Extend the props interface and state**

In `frontend/components/PromptImpactTimeline.tsx`:

Old (around line 30):
```tsx
interface PromptImpactTimelineProps {
  timeline: PromptTimelinePoint[];
  contentEvents: ContentEventItem[];
  drafts?: PromptDraftSnapshot[];
  height?: number;
}
```
New:
```tsx
interface PromptImpactTimelineProps {
  timeline: PromptTimelinePoint[];
  contentEvents: ContentEventItem[];
  drafts?: PromptDraftSnapshot[];
  height?: number;
  highlightDraftId?: number;
}
```

Add to the function signature (around line 39):

```tsx
export default function PromptImpactTimeline({
  timeline,
  contentEvents,
  drafts = [],
  height = 320,
  highlightDraftId,
}: PromptImpactTimelineProps) {
```

Add state for the pulse:

```tsx
const [pulsingIndex, setPulsingIndex] = useState<number | null>(null);
```

- [ ] **Step 2: Auto-switch timeframe if the highlighted draft is outside it**

Immediately below the existing `filteredData` computation (around line 78), add:

```tsx
// If the highlighted draft's event lies outside the current timeframe, switch to 'all'.
useEffect(() => {
  if (highlightDraftId == null) return;
  const event = contentEvents.find(
    (e) =>
      e.event_type === 'draft_posted' &&
      (e.data as Record<string, unknown>)?.draft_id === highlightDraftId,
  );
  if (!event) return;
  const eventTime = parseUTCISO(event.created_at).getTime();
  const cutoffs: Record<Timeframe, number> = {
    '7d': Date.now() - 7 * 86400000,
    '30d': Date.now() - 30 * 86400000,
    '90d': Date.now() - 90 * 86400000,
    all: 0,
  };
  if (eventTime < cutoffs[timeframe]) {
    setTimeframe('all');
  }
}, [highlightDraftId, contentEvents, timeframe]);
```

- [ ] **Step 3: On mount/change, expand the draft panel and trigger the pulse**

Add this effect after the existing `handleMarkerClick` definition (around line 120):

```tsx
useEffect(() => {
  if (highlightDraftId == null) return;
  // Find the data index for this draft by walking markersByIndex
  let targetIndex: number | null = null;
  markersByIndex.forEach((markers, idx) => {
    if (markers.some((m) => m.draftId === highlightDraftId)) {
      targetIndex = idx;
    }
  });
  if (targetIndex == null) return;

  // Expand panel (reuses existing logic)
  handleMarkerClick(targetIndex);

  // Kick off the one-shot pulse
  setPulsingIndex(targetIndex);
  const timer = setTimeout(() => setPulsingIndex(null), 1400); // matches animation + small buffer
  return () => clearTimeout(timer);
}, [highlightDraftId, markersByIndex, handleMarkerClick]);
```

Ensure `handleMarkerClick` is stable (`useCallback` — it already is per current code).

- [ ] **Step 4: Render the pulse on the matching diamond**

Find the `DraftMarkerLayer` Customized component (around line 334 — the `<Customized component={DraftMarkerLayer} />` call) and the matching `DraftMarkerLayer` function (grep for `function DraftMarkerLayer` or `const DraftMarkerLayer`).

Modify the `DraftMarkerLayer` to accept a `pulsingIndex` prop (threading through `<Customized>` via a wrapper is the cleanest approach):

Replace the `<Customized component={DraftMarkerLayer} />` usage with an inline wrapper that closes over `pulsingIndex`:

Old:
```tsx
<Customized component={DraftMarkerLayer} />
```
New:
```tsx
<Customized component={(props: Record<string, unknown>) => (
  <DraftMarkerLayer {...props} pulsingIndex={pulsingIndex} />
)} />
```

Inside `DraftMarkerLayer`, for each rendered diamond, check `if (dataIndex === pulsingIndex)` and render an additional SVG `<circle>` behind the diamond with an expanding-and-fading ring. Example (adapt coordinates to the existing marker code):

```tsx
{dataIndex === pulsingIndex && (
  <circle
    cx={cx}
    cy={cy}
    r={8}
    fill="none"
    stroke="var(--accent)"
    strokeWidth={2}
    opacity={0.9}
    style={{
      transformOrigin: `${cx}px ${cy}px`,
      animation: 'diamond-pulse 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
    }}
  />
)}
```

Add the keyframes at the bottom of the file, inside a styled-jsx block, **or** if the project uses `tailwindcss` keyframes in `tailwind.config.js`, add them there instead. For minimum intrusion, inline via a one-shot `<style>` tag rendered alongside the chart (acceptable because it's a single component):

```tsx
<style jsx>{`
  @keyframes diamond-pulse {
    0%   { transform: scale(0.6); opacity: 0.9; }
    100% { transform: scale(2.4); opacity: 0; }
  }
`}</style>
```

If the project does not support `styled-jsx` (check `package.json`), add the keyframes to `frontend/app/globals.css` instead, scoped via a uniquely-named `@keyframes diamond-pulse` block.

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (Task 13's pending error now resolves).

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/PromptImpactTimeline.tsx frontend/app/globals.css
git commit -m "feat(content-hub): highlight diamond on prompt timeline for deep-linked drafts"
```

(Omit `globals.css` from the add if you used `styled jsx` inline instead.)

---

## Task 15: Manual browser verification

No commits here. Walk the full end-to-end flow in a dev environment and note any issues before opening a PR.

- [ ] **Step 1: Start dev servers**

Run in two terminals:

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
```

```bash
cd frontend && PORT=3002 npm run dev
```

Open: `http://localhost:3002/content`

- [ ] **Step 2: Verify rename**

- Content Drafts primary tab → sub-tab reads **Saved** (not Scheduled).
- Queue-full / saved-queue-full error messages say "Saved drafts queue is full".
- Help modal (gear icon → Help) reads "Saved — approved drafts ready to post…".
- URL `http://localhost:3002/content?tab=saved` opens the Saved sub-tab (alias works).
- URL `http://localhost:3002/content?tab=scheduled` still opens the Saved sub-tab (legacy param still works).

- [ ] **Step 3: Verify summary strip**

- Switch to the Posted primary tab.
- If the user has ≥1 posted draft with attribution, the strip shows count / avg delta / best / awaiting / unattached.
- If 0 posts, strip says "Posted drafts will appear here with their visibility impact."
- Click "How impact works" → ImpactExplainerModal opens with all 5 sections.

- [ ] **Step 4: Verify PostedCard click-through + pulse**

- Ensure at least one posted draft has `prompt_id` set and `runs_since_posting ≥ 1` (trigger a tracking run if needed).
- Click anywhere on the card body.
- URL should navigate to `/tracker/{brandId}/prompt/{promptId}?draft={draftId}`.
- The matching diamond marker on the timeline pulses once (~1.2s ring expansion + fade).
- The draft info panel is auto-expanded below the chart.
- If the draft's date falls before 90 days ago, timeframe auto-switches to **All**.
- Clicking the info (ⓘ) button on the card does NOT navigate — it opens the explainer modal.
- Clicking the trash icon does NOT navigate — it opens the delete confirm.

- [ ] **Step 5: Verify orphan card (no prompt attached)**

- Create an orphan draft manually: on the Queue tab, click "Request Draft" → leave prompt unselected, enter a custom topic, generate. Approve it into Saved.
- Click "Mark as Posted" on the Saved orphan → **MarkAsPostedModal** opens with suggestions.
  - Top 3 prompts ranked by similarity, with relevance labels.
  - "Skip — post without attaching" button is clearly visible.
- Test both paths:
  - Attach one of the suggestions → draft moves to Posted, card is clickable, attribution row creates on next tracking run.
  - Skip → draft moves to Posted as an orphan, card shows "No prompt attached — impact not trackable" and the Attach to prompt button.

- [ ] **Step 6: Verify late-attach flow**

- Click "Attach to prompt" on an orphan Posted card → popover opens with suggestions.
- Pick a prompt → card updates in place: shows "Now X% · Attached late — baseline unavailable", card becomes clickable.
- Navigate to the prompt detail page via the card click → the timeline should eventually show a diamond for this draft (after the next tracking run populates `current_score`).

- [ ] **Step 7: Verify delete**

- Click trash icon on a Posted card → confirm dialog appears.
- Accept → card disappears; summary strip count decrements; refresh page — still gone; any `DraftAttribution` rows cascaded.

- [ ] **Step 8: Regression sweep (5 min)**

- Queue tab still loads, Request Draft still works, approve/reject still works.
- Saved tab still loads, "Mark as Posted" on a non-orphan (prompt already set) bypasses the modal and posts directly.
- Visibility Opportunities tab still loads and scans.
- Other routes unchanged: `/dashboard`, `/reports`, `/settings`.

---

## Self-Review (completed inline while writing this plan)

**Spec coverage check:**

| Spec section | Plan task(s) |
|---|---|
| §1 Copy & IA (Scheduled → Saved rename) | Task 7 |
| §2 Posted tab summary strip | Task 9 |
| §2 PostedCard redesign (whole-card click, attribution promoted, delete, orphan/late-attach variants) | Task 10 |
| §3 Prompt detail highlight (`?draft=` + pulse) | Tasks 13 + 14 |
| §4 Orphan matching at Mark-as-Posted | Task 12 |
| §4a Similarity helper + thresholds | Task 1, labels in Task 5 |
| §5 Attach-to-prompt on orphan Posted cards | Task 11 (popover) + Task 10 (button on orphan card) |
| §5 Late-attach attribution branch | Task 4 |
| §5 `PUT /draft/{id}` accepts `prompt_id` | Tasks 2 + 3 |
| §5 `POST /prompt-suggestions` endpoint | Task 5 |
| §6 Impact explainer modal + entry points | Task 8 + wiring in Tasks 9, 10 |
| §7 Delete from Posted | Task 10 (button), existing backend cascade |

All spec sections have corresponding tasks.

**Placeholder scan:** no TBDs, TODOs, or "add appropriate X" placeholders. Every step has either complete code or an exact command to run.

**Type consistency:** `PromptSuggestion.label` is `'very_relevant' | 'somewhat' | 'loose'` in both backend (Task 5 schema) and frontend (Task 6 typings). `highlightDraftId` is `number | undefined` in both Task 13 (passing it) and Task 14 (receiving it). `ContentDraft.prompt_id` nullability is preserved throughout. `attributionMap` key is `draft.id` consistently.
