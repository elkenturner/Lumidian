"""Tests for Content Impact Intelligence feature."""
from __future__ import annotations

import json

import pytest

from tests.conftest import AsyncSessionLocal, register_and_login, create_brand


@pytest.mark.asyncio
async def test_log_content_event(db_session):
    """log_content_event creates a ContentEvent row."""
    from app.models import Brand, Prompt, User
    from app.services.content_event_service import log_content_event

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


@pytest.mark.asyncio
async def test_prompt_run_scores_populated(db_session):
    """_persist_prompt_run_scores creates PromptRunScore rows from QueryResults."""
    from app.models import Brand, Prompt, QueryResult, TrackingRun, User, PromptRunScore
    from app.services.tracking_service import _persist_prompt_run_scores
    from sqlalchemy import select

    user = User(email="prs@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="PRSBrand", slug="prsbrand", user_id=user.id, tier="basic")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="best tool for testing")
    db_session.add(prompt)
    await db_session.flush()
    run = TrackingRun(brand_id=brand.id, status="running")
    db_session.add(run)
    await db_session.flush()

    qrs = []
    for model in ["chatgpt", "claude"]:
        for i in range(5):
            qr = QueryResult(
                tracking_run_id=run.id,
                prompt_id=prompt.id,
                model=model,
                run_number=i + 1,
                response_text=f"Response {i} mentioning PRSBrand" if i < 3 else f"Response {i}",
                mentioned=(i < 3),
            )
            db_session.add(qr)
            qrs.append(qr)
    await db_session.commit()

    count = await _persist_prompt_run_scores(db_session, run.id, brand.id, qrs)
    await db_session.commit()
    assert count == 2

    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(PromptRunScore).where(PromptRunScore.tracking_run_id == run.id)
        )
        scores = result.scalars().all()
        assert len(scores) == 2
        for s in scores:
            assert s.score == 60.0
            assert s.mentioned_count == 3
            assert s.query_count == 5
