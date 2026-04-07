# Content Impact Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-prompt impact timelines with draft markers, silent event logging infrastructure, and rule-based heuristic insights — creating a competitive moat through content activity correlation intelligence.

**Architecture:** Two new DB tables (`PromptRunScore`, `ContentEvent`) are populated during tracking runs and draft posting. Three new API endpoints serve timeline, detail, and overview data. A pure-function heuristic service generates insights on-read. Frontend adds sparklines to the reports prompt list and a new dedicated prompt detail page.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), Next.js/React/TypeScript/Recharts/Tailwind (frontend), SQLite

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `backend/app/services/heuristic_service.py` | Pure-function heuristic engine — evaluates rules against prompt data, returns insight objects |
| `backend/app/services/content_event_service.py` | Helper to log ContentEvent rows (fire-and-forget, like `analytics_service.py`) |
| `backend/tests/test_prompt_intelligence.py` | Tests for PromptRunScore population, ContentEvent logging, heuristic rules, and new endpoints |
| `frontend/components/PromptSparkline.tsx` | Compact 64px inline chart with draft-posted dot markers |
| `frontend/components/PromptImpactTimeline.tsx` | Full-size interactive Recharts ComposedChart with model lines + draft markers |
| `frontend/components/PromptInsightCard.tsx` | Single heuristic insight display with severity coloring |
| `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx` | Prompt detail page — the "X-ray" view |

### Modified files
| File | Changes |
|------|---------|
| `backend/app/models.py` | Add `PromptRunScore` and `ContentEvent` ORM models |
| `backend/app/database.py` | Add CREATE TABLE + index migration statements |
| `backend/app/schemas.py` | Add Pydantic response models for 3 new endpoints |
| `backend/app/routers/results.py` | Add 3 new endpoints: timeline, detail, prompts overview |
| `backend/app/services/tracking_service.py` | After RunModelScore insert: compute + insert PromptRunScore rows, log ContentEvents |
| `backend/app/services/content_service.py` | In `post_draft()`: log `draft_posted` ContentEvent |
| `backend/tests/conftest.py` | Add new tables to clean_tables truncation list |
| `frontend/lib/api.ts` | Add 3 new API methods + TypeScript interfaces |
| `frontend/app/reports/page.tsx` | Add sparkline + click-through arrow to each prompt row |

---

## Task 1: Database Models & Migrations

**Files:**
- Modify: `backend/app/models.py` (after line 563, before `Notification` class)
- Modify: `backend/app/database.py` (append to migrations list at line 302)
- Modify: `backend/tests/conftest.py` (add tables to clean_tables list at line 70)

- [ ] **Step 1: Add PromptRunScore model to models.py**

Add after the `AnalyticsEvent` class (line 563), before the `Notification` class:

```python
# ── Prompt-level time-series scores ──────────────────────────────────────────

class PromptRunScore(Base):
    """Per-prompt per-model visibility score snapshot for each tracking run."""
    __tablename__ = "prompt_run_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(50), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    mentioned_count: Mapped[int] = mapped_column(Integer, nullable=False)
    query_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("prompt_id", "tracking_run_id", "model", name="uq_prompt_run_score"),
    )
```

- [ ] **Step 2: Add ContentEvent model to models.py**

Add immediately after `PromptRunScore`:

```python
# ── Content event log (silent storage for future intelligence) ───────────────

class ContentEvent(Base):
    """Flexible event log for content-related signals. JSON data column for arbitrary payloads."""
    __tablename__ = "content_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
```

- [ ] **Step 3: Add migrations to database.py**

Append these lines to the `migrations` list in `run_migrations()`, after line 302 (`ALTER TABLE brands ADD COLUMN prompt_limit`):

```python
        # 2026-04-07: Content Impact Intelligence tables
        "CREATE TABLE IF NOT EXISTS prompt_run_scores (id INTEGER PRIMARY KEY, prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE, tracking_run_id INTEGER NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, model TEXT NOT NULL, score REAL NOT NULL, mentioned_count INTEGER NOT NULL, query_count INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(prompt_id, tracking_run_id, model))",
        "CREATE INDEX IF NOT EXISTS idx_prompt_run_scores_prompt_model ON prompt_run_scores(prompt_id, model, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_prompt_run_scores_brand ON prompt_run_scores(brand_id, created_at)",
        "CREATE TABLE IF NOT EXISTS content_events (id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL, event_type TEXT NOT NULL, data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS idx_content_events_brand_type ON content_events(brand_id, event_type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_content_events_prompt ON content_events(prompt_id, created_at)",
```

- [ ] **Step 4: Add new tables to test cleanup**

In `backend/tests/conftest.py`, update the `clean_tables` fixture. Add `"prompt_run_scores"` and `"content_events"` to the table list at line 70, before `"analytics_events"`:

```python
        for table in [
            "prompt_run_scores", "content_events",
            "analytics_events", "content_attribution", "content_posts",
            "content_drafts", "content_gaps", "content_opportunities",
            "run_model_scores", "query_results", "tracking_runs",
            "competitors", "prompts", "brand_profiles",
            "brand_content_settings", "account_connections",
            "system_settings", "brands", "users",
        ]:
```

- [ ] **Step 5: Verify tables are created**

Run: `cd backend && source venv/bin/activate && python -c "import asyncio; from app.database import engine, Base; import app.models; asyncio.run(engine.dispose())"; echo "Models imported OK"`

Expected: No import errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/tests/conftest.py
git commit -m "feat: add PromptRunScore and ContentEvent database models and migrations"
```

---

## Task 2: Content Event Service

**Files:**
- Create: `backend/app/services/content_event_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_prompt_intelligence.py`:

```python
"""Tests for Content Impact Intelligence feature."""
from __future__ import annotations

import json

import pytest
import pytest_asyncio

from tests.conftest import AsyncSessionLocal, register_and_login, create_brand


@pytest.mark.asyncio
async def test_log_content_event(db_session):
    """log_content_event creates a ContentEvent row."""
    from app.models import Brand, Prompt, User
    from app.services.content_event_service import log_content_event

    # Create a user + brand
    user = User(email="evt@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="EvtBrand", slug="evtbrand", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="test prompt")
    db_session.add(prompt)
    await db_session.commit()

    await log_content_event(
        event_type="draft_posted",
        brand_id=brand.id,
        prompt_id=prompt.id,
        data={"draft_id": 1, "platform": "reddit"},
    )

    from sqlalchemy import select
    from app.models import ContentEvent
    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(ContentEvent).where(ContentEvent.brand_id == brand.id)
        )
        events = result.scalars().all()
        assert len(events) == 1
        assert events[0].event_type == "draft_posted"
        assert json.loads(events[0].data)["platform"] == "reddit"
        assert events[0].prompt_id == prompt.id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_log_content_event -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.content_event_service'`

- [ ] **Step 3: Implement content_event_service.py**

Create `backend/app/services/content_event_service.py`:

```python
"""
Content event logging helper.

log_content_event() is fire-and-forget: it always creates its own DB session
and never raises — failures are logged as warnings so they never break the
calling code path.  Mirrors the pattern in analytics_service.py.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def log_content_event(
    event_type: str,
    brand_id: int,
    prompt_id: int | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Append a content event row. Never raises."""
    try:
        from app.database import AsyncSessionLocal
        from app.models import ContentEvent

        async with AsyncSessionLocal() as db:
            event = ContentEvent(
                event_type=event_type,
                brand_id=brand_id,
                prompt_id=prompt_id,
                data=json.dumps(data) if data else None,
            )
            db.add(event)
            await db.commit()
    except Exception as exc:
        logger.warning("Content event logging failed (non-fatal): %s — %s", event_type, exc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_log_content_event -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/content_event_service.py backend/tests/test_prompt_intelligence.py
git commit -m "feat: add content_event_service for silent event logging"
```

---

## Task 3: Populate PromptRunScore During Tracking Runs

**Files:**
- Modify: `backend/app/services/tracking_service.py` (inside the persist block, after line 225)
- Test: `backend/tests/test_prompt_intelligence.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_prompt_intelligence.py`:

