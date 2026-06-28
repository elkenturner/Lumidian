# backend/tests/test_tracking_resilience.py
import pytest
from datetime import datetime, timedelta, UTC
from unittest.mock import patch
from sqlalchemy import select

from app.database import AsyncSessionLocal, cleanup_stale_runs
from app.models import Brand, Prompt, QueryResult, RunModelScore, TrackingRun, User
from app.services.tracking_service import finalize_run, run_tracking


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
            select(RunModelScore).where(RunModelScore.tracking_run_id == run_id)
        )).scalars().all()
        assert len(scores) == 1 and scores[0].score == 66.67


async def test_finalize_run_is_idempotent():
    run_id, _ = await _seed_run_with_results([True, False])
    await finalize_run(run_id)
    await finalize_run(run_id)  # second call must not duplicate RunModelScore rows
    async with AsyncSessionLocal() as db:
        scores = (await db.execute(
            select(RunModelScore).where(RunModelScore.tracking_run_id == run_id)
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


async def test_manual_run_incremental_persistence_survives_one_prompt_failure():
    """_execute_run_with_id (the manual POST /api/tracking/run path, used by
    RoxStart) must also keep completed prompts' data when one prompt fails,
    and finalize the run as completed — not lose everything like the old
    bulk-insert-at-end did."""
    from sqlalchemy import select as _select
    from app.routers.tracking import _execute_run_with_id

    brand_id = await _make_pro_brand_with_prompts(3)
    async with AsyncSessionLocal() as db:
        run = TrackingRun(brand_id=brand_id, status="running", run_type="manual")
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    async def fake_query_model(model, prompt_text, brand_name, **kwargs):
        if "prompt 1" in prompt_text:
            raise RuntimeError("simulated provider blowup")
        return {"response_text": f"{brand_name} is great", "error": None,
                "latency_ms": 5, "mentioned": True, "citations": None}

    with patch("app.services.llm_service.query_model", side_effect=fake_query_model):
        await _execute_run_with_id(run_id=run_id, brand_id=brand_id)

    async with AsyncSessionLocal() as db:
        prompts = (await db.execute(
            _select(Prompt).where(Prompt.brand_id == brand_id)
        )).scalars().all()
        pid_by_text = {p.text: p.id for p in prompts}
        rows = (await db.execute(
            _select(QueryResult).where(QueryResult.tracking_run_id == run_id)
        )).scalars().all()
        persisted_pids = {r.prompt_id for r in rows}
        # surviving prompts persisted despite prompt 1 failing
        assert pid_by_text["prompt 0"] in persisted_pids
        assert pid_by_text["prompt 2"] in persisted_pids
        run = await db.get(TrackingRun, run_id)
        assert run.status == "completed"
        assert run.total_queries > 0
