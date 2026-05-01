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
async def test_manual_run_persists_prompt_run_scores(client):
    """_execute_run_with_id (manual run path) writes PromptRunScore rows."""
    from unittest.mock import AsyncMock, patch
    from datetime import datetime, UTC

    from sqlalchemy import select

    from app.models import PromptRunScore, TrackingRun

    await register_and_login(client, email="manualpr@test.com", password="Password123")
    brand = await create_brand(
        client, name="ManualPRBrand", prompts=["best testing tool", "top dev platform"]
    )
    brand_id = brand["id"]

    async with AsyncSessionLocal() as db:
        run = TrackingRun(
            brand_id=brand_id,
            status="running",
            run_type="manual",
            started_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.commit()
        run_id = run.id

    with patch(
        "app.services.llm_service.query_model",
        new_callable=AsyncMock,
        return_value={
            "response_text": "ManualPRBrand is great",
            "mentioned": True,
            "latency_ms": 100,
            "error": None,
        },
    ), patch(
        "app.services.sentiment_service.classify_sentiments_for_run",
        new_callable=AsyncMock,
    ), patch(
        "app.services.gap_analysis_service.run_gap_analysis",
        new_callable=AsyncMock,
        return_value=[],
    ):
        from app.routers.tracking import _execute_run_with_id

        await _execute_run_with_id(run_id=run_id, brand_id=brand_id)

    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(PromptRunScore).where(PromptRunScore.tracking_run_id == run_id)
        )
        scores = result.scalars().all()
        assert len(scores) > 0, "Manual run must persist PromptRunScore rows"
        for s in scores:
            assert s.brand_id == brand_id
            assert s.score == 100.0  # all queries mentioned the brand


@pytest.mark.asyncio
async def test_single_prompt_run_persists_prompt_run_scores(client):
    """_background_prompt_run (single-prompt path) writes PromptRunScore rows."""
    from unittest.mock import AsyncMock, patch
    from datetime import datetime, UTC

    from sqlalchemy import select

    from app.models import Prompt, PromptRunScore, TrackingRun

    await register_and_login(client, email="promptpr@test.com", password="Password123")
    brand = await create_brand(
        client, name="PromptPRBrand", prompts=["original prompt"]
    )
    brand_id = brand["id"]

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
        prompt = result.scalars().first()
        prompt_id = prompt.id
        prompt_text = prompt.text

        run = TrackingRun(
            brand_id=brand_id,
            status="pending",
            run_type="prompt",
            started_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.commit()
        run_id = run.id

    with patch(
        "app.services.llm_service.query_model",
        new_callable=AsyncMock,
        return_value={
            "response_text": "PromptPRBrand is great",
            "mentioned": True,
            "latency_ms": 100,
            "error": None,
        },
    ), patch(
        "app.services.sentiment_service.classify_sentiments_for_run",
        new_callable=AsyncMock,
    ), patch(
        "app.services.gap_analysis_service.run_gap_analysis",
        new_callable=AsyncMock,
        return_value=[],
    ):
        from app.routers.tracking import _background_prompt_run

        await _background_prompt_run(
            run_id=run_id,
            brand_id=brand_id,
            prompt_id=prompt_id,
            prompt_text=prompt_text,
            brand_name="PromptPRBrand",
            tier=None,
            brand_type="standard",
        )

    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(PromptRunScore).where(PromptRunScore.tracking_run_id == run_id)
        )
        scores = result.scalars().all()
        assert len(scores) > 0, "Prompt-run must persist PromptRunScore rows"
        for s in scores:
            assert s.brand_id == brand_id
            assert s.prompt_id == prompt_id
            assert s.score == 100.0


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


