from datetime import datetime, timedelta, UTC

import pytest

from app.database import AsyncSessionLocal
from app.models import ContentCluster
from app.services.cluster_cleanup import auto_fail_stale_clusters


@pytest.mark.asyncio
async def test_marks_stuck_briefing_as_failed():
    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="stale-1")
        cluster = await db.get(ContentCluster, cluster_id)
        cluster.status = "briefing"
        cluster.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=30)
        await db.commit()

    async with AsyncSessionLocal() as db:
        n = await auto_fail_stale_clusters(db, max_age_minutes=15)
        assert n == 1
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert cluster.failure_reason == "timeout"


@pytest.mark.asyncio
async def test_leaves_fresh_clusters_alone():
    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="stale-2")
        cluster = await db.get(ContentCluster, cluster_id)
        cluster.status = "generating"
        await db.commit()

    async with AsyncSessionLocal() as db:
        n = await auto_fail_stale_clusters(db, max_age_minutes=15)
        assert n == 0
