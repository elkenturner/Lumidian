# Resilient Tracking Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tracking runs persist results incrementally and survive a mid-run backend restart, so a long Pro run (4 models, many prompts) never loses all its data and a killed run still surfaces whatever it completed.

**Architecture:** Three changes to the backend tracking flow, all behavior-preserving on the happy path:
1. Extract a single reusable `finalize_run(run_id)` that computes scores from the **persisted** `QueryResult` rows in the DB and marks the run `completed` (idempotent).
2. Replace the monolithic "gather all queries → bulk insert at the end" loop in `run_tracking` with **per-prompt** execution that commits each prompt's `QueryResult` rows as that prompt finishes, then calls `finalize_run`.
3. Make startup cleanup (`cleanup_stale_runs`) **finalize** a stale `running` run that has partial results (→ `completed`) instead of nuking it to `failed`; only truly empty runs become `failed`.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, SQLite + aiosqlite, pytest (`asyncio_mode=auto`).

## Global Constraints

- All DB access is async via `AsyncSessionLocal` (`async_sessionmaker`, `expire_on_commit=False`). Never use sync SQLAlchemy.
- `AsyncSessionLocal` has `expire_on_commit=False` — committed ORM instances keep their loaded attribute values after the session closes (post-processing relies on this).
- Multi-tenancy: never widen a query past `brand_id` / `tracking_run_id` scoping.
- No new dependencies. No Alembic — schema is unchanged (no new columns).
- Tests use isolated SQLite; tables are truncated (not dropped) between tests by the autouse fixture in `tests/conftest.py`. Run all commands from `backend/` with the venv active.
- Preserve existing behavior on full completion: a run that finishes all queries must produce the **same** `RunModelScore`, `overall_score`, `total_queries`, `total_mentions`, and `PromptRunScore` rows as today.

---

## File Structure

- `backend/app/services/tracking_service.py` — owns `run_tracking` (the run loop), `_compute_overall_score`, `_persist_prompt_run_scores`. Add `finalize_run`; refactor the run loop. This is the core change.
- `backend/app/database.py` — owns `cleanup_stale_runs` (startup) and `fail_stale_runs_for_brand` (inline). Change `cleanup_stale_runs` to finalize-or-fail.
- `backend/tests/test_tracking_resilience.py` — **new** test module for the three behaviors (kept separate from `test_tracking.py` to avoid merge friction).

Current key line references (verify before editing — file may have shifted):
- `tracking_service.py:283-293` — `QueryResult(...)` construction inside `_bounded_query`.
- `tracking_service.py:295-303` — matrix `tasks = [...]` then `query_results = await asyncio.gather(*tasks)`.
- `tracking_service.py:322-405` — persist + score + mark completed (the block to refactor).
- `tracking_service.py:331-361` — per-model `model_stats` aggregation + `RunModelScore` creation (logic to move into `finalize_run`).
- `tracking_service.py:172-186` — `_compute_overall_score` (reuse as-is).
- `tracking_service.py:88-126` — `_persist_prompt_run_scores` (reuse as-is).
- `database.py:761-792` — `cleanup_stale_runs` (the function to change).

---

### Task 1: Extract `finalize_run(run_id)` and route the happy path through it

Pure refactor — no behavior change. `finalize_run` reads persisted `QueryResult` rows for a run, (re)computes `RunModelScore` + `overall_score` + `PromptRunScore`, and marks the run `completed`. Idempotent so it can be called again by cleanup. The happy-path persist/score block is replaced by: insert results → `finalize_run`.

**Files:**
- Modify: `backend/app/services/tracking_service.py` (add `finalize_run`; rewrite the `# 4 & 5` block at ~322-405 to insert results then call `finalize_run`)
- Test: `backend/tests/test_tracking_resilience.py`

