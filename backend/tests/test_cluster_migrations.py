import pytest
from sqlalchemy import select, text

from app.database import AsyncSessionLocal, run_migrations
from app.models import Brand, ContentDraft, Prompt, User


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


@pytest.mark.asyncio
async def test_rerunning_migrations_does_not_wipe_unposted_drafts():
    """Regression: the cluster-migration clean-slate DELETE must run at most once.

    Before the fix, the DELETE was outside the column-add guard and wiped every
    unposted draft on each app restart, nuking cluster pieces on every deploy.
    """
    async with AsyncSessionLocal() as db:
        user = User(email="migrate-survival@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="migrate-survival-brand", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        # Unposted draft — exactly the kind the buggy DELETE wipes.
        draft = ContentDraft(
            brand_id=brand.id,
            prompt_id=prompt.id,
            platform="linkedin",
            status="draft",
            content_text="cluster piece — must survive a redeploy",
            source="cluster",
        )
        db.add(draft); await db.commit(); await db.refresh(draft)
        draft_id = draft.id

    # Simulate a redeploy — run the migration entry point again.
    await run_migrations()

    async with AsyncSessionLocal() as db:
        survived = (await db.execute(
            select(ContentDraft).where(ContentDraft.id == draft_id)
        )).scalar_one_or_none()
        assert survived is not None, (
            "unposted cluster draft was wiped by re-running migrations — "
            "the clean-slate DELETE is not guarded"
        )
