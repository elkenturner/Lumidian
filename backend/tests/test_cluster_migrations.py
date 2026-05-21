import pytest
from sqlalchemy import text

from app.database import AsyncSessionLocal, run_migrations


@pytest.mark.asyncio
async def test_migrations_idempotent_for_new_fields():
    # Run migrations twice — must not raise. The fresh test DB will not have
    # the legacy `partial_failed` rows, but the migration should be a no-op then.
    await run_migrations()
    await run_migrations()
    async with AsyncSessionLocal() as db:
        # New columns are present
        row = await db.execute(text("PRAGMA table_info(content_clusters)"))
        cols = {r[1] for r in row.fetchall()}
        assert "failure_reason" in cols

        row = await db.execute(text("PRAGMA table_info(content_drafts)"))
        cols = {r[1] for r in row.fetchall()}
        assert "failure_reason" in cols
        assert "generation_state" in cols

        row = await db.execute(text("PRAGMA table_info(content_briefs)"))
        cols = {r[1] for r in row.fetchall()}
        assert "evidence_pack_id" in cols