**Interfaces:**
- Produces: `async def finalize_run(run_id: int, *, error_message: str | None = None) -> bool` — returns `True` if the run was finalized as `completed` (had ≥1 `QueryResult`), `False` if it had zero results (caller decides whether to mark failed). Computes from DB rows only. Idempotent: deletes existing `RunModelScore` and `PromptRunScore` for `run_id` before re-adding.
- Consumes: existing `_compute_overall_score(model_stats)` and `_persist_prompt_run_scores(db, run_id, brand_id, query_results)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_tracking_resilience.py
import pytest
from app.database import AsyncSessionLocal
from app.models import Brand, Prompt, QueryResult, RunModelScore, TrackingRun, User
from app.services.tracking_service import finalize_run


async def _seed_run_with_results(mentioned_pattern: list[bool], model: str = "gemini") -> tuple[int, int]:
    """Create a user→brand→prompt→running-run with one QueryResult per bool. Returns (run_id, brand_id)."""
    async with AsyncSessionLocal() as db:
        user = User(email="fin@example.com", password_hash="x", subscription_tier="pro",
                    subscription_status="active", email_verified=True)
        db.add(user); await db.flush()
        brand = Brand(name="Fin Brand", slug="fin-brand", user_id=user.id, brand_type="pro")
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        run = TrackingRun(brand_id=brand.id, status="running", run_type="manual")
        db.add(run); await db.flush()
        for i, m in enumerate(mentioned_pattern, start=1):
            db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model=model,
                               run_number=i, response_text="...", mentioned=m, error=None))
        await db.commit()
        return run.id, brand.id


async def test_finalize_run_computes_scores_and_completes():
    run_id, _ = await _seed_run_with_results([True, True, False])  # 2/3 = 66.67%
    ok = await finalize_run(run_id)
    assert ok is True
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        assert run.status == "completed"
        assert run.completed_at is not None
        assert run.total_queries == 3
        assert run.total_mentions == 2
        assert run.overall_score == 66.67
        scores = (await db.execute(
            __import__("sqlalchemy").select(RunModelScore).where(RunModelScore.tracking_run_id == run_id)
        )).scalars().all()
        assert len(scores) == 1 and scores[0].score == 66.67


async def test_finalize_run_is_idempotent():
    run_id, _ = await _seed_run_with_results([True, False])
    await finalize_run(run_id)
    await finalize_run(run_id)  # second call must not duplicate RunModelScore rows
    async with AsyncSessionLocal() as db:
        scores = (await db.execute(
            __import__("sqlalchemy").select(RunModelScore).where(RunModelScore.tracking_run_id == run_id)
        )).scalars().all()
        assert len(scores) == 1


async def test_finalize_run_returns_false_for_empty_run():
    async with AsyncSessionLocal() as db:
        brand = Brand(name="Empty", slug="empty", brand_type="pro")
        db.add(brand); await db.flush()
        run = TrackingRun(brand_id=brand.id, status="running", run_type="manual")
        db.add(run); await db.commit()
        run_id = run.id
    ok = await finalize_run(run_id)
    assert ok is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py -v`
Expected: FAIL with `ImportError: cannot import name 'finalize_run'`.

- [ ] **Step 3: Implement `finalize_run`**

Add to `backend/app/services/tracking_service.py` (after `_compute_overall_score`, before `run_tracking`). Uses only persisted rows.

