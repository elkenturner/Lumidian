"""Verifies the prospect_audits table exists after migrations run."""
import pytest
from sqlalchemy import inspect

from app.database import engine


@pytest.mark.asyncio
async def test_prospect_audits_table_exists():
    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    assert "prospect_audits" in tables


@pytest.mark.asyncio
async def test_prospect_audits_columns():
    async with engine.connect() as conn:
        cols = await conn.run_sync(
            lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("prospect_audits")}
        )
    required = {
        "id", "staff_user_id", "business_name", "website_url",
        "is_local", "location", "status", "status_message",
        "error_message", "cancel_requested",
        "overall_visibility_pct", "aggregate_rvi", "rvi_band",
        "pdf_path", "created_at", "started_at", "completed_at",
    }
    assert required.issubset(cols), f"missing columns: {required - cols}"