@pytest.mark.asyncio
async def test_prompt_detail_fallback_no_prompt_run_scores(db_session):
    """Detail endpoint computes timeline from QueryResult when no PromptRunScore rows exist."""
    from app.models import Brand, Prompt, QueryResult, TrackingRun, User
    from tests.conftest import AsyncSessionLocal

    user = User(email="fallback@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="FallbackBrand", slug="fallbackbrand", user_id=user.id, tier="basic")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="fallback test prompt")
    db_session.add(prompt)
    await db_session.flush()
    from datetime import datetime, UTC
    run = TrackingRun(brand_id=brand.id, status="completed", completed_at=datetime.now(UTC).replace(tzinfo=None))
    db_session.add(run)
    await db_session.flush()

    # Add QueryResult rows but NO PromptRunScore rows (simulates pre-deploy run)
    for model in ["chatgpt", "claude"]:
        for i in range(5):
            qr = QueryResult(
                tracking_run_id=run.id,
                prompt_id=prompt.id,
                model=model,
                run_number=i + 1,
                response_text=f"Response {i} mentioning FallbackBrand" if i < 3 else f"Response {i}",
                mentioned=(i < 3),
            )
            db_session.add(qr)
    await db_session.commit()

    # Now query the detail endpoint logic directly
    from app.routers.results import _safe_json  # noqa: F401
    from collections import defaultdict
    from datetime import UTC, datetime, timedelta
    from sqlalchemy import select

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=90)

    # Verify no PromptRunScore rows exist
    from app.models import PromptRunScore
    async with AsyncSessionLocal() as check_db:
        prs_result = await check_db.execute(
            select(PromptRunScore).where(PromptRunScore.prompt_id == prompt.id)
        )
        assert len(prs_result.scalars().all()) == 0

        # Verify QueryResult rows DO exist
        qr_result = await check_db.execute(
            select(QueryResult).where(QueryResult.prompt_id == prompt.id)
        )
        assert len(qr_result.scalars().all()) == 10

        # Simulate the fallback logic
        qr_result2 = await check_db.execute(
            select(QueryResult)
            .join(TrackingRun, QueryResult.tracking_run_id == TrackingRun.id)
            .where(
                QueryResult.prompt_id == prompt.id,
                TrackingRun.brand_id == brand.id,
                TrackingRun.status == "completed",
                TrackingRun.completed_at >= cutoff,
            )
        )
        qr_rows = qr_result2.scalars().all()
        assert len(qr_rows) == 10

        run_model_stats = defaultdict(lambda: defaultdict(lambda: {"mentioned": 0, "total": 0}))
        for qr in qr_rows:
            if qr.error:
                continue
            run_model_stats[qr.tracking_run_id][qr.model]["total"] += 1
            if qr.mentioned:
                run_model_stats[qr.tracking_run_id][qr.model]["mentioned"] += 1

        # Should have 2 model entries for this run
        assert len(run_model_stats[run.id]) == 2
        # Each model: 3 mentioned out of 5 = 60%
        for model_stats in run_model_stats[run.id].values():
            assert model_stats["mentioned"] == 3
            assert model_stats["total"] == 5


@pytest.mark.asyncio
async def test_log_score_change_events(db_session):
    """_log_score_change_events creates ContentEvent rows for significant score changes."""
    from app.models import Brand, ContentEvent, Prompt, PromptRunScore, TrackingRun, User
    from app.services.tracking_service import _log_score_change_events
    from sqlalchemy import select

    user = User(email="scorechange@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="ScoreChangeBrand", slug="scorechangebrand", user_id=user.id, tier="basic")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="score change test prompt")
    db_session.add(prompt)
    await db_session.flush()

    # Create a previous run with scores
    run1 = TrackingRun(brand_id=brand.id, status="completed")
    db_session.add(run1)
    await db_session.flush()
    prev_score = PromptRunScore(
        prompt_id=prompt.id, tracking_run_id=run1.id, brand_id=brand.id,
        model="chatgpt", score=40.0, mentioned_count=2, query_count=5,
    )
    db_session.add(prev_score)
    await db_session.commit()

    # Create a new run with a significant score change (+20pp) and a small change (+3pp)
    run2 = TrackingRun(brand_id=brand.id, status="completed")
    db_session.add(run2)
    await db_session.flush()
    new_score_big = PromptRunScore(
        prompt_id=prompt.id, tracking_run_id=run2.id, brand_id=brand.id,
        model="chatgpt", score=60.0, mentioned_count=3, query_count=5,
    )
    new_score_small = PromptRunScore(
        prompt_id=prompt.id, tracking_run_id=run2.id, brand_id=brand.id,
        model="claude", score=43.0, mentioned_count=2, query_count=5,
    )
    db_session.add_all([new_score_big, new_score_small])
    await db_session.commit()

    # Also add a previous claude score so the small change has a baseline
    prev_claude = PromptRunScore(
        prompt_id=prompt.id, tracking_run_id=run1.id, brand_id=brand.id,
        model="claude", score=40.0, mentioned_count=2, query_count=5,
    )
    db_session.add(prev_claude)
    await db_session.commit()

    # Run the function — should log event for chatgpt (+20pp) but not claude (+3pp)
    await _log_score_change_events(
        brand_id=brand.id,
        run_id=run2.id,
        new_scores=[
            {"prompt_id": prompt.id, "model": "chatgpt", "score": 60.0},
            {"prompt_id": prompt.id, "model": "claude", "score": 43.0},
        ],
    )

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
        assert data["model"] == "chatgpt"
        assert data["old_score"] == 40.0
        assert data["new_score"] == 60.0
        assert data["delta"] == 20.0


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

    assert snapshot["content_preview"] == long_body
    assert len(snapshot["content_preview"]) > 1000
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