```python
async def finalize_run(run_id: int, *, error_message: str | None = None) -> bool:
    """Compute scores from the persisted QueryResult rows for run_id, write
    RunModelScore + PromptRunScore, and mark the run completed.

    Reads from the DB (not an in-memory list) so it works both for a normal
    finish and for a partially-completed run recovered after a restart.
    Idempotent: clears any existing RunModelScore/PromptRunScore for the run
    before re-adding. Returns True if finalized as completed (>=1 result),
    False if the run had zero results (caller decides how to handle).
    """
    from sqlalchemy import delete
    from app.models import PromptRunScore

    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        if run is None:
            return False

        qr_rows = (await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == run_id)
        )).scalars().all()

        if not qr_rows:
            return False

        # Idempotency: remove prior score rows for this run before recomputing.
        await db.execute(delete(RunModelScore).where(RunModelScore.tracking_run_id == run_id))
        await db.execute(delete(PromptRunScore).where(PromptRunScore.tracking_run_id == run_id))

        model_stats: dict[str, dict] = {}
        for qr in qr_rows:
            if qr.error:
                continue
            stats = model_stats.setdefault(qr.model, {"total_queries": 0, "total_mentions": 0})
            stats["total_queries"] += 1
            if qr.mentioned:
                stats["total_mentions"] += 1

        overall_queries = 0
        overall_mentions = 0
        for model_name, stats in model_stats.items():
            tq = stats["total_queries"]
            tm = stats["total_mentions"]
            score = (tm / tq * 100.0) if tq > 0 else 0.0
            db.add(RunModelScore(
                tracking_run_id=run_id, model=model_name,
                total_queries=tq, total_mentions=tm, score=round(score, 2),
            ))
            overall_queries += tq
            overall_mentions += tm

        overall_score = _compute_overall_score(model_stats)

        run.status = "completed"
        run.completed_at = _utcnow()
        run.overall_score = round(overall_score, 2)
        run.total_queries = overall_queries
        run.total_mentions = overall_mentions
        if error_message:
            run.error_message = error_message

        await _persist_prompt_run_scores(db, run_id, run.brand_id, qr_rows)
        await db.commit()

    logger.info("finalize_run %d: completed score=%.2f%% (%d/%d)",
                run_id, overall_score, overall_mentions, overall_queries)
    return True
```

- [ ] **Step 4: Route the happy path through `finalize_run`**

In `run_tracking`, replace the body of the `# ── 4 & 5 ──` block (currently `tracking_service.py:322-405`) so it **inserts** the gathered results, commits, then calls `finalize_run`. Keep the existing `except` cleanup that marks the run failed on DB error. The matrix `gather` at 295-303 stays for now (Task 2 changes it).

```python
    # ── 4 & 5. Persist results and compute scores ────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            for qr in query_results:
                db.add(qr)
            await db.commit()
    except Exception as exc:
        logger.exception("Error persisting results for run %d", run_id)
        try:
            async with AsyncSessionLocal() as err_db:
                run = await err_db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = f"DB error: {exc}"
                    run.completed_at = _utcnow()
                    await err_db.commit()
        except Exception as inner_exc:
            logger.critical(
                "CRITICAL: Failed to mark run %d as failed — run may be stuck. "
                "Original: %s, Cleanup: %s", run_id, exc, inner_exc,
            )
        raise

    await finalize_run(run_id)
```

- [ ] **Step 5: Run the resilience tests + existing tracking tests**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py tests/test_tracking.py -v`
Expected: all PASS (new finalize tests pass; existing tracking tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/tracking_service.py backend/tests/test_tracking_resilience.py
git commit -m "refactor(tracking): extract idempotent finalize_run from persist block"
```

---

### Task 2: Incremental per-prompt persistence in `run_tracking`

Replace the single all-prompts `gather` + single bulk insert with one task per prompt. Each prompt task runs its `model × run_number` queries, commits **its own** `QueryResult` rows, and returns them. Results accumulate into `query_results` for the unchanged post-processing. A failing prompt no longer discards the others.

**Files:**
- Modify: `backend/app/services/tracking_service.py` (replace matrix build `295-303` and the insert in the `# 4 & 5` block from Task 1)
- Test: `backend/tests/test_tracking_resilience.py`

**Interfaces:**
- Consumes: `_bounded_query(prompt_id, prompt_text, model, run_number) -> QueryResult` (unchanged), `finalize_run` (Task 1).
- Produces: `query_results: list[QueryResult]` accumulated across prompt tasks, then `finalize_run(run_id)`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/tests/test_tracking_resilience.py
from unittest.mock import patch
from app.services.tracking_service import run_tracking


