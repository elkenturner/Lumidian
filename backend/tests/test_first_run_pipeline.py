"""Tests for first-run detection and onboarding pipeline."""
from datetime import UTC
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def test_first_run_triggers_onboarding_pipeline(client: httpx.AsyncClient):
    """First tracking run for a brand should be created with run_type='onboarding'."""
    await register_and_login(client, email="firstrun@test.com", password="Password123")

    # Create a brand with prompts
    brand = await create_brand(client, name="FirstRunBrand", prompts=["What is FirstRunBrand?"])
    brand_id = brand["id"]

    # Mock the background function so we don't do real LLM calls
    with patch(
        "app.routers.tracking._background_run_with_id",
        new_callable=AsyncMock,
    ):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
        assert run_resp.status_code == 202

        # Verify the run was created with onboarding type
        from app.database import AsyncSessionLocal
        from app.models import TrackingRun
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_resp.json()["run_id"])
            # First run should be marked as onboarding type
            assert run.run_type == "onboarding"


async def test_second_run_is_manual_not_onboarding(client: httpx.AsyncClient):
    """Second tracking run should be manual type, not onboarding."""
    await register_and_login(client, email="secondrun@test.com", password="Password123")

    brand = await create_brand(client, name="SecondRunBrand", prompts=["test"])
    brand_id = brand["id"]

    # Create a completed run in the DB to simulate first run already happened
    from datetime import datetime

    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        existing_run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="onboarding",
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(existing_run)
        await db.commit()

    with patch(
        "app.routers.tracking._background_run_with_id",
        new_callable=AsyncMock,
    ):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
        assert run_resp.status_code == 202

        # Verify this run is manual, not onboarding
        from app.database import AsyncSessionLocal
        from app.models import TrackingRun
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_resp.json()["run_id"])
            assert run.run_type == "manual"


async def test_onboarding_pipeline_fires_after_first_run_completes(client: httpx.AsyncClient):
    """After an onboarding run completes, _onboarding_post_process should be called."""
    await register_and_login(client, email="onboardingpipeline@test.com", password="Password123")

    brand = await create_brand(client, name="OnboardingPipelineBrand", prompts=["test prompt"])
    brand_id = brand["id"]

    # Trigger first run (no completed runs exist yet)
    with patch(
        "app.routers.tracking._background_run_with_id",
        new_callable=AsyncMock,
    ):
        run_resp = await client.post(f"/api/tracking/run/{brand_id}")
        assert run_resp.status_code == 202
        run_id = run_resp.json()["run_id"]

    # Mark the run as completed with run_type=onboarding in DB
    from datetime import datetime

    from app.database import AsyncSessionLocal
    from app.models import TrackingRun
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, run_id)
        assert run.run_type == "onboarding"
        run.status = "completed"
        run.completed_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()

    # Now call _execute_run_with_id directly and assert _onboarding_post_process is triggered
    with patch(
        "app.services.tracking_service._onboarding_post_process",
        new_callable=AsyncMock,
    ) as mock_onboarding, patch(
        "app.services.llm_service.query_model",
        new_callable=AsyncMock,
        return_value={"response_text": "test response", "mentioned": True, "latency_ms": 100, "error": None},
    ), patch(
        "app.services.sentiment_service.classify_sentiments_for_run",
        new_callable=AsyncMock,
    ), patch(
        "app.services.gap_analysis_service.run_gap_analysis",
        new_callable=AsyncMock,
        return_value=[],
    ):
        # Reset the run to pending/running so _execute_run_with_id can process it
        async with AsyncSessionLocal() as db:
            run = await db.get(TrackingRun, run_id)
            run.status = "running"
            run.completed_at = None
            await db.commit()

        import asyncio

        from app.routers.tracking import _execute_run_with_id

        # Run in a task context so create_task works
        async def _run():
            await _execute_run_with_id(run_id=run_id, brand_id=brand_id)
            # Allow the created task to be scheduled
            await asyncio.sleep(0)

        await _run()

        # _onboarding_post_process should have been invoked via create_task
        # We give the event loop a tick to run the created task
        await asyncio.sleep(0)
        mock_onboarding.assert_called_once_with(brand_id)
