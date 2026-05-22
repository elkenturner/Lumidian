from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit, User
from app.scheduler import cleanup_stale_prospect_audits


@pytest.mark.asyncio
async def test_cleanup_removes_audits_older_than_60_days(tmp_path):
    async with AsyncSessionLocal() as db:
        user = User(email="staff-c1@x.com", password_hash="x", name="S", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()

        old_pdf = tmp_path / "old.pdf"
        old_pdf.write_bytes(b"%PDF")
        old = ProspectAudit(
            staff_user_id=user.id,
            business_name="Old",
            website_url="https://o.com",
            is_local=False,
            status="completed",
            pdf_path=str(old_pdf),
            created_at=datetime.utcnow() - timedelta(days=61),
        )
        recent = ProspectAudit(
            staff_user_id=user.id,
            business_name="Recent",
            website_url="https://r.com",
            is_local=False,
            status="completed",
            created_at=datetime.utcnow() - timedelta(days=5),
        )
        db.add_all([old, recent])
        await db.commit()
        old_id, recent_id = old.id, recent.id

    deleted = await cleanup_stale_prospect_audits()
    assert deleted == 1
    assert not old_pdf.exists()

    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(ProspectAudit).where(ProspectAudit.id == old_id))).scalar_one_or_none() is None
        assert (await db.execute(select(ProspectAudit).where(ProspectAudit.id == recent_id))).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_cleanup_handles_missing_pdf_file_gracefully():
    async with AsyncSessionLocal() as db:
        user = User(email="staff-c2@x.com", password_hash="x", name="S", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()
        a = ProspectAudit(
            staff_user_id=user.id,
            business_name="Gone",
            website_url="https://g.com",
            is_local=False,
            status="completed",
            pdf_path="/nonexistent/path.pdf",
            created_at=datetime.utcnow() - timedelta(days=70),
        )
        db.add(a)
        await db.commit()

    # Should NOT raise
    deleted = await cleanup_stale_prospect_audits()
    assert deleted == 1