async def _make_pro_brand_with_prompts(n_prompts: int) -> int:
    async with AsyncSessionLocal() as db:
        user = User(email="inc@example.com", password_hash="x", subscription_tier="pro",
                    subscription_status="active", email_verified=True)
        db.add(user); await db.flush()
        brand = Brand(name="Inc Brand", slug="inc-brand", user_id=user.id, brand_type="pro")
        db.add(brand); await db.flush()
        for i in range(n_prompts):
            db.add(Prompt(brand_id=brand.id, text=f"prompt {i}", prompt_type="standard"))
        await db.commit()
        return brand.id


async def test_incremental_persistence_survives_one_prompt_failure():
    """If every query for one prompt raises, the other prompts' results still persist."""
    brand_id = await _make_pro_brand_with_prompts(3)

    async def fake_query_model(model, prompt_text, brand_name, **kwargs):
        if "prompt 1" in prompt_text:
            raise RuntimeError("simulated provider blowup")
        return {"response_text": f"{brand_name} is great", "error": None, "latency_ms": 5, "citations": None}

    with patch("app.services.tracking_service.query_model", side_effect=fake_query_model):
        await run_tracking(brand_id, run_type="manual")

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as _select
        prompts = (await db.execute(_select(Prompt).where(Prompt.brand_id == brand_id))).scalars().all()
        pid_by_text = {p.text: p.id for p in prompts}
        rows = (await db.execute(_select(QueryResult))).scalars().all()
        persisted_pids = {r.prompt_id for r in rows}
        # prompt 0 and prompt 2 persisted; prompt 1 (failed) did not lose 0 and 2
        assert pid_by_text["prompt 0"] in persisted_pids
        assert pid_by_text["prompt 2"] in persisted_pids
        # the run still finalized as completed with the surviving data
        run = (await db.execute(_select(TrackingRun).where(TrackingRun.brand_id == brand_id))).scalars().first()
        assert run.status == "completed"
        assert run.total_queries > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py::test_incremental_persistence_survives_one_prompt_failure -v`
Expected: FAIL — with the current monolithic `gather`, one prompt raising aborts the whole run (`raise` at the gather `except`), so no run is marked `completed`.

- [ ] **Step 3: Implement per-prompt execution**

Replace the matrix build (`tracking_service.py:295-303`) AND the insert step from Task 1's Step 4 with a per-prompt structure. The shared `semaphore` (MAX_CONCURRENT) still caps total query concurrency, so throughput is unchanged.

```python
    async def _run_one_prompt(prompt_id: int, prompt_text: str) -> list[QueryResult]:
        """Execute every model × run_number query for one prompt, then commit
        that prompt's QueryResult rows in their own session. Returns the rows."""
        sub_tasks = [
            _bounded_query(prompt_id, prompt_text, model, run_number)
            for model in active_models
            for run_number in range(1, runs_per_prompt + 1)
        ]
        prompt_results = await asyncio.gather(*sub_tasks)
        async with AsyncSessionLocal() as db:
            for qr in prompt_results:
                db.add(qr)
            await db.commit()  # expire_on_commit=False → qr attrs stay usable below
        return prompt_results

    prompt_tasks = [_run_one_prompt(pid, ptext) for pid, ptext in prompt_data]
    settled = await asyncio.gather(*prompt_tasks, return_exceptions=True)

    query_results: list[QueryResult] = []
    for outcome in settled:
        if isinstance(outcome, Exception):
            logger.warning("[tracking] a prompt failed for run %d (non-fatal): %s", run_id, outcome)
            continue
        query_results.extend(outcome)

    # finalize from whatever persisted; if nothing persisted, mark failed.
    finalized = await finalize_run(run_id)
    if not finalized:
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = "No query results were produced"
                run.completed_at = _utcnow()
                await db.commit()
        return run_id
```

Notes for the implementer:
- DELETE the old matrix `tasks = [...]`, the `query_results = await asyncio.gather(*tasks)` block (old `295-320`), and the Task-1 insert+`finalize_run` block — they are fully replaced by the code above. The post-processing sections (`# 6` sentiment onward) stay unchanged and continue to read the `query_results` list.
- Keep `_bounded_query`, `semaphore`, and `cancel_evt` exactly as they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite (regression gate)**

