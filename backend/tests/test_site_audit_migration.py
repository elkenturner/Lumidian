import pytest
from sqlalchemy import inspect
from app.database import engine, run_migrations, create_tables


@pytest.mark.asyncio
async def test_recommendation_columns_present():
    await create_tables()
    await run_migrations()
    async with engine.connect() as conn:
        cols = await conn.run_sync(
            lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("website_audit_recommendations")]
        )
    expected = {
        "artifact", "artifact_type", "artifact_generated_at", "artifact_regen_count",
        "status", "expected_lift_pp", "target_url", "priority_score",
    }
    assert expected.issubset(set(cols)), f"missing: {expected - set(cols)}"
