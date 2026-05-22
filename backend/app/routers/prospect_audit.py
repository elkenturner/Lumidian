"""Prospect audit router — agency staff cold-email audit deliverable.

Mounted by app.main as /api/agency/prospects/*.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.dependencies import DbDep, require_agency_staff
from app.models import ProspectAudit, User
from app.schemas import ProspectAuditCreate, ProspectAuditListItem, ProspectAuditOut
from app.services.prospect_audit.runner import run_audit
from app.state import prospect_audit_cancel_events

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agency/prospects", tags=["prospect-audit"])


def _to_out(a: ProspectAudit) -> ProspectAuditOut:
    return ProspectAuditOut(
        id=a.id,
        business_name=a.business_name,
        website_url=a.website_url,
        is_local=a.is_local,
        location=a.location,
        status=a.status,
        status_message=a.status_message,
        error_message=a.error_message,
        cancel_requested=a.cancel_requested,
        overall_visibility_pct=a.overall_visibility_pct,
        aggregate_rvi=a.aggregate_rvi,
        rvi_band=a.rvi_band,
        created_at=a.created_at,
        started_at=a.started_at,
        completed_at=a.completed_at,
        has_pdf=a.pdf_path is not None,
    )


def _to_list_item(a: ProspectAudit) -> ProspectAuditListItem:
    return ProspectAuditListItem(
        id=a.id,
        business_name=a.business_name,
        website_url=a.website_url,
        is_local=a.is_local,
        location=a.location,
        status=a.status,
        overall_visibility_pct=a.overall_visibility_pct,
        aggregate_rvi=a.aggregate_rvi,
        rvi_band=a.rvi_band,
        created_at=a.created_at,
        completed_at=a.completed_at,
    )


@router.post("", response_model=ProspectAuditOut, status_code=status.HTTP_201_CREATED)
async def create_prospect_audit(
    payload: ProspectAuditCreate,
    background: BackgroundTasks,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    """Create a new prospect audit and kick off the background pipeline."""
    # Soft hourly rate limit
    cutoff = datetime.utcnow() - timedelta(hours=1)
    recent = (await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.staff_user_id == user.id,
            ProspectAudit.created_at >= cutoff,
        )
    )).scalars().all()
    if len(recent) >= 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded — max 10 prospect audits per hour per staff member.",
        )

    audit = ProspectAudit(
        staff_user_id=user.id,
        business_name=payload.business_name,
        website_url=payload.website_url,
        is_local=payload.is_local,
        location=payload.location,
        status="pending",
    )
    db.add(audit)
    await db.commit()
    await db.refresh(audit)

    background.add_task(run_audit, audit.id)
    return _to_out(audit)


@router.get("", response_model=list[ProspectAuditListItem])
async def list_prospect_audits(
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> list[ProspectAuditListItem]:
    result = await db.execute(
        select(ProspectAudit)
        .where(ProspectAudit.staff_user_id == user.id)
        .order_by(ProspectAudit.created_at.desc())
        .limit(100)
    )
    return [_to_list_item(a) for a in result.scalars().all()]


@router.get("/{audit_id}", response_model=ProspectAuditOut)
async def get_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    return _to_out(audit)


@router.post("/{audit_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
):
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")

    audit.cancel_requested = True
    await db.commit()

    event = prospect_audit_cancel_events.get(audit_id)
    if event is not None:
        event.set()


@router.post("/{audit_id}/retry", response_model=ProspectAuditOut)
async def retry_prospect_audit(
    audit_id: int,
    background: BackgroundTasks,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    if audit.status not in {"failed", "canceled", "completed"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot retry — audit is currently {audit.status}.",
        )

    if audit.pdf_path:
        try:
            Path(audit.pdf_path).unlink(missing_ok=True)
        except Exception as exc:
            logger.warning("retry: failed to delete stale PDF %s: %s", audit.pdf_path, exc)

    audit.status = "pending"
    audit.status_message = None
    audit.error_message = None
    audit.cancel_requested = False
    audit.overall_visibility_pct = None
    audit.aggregate_rvi = None
    audit.rvi_band = None
    audit.pdf_path = None
    audit.started_at = None
    audit.completed_at = None
    await db.commit()
    await db.refresh(audit)

    background.add_task(run_audit, audit.id)
    return _to_out(audit)


@router.delete("/{audit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
):
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")

    if audit.pdf_path:
        try:
            Path(audit.pdf_path).unlink(missing_ok=True)
        except Exception as exc:
            logger.warning("delete: failed to remove PDF %s: %s", audit.pdf_path, exc)

    await db.delete(audit)
    await db.commit()


@router.get("/{audit_id}/pdf")
async def get_prospect_audit_pdf(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
):
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None or audit.status != "completed" or not audit.pdf_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF not available")

    path = Path(audit.pdf_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file missing")

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in audit.business_name).strip().replace(" ", "-")
    filename = f"{safe_name or 'prospect'}-ai-visibility-audit.pdf"
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