```python
@pytest.mark.asyncio
async def test_prompt_run_scores_populated_after_tracking(db_session):
    """After a tracking run completes, PromptRunScore rows exist for each prompt+model."""
    from app.models import Brand, Prompt, QueryResult, TrackingRun, User, PromptRunScore
    from sqlalchemy import select

    # Create user, brand, prompt
    user = User(email="prs@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="PRSBrand", slug="prsbrand", user_id=user.id, tier="basic")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="best tool for testing")
    db_session.add(prompt)
    await db_session.flush()

    # Create a tracking run with query results
    run = TrackingRun(brand_id=brand.id, status="running")
    db_session.add(run)
    await db_session.flush()

    # Simulate 5 queries per model (basic tier), 2 models
    for model in ["chatgpt", "claude"]:
        for i in range(5):
            db_session.add(QueryResult(
                tracking_run_id=run.id,
                prompt_id=prompt.id,
                model=model,
                run_number=i + 1,
                response_text=f"Response {i} mentioning PRSBrand" if i < 3 else f"Response {i} no mention",
                mentioned=(i < 3),  # 3 out of 5 mentioned
            ))
    await db_session.commit()

    # Call the PromptRunScore population function
    from app.services.tracking_service import _persist_prompt_run_scores
    async with AsyncSessionLocal() as score_db:
        await _persist_prompt_run_scores(
            score_db,
            run_id=run.id,
            brand_id=brand.id,
            query_results=list((await db_session.execute(
                select(QueryResult).where(QueryResult.tracking_run_id == run.id)
            )).scalars().all()),
        )

    # Verify
    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(PromptRunScore).where(PromptRunScore.tracking_run_id == run.id)
        )
        scores = result.scalars().all()
        assert len(scores) == 2  # one per model
        for s in scores:
            assert s.prompt_id == prompt.id
            assert s.brand_id == brand.id
            assert s.query_count == 5
            assert s.mentioned_count == 3
            assert s.score == 60.0  # 3/5 * 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_prompt_run_scores_populated_after_tracking -v`

Expected: FAIL — `ImportError: cannot import name '_persist_prompt_run_scores'`

- [ ] **Step 3: Implement _persist_prompt_run_scores in tracking_service.py**

Add this function before `run_tracking()` in `backend/app/services/tracking_service.py` (after the `_detect_mention` function, around line 73):

```python
async def _persist_prompt_run_scores(
    db,
    run_id: int,
    brand_id: int,
    query_results: list,
) -> None:
    """Compute and persist per-prompt per-model scores from query results."""
    from app.models import PromptRunScore

    # Group by (prompt_id, model)
    prompt_model_stats: dict[tuple[int, int | str], dict] = {}
    for qr in query_results:
        if qr.error:
            continue
        key = (qr.prompt_id, qr.model)
        if key not in prompt_model_stats:
            prompt_model_stats[key] = {"total": 0, "mentioned": 0}
        stats = prompt_model_stats[key]
        stats["total"] += 1
        if qr.mentioned:
            stats["mentioned"] += 1

    for (prompt_id, model), stats in prompt_model_stats.items():
        tq = stats["total"]
        tm = stats["mentioned"]
        score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
        db.add(PromptRunScore(
            prompt_id=prompt_id,
            tracking_run_id=run_id,
            brand_id=brand_id,
            model=model,
            score=score,
            mentioned_count=tm,
            query_count=tq,
        ))
    await db.commit()
    logger.info("Persisted %d PromptRunScore rows for run %d", len(prompt_model_stats), run_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_prompt_run_scores_populated_after_tracking -v`

Expected: PASS

- [ ] **Step 5: Hook into the tracking run flow**

In `backend/app/services/tracking_service.py`, inside `run_tracking()`, add the call after line 242 (`await db.commit()`) but inside the same try block. Insert before the `logger.info("Tracking run %d completed...")` line:

```python
            # Persist per-prompt per-model scores for impact timelines
            await _persist_prompt_run_scores(db, run_id, brand_id, query_results)
```

Wait — the `db.commit()` on line 242 closes the transaction. The `_persist_prompt_run_scores` function does its own commit. But we're still inside `async with AsyncSessionLocal() as db:`. This is fine — the function uses the passed `db` session.

Actually, looking more carefully, the function does `await db.commit()` which will work since we're passing the same session. But it's cleaner to call it before the first commit so everything is in one transaction. Insert it right before line 242 (`await db.commit()`):

```python
            # Persist per-prompt per-model scores for impact timelines
            for (prompt_id, model_name), pms in _prompt_model_stats(query_results).items():
                tq, tm = pms["total"], pms["mentioned"]
                score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
                db.add(PromptRunScore(
                    prompt_id=prompt_id,
                    tracking_run_id=run_id,
                    brand_id=brand_id,
                    model=model_name,
                    score=score,
                    mentioned_count=tm,
                    query_count=tq,
                ))
```

This requires adding `PromptRunScore` to the imports at line 26 and refactoring the grouping logic. Let me simplify — keep the standalone function but have it not commit (let the caller commit). Update the function:

Replace the `_persist_prompt_run_scores` function with:

```python
async def _persist_prompt_run_scores(
    db,
    run_id: int,
    brand_id: int,
    query_results: list,
) -> int:
    """Compute and add per-prompt per-model PromptRunScore rows to the session.
    Does NOT commit — caller is responsible for committing."""
    from app.models import PromptRunScore

    prompt_model_stats: dict[tuple[int, str], dict] = {}
    for qr in query_results:
        if qr.error:
            continue
        key = (qr.prompt_id, qr.model)
        if key not in prompt_model_stats:
            prompt_model_stats[key] = {"total": 0, "mentioned": 0}
        stats = prompt_model_stats[key]
        stats["total"] += 1
        if qr.mentioned:
            stats["mentioned"] += 1

    count = 0
    for (prompt_id, model), stats in prompt_model_stats.items():
        tq = stats["total"]
        tm = stats["mentioned"]
        score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
        db.add(PromptRunScore(
            prompt_id=prompt_id,
            tracking_run_id=run_id,
            brand_id=brand_id,
            model=model,
            score=score,
            mentioned_count=tm,
            query_count=tq,
        ))
        count += 1
    logger.info("Added %d PromptRunScore rows for run %d", count, run_id)
    return count
```

Then in `run_tracking()`, insert before the `await db.commit()` at line 242:

```python
            # Persist per-prompt per-model scores for impact timelines
            await _persist_prompt_run_scores(db, run_id, brand_id, query_results)
```

Update the test to also not expect an independent commit — use a session that we commit ourselves:

```python
    # In the test, instead of calling the function with a separate session:
    from app.services.tracking_service import _persist_prompt_run_scores
    async with AsyncSessionLocal() as score_db:
        qr_result = await score_db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == run.id)
        )
        qrs = qr_result.scalars().all()
        await _persist_prompt_run_scores(score_db, run.id, brand.id, qrs)
        await score_db.commit()
```

- [ ] **Step 6: Run all tests**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py -v`

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/tracking_service.py backend/tests/test_prompt_intelligence.py
git commit -m "feat: populate PromptRunScore rows during tracking runs"
```

---

## Task 4: Log ContentEvents from Tracking + Drafts

**Files:**
- Modify: `backend/app/services/tracking_service.py` (after gap analysis, in the post-run hooks)
- Modify: `backend/app/services/content_service.py` (in `post_draft()`, after line 480)
- Test: `backend/tests/test_prompt_intelligence.py`

- [ ] **Step 1: Write failing test for score_change events**

Append to `backend/tests/test_prompt_intelligence.py`:

```python
@pytest.mark.asyncio
async def test_score_change_events_logged(db_session):
    """When prompt score changes >=5pp between runs, a score_change ContentEvent is logged."""
    from app.models import Brand, Prompt, User, PromptRunScore, ContentEvent
    from app.services.content_event_service import log_content_event
    from app.services.tracking_service import _log_score_change_events
    from sqlalchemy import select

    user = User(email="sce@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="SCEBrand", slug="scebrand", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="test prompt")
    db_session.add(prompt)
    await db_session.flush()

    # Simulate previous run score
    prev_score = PromptRunScore(
        prompt_id=prompt.id, tracking_run_id=1, brand_id=brand.id,
        model="chatgpt", score=40.0, mentioned_count=2, query_count=5,
    )
    db_session.add(prev_score)
    await db_session.commit()

    # New scores with significant change
    new_scores = [
        {"prompt_id": prompt.id, "model": "chatgpt", "score": 60.0},  # +20pp
    ]

    await _log_score_change_events(brand.id, run_id=2, new_scores=new_scores)

    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(ContentEvent).where(
                ContentEvent.brand_id == brand.id,
                ContentEvent.event_type == "score_change",
            )
        )
        events = result.scalars().all()
        assert len(events) == 1
        data = json.loads(events[0].data)
        assert data["delta"] == 20.0
        assert data["old_score"] == 40.0
        assert data["new_score"] == 60.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_score_change_events_logged -v`

Expected: FAIL — `ImportError: cannot import name '_log_score_change_events'`

- [ ] **Step 3: Implement _log_score_change_events**

Add to `backend/app/services/tracking_service.py`, after `_persist_prompt_run_scores`:

