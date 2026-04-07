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
    assert gap_insights[0]["severity"] == "info"


@pytest.mark.asyncio
async def test_heuristic_score_dropping():
    """score_dropping heuristic fires when overall score declines >=8pp over last 5 runs."""
    from app.services.heuristic_service import evaluate_heuristics

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
    """inactive_prompt heuristic fires when no content events and no drafts posted."""
    from app.services.heuristic_service import evaluate_heuristics

    insights = evaluate_heuristics(
        prompt_id=1,
        current_scores={"chatgpt": 50.0},
        score_history=[{"overall": 50.0, "run_id": 1}],
        content_events=[],
        drafts_posted=0,
    )
    inactive_insights = [i for i in insights if i["id"] == "inactive_prompt"]
    assert len(inactive_insights) == 1
    assert inactive_insights[0]["severity"] == "info"


@pytest.mark.asyncio
async def test_prompts_overview_endpoint(client):
    """GET /api/results/{brand_id}/prompts/overview returns prompt summaries."""
    await register_and_login(client)
    brand_data = await create_brand(client, "OverviewBrand", ["best project management tool"])

    resp = await client.get(f"/api/results/{brand_data['id']}/prompts/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "prompts" in data
    assert len(data["prompts"]) == 1
    assert data["prompts"][0]["prompt_text"] == "best project management tool"


@pytest.mark.asyncio
async def test_prompt_timeline_endpoint(client):
    """GET /api/results/{brand_id}/prompt/{prompt_id}/timeline returns timeline data."""
    await register_and_login(client)
    brand_data = await create_brand(client, "TimelineBrand", ["best AI tool"])
    brand_id = brand_data["id"]

    # Get prompt id
    brand_resp = await client.get(f"/api/brands/{brand_id}")
    prompt_id = brand_resp.json()["prompts"][0]["id"]

    resp = await client.get(f"/api/results/{brand_id}/prompt/{prompt_id}/timeline")
    assert resp.status_code == 200
    data = resp.json()
    assert data["prompt_id"] == prompt_id
    assert "timeline" in data
    assert "content_events" in data


@pytest.mark.asyncio
async def test_prompt_timeline_404_wrong_prompt(client):
    """Timeline endpoint returns 404 for non-existent prompt."""
    await register_and_login(client)
    brand_data = await create_brand(client, "Timeline404Brand", ["test"])

    resp = await client.get(f"/api/results/{brand_data['id']}/prompt/99999/timeline")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_prompt_detail_endpoint(client):
    """GET /api/results/{brand_id}/prompt/{prompt_id}/detail returns full detail."""
    await register_and_login(client)
    brand_data = await create_brand(client, "DetailBrand", ["best CRM software"])
    brand_id = brand_data["id"]

    brand_resp = await client.get(f"/api/brands/{brand_id}")
    prompt_id = brand_resp.json()["prompts"][0]["id"]

    resp = await client.get(f"/api/results/{brand_id}/prompt/{prompt_id}/detail")
    assert resp.status_code == 200
    data = resp.json()
    assert data["prompt_id"] == prompt_id
    assert "timeline" in data
    assert "insights" in data
    assert "drafts" in data
    assert "competitors" in data
    assert "recent_responses" in data


@pytest.mark.asyncio
async def test_prompt_detail_404_wrong_prompt(client):
    """Detail endpoint returns 404 for non-existent prompt."""
    await register_and_login(client)
    brand_data = await create_brand(client, "Detail404Brand", ["test"])

    resp = await client.get(f"/api/results/{brand_data['id']}/prompt/99999/detail")
    assert resp.status_code == 404
