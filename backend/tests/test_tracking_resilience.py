# backend/tests/test_tracking_resilience.py
import pytest
from sqlalchemy import select

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
