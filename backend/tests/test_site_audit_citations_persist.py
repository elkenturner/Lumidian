import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, Competitor, Prompt, QueryResult, TrackingRun, User, CitationSource, utcnow,
)
from app.services.site_audit.citations import extract_for_run


@pytest.mark.asyncio
async def test_extract_for_run_inserts_classified_citations():
    async with AsyncSessionLocal() as db:
        u = User(email="t@x.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="Brand", slug="brand", user_id=u.id, website_url="https://acme.com")
        db.add(b); await db.flush()
        c = Competitor(brand_id=b.id, name="Rival", website_url="https://rival.com")
        db.add(c); await db.flush()
        p = Prompt(brand_id=b.id, text="best widgets")
        db.add(p); await db.flush()
        run = TrackingRun(brand_id=b.id, status="completed", started_at=utcnow())
        db.add(run); await db.flush()
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=p.id, model="chatgpt", run_number=1,
            response_text="See [rival pricing](https://rival.com/pricing) and https://wikipedia.org/widgets.",
            mentioned=False,
        )
        db.add(qr); await db.commit()

        n = await extract_for_run(run.id)
        assert n == 2

        rows = (await db.execute(select(CitationSource).where(CitationSource.brand_id == b.id))).scalars().all()
        kinds = {r.kind for r in rows}
        assert kinds == {"competitor", "third_party"}


@pytest.mark.asyncio
async def test_extract_for_run_is_idempotent():
    async with AsyncSessionLocal() as db:
        u = User(email="t2@x.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="B2", slug="b2", user_id=u.id, website_url="https://acme.com")
        db.add(b); await db.flush()
        p = Prompt(brand_id=b.id, text="x")
        db.add(p); await db.flush()
        run = TrackingRun(brand_id=b.id, status="completed", started_at=utcnow())
        db.add(run); await db.flush()
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=p.id, model="chatgpt", run_number=1,
            response_text="https://wikipedia.org/x",
            mentioned=False,
        )
        db.add(qr); await db.commit()

        n1 = await extract_for_run(run.id)
        n2 = await extract_for_run(run.id)
        rows = (await db.execute(select(CitationSource))).scalars().all()
        assert n1 == 1
        assert n2 == 0  # idempotent
        assert len(rows) == 1
