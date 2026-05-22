"""Prospect audit router — agency staff cold-email audit deliverable.

Mounted by app.main as /api/agency/prospects/*.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select

from app.dependencies import DbDep, require_agency_staff
from app.models import ProspectAudit, User
from app.schemas import ProspectAuditCreate, ProspectAuditListItem, ProspectAuditOut
from app.services.prospect_audit.runner import run_audit

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