Run: `cd backend && source venv/bin/activate && pytest tests/ -q`
Expected: all PASS — especially `test_tracking.py`, `test_content.py` (attribution/gaps post-processing read `query_results`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/tracking_service.py backend/tests/test_tracking_resilience.py
git commit -m "feat(tracking): commit query results per-prompt so partial runs survive interruption"
```

---

### Task 3: Restart-safe startup cleanup — finalize partial runs instead of failing them

`cleanup_stale_runs` runs on startup (`main.py:109`). After a restart the in-process run task is gone, so every `running` run is dead. Today it marks them all `failed`, discarding any data. Change it to **finalize** runs that have ≥1 `QueryResult` (→ `completed`, with a note) and only `fail` empty ones.

**Files:**
- Modify: `backend/app/database.py` (`cleanup_stale_runs`, `761-792`)
- Test: `backend/tests/test_tracking_resilience.py`

**Interfaces:**
- Consumes: `app.services.tracking_service.finalize_run` (imported lazily inside the function to avoid a circular import — `tracking_service` imports from `database`).

- [ ] **Step 1: Write the failing test**

```python
# add to backend/tests/test_tracking_resilience.py
from datetime import datetime, timedelta, UTC
from app.database import cleanup_stale_runs


async def test_cleanup_finalizes_partial_run_with_results():
    run_id, _ = await _seed_run_with_results([True, False, True])  # 2/3
    # backdate created_at so it's past the 15-min cutoff
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        run.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=20)
        await db.commit()

    await cleanup_stale_runs()

    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        assert run.status == "completed"        # recovered, not failed
        assert run.total_queries == 3
        assert run.overall_score is not None