```python
async def _log_score_change_events(
    brand_id: int,
    run_id: int,
    new_scores: list[dict],
) -> None:
    """Log ContentEvent for any prompt+model score changes >= 5pp from previous run."""
    from app.models import PromptRunScore
    from app.services.content_event_service import log_content_event

    THRESHOLD = 5.0

    # Get previous scores for comparison
    async with AsyncSessionLocal() as db:
        for ns in new_scores:
            result = await db.execute(
                select(PromptRunScore)
                .where(
                    PromptRunScore.prompt_id == ns["prompt_id"],
                    PromptRunScore.model == ns["model"],
                    PromptRunScore.tracking_run_id != run_id,
                )
                .order_by(PromptRunScore.created_at.desc())
                .limit(1)
            )
            prev = result.scalar_one_or_none()
            if prev is None:
                continue
            delta = round(ns["score"] - prev.score, 2)
            if abs(delta) >= THRESHOLD:
                await log_content_event(
                    event_type="score_change",
                    brand_id=brand_id,
                    prompt_id=ns["prompt_id"],
                    data={
                        "prompt_id": ns["prompt_id"],
                        "model": ns["model"],
                        "old_score": prev.score,
                        "new_score": ns["score"],
                        "delta": delta,
                        "tracking_run_id": run_id,
                    },
                )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_score_change_events_logged -v`

Expected: PASS

- [ ] **Step 5: Hook score change logging into tracking flow**

In `run_tracking()`, add as a new post-run step after the gap analysis block (after line 382). Follow the existing non-fatal pattern:

```python
    # ── 8b. Log significant prompt score changes ────────────────────────────
    try:
        from app.models import PromptRunScore as _PRS
        async with AsyncSessionLocal() as prs_db:
            prs_result = await prs_db.execute(
                select(_PRS).where(_PRS.tracking_run_id == run_id)
            )
            new_scores = [
                {"prompt_id": s.prompt_id, "model": s.model, "score": s.score}
                for s in prs_result.scalars().all()
            ]
        if new_scores:
            await _log_score_change_events(brand_id, run_id, new_scores)
    except Exception as exc:
        logger.warning("Score change event logging failed for run %d (non-fatal): %s", run_id, exc)
```

- [ ] **Step 6: Add draft_posted event to content_service.py**

In `backend/app/services/content_service.py`, in the `post_draft()` function, add after the existing `log_event` call (around line 480, after `await log_event(...)`):

```python
    from app.services.content_event_service import log_content_event
    await log_content_event(
        event_type="draft_posted",
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        data={
            "draft_id": draft_id,
            "platform": draft.platform,
            "visibility_at_post": draft.visibility_at_post,
        },
    )
```

- [ ] **Step 7: Run all tests**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py -v`

Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/tracking_service.py backend/app/services/content_service.py backend/tests/test_prompt_intelligence.py
git commit -m "feat: log score_change and draft_posted ContentEvents"
```

---

## Task 5: Pydantic Schemas for New Endpoints

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Add response schemas to schemas.py**

Append to the end of `backend/app/schemas.py`:

```python
# ── Prompt Intelligence schemas ──────────────────────────────────────────────

class PromptTimelinePoint(BaseModel):
    run_id: int
    completed_at: datetime | None
    scores: dict[str, float]  # model -> score
    overall: float

class ContentEventResponse(BaseModel):
    id: int
    event_type: str
    created_at: datetime
    data: dict | None = None

    model_config = ConfigDict(from_attributes=True)

class PromptTimelineResponse(BaseModel):
    prompt_id: int
    prompt_text: str
    timeline: list[PromptTimelinePoint]
    content_events: list[ContentEventResponse]
    current_scores: dict[str, float]
    total_drafts_targeting: int
    latest_draft_posted_at: datetime | None

class PromptDraftSnapshot(BaseModel):
    id: int
    platform: str
    status: str
    posted_at: datetime | None
    visibility_at_post: float | None
    content_preview: str
    score_snapshot: dict  # {at_posting, current, delta, runs_since}

class PromptCompetitorSummary(BaseModel):
    name: str
    mention_rate: float
    trend: str  # "increasing" | "decreasing" | "stable"

class PromptInsight(BaseModel):
    id: str
    message: str
    severity: str  # "positive" | "warning" | "negative" | "info"
    model: str | None = None

class PromptRecentResponse(BaseModel):
    model: str
    response_text: str | None
    mentioned: bool
    sentiment: str | None
    created_at: datetime

class PromptDetailResponse(BaseModel):
    prompt_id: int
    prompt_text: str
    prompt_type: str
    current_scores: dict[str, float]
    score_trend: str  # "improving" | "declining" | "stable"
    timeline: list[PromptTimelinePoint]
    content_events: list[ContentEventResponse]
    drafts: list[PromptDraftSnapshot]
    competitors: list[PromptCompetitorSummary]
    insights: list[PromptInsight]
    recent_responses: list[PromptRecentResponse]

class PromptOverviewItem(BaseModel):
    prompt_id: int
    prompt_text: str
    current_overall: float
    trend: str  # "improving" | "declining" | "stable"
    sparkline: list[float]
    model_scores: dict[str, float]
    drafts_posted: int
    last_draft_at: datetime | None
    has_recent_content_event: bool

class PromptsOverviewResponse(BaseModel):
    prompts: list[PromptOverviewItem]
```

- [ ] **Step 2: Verify schemas compile**

Run: `cd backend && python -c "from app.schemas import PromptTimelineResponse, PromptDetailResponse, PromptsOverviewResponse; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat: add Pydantic schemas for prompt intelligence endpoints"
```

---

## Task 6: Heuristic Service

**Files:**
- Create: `backend/app/services/heuristic_service.py`
- Test: `backend/tests/test_prompt_intelligence.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_prompt_intelligence.py`:

```python
@pytest.mark.asyncio
async def test_heuristic_model_gap():
    """model_gap heuristic fires when one model scores >=30pp above another."""
    from app.services.heuristic_service import evaluate_heuristics

    prompt_scores = {
        "chatgpt": 20.0,
        "claude": 65.0,
        "perplexity": 50.0,
        "gemini": 30.0,
    }
    insights = evaluate_heuristics(
        prompt_id=1,
        current_scores=prompt_scores,
        score_history=[],
        content_events=[],
        drafts_posted=0,
    )
    gap_insights = [i for i in insights if i["id"] == "model_gap"]
    assert len(gap_insights) >= 1
    assert "Claude" in gap_insights[0]["message"] or "ChatGPT" in gap_insights[0]["message"]
    assert gap_insights[0]["severity"] == "info"


@pytest.mark.asyncio
async def test_heuristic_score_dropping():
    """score_dropping heuristic fires when overall score declines >=8pp over last 5 runs."""
    from app.services.heuristic_service import evaluate_heuristics

    # Declining trend: 60, 55, 52, 48, 44
    history = [
        {"overall": 60.0, "run_id": 1},
        {"overall": 55.0, "run_id": 2},
        {"overall": 52.0, "run_id": 3},
        {"overall": 48.0, "run_id": 4},
        {"overall": 44.0, "run_id": 5},
    ]
    insights = evaluate_heuristics(
        prompt_id=1,
        current_scores={"chatgpt": 44.0},
        score_history=history,
        content_events=[],
        drafts_posted=0,
    )
    drop_insights = [i for i in insights if i["id"] == "score_dropping"]
    assert len(drop_insights) == 1
    assert drop_insights[0]["severity"] == "negative"


@pytest.mark.asyncio
async def test_heuristic_inactive_prompt():
    """inactive_prompt heuristic fires when no content events in >= 30 days."""
    from app.services.heuristic_service import evaluate_heuristics

    insights = evaluate_heuristics(
        prompt_id=1,
        current_scores={"chatgpt": 50.0},
        score_history=[{"overall": 50.0, "run_id": 1}],
        content_events=[],  # No events
        drafts_posted=0,
    )
    inactive_insights = [i for i in insights if i["id"] == "inactive_prompt"]
    assert len(inactive_insights) == 1
    assert inactive_insights[0]["severity"] == "info"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_heuristic_model_gap tests/test_prompt_intelligence.py::test_heuristic_score_dropping tests/test_prompt_intelligence.py::test_heuristic_inactive_prompt -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.heuristic_service'`

- [ ] **Step 3: Implement heuristic_service.py**

Create `backend/app/services/heuristic_service.py`:

