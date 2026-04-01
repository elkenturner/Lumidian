"""
Tests for tracking run endpoints:
  POST /api/tracking/run/{brand_id}       — trigger run
  GET  /api/tracking/runs/{brand_id}      — list runs
  GET  /api/tracking/run/{run_id}/status  — poll status
  Ownership isolation for runs
"""
import pytest
import httpx
from unittest.mock import patch, AsyncMock
from tests.conftest import register_and_login, create_brand


pytestmark = pytest.mark.asyncio


# ── Trigger run ───────────────────────────────────────────────────────────────

async def test_trigger_run_returns_202(client: httpx.AsyncClient):
    await register_and_login(client, email="trigger@example.com")
    brand = await create_brand(client, name="Trigger Brand")

    with patch(
        "app.routers.tracking._background_run_with_id",
        new_callable=AsyncMock,
    ):
        resp = await client.post(f"/api/tracking/run/{brand['id']}")
    assert resp.status_code == 202
    data = resp.json()
    assert "run_id" in data
    assert data["status"] == "pending"


async def test_trigger_run_unauthenticated(client: httpx.AsyncClient):
    resp = await client.post("/api/tracking/run/1")
    assert resp.status_code == 401


async def test_trigger_run_wrong_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="norun@example.com")
    resp = await client.post("/api/tracking/run/99999")
    assert resp.status_code in (403, 404)


async def test_trigger_run_other_users_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="owner_run@example.com")
    brand = await create_brand(client, name="Owner Run Brand")

    await register_and_login(client, email="thief_run@example.com")
    resp = await client.post(f"/api/tracking/run/{brand['id']}")
    assert resp.status_code == 403


# ── List runs ─────────────────────────────────────────────────────────────────

async def test_list_runs_empty(client: httpx.AsyncClient):
    await register_and_login(client, email="listruns@example.com")
    brand = await create_brand(client, name="List Runs Brand")
    resp = await client.get(f"/api/tracking/runs/{brand['id']}")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_runs_after_trigger(client: httpx.AsyncClient):
    await register_and_login(client, email="listruns2@example.com")
    brand = await create_brand(client, name="List Runs 2 Brand")

    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        await client.post(f"/api/tracking/run/{brand['id']}")

    resp = await client.get(f"/api/tracking/runs/{brand['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_list_runs_access_control(client: httpx.AsyncClient):
    await register_and_login(client, email="ownerruns2@example.com")
    brand = await create_brand(client, name="Owner Runs 2 Brand")

    await register_and_login(client, email="thiefruns2@example.com")
    resp = await client.get(f"/api/tracking/runs/{brand['id']}")
    assert resp.status_code == 403


# ── Poll run status ───────────────────────────────────────────────────────────

async def test_poll_run_status(client: httpx.AsyncClient):
    await register_and_login(client, email="pollstatus@example.com")
    brand = await create_brand(client, name="Poll Status Brand")

    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        trigger_resp = await client.post(f"/api/tracking/run/{brand['id']}")
    run_id = trigger_resp.json()["run_id"]

    resp = await client.get(f"/api/tracking/run/{run_id}/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == run_id
    assert data["status"] in ("pending", "running", "completed", "failed")


async def test_poll_run_not_found(client: httpx.AsyncClient):
    await register_and_login(client, email="pollnotfound@example.com")
    resp = await client.get("/api/tracking/run/99999/status")
    assert resp.status_code == 404


async def test_poll_other_users_run(client: httpx.AsyncClient):
    await register_and_login(client, email="runowner@example.com")
    brand = await create_brand(client, name="Run Owner Brand")

    with patch("app.routers.tracking._background_run_with_id", new_callable=AsyncMock):
        trigger_resp = await client.post(f"/api/tracking/run/{brand['id']}")
    run_id = trigger_resp.json()["run_id"]

    await register_and_login(client, email="runthief@example.com")
    resp = await client.get(f"/api/tracking/run/{run_id}/status")
    assert resp.status_code == 403


# ── Run completion (direct DB manipulation) ───────────────────────────────────

async def test_run_status_transitions(client: httpx.AsyncClient):
    """Verify a run can be written as 'completed' and read back correctly."""
    from app.database import AsyncSessionLocal
    from app.models import TrackingRun, Brand, User, Prompt
    from sqlalchemy import select

    await register_and_login(client, email="transition@example.com")
    brand = await create_brand(client, name="Transition Brand")
    brand_id = brand["id"]

    # Manually insert a completed run
    async with AsyncSessionLocal() as db:
        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            overall_score=75.0,
            total_queries=4,
            total_mentions=3,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    resp = await client.get(f"/api/tracking/run/{run_id}/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["overall_score"] == 75.0


# ── Single-prompt mini run ────────────────────────────────────────────────────

async def test_trigger_prompt_run_returns_202(client: httpx.AsyncClient):
    """POST /api/tracking/run-prompt/{brand_id}/{prompt_id} returns 202 with run_id."""
    await register_and_login(client, email="promptrun@example.com")
    brand = await create_brand(
        client,
        name="Prompt Run Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]

    with patch(
        "app.routers.tracking._background_prompt_run",
        new_callable=AsyncMock,
    ):
        resp = await client.post(
            f"/api/tracking/run-prompt/{brand['id']}/{prompt_id}"
        )

    assert resp.status_code == 202
    data = resp.json()
    assert "run_id" in data
    assert data["status"] == "pending"


async def test_trigger_prompt_run_wrong_prompt(client: httpx.AsyncClient):
    """Prompt id not belonging to this brand returns 404."""
    await register_and_login(client, email="promptrun_wrong@example.com")
    brand = await create_brand(client, name="Prompt Wrong Brand")

    resp = await client.post(
        f"/api/tracking/run-prompt/{brand['id']}/99999"
    )
    assert resp.status_code == 404


async def test_trigger_prompt_run_access_control(client: httpx.AsyncClient):
    """User cannot trigger a prompt run on another user's brand."""
    await register_and_login(client, email="promptrun_owner@example.com")
    brand = await create_brand(
        client,
        name="Prompt Owner Brand",
        prompts=["What is the best tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]

    await register_and_login(client, email="promptrun_thief@example.com")
    resp = await client.post(
        f"/api/tracking/run-prompt/{brand['id']}/{prompt_id}"
    )
    assert resp.status_code == 403
