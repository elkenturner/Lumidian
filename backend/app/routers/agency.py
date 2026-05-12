"""Agency portal endpoints. All endpoints require is_agency_staff=True."""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_agency_staff
from app.models import AgencyClient, Brand, ClientReviewLink, ContentDraft, User
from app.schemas import (
    AgencyClientCreate,
    AgencyClientOut,
    AgencyClientUpdate,
    DraftAssignIn,
    DraftStatusUpdateIn,
    ReviewLinkOut,
    TodayDraftOut,
    TodayOut,
)

router = APIRouter(prefix="/agency", tags=["agency"])


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "client"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    suffix = 2
    while True:
        existing = await db.execute(select(AgencyClient.id).where(AgencyClient.slug == slug))
        if existing.scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


async def _client_to_out(db: AsyncSession, client: AgencyClient) -> AgencyClientOut:
    brand_q = await db.execute(
        select(Brand.id).where(Brand.agency_client_id == client.id).order_by(Brand.id.asc()).limit(1)
    )
    brand_id = brand_q.scalar_one_or_none()
    pending_count = 0
    if brand_id is not None:
        cnt = await db.execute(
            select(func.count(ContentDraft.id)).where(
                ContentDraft.brand_id == brand_id, ContentDraft.status == "draft"
            )
        )
        pending_count = cnt.scalar_one() or 0
    return AgencyClientOut(
        id=client.id,
        name=client.name,
        slug=client.slug,
        status=client.status,
        retainer_amount_usd=client.retainer_amount_usd,
        retainer_started_at=client.retainer_started_at,
        peec_dashboard_url=client.peec_dashboard_url,
        primary_contact_name=client.primary_contact_name,
        primary_contact_email=client.primary_contact_email,
        brand_id=brand_id,
        drafts_pending=pending_count,
        created_at=client.created_at,
    )


@router.get("/clients", response_model=list[AgencyClientOut])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    rows = await db.execute(select(AgencyClient).order_by(AgencyClient.created_at.desc()))
    clients = rows.scalars().all()
    return [await _client_to_out(db, c) for c in clients]


@router.post("/clients", response_model=AgencyClientOut, status_code=http_status.HTTP_201_CREATED)
async def create_client(
    body: AgencyClientCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    base_slug = _slugify(body.name)
    slug = await _unique_slug(db, base_slug)
    client = AgencyClient(
        name=body.name.strip(),
        slug=slug,
        status=body.status or "onboarding",
        retainer_amount_usd=body.retainer_amount_usd,
        peec_dashboard_url=body.peec_dashboard_url,
        primary_contact_name=body.primary_contact_name,
        primary_contact_email=body.primary_contact_email,
    )
    db.add(client)
    await db.flush()

    brand = Brand(
        name=body.name.strip(),
        slug=f"agency-{slug}",
        user_id=user.id,
        agency_client_id=client.id,
        brand_type="standard",
    )
    db.add(brand)
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.get("/clients/{client_id}", response_model=AgencyClientOut)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return await _client_to_out(db, client)


@router.patch("/clients/{client_id}", response_model=AgencyClientOut)
async def update_client(
    client_id: int,
    body: AgencyClientUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    if body.status == "active" and client.retainer_started_at is None:
        client.retainer_started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.delete("/clients/{client_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = "churned"
    await db.commit()


@router.get("/today", response_model=TodayOut)
async def get_today(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    drafts_q = await db.execute(
        select(ContentDraft, Brand, AgencyClient)
        .join(Brand, Brand.id == ContentDraft.brand_id)
        .join(AgencyClient, AgencyClient.id == Brand.agency_client_id)
        .where(ContentDraft.status == "draft")
        .order_by(ContentDraft.created_at.asc())
        .limit(50)
    )
    drafts_rows = drafts_q.all()
    drafts = [
        TodayDraftOut(
            draft_id=draft.id,
            title=getattr(draft, "title", None),
            platform=draft.platform,
            client_id=client.id,
            client_name=client.name,
            assigned_to_user_id=draft.assigned_to_user_id,
            created_at=draft.created_at,
        )
        for draft, _brand, client in drafts_rows
    ]
    active_clients_q = await db.execute(
        select(func.count(AgencyClient.id)).where(AgencyClient.status == "active")
    )
    active_clients = active_clients_q.scalar_one() or 0
    return TodayOut(
        drafts_to_review=drafts,
        drafts_to_review_count=len(drafts),
        active_clients=active_clients,
    )


@router.patch("/drafts/{draft_id}/assign", status_code=http_status.HTTP_204_NO_CONTENT)
async def assign_draft(
    draft_id: int,
    body: DraftAssignIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.assigned_to_user_id = body.assigned_to_user_id
    await db.commit()


def _public_base_url(request: Request) -> str:
    """Return base URL for public links (env override, else inferred)."""
    env_url = os.getenv("PUBLIC_BASE_URL")
    if env_url:
        return env_url.rstrip("/")
    return f"{request.url.scheme}://{request.url.netloc}"


def _link_to_out(link: ClientReviewLink, request: Request) -> ReviewLinkOut:
    base = _public_base_url(request)
    return ReviewLinkOut(token=link.token, url=f"{base}/review/{link.token}", created_at=link.created_at)


@router.get("/clients/{client_id}/review-link", response_model=ReviewLinkOut | None)
async def get_review_link(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    q = await db.execute(
        select(ClientReviewLink)
        .where(ClientReviewLink.agency_client_id == client_id, ClientReviewLink.revoked_at.is_(None))
        .order_by(ClientReviewLink.created_at.desc())
        .limit(1)
    )
    link = q.scalar_one_or_none()
    return _link_to_out(link, request) if link else None


@router.post("/clients/{client_id}/review-link", response_model=ReviewLinkOut, status_code=http_status.HTTP_201_CREATED)
async def rotate_review_link(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    # Revoke any existing active links
    existing_q = await db.execute(
        select(ClientReviewLink).where(
            ClientReviewLink.agency_client_id == client_id,
            ClientReviewLink.revoked_at.is_(None),
        )
    )
    for old in existing_q.scalars().all():
        old.revoked_at = datetime.utcnow()
    new_link = ClientReviewLink(
        agency_client_id=client_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(new_link)
    await db.commit()
    await db.refresh(new_link)
    return _link_to_out(new_link, request)


_STAFF_ALLOWED_STATUSES = {"draft", "awaiting_client", "approved", "posted", "dismissed"}


@router.patch("/drafts/{draft_id}/status", status_code=http_status.HTTP_204_NO_CONTENT)
async def update_draft_status(
    draft_id: int,
    body: DraftStatusUpdateIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    if body.status not in _STAFF_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of {sorted(_STAFF_ALLOWED_STATUSES)}",
        )
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.status = body.status
    if body.status == "approved" and draft.approved_at is None:
        draft.approved_at = datetime.utcnow()
    if body.status == "posted" and draft.posted_at is None:
        draft.posted_at = datetime.utcnow()
    await db.commit()