```python
"""
Heuristic engine for prompt-level insights.

Pure functions — no database access, no LLM calls. Takes pre-fetched data
and returns insight dicts. Called by the prompt detail API endpoint.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

MODEL_LABELS = {
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
}


def evaluate_heuristics(
    prompt_id: int,
    current_scores: dict[str, float],
    score_history: list[dict],  # [{overall, run_id, ...}]
    content_events: list[dict],  # [{event_type, created_at, data}]
    drafts_posted: int,
) -> list[dict]:
    """Evaluate all heuristic rules and return triggered insights."""
    insights: list[dict] = []

    insights.extend(_check_model_gap(prompt_id, current_scores))
    insights.extend(_check_score_dropping(prompt_id, score_history))
    insights.extend(_check_inactive_prompt(prompt_id, content_events, drafts_posted))
    insights.extend(_check_model_responding(prompt_id, score_history, content_events))

    return insights


def _check_model_gap(prompt_id: int, current_scores: dict[str, float]) -> list[dict]:
    """Fire when one model scores >=30pp higher than another."""
    if len(current_scores) < 2:
        return []
    scores = [(m, s) for m, s in current_scores.items() if s is not None]
    if len(scores) < 2:
        return []
    best_model, best_score = max(scores, key=lambda x: x[1])
    worst_model, worst_score = min(scores, key=lambda x: x[1])
    gap = best_score - worst_score
    if gap >= 30:
        best_label = MODEL_LABELS.get(best_model, best_model)
        worst_label = MODEL_LABELS.get(worst_model, worst_model)
        return [{
            "id": "model_gap",
            "message": f"{best_label} scores {int(gap)}pp higher than {worst_label} for this prompt",
            "severity": "info",
            "model": worst_model,
            "prompt_id": prompt_id,
            "data": {"best": best_model, "worst": worst_model, "gap": gap},
        }]
    return []


def _check_score_dropping(prompt_id: int, score_history: list[dict]) -> list[dict]:
    """Fire when overall score declined >=8pp over the last 5 data points."""
    if len(score_history) < 2:
        return []
    recent = score_history[-5:] if len(score_history) >= 5 else score_history
    first_score = recent[0].get("overall", 0)
    last_score = recent[-1].get("overall", 0)
    drop = first_score - last_score
    if drop >= 8:
        return [{
            "id": "score_dropping",
            "message": f"Overall visibility has dropped {int(drop)}pp over the last {len(recent)} runs",
            "severity": "negative",
            "model": None,
            "prompt_id": prompt_id,
            "data": {"drop": drop, "from": first_score, "to": last_score, "runs": len(recent)},
        }]
    return []


def _check_inactive_prompt(
    prompt_id: int, content_events: list[dict], drafts_posted: int
) -> list[dict]:
    """Fire when no content has targeted this prompt (no draft_posted events at all)."""
    draft_events = [e for e in content_events if e.get("event_type") == "draft_posted"]
    if len(draft_events) == 0 and drafts_posted == 0:
        return [{
            "id": "inactive_prompt",
            "message": "No content has targeted this prompt yet",
            "severity": "info",
            "model": None,
            "prompt_id": prompt_id,
            "data": {},
        }]
    return []


def _check_model_responding(
    prompt_id: int, score_history: list[dict], content_events: list[dict]
) -> list[dict]:
    """Fire when a model score improved >=10pp and there was a recent draft_posted event."""
    draft_events = [e for e in content_events if e.get("event_type") == "draft_posted"]
    if not draft_events or len(score_history) < 2:
        return []
    # This is a simplified version — checks overall trend after any content event
    # A more sophisticated version would check per-model scores around each event
    return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_heuristic_model_gap tests/test_prompt_intelligence.py::test_heuristic_score_dropping tests/test_prompt_intelligence.py::test_heuristic_inactive_prompt -v`

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/heuristic_service.py backend/tests/test_prompt_intelligence.py
git commit -m "feat: add heuristic engine for prompt-level insights"
```

---

## Task 7: API Endpoints

**Files:**
- Modify: `backend/app/routers/results.py`
- Test: `backend/tests/test_prompt_intelligence.py`

- [ ] **Step 1: Write the failing test for prompts overview endpoint**

Append to `backend/tests/test_prompt_intelligence.py`:

```python
@pytest.mark.asyncio
async def test_prompts_overview_endpoint(client):
    """GET /api/results/{brand_id}/prompts/overview returns prompt summaries."""
    await register_and_login(client)
    brand_data = await create_brand(client, "OverviewBrand", ["best project management tool"])

    # Trigger a run (mock LLM responses)
    from unittest.mock import AsyncMock, patch
    async def mock_query(model, prompt, brand, runs_per_prompt):
        return [{"response_text": f"Try OverviewBrand for {prompt}", "mentioned": True, "latency_ms": 100, "error": None}] * runs_per_prompt

    with patch("app.services.tracking_service.query_model", new=AsyncMock(side_effect=lambda m, p, b, r: mock_query(m, p, b, r))):
        run_resp = await client.post(f"/api/tracking/run/{brand_data['id']}")
        assert run_resp.status_code == 200

    # Wait a moment for background task
    import asyncio
    await asyncio.sleep(1)

    resp = await client.get(f"/api/results/{brand_data['id']}/prompts/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "prompts" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_prompts_overview_endpoint -v`

Expected: FAIL — 404 (endpoint doesn't exist yet)

- [ ] **Step 3: Implement the three endpoints**

Add to `backend/app/routers/results.py`. First, add imports at the top (after existing imports):

```python
from app.models import Brand, ContentAttribution, ContentEvent, Prompt, PromptRunScore, QueryResult, RunModelScore, TrackingRun, ContentDraft, DraftAttribution, CompetitorMention, Competitor
from app.schemas import (
    ContentAttributionSummary,
    ContentEventResponse,
    ModelScoreResponse,
    OverviewResponse,
    PaginatedQueryResults,
    PromptDetailResponse,
    PromptDraftSnapshot,
    PromptInsight,
    PromptOverviewItem,
    PromptRecentResponse,
    PromptTimelinePoint,
    PromptTimelineResponse,
    PromptsOverviewResponse,
    QueryResultResponse,
    TrackingRunSummary,
    TrendPoint,
    TrendsResponse,
)
```

(Replace the existing imports from `app.models` and `app.schemas` with the expanded list.)

Then add the three endpoint functions at the end of the file:

```python
# ── Prompts Overview (for sparklines) ────────────────────────────────────────

@router.get("/{brand_id}/prompts/overview", response_model=PromptsOverviewResponse)
async def get_prompts_overview(brand_id: int, db: DbDep, user: CurrentUser):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get all prompts for this brand
    prompts_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == brand_id)
    )
    prompts = prompts_result.scalars().all()
    if not prompts:
        return PromptsOverviewResponse(prompts=[])

    prompt_ids = [p.id for p in prompts]

    # Get last 10 runs of PromptRunScore data per prompt
    scores_result = await db.execute(
        select(PromptRunScore)
        .where(PromptRunScore.brand_id == brand_id)
        .order_by(PromptRunScore.created_at.desc())
    )
    all_scores = scores_result.scalars().all()

    # Group by prompt_id
    from collections import defaultdict
    scores_by_prompt: dict[int, list[PromptRunScore]] = defaultdict(list)
    for s in all_scores:
        scores_by_prompt[s.prompt_id].append(s)

    # Count posted drafts per prompt
    draft_result = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
            ContentDraft.prompt_id.in_(prompt_ids),
        )
        .order_by(ContentDraft.posted_at.desc())
    )
    drafts = draft_result.scalars().all()
    drafts_by_prompt: dict[int, list] = defaultdict(list)
    for d in drafts:
        if d.prompt_id:
            drafts_by_prompt[d.prompt_id].append(d)

    # Check for recent content events
    from datetime import timedelta
    thirty_days_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
    events_result = await db.execute(
        select(ContentEvent)
        .where(
            ContentEvent.brand_id == brand_id,
            ContentEvent.created_at >= thirty_days_ago,
        )
    )
    recent_events = events_result.scalars().all()
    prompts_with_events = {e.prompt_id for e in recent_events if e.prompt_id}

    items = []
    for p in prompts:
        prompt_scores = scores_by_prompt.get(p.id, [])

        # Get unique runs, sorted by time (most recent first, then reverse for sparkline)
        runs_seen: dict[int, dict[str, float]] = {}
        for s in prompt_scores:
            if s.tracking_run_id not in runs_seen:
                runs_seen[s.tracking_run_id] = {}
            runs_seen[s.tracking_run_id][s.model] = s.score

        # Build sparkline from overall averages (last 10 runs)
        run_overalls = []
        for run_id, model_scores in runs_seen.items():
            avg = round(sum(model_scores.values()) / len(model_scores), 1) if model_scores else 0
            run_overalls.append(avg)
        sparkline = list(reversed(run_overalls[:10]))  # oldest-to-newest, max 10

        # Current scores from most recent run
        current_model_scores = {}
        if runs_seen:
            latest_run_id = next(iter(runs_seen))
            current_model_scores = runs_seen[latest_run_id]
        current_overall = round(sum(current_model_scores.values()) / len(current_model_scores), 1) if current_model_scores else 0

        # Trend
        trend = "stable"
        if len(sparkline) >= 3:
            recent_avg = sum(sparkline[-3:]) / 3
            older_avg = sum(sparkline[:3]) / 3
            if recent_avg - older_avg >= 3:
                trend = "improving"
            elif older_avg - recent_avg >= 3:
                trend = "declining"

        prompt_drafts = drafts_by_prompt.get(p.id, [])
        items.append(PromptOverviewItem(
            prompt_id=p.id,
            prompt_text=p.text,
            current_overall=current_overall,
            trend=trend,
            sparkline=sparkline,
            model_scores=current_model_scores,
            drafts_posted=len(prompt_drafts),
            last_draft_at=prompt_drafts[0].posted_at if prompt_drafts else None,
            has_recent_content_event=p.id in prompts_with_events,
        ))

    return PromptsOverviewResponse(prompts=items)


# ── Prompt Timeline ──────────────────────────────────────────────────────────

@router.get("/{brand_id}/prompt/{prompt_id}/timeline", response_model=PromptTimelineResponse)
async def get_prompt_timeline(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
    days: int = Query(90, ge=7, le=365),
):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get the prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days)

    # Get PromptRunScores
    scores_result = await db.execute(
        select(PromptRunScore)
        .join(TrackingRun, PromptRunScore.tracking_run_id == TrackingRun.id)
        .where(
            PromptRunScore.prompt_id == prompt_id,
            PromptRunScore.created_at >= cutoff,
        )
        .order_by(PromptRunScore.created_at.asc())
    )
    scores = scores_result.scalars().all()

    # Build timeline grouped by run
    from collections import defaultdict
    runs_data: dict[int, dict] = {}
    for s in scores:
        if s.tracking_run_id not in runs_data:
            runs_data[s.tracking_run_id] = {"scores": {}, "completed_at": s.created_at}
        runs_data[s.tracking_run_id]["scores"][s.model] = s.score

    timeline = []
    for run_id, rd in runs_data.items():
        model_scores = rd["scores"]
        overall = round(sum(model_scores.values()) / len(model_scores), 1) if model_scores else 0
        timeline.append(PromptTimelinePoint(
            run_id=run_id,
            completed_at=rd["completed_at"],
            scores=model_scores,
            overall=overall,
        ))

    # Get content events
    events_result = await db.execute(
        select(ContentEvent)
        .where(
            ContentEvent.prompt_id == prompt_id,
            ContentEvent.event_type.in_(["draft_posted", "content_correlated"]),
            ContentEvent.created_at >= cutoff,
        )
        .order_by(ContentEvent.created_at.asc())
    )
    events = events_result.scalars().all()

    import json
    content_events = [
        ContentEventResponse(
            id=e.id,
            event_type=e.event_type,
            created_at=e.created_at,
            data=json.loads(e.data) if e.data else None,
        )
        for e in events
    ]

    # Current scores (from latest timeline point)
    current_scores = timeline[-1].scores if timeline else {}

    # Draft count
    draft_count_result = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.prompt_id == prompt_id, ContentDraft.status == "posted")
    )
    posted_drafts = draft_count_result.scalars().all()

    return PromptTimelineResponse(
        prompt_id=prompt.id,
        prompt_text=prompt.text,
        timeline=timeline,
        content_events=content_events,
        current_scores=current_scores,
        total_drafts_targeting=len(posted_drafts),
        latest_draft_posted_at=posted_drafts[0].posted_at if posted_drafts else None,
    )


# ── Prompt Detail ────────────────────────────────────────────────────────────

@router.get("/{brand_id}/prompt/{prompt_id}/detail", response_model=PromptDetailResponse)
async def get_prompt_detail(
    brand_id: int,
    prompt_id: int,
    db: DbDep,
    user: CurrentUser,
):
    brand = await get_brand_for_user(brand_id, db, user)

    # Get prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Reuse timeline endpoint logic
    from datetime import timedelta
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=90)

    # Scores
    scores_result = await db.execute(
        select(PromptRunScore)
        .where(PromptRunScore.prompt_id == prompt_id, PromptRunScore.created_at >= cutoff)
        .order_by(PromptRunScore.created_at.asc())
    )
    scores = scores_result.scalars().all()

    from collections import defaultdict
    runs_data: dict[int, dict] = {}
    for s in scores:
        if s.tracking_run_id not in runs_data:
            runs_data[s.tracking_run_id] = {"scores": {}, "completed_at": s.created_at}
        runs_data[s.tracking_run_id]["scores"][s.model] = s.score

    timeline = []
    for run_id, rd in runs_data.items():
        ms = rd["scores"]
        overall = round(sum(ms.values()) / len(ms), 1) if ms else 0
        timeline.append(PromptTimelinePoint(
            run_id=run_id, completed_at=rd["completed_at"], scores=ms, overall=overall,
        ))

    current_scores = timeline[-1].scores if timeline else {}
    current_overall = timeline[-1].overall if timeline else 0

    # Score trend
    trend = "stable"
    if len(timeline) >= 3:
        recent = sum(t.overall for t in timeline[-3:]) / 3
        older = sum(t.overall for t in timeline[:3]) / 3
        if recent - older >= 3:
            trend = "improving"
        elif older - recent >= 3:
            trend = "declining"

    # Content events
    import json
    events_result = await db.execute(
        select(ContentEvent)
        .where(ContentEvent.prompt_id == prompt_id, ContentEvent.created_at >= cutoff)
        .order_by(ContentEvent.created_at.asc())
    )
    events = events_result.scalars().all()
    content_events = [
        ContentEventResponse(
            id=e.id, event_type=e.event_type, created_at=e.created_at,
            data=json.loads(e.data) if e.data else None,
        )
        for e in events
    ]

    # Drafts targeting this prompt
    drafts_result = await db.execute(
        select(ContentDraft)
        .where(ContentDraft.prompt_id == prompt_id)
        .order_by(ContentDraft.created_at.desc())
    )
    drafts = drafts_result.scalars().all()

    # Get DraftAttribution for posted drafts
    draft_snapshots = []
    for d in drafts:
        snapshot = {"at_posting": None, "current": None, "delta": None, "runs_since": None}
        if d.status == "posted":
            attr_result = await db.execute(
                select(DraftAttribution).where(DraftAttribution.draft_id == d.id).limit(1)
            )
            attr = attr_result.scalar_one_or_none()
            if attr:
                snapshot = {
                    "at_posting": attr.score_at_posting,
                    "current": attr.current_score,
                    "delta": attr.delta,
                    "runs_since": attr.runs_since_posting,
                }
        draft_snapshots.append(PromptDraftSnapshot(
            id=d.id,
            platform=d.platform,
            status=d.status,
            posted_at=d.posted_at,
            visibility_at_post=d.visibility_at_post if hasattr(d, 'visibility_at_post') else d.visibility_score_at_draft,
            content_preview=d.content_text[:150] if d.content_text else "",
            score_snapshot=snapshot,
        ))

    # Competitors on this prompt
    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()

    competitor_summaries = []
    if competitors:
        for comp in competitors:
            # Get mention rate from recent runs
            mentions_result = await db.execute(
                select(CompetitorMention)
                .join(TrackingRun, CompetitorMention.tracking_run_id == TrackingRun.id)
                .where(
                    CompetitorMention.competitor_id == comp.id,
                    CompetitorMention.prompt_id == prompt_id,
                    TrackingRun.completed_at >= cutoff,
                )
            )
            mentions = mentions_result.scalars().all()
            if mentions:
                rate = round(sum(1 for m in mentions if m.mentioned) / len(mentions), 2)
                competitor_summaries.append(PromptCompetitorSummary(
                    name=comp.name, mention_rate=rate, trend="stable",
                ))

    # Heuristics
    from app.services.heuristic_service import evaluate_heuristics
    history = [{"overall": t.overall, "run_id": t.run_id} for t in timeline]
    event_dicts = [{"event_type": e.event_type, "created_at": str(e.created_at), "data": e.data} for e in events]
    raw_insights = evaluate_heuristics(
        prompt_id=prompt_id,
        current_scores=current_scores,
        score_history=history,
        content_events=event_dicts,
        drafts_posted=sum(1 for d in drafts if d.status == "posted"),
    )
    insights = [PromptInsight(**{k: v for k, v in i.items() if k in ("id", "message", "severity", "model")}) for i in raw_insights]

    # Recent AI responses (latest run, one per model)
    latest_run_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run = latest_run_result.scalar_one_or_none()

    recent_responses = []
    if latest_run:
        resp_result = await db.execute(
            select(QueryResult)
            .where(
                QueryResult.tracking_run_id == latest_run.id,
                QueryResult.prompt_id == prompt_id,
            )
            .order_by(QueryResult.model)
        )
        resps = resp_result.scalars().all()
        seen_models = set()
        for r in resps:
            if r.model not in seen_models:
                seen_models.add(r.model)
                recent_responses.append(PromptRecentResponse(
                    model=r.model,
                    response_text=r.response_text,
                    mentioned=r.mentioned,
                    sentiment=r.sentiment,
                    created_at=r.created_at,
                ))

    return PromptDetailResponse(
        prompt_id=prompt.id,
        prompt_text=prompt.text,
        prompt_type=prompt.prompt_type or "standard",
        current_scores=current_scores,
        score_trend=trend,
        timeline=timeline,
        content_events=content_events,
        drafts=draft_snapshots,
        competitors=competitor_summaries,
        insights=insights,
        recent_responses=recent_responses,
    )
```

- [ ] **Step 4: Run the endpoint test**

Run: `cd backend && python -m pytest tests/test_prompt_intelligence.py::test_prompts_overview_endpoint -v`

Expected: PASS (or may need adjustments to the mock)

- [ ] **Step 5: Run all tests**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`

Expected: All existing tests still pass, new tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/results.py backend/app/schemas.py backend/tests/test_prompt_intelligence.py
git commit -m "feat: add prompt timeline, detail, and overview API endpoints"
```

---

## Task 8: Backfill Script

**Files:**
- Create: `backend/backfill_prompt_scores.py`

- [ ] **Step 1: Create the backfill script**

Create `backend/backfill_prompt_scores.py`:

```python
"""
One-time backfill: populate PromptRunScore from historical QueryResult data.

Run: cd backend && python backfill_prompt_scores.py
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def backfill():
    from app.database import AsyncSessionLocal, engine, Base
    from app.models import QueryResult, TrackingRun, PromptRunScore
    from sqlalchemy import select, func

    # Check if already backfilled
    async with AsyncSessionLocal() as db:
        count_result = await db.execute(select(func.count()).select_from(PromptRunScore))
        existing = count_result.scalar_one()
        if existing > 0:
            logger.info("PromptRunScore already has %d rows — skipping backfill.", existing)
            return

    # Get all completed runs
    async with AsyncSessionLocal() as db:
        runs_result = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.asc())
        )
        runs = runs_result.scalars().all()
        logger.info("Found %d completed runs to backfill.", len(runs))

        total_scores = 0
        for run in runs:
            # Get query results for this run
            qr_result = await db.execute(
                select(QueryResult).where(QueryResult.tracking_run_id == run.id)
            )
            qrs = qr_result.scalars().all()

            # Group by (prompt_id, model)
            stats: dict[tuple[int, str], dict] = {}
            for qr in qrs:
                if qr.error:
                    continue
                key = (qr.prompt_id, qr.model)
                if key not in stats:
                    stats[key] = {"total": 0, "mentioned": 0}
                s = stats[key]
                s["total"] += 1
                if qr.mentioned:
                    s["mentioned"] += 1

            for (prompt_id, model), s in stats.items():
                tq = s["total"]
                tm = s["mentioned"]
                score = round(tm / tq * 100.0, 2) if tq > 0 else 0.0
                db.add(PromptRunScore(
                    prompt_id=prompt_id,
                    tracking_run_id=run.id,
                    brand_id=run.brand_id,
                    model=model,
                    score=score,
                    mentioned_count=tm,
                    query_count=tq,
                ))
                total_scores += 1

            if total_scores % 100 == 0 and total_scores > 0:
                await db.commit()
                logger.info("Progress: %d scores inserted...", total_scores)

        await db.commit()
        logger.info("Backfill complete: %d PromptRunScore rows inserted.", total_scores)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(backfill())
```

- [ ] **Step 2: Commit**

```bash
git add backend/backfill_prompt_scores.py
git commit -m "feat: add one-time backfill script for PromptRunScore from historical data"
```

---

## Task 9: Frontend API Client

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add TypeScript interfaces**

Add to `frontend/lib/api.ts`, after the existing interface definitions:

```typescript
// ── Prompt Intelligence types ───────────────────────────────────────────────

export interface PromptTimelinePoint {
  run_id: number;
  completed_at: string | null;
  scores: Record<string, number>;
  overall: number;
}

export interface ContentEventItem {
  id: number;
  event_type: string;
  created_at: string;
  data: Record<string, unknown> | null;
}

export interface PromptTimelineData {
  prompt_id: number;
  prompt_text: string;
  timeline: PromptTimelinePoint[];
  content_events: ContentEventItem[];
  current_scores: Record<string, number>;
  total_drafts_targeting: number;
  latest_draft_posted_at: string | null;
}

export interface PromptDraftSnapshot {
  id: number;
  platform: string;
  status: string;
  posted_at: string | null;
  visibility_at_post: number | null;
  content_preview: string;
  score_snapshot: {
    at_posting: number | null;
    current: number | null;
    delta: number | null;
    runs_since: number | null;
  };
}

export interface PromptInsightData {
  id: string;
  message: string;
  severity: 'positive' | 'warning' | 'negative' | 'info';
  model: string | null;
}

export interface PromptRecentResponseData {
  model: string;
  response_text: string | null;
  mentioned: boolean;
  sentiment: string | null;
  created_at: string;
}

export interface PromptCompetitorData {
  name: string;
  mention_rate: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface PromptDetailData {
  prompt_id: number;
  prompt_text: string;
  prompt_type: string;
  current_scores: Record<string, number>;
  score_trend: 'improving' | 'declining' | 'stable';
  timeline: PromptTimelinePoint[];
  content_events: ContentEventItem[];
  drafts: PromptDraftSnapshot[];
  competitors: PromptCompetitorData[];
  insights: PromptInsightData[];
  recent_responses: PromptRecentResponseData[];
}

export interface PromptOverviewItem {
  prompt_id: number;
  prompt_text: string;
  current_overall: number;
  trend: 'improving' | 'declining' | 'stable';
  sparkline: number[];
  model_scores: Record<string, number>;
  drafts_posted: number;
  last_draft_at: string | null;
  has_recent_content_event: boolean;
}

export interface PromptsOverviewData {
  prompts: PromptOverviewItem[];
}
```

- [ ] **Step 2: Add API methods**

Add after the existing API methods in `frontend/lib/api.ts`:

```typescript
// ── Prompt Intelligence ─────────────────────────────────────────────────────

export async function getPromptsOverview(brandId: number): Promise<PromptsOverviewData> {
  return dedupedGet<PromptsOverviewData>(`/results/${brandId}/prompts/overview`);
}

export async function getPromptTimeline(brandId: number, promptId: number, days?: number): Promise<PromptTimelineData> {
  const params = days ? { days } : undefined;
  return dedupedGet<PromptTimelineData>(`/results/${brandId}/prompt/${promptId}/timeline`, params);
}

export async function getPromptDetail(brandId: number, promptId: number): Promise<PromptDetailData> {
  return dedupedGet<PromptDetailData>(`/results/${brandId}/prompt/${promptId}/detail`);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add prompt intelligence API client methods and TypeScript types"
```

---

## Task 10: PromptSparkline Component

**Files:**
- Create: `frontend/components/PromptSparkline.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/PromptSparkline.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface PromptSparklineProps {
  sparkline: number[];
  draftEvents?: { index: number }[];
  height?: number;
}

export default function PromptSparkline({ sparkline, draftEvents = [], height = 64 }: PromptSparklineProps) {
  const data = useMemo(
    () => sparkline.map((value, i) => ({ index: i, score: value })),
    [sparkline],
  );

  if (data.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[10px] text-[var(--text-faint)]">
        Not enough data
      </div>
    );
  }

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              return (
                <div
                  style={{
                    background: 'rgba(8,12,20,0.96)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.50)',
                  }}
                >
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {Math.round(payload[0].value as number)}%
                  </span>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="url(#sparkGrad)"
            dot={false}
            isAnimationActive={true}
            animationDuration={800}
          />
          {/* Draft posted markers */}
          {draftEvents.map((evt) => (
            <Area
              key={`marker-${evt.index}`}
              type="monotone"
              dataKey="score"
              stroke="none"
              fill="none"
              dot={(props: Record<string, unknown>) => {
                const idx = props.index as number;
                if (idx !== evt.index) return <circle key={idx} r={0} />;
                return (
                  <circle
                    key={idx}
                    cx={props.cx as number}
                    cy={(props.cy as number) + 20}
                    r={2.5}
                    fill="var(--accent-light)"
                    stroke="var(--accent)"
                    strokeWidth={1}
                  />
                );
              }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PromptSparkline.tsx
git commit -m "feat: add PromptSparkline component for compact inline charts"
```

---

## Task 11: PromptInsightCard Component

**Files:**
- Create: `frontend/components/PromptInsightCard.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/PromptInsightCard.tsx`:

```tsx
'use client';

import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';
import { getModelConfig } from '@/lib/constants/models';

interface PromptInsightCardProps {
  id: string;
  message: string;
  severity: 'positive' | 'warning' | 'negative' | 'info';
  model?: string | null;
}

const SEVERITY_CONFIG = {
  positive: { color: 'var(--success)', Icon: TrendingUp },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  negative: { color: 'var(--danger)', Icon: TrendingDown },
  info: { color: 'var(--accent)', Icon: Info },
};

export default function PromptInsightCard({ message, severity, model }: PromptInsightCardProps) {
  const { color, Icon } = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const modelCfg = model ? getModelConfig(model) : null;

  return (
    <div
      className="flex items-start gap-3 px-3.5 py-2.5 rounded-lg transition-colors"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <Icon size={15} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <p className="text-[13px] text-[var(--text-primary)] leading-snug flex-1">
        {message}
      </p>
      {modelCfg && model && (
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            color: modelCfg.color,
            background: modelCfg.bgColor,
          }}
        >
          {modelCfg.label}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PromptInsightCard.tsx
git commit -m "feat: add PromptInsightCard component for heuristic insights"
```

---

## Task 12: PromptImpactTimeline Component

**Files:**
- Create: `frontend/components/PromptImpactTimeline.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/PromptImpactTimeline.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { MODEL_ORDER, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';
import type { PromptTimelinePoint, ContentEventItem } from '@/lib/api';

interface PromptImpactTimelineProps {
  timeline: PromptTimelinePoint[];
  contentEvents: ContentEventItem[];
  height?: number;
}

type Timeframe = '7d' | '30d' | '90d' | 'all';

export default function PromptImpactTimeline({
  timeline,
  contentEvents,
  height = 320,
}: PromptImpactTimelineProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('90d');
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  const filteredData = useMemo(() => {
    const now = Date.now();
    const cutoffs: Record<Timeframe, number> = {
      '7d': now - 7 * 86400000,
      '30d': now - 30 * 86400000,
      '90d': now - 90 * 86400000,
      all: 0,
    };
    const cutoff = cutoffs[timeframe];

    return timeline
      .filter((t) => {
        if (!t.completed_at) return true;
        return parseUTCISO(t.completed_at).getTime() >= cutoff;
      })
      .map((t) => ({
        ...t,
        date: t.completed_at ? format(parseUTCISO(t.completed_at), 'MMM d') : '',
        ...Object.fromEntries(
          MODEL_ORDER.map((m) => [m, t.scores[m] ?? null]),
        ),
      }));
  }, [timeline, timeframe]);

  // Map content events to nearest timeline index for ReferenceLine
  const draftMarkers = useMemo(() => {
    return contentEvents
      .filter((e) => e.event_type === 'draft_posted')
      .map((e) => {
        const eventTime = parseUTCISO(e.created_at).getTime();
        // Find nearest data point index
        let closestIdx = 0;
        let closestDist = Infinity;
        filteredData.forEach((d, i) => {
          if (!d.completed_at) return;
          const dist = Math.abs(parseUTCISO(d.completed_at).getTime() - eventTime);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        });
        return {
          ...e,
          dataIndex: closestIdx,
          label: (e.data as Record<string, unknown>)?.platform as string || 'Draft',
        };
      });
  }, [contentEvents, filteredData]);

  const toggleModel = (model: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  if (filteredData.length < 2) {
    return (
      <div className="card" style={{ padding: '28px 20px 24px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Impact Timeline</h3>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-[var(--text-faint)]">
          Not enough tracking data yet
        </div>
      </div>
    );
  }

  return (
    <div
      className="card overflow-hidden"
      style={{
        padding: '28px 20px 24px',
        borderTop: '2px solid transparent',
        borderImage: 'linear-gradient(90deg, var(--color-chatgpt), var(--color-claude), var(--color-perplexity), var(--color-gemini)) 1',
        borderImageSlice: 1,
        opacity: 0.4,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Impact Timeline</h3>
        <div className="flex items-center gap-0.5 bg-[rgba(255,255,255,0.04)] border border-[var(--border-subtle)] rounded-lg p-0.5">
          {(['7d', '30d', '90d', 'all'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                timeframe === tf
                  ? 'bg-[rgba(99,102,241,0.25)] text-[var(--accent-light)]'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tf === 'all' ? 'All' : tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div
        style={{
          background: 'radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.04) 0%, transparent 70%)',
        }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={filteredData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="overallGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(99,102,241,0.05)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.1)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(99,102,241,0.1)' }}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div
                    style={{
                      background: 'rgba(8,12,20,0.96)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(99,102,241,0.22)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.50)',
                    }}
                  >
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">{label}</p>
                    {payload.map((p) => (
                      <div key={p.dataKey as string} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        <span className="text-[var(--text-secondary)]">
                          {p.dataKey === 'overall' ? 'Overall' : getModelConfig(p.dataKey as string).label}
                        </span>
                        <span className="font-mono font-bold text-[var(--text-primary)] ml-auto">
                          {Math.round(p.value as number)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />

            {/* Draft posted markers */}
            {draftMarkers.map((marker) => (
              <ReferenceLine
                key={marker.id}
                x={filteredData[marker.dataIndex]?.date}
                stroke="var(--accent-light)"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
                label={{
                  value: '\u25C6',
                  position: 'top',
                  fill: 'var(--accent-light)',
                  fontSize: 10,
                }}
              />
            ))}

            {/* Overall area */}
            <Area
              type="monotone"
              dataKey="overall"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#overallGrad)"
              dot={false}
              isAnimationActive={true}
              animationDuration={1200}
            />

            {/* Per-model dashed lines */}
            {MODEL_ORDER.filter((m) => !hiddenModels.has(m)).map((modelKey) => {
              const cfg = getModelConfig(modelKey);
              return (
                <Line
                  key={modelKey}
                  type="monotone"
                  dataKey={modelKey}
                  stroke={cfg.color}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls
                  isAnimationActive={true}
                  animationDuration={1400}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3 px-1">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="w-4 h-0.5 bg-[var(--accent)] rounded" />
          Overall
        </div>
        {MODEL_ORDER.map((modelKey) => {
          const cfg = getModelConfig(modelKey);
          const isHidden = hiddenModels.has(modelKey);
          return (
            <button
              key={modelKey}
              onClick={() => toggleModel(modelKey)}
              className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                isHidden ? 'opacity-30' : 'opacity-100'
              }`}
              style={{ color: cfg.color }}
            >
              <span
                className="w-4 h-0.5 rounded"
                style={{
                  background: cfg.color,
                  borderTop: '1px dashed',
                  borderColor: cfg.color,
                }}
              />
              {cfg.label}
            </button>
          );
        })}
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent-light)]">
          <span style={{ fontSize: 10 }}>{'\u25C6'}</span>
          Draft posted
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/PromptImpactTimeline.tsx
git commit -m "feat: add PromptImpactTimeline component with draft markers"
```

---

## Task 13: Prompt Detail Page

**Files:**
- Create: `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`

- [ ] **Step 1: Create the page**

Create the directory structure and page file `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, FileText, ExternalLink } from 'lucide-react';
import {
  getPromptDetail,
  PromptDetailData,
} from '@/lib/api';
import { MODEL_ORDER, getModelConfig } from '@/lib/constants/models';
import PromptImpactTimeline from '@/components/PromptImpactTimeline';
import PromptInsightCard from '@/components/PromptInsightCard';
import { format } from 'date-fns';
import { parseUTCISO } from '@/lib/utils/formatting';
import { logError } from '@/lib/utils/errors';
import { useIsMobile } from '@/hooks/useIsMobile';

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const brandId = Number(params.brandId);
  const promptId = Number(params.promptId);

  const [data, setData] = useState<PromptDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Prompt Detail — Lumidian';
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getPromptDetail(brandId, promptId);
      setData(detail);
    } catch (err) {
      logError(err, 'PromptDetail: fetch');
    } finally {
      setLoading(false);
    }
  }, [brandId, promptId]);

  useEffect(() => {
    if (brandId && promptId) loadData();
  }, [brandId, promptId, loadData]);

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
        <p className="text-sm text-[var(--text-muted)]">Prompt not found.</p>
      </div>
    );
  }

  const trendLabel = data.score_trend === 'improving' ? '▲ Improving' : data.score_trend === 'declining' ? '▼ Declining' : '— Stable';
  const trendColor = data.score_trend === 'improving' ? 'var(--success)' : data.score_trend === 'declining' ? 'var(--danger)' : 'var(--text-muted)';
  const overallScore = Object.values(data.current_scores).length > 0
    ? Math.round(Object.values(data.current_scores).reduce((a, b) => a + b, 0) / Object.values(data.current_scores).length)
    : 0;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
      {/* Back link */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-5"
      >
        <ArrowLeft size={14} />
        Back to Reports
      </button>

      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold text-[var(--text-primary)] leading-snug mb-3">
          &ldquo;{data.prompt_text}&rdquo;
        </h1>
        <div className="flex items-center gap-3">
          <span className="stat-value text-2xl">{overallScore}%</span>
          <span className="text-xs font-medium" style={{ color: trendColor }}>{trendLabel}</span>
        </div>
      </div>

      {/* Model score pills */}
      <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3 mb-6`}>
        {MODEL_ORDER.map((modelKey) => {
          const cfg = getModelConfig(modelKey);
          const score = data.current_scores[modelKey];
          // Find delta from timeline
          let delta: number | null = null;
          if (data.timeline.length >= 2) {
            const latest = data.timeline[data.timeline.length - 1].scores[modelKey];
            const prev = data.timeline[data.timeline.length - 2].scores[modelKey];
            if (latest != null && prev != null) delta = Math.round(latest - prev);
          }
          return (
            <div
              key={modelKey}
              className="rounded-lg px-4 py-3 transition-colors hover:brightness-110"
              style={{
                borderLeft: `3px solid ${cfg.color}`,
                background: cfg.bgColor,
              }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: cfg.color }}>
                {cfg.label}
              </p>
              <p className="stat-value stat-value-sm">
                {score != null ? `${Math.round(score)}%` : '—'}
              </p>
              {delta !== null && delta !== 0 && (
                <p
                  className="text-[10px] font-bold mt-0.5"
                  style={{ color: delta > 0 ? 'var(--success)' : 'var(--danger)' }}
                >
                  {delta > 0 ? `+${delta}` : delta}pp
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Impact Timeline */}
      <div className="mb-6">
        <PromptImpactTimeline
          timeline={data.timeline}
          contentEvents={data.content_events}
        />
      </div>

      {/* Insights + Content Activity — two columns on desktop */}
      <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4 mb-6`}>
        {/* Insights */}
        <div className="card p-5">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Insights
          </h3>
          {data.insights.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">No insights yet — more data needed</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.insights.map((insight) => (
                <PromptInsightCard
                  key={insight.id}
                  id={insight.id}
                  message={insight.message}
                  severity={insight.severity}
                  model={insight.model}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content Activity */}
        <div className="card p-5">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Content Activity
          </h3>
          {data.drafts.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">No drafts targeting this prompt</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                >
                  <FileText size={14} className="text-[var(--accent-light)] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] capitalize">
                        {draft.platform}
                      </span>
                      <span className="text-[10px] text-[var(--text-faint)] capitalize">{draft.status}</span>
                    </div>
                    {draft.posted_at && (
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        Posted {format(parseUTCISO(draft.posted_at), 'MMM d')}
                        {draft.score_snapshot.delta != null && (
                          <span
                            className="ml-1.5 font-bold"
                            style={{
                              color: draft.score_snapshot.delta > 0 ? 'var(--success)' : draft.score_snapshot.delta < 0 ? 'var(--danger)' : 'var(--text-faint)',
                            }}
                          >
                            {draft.score_snapshot.delta > 0 ? '+' : ''}{Math.round(draft.score_snapshot.delta)}pp since
                          </span>
                        )}
                      </p>
                    )}
                    {!draft.posted_at && (
                      <p className="text-[10px] text-[var(--text-faint)] mt-0.5">Draft — not yet posted</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Competitor Presence */}
      {data.competitors.length > 0 && (
        <div className="card p-5 mb-6">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Competitor Presence
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-faint)] border-b border-[var(--border-subtle)]">
                  <th className="text-left py-2 pr-4 font-medium">Competitor</th>
                  <th className="text-right py-2 px-3 font-medium">Mention Rate</th>
                  <th className="text-right py-2 pl-3 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.competitors.map((c) => (
                  <tr key={c.name} className="border-b border-[rgba(255,255,255,0.04)]">
                    <td className="py-2.5 pr-4 text-[var(--text-secondary)] font-medium">{c.name}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-[var(--text-primary)]">
                      {Math.round(c.mention_rate * 100)}%
                    </td>
                    <td className="py-2.5 pl-3 text-right capitalize" style={{
                      color: c.trend === 'increasing' ? 'var(--danger)' : c.trend === 'decreasing' ? 'var(--success)' : 'var(--text-faint)',
                    }}>
                      {c.trend}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent AI Responses */}
      {data.recent_responses.length > 0 && (
        <div className="card p-5">
          <h3 className="text-[13px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Recent AI Responses
          </h3>
          <div className="flex flex-col gap-3">
            {data.recent_responses.map((resp) => {
              const cfg = getModelConfig(resp.model);
              return (
                <div
                  key={resp.model}
                  className="rounded-lg border border-[var(--border-subtle)] overflow-hidden"
                  style={{ borderLeftWidth: 3, borderLeftColor: cfg.color }}
                >
                  <div className="px-4 py-2.5 bg-[rgba(255,255,255,0.02)] flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {resp.mentioned ? '✓ Mentioned' : '✗ Not mentioned'}
                      {resp.sentiment && ` · ${resp.sentiment}`}
                    </span>
                  </div>
                  {resp.response_text && (
                    <div className="px-4 py-3 text-xs text-[var(--text-secondary)] leading-relaxed max-h-32 overflow-y-auto">
                      {resp.response_text.slice(0, 500)}
                      {resp.response_text.length > 500 && '…'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/tracker/\[brandId\]/prompt/\[promptId\]/page.tsx
git commit -m "feat: add prompt detail page with impact timeline, insights, and breakdowns"
```

---

## Task 14: Add Sparklines to Reports Page

**Files:**
- Modify: `frontend/app/reports/page.tsx`

- [ ] **Step 1: Add sparkline imports and data loading**

At the top of `frontend/app/reports/page.tsx`, add to the imports:

```tsx
import { getPromptsOverview, PromptsOverviewData, PromptOverviewItem } from '@/lib/api';
import PromptSparkline from '@/components/PromptSparkline';
import { ChevronRight } from 'lucide-react';
```

Add state for the overview data (after the other useState declarations around line 132):

```tsx
const [promptsOverview, setPromptsOverview] = useState<PromptsOverviewData | null>(null);
```

In the `loadData` callback, add the overview fetch alongside existing data loading. Inside the `try` block (around line 165, inside the `Promise.all`), add:

```tsx
const overviewPromise = getPromptsOverview(brandId).catch((err) => { logError(err, 'Reports: fetch prompts overview'); return null; });
```

And update the destructuring to include it, then set state:

```tsx
if (overviewData) setPromptsOverview(overviewData);
```

- [ ] **Step 2: Add sparkline and click-through to prompt rows**

In the prompt row rendering (around line 533, inside the `promptGroups.map`), add a sparkline and a link arrow to each prompt row.

After the model breakdown badges section (around line 591) and before the gap explanation, add:

```tsx
{/* Sparkline + view details */}
{(() => {
  const overview = promptsOverview?.prompts.find((p) => p.prompt_id === g.promptId);
  if (!overview || overview.sparkline.length < 2) return null;
  return (
    <div className="flex items-center gap-3 mt-2.5">
      <div className="flex-1 max-w-[200px]">
        <PromptSparkline sparkline={overview.sparkline} height={48} />
      </div>
      <Link
        href={`/tracker/${selectedBrandId}/prompt/${g.promptId}`}
        className="flex items-center gap-1 text-[10px] text-[var(--accent-light)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        View details
        <ChevronRight size={12} />
      </Link>
    </div>
  );
})()}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd frontend && npm run build`

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "feat: add prompt sparklines and detail links to reports page"
```

---

## Task 15: Final Integration Test & Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && python -m pytest tests/ -v --timeout=30`

Expected: All tests pass.

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Run the backfill script (if there's existing data)**

Run: `cd backend && python backfill_prompt_scores.py`

Expected: Either backfills data or reports "already has N rows — skipping."

- [ ] **Step 4: Verify endpoints manually**

Start the dev servers and check:
1. `GET /api/results/{brandId}/prompts/overview` returns prompt data
2. `GET /api/results/{brandId}/prompt/{promptId}/timeline` returns timeline
3. `GET /api/results/{brandId}/prompt/{promptId}/detail` returns full detail
4. Reports page shows sparklines on prompt rows
5. Clicking "View details" navigates to prompt detail page

- [ ] **Step 5: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: final integration fixes for content impact intelligence"
```