async def test_cleanup_fails_empty_stale_run():
    async with AsyncSessionLocal() as db:
        brand = Brand(name="EmptyStale", slug="empty-stale", brand_type="pro")
        db.add(brand); await db.flush()
        run = TrackingRun(brand_id=brand.id, status="running", run_type="manual",
                          created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=20))
        db.add(run); await db.commit()
        run_id = run.id

    await cleanup_stale_runs()

    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        assert run.status == "failed"
        assert "startup cleanup" in (run.error_message or "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py::test_cleanup_finalizes_partial_run_with_results -v`
Expected: FAIL — current `cleanup_stale_runs` marks the partial run `failed`, so `status == "completed"` assertion fails.

- [ ] **Step 3: Implement finalize-or-fail in `cleanup_stale_runs`**

Replace the single bulk `update(...).values(status="failed", ...)` (`database.py:774-792`) with a per-run decision.

```python
async def cleanup_stale_runs(max_age_minutes: int = 15):
    """On startup, resolve tracking runs stuck in pending/running.

    The in-process task is gone after a restart, so these runs are dead. If a
    run already has partial QueryResult rows (incremental persistence), finalize
    it as 'completed' with whatever was gathered; otherwise mark it 'failed'.
    """
    from datetime import datetime, timedelta

    from sqlalchemy import and_, func, select

    from app.models import QueryResult, TrackingRun
    from app.services.tracking_service import finalize_run  # lazy: avoid circular import

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)

    async with AsyncSessionLocal() as db:
        stale = (await db.execute(
            select(TrackingRun.id).where(
                and_(
                    TrackingRun.status.in_(["pending", "running"]),
                    TrackingRun.created_at < cutoff,
                )
            )
        )).scalars().all()

    finalized_ids: list[int] = []
    failed_ids: list[int] = []
    for run_id in stale:
        async with AsyncSessionLocal() as db:
            result_count = (await db.execute(
                select(func.count(QueryResult.id)).where(QueryResult.tracking_run_id == run_id)
            )).scalar_one()

        if result_count > 0:
            ok = await finalize_run(
                run_id,
                error_message="Recovered partial run after restart (startup cleanup)",
            )
            (finalized_ids if ok else failed_ids).append(run_id)
        else:
            async with AsyncSessionLocal() as db:
                run = await db.get(TrackingRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = (
                        f"Auto-failed by startup cleanup: run exceeded {max_age_minutes} "
                        f"minute threshold without completing"
                    )
                    await db.commit()
            failed_ids.append(run_id)

    if finalized_ids or failed_ids:
        logger.info("Startup cleanup: finalized %s, failed %s", finalized_ids, failed_ids)
```

- [ ] **Step 4: Run the cleanup tests to verify they pass**

Run: `cd backend && source venv/bin/activate && pytest tests/test_tracking_resilience.py -v`
Expected: PASS (both cleanup tests + all Task 1/2 tests).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && source venv/bin/activate && pytest tests/ -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/database.py backend/tests/test_tracking_resilience.py
git commit -m "fix(tracking): startup cleanup recovers partial runs instead of failing them"
```

---

### Task 4: Manual verification on a disposable brand (pre-deploy gate)

Before deploying to production, verify locally (or on a staging DB) that a full run still completes correctly end-to-end with mocked-free real providers, and that the score path is intact. No code change.

**Files:** none (verification only).

- [ ] **Step 1:** Start the backend locally per CLAUDE.md (`cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`).
- [ ] **Step 2:** Create a throwaway Free-tier brand with 2 prompts (Free = Perplexity + Gemini, no Claude → fast) and trigger a run via the API.
- [ ] **Step 3:** Poll `GET /api/tracking/run/{run_id}/status` until `completed`; confirm `overall_score`, per-model breakdown, and that `query_results` rows exist. Confirm `RunModelScore` count == model count.
- [ ] **Step 4:** Use `superpowers:verification-before-completion` to record the evidence (status output, row counts) before declaring the fix ready to deploy.

---

## Deploy + RoxStart backfill (post-implementation, separate step)

After all tasks pass and changes are merged to `main` and pushed (Railway auto-deploys on push — see memory `reference_deployment`; remember `git push origin main` has no auto-push hook):

1. Confirm the production backend restarted cleanly (health check green).
2. Re-trigger the RoxStart run: `POST https://api.lumidian.ai/api/tracking/run/10` as `demo+roxstart@lumidian.ai`.
3. The full 4-model run takes ~37 min (Claude-bound). With incremental persistence, partial data is now safe; if a restart truncates it, startup cleanup finalizes the completed portion and a re-trigger fills the rest.
4. Verify `GET /api/results/10/overview` shows a populated score + 4-model breakdown.

---

## Self-Review

**Spec coverage:**
- "Incremental persistence" → Task 2 (per-prompt commit). ✓
- "Restart-safe runs" → Task 3 (finalize partial on startup) + Task 1 (idempotent finalize that recovery depends on). ✓
- "Don't change happy-path scoring" → Task 1 routes the normal finish through the same `finalize_run`; Task 2 keeps the `semaphore` concurrency and the post-processing list. Regression gate = full suite in Task 2/3 Step 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; tests include assertions and exact run commands. ✓

**Type consistency:** `finalize_run(run_id: int, *, error_message: str | None = None) -> bool` is defined in Task 1 and called identically in Task 2 (`finalize_run(run_id)`) and Task 3 (`finalize_run(run_id, error_message=...)`). `_run_one_prompt -> list[QueryResult]`; `settled` items are `list[QueryResult] | Exception`. `_seed_run_with_results -> (run_id, brand_id)` used consistently. ✓

**Risk notes for the executor:**
- Circular import: `tracking_service` imports names from `database`, so Task 3 imports `finalize_run` **lazily inside** `cleanup_stale_runs`. Do not move it to module top.
- SQLite write concurrency: per-prompt commits are sequential per prompt and modest in volume; fine for SQLite. If a future Postgres move happens, revisit.
- `_persist_prompt_run_scores` accepts any iterable of objects with `.prompt_id/.model/.error/.mentioned` — passing DB-loaded `QueryResult` rows in `finalize_run` is compatible with passing the in-memory list today.
