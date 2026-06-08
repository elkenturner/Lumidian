"""Agency portal endpoints. All endpoints require is_agency_staff=True."""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ensure_client_access, require_admin, require_agency_staff, require_client_access
from app.models import AgencyClient, AgencyClientAssignment, AgencyClientMilestone, AgencyStaff, Brand, ClientActivityEvent, ClientDocument, ClientReviewLink, ContentDraft, ContentPost, Prompt, User
from app.schemas import (
    ActivityEventOut,
    AgencyClientCreate,
    AgencyClientMilestoneOut,
    AgencyClientMilestoneUpdate,
    AgencyClientOut,
    AgencyClientUpdate,
    AgencyDraftGenerateIn,
    AgencyStaffOut,
    ClientProposalUpdateIn,
    ClientStaffAssignmentOut,
    DocumentGenerateIn,
    DocumentOut,
    DocumentTemplateOut,
    DocumentUpdateIn,
    DraftOut,
    DraftStatusUpdateIn,
    MarkPostedIn,
    MILESTONE_KINDS,
    MILESTONE_STATUSES,
    NoteCreate,
    NoteUpdate,
    ReviewLinkOut,
)
from app.services.document_engine import generate_document, generate_pdf, get_template, list_templates, MissingDataError, LLMJSONError
from app.services.document_engine.typst_renderer import TypstCompileError
from app.services.agency_activity import (
    emit_event,
    EVENT_DRAFT_GENERATED_BY_STAFF,
    EVENT_DRAFT_MARKED_POSTED,
    EVENT_NOTE,
)
from app.services.drafting_service import generate_gap_draft, ALL_DRAFT_PLATFORMS

router = APIRouter(prefix="/agency", tags=["agency"])
logger = logging.getLogger(__name__)


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
        primary_contact_name=client.primary_contact_name,
        primary_contact_email=client.primary_contact_email,
        brand_id=brand_id,
        drafts_pending=pending_count,
        created_at=client.created_at,
        current_proposal_doc_url=client.current_proposal_doc_url,
        current_proposal_label=client.current_proposal_label,
    )


async def _event_to_out(db: AsyncSession, event: ClientActivityEvent) -> ActivityEventOut:
    actor_name: str | None = None
    if event.actor_user_id is not None:
        actor = await db.get(User, event.actor_user_id)
        actor_name = (actor.name or actor.email) if actor else None
    payload_obj: dict | None = None
    if event.payload:
        try:
            payload_obj = json.loads(event.payload)
        except json.JSONDecodeError:
            payload_obj = None
    return ActivityEventOut(
        id=event.id,
        agency_client_id=event.agency_client_id,
        event_type=event.event_type,
        actor_user_id=event.actor_user_id,
        actor_name=actor_name,
        body=event.body,
        payload=payload_obj,
        related_draft_id=event.related_draft_id,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


async def _accessible_client_ids(db: AsyncSession, user: User) -> list[int] | None:
    """Return list of client IDs this user can access, or None to mean 'all' (admin bypass)."""
    if user.is_admin:
        return None
    rows = await db.execute(
        select(AgencyClientAssignment.agency_client_id).where(
            AgencyClientAssignment.staff_user_id == user.id
        )
    )
    return [r for (r,) in rows.all()]


@router.get("/clients", response_model=list[AgencyClientOut])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    accessible = await _accessible_client_ids(db, user)
    if accessible is not None and not accessible:
        return []
    stmt = select(AgencyClient).order_by(AgencyClient.created_at.desc())
    if accessible is not None:
        stmt = stmt.where(AgencyClient.id.in_(accessible))
    rows = await db.execute(stmt)
    clients = rows.scalars().all()
    return [await _client_to_out(db, c) for c in clients]


@router.post("/clients", response_model=AgencyClientOut, status_code=http_status.HTTP_201_CREATED)
async def create_client(
    body: AgencyClientCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    base_slug = _slugify(body.name)
    slug = await _unique_slug(db, base_slug)
    client = AgencyClient(
        name=body.name.strip(),
        slug=slug,
        status=body.status or "onboarding",
        retainer_amount_usd=body.retainer_amount_usd,
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
        brand_type="agency",
    )
    db.add(brand)
    # Auto-assign creator so they can immediately access this client.
    db.add(AgencyClientAssignment(
        agency_client_id=client.id,
        staff_user_id=user.id,
    ))
    await emit_event(
        db,
        agency_client_id=client.id,
        event_type="client_created",
        body=f"Created client {client.name}",
        actor_user_id=user.id,
    )
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.get("/clients/{client_id}", response_model=AgencyClientOut)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
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
    user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    prev_status = client.status
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    if body.status == "active" and client.retainer_started_at is None:
        client.retainer_started_at = datetime.utcnow()
    if body.status is not None and body.status != prev_status:
        await emit_event(
            db,
            agency_client_id=client.id,
            event_type="client_status_changed",
            body=f"Status changed: {prev_status} → {body.status}",
            actor_user_id=user.id,
            payload={"prev": prev_status, "next": body.status},
        )
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


@router.delete("/clients/{client_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = "churned"
    await db.commit()


def _public_base_url(request: Request) -> str:
    """Return base URL for public links (env override, else inferred)."""
    env_url = os.getenv("PUBLIC_BASE_URL")
    if env_url:
        return env_url.rstrip("/")
    return f"{request.url.scheme}://{request.url.netloc}"


def _link_to_out(link: ClientReviewLink, request: Request) -> ReviewLinkOut:
    base = _public_base_url(request)
    return ReviewLinkOut(token=link.token, url=f"{base}/client/{link.token}", created_at=link.created_at)


@router.get("/clients/{client_id}/review-link", response_model=ReviewLinkOut | None)
async def get_review_link(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
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
    user: User = Depends(require_client_access),
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
    existing_links = existing_q.scalars().all()
    had_prior_link = len(existing_links) > 0
    for old in existing_links:
        old.revoked_at = datetime.utcnow()
    new_link = ClientReviewLink(
        agency_client_id=client_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(new_link)
    event_type = "review_link_rotated" if had_prior_link else "review_link_generated"
    body_text = "Rotated client review link" if had_prior_link else "Generated client review link"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type=event_type,
        body=body_text,
        actor_user_id=user.id,
    )
    await db.commit()
    await db.refresh(new_link)
    return _link_to_out(new_link, request)


_STAFF_ALLOWED_STATUSES = {"draft", "awaiting_client", "approved", "posted", "dismissed"}


@router.patch("/drafts/{draft_id}/status", status_code=http_status.HTTP_204_NO_CONTENT)
async def update_draft_status(
    draft_id: int,
    body: DraftStatusUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    if body.status not in _STAFF_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of {sorted(_STAFF_ALLOWED_STATUSES)}",
        )
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    brand = await db.get(Brand, draft.brand_id)
    if brand is None or brand.agency_client_id is None:
        raise HTTPException(status_code=404, detail="Draft has no agency client")
    await ensure_client_access(db, user, brand.agency_client_id)
    prev_status = draft.status
    draft.status = body.status
    if body.status == "approved" and draft.approved_at is None:
        draft.approved_at = datetime.utcnow()
    if body.status == "posted" and draft.posted_at is None:
        draft.posted_at = datetime.utcnow()

    # Emit activity event if this is an interesting transition
    if brand and brand.agency_client_id is not None:
        title_label = draft.title or f"Draft #{draft.id}"
        if body.status == "awaiting_client" and prev_status != "awaiting_client":
            await emit_event(
                db,
                agency_client_id=brand.agency_client_id,
                event_type="draft_sent_to_client",
                body=f"Sent '{title_label}' to client review",
                actor_user_id=user.id,
                related_draft_id=draft.id,
            )
        elif body.status == "posted" and prev_status != "posted":
            await emit_event(
                db,
                agency_client_id=brand.agency_client_id,
                event_type="draft_marked_posted",
                body=f"Marked '{title_label}' as posted",
                actor_user_id=user.id,
                related_draft_id=draft.id,
            )
    await db.commit()


@router.get("/clients/{client_id}/activity", response_model=list[ActivityEventOut])
async def list_client_activity(
    client_id: int,
    limit: int = 50,
    before: int | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    limit = max(1, min(limit, 100))
    stmt = (
        select(ClientActivityEvent)
        .where(ClientActivityEvent.agency_client_id == client_id)
        .order_by(ClientActivityEvent.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(ClientActivityEvent.id < before)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _event_to_out(db, e) for e in rows]


@router.post("/clients/{client_id}/activity/note", response_model=ActivityEventOut, status_code=http_status.HTTP_201_CREATED)
async def post_note(
    client_id: int,
    body: NoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    event = await emit_event(
        db,
        agency_client_id=client_id,
        event_type=EVENT_NOTE,
        body=body.body,
        actor_user_id=user.id,
    )
    await db.commit()
    await db.refresh(event)
    return await _event_to_out(db, event)


@router.patch("/activity/{event_id}/note", response_model=ActivityEventOut)
async def edit_note(
    event_id: int,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    event = await db.get(ClientActivityEvent, event_id)
    if event is None or event.event_type != EVENT_NOTE:
        raise HTTPException(status_code=404, detail="Note not found")
    await ensure_client_access(db, user, event.agency_client_id)
    if event.actor_user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not the author")
    event.body = body.body
    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)
    return await _event_to_out(db, event)


@router.delete("/activity/{event_id}/note", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_note(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    event = await db.get(ClientActivityEvent, event_id)
    if event is None or event.event_type != EVENT_NOTE:
        raise HTTPException(status_code=404, detail="Note not found")
    await ensure_client_access(db, user, event.agency_client_id)
    if event.actor_user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not the author")
    await db.delete(event)
    await db.commit()


@router.get("/staff", response_model=list[AgencyStaffOut])
async def list_staff(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    # NOTE: list_staff is intentionally not per-client filtered — drafting/task UIs
    # need the full staff roster to populate "assign to" dropdowns.
    rows = await db.execute(
        select(User)
        .join(AgencyStaff, AgencyStaff.user_id == User.id)
        .where(AgencyStaff.active == True)  # noqa: E712
        .order_by(User.email.asc())
    )
    users = rows.scalars().all()
    return [AgencyStaffOut(id=u.id, name=u.name, email=u.email) for u in users]


# ── Per-client staff assignment ──────────────────────────────────────────────


@router.get("/clients/{client_id}/staff-assigned", response_model=list[ClientStaffAssignmentOut])
async def list_client_assigned_staff(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
):
    """Staff members assigned to this client."""
    rows = await db.execute(
        select(User, AgencyClientAssignment)
        .join(AgencyClientAssignment, AgencyClientAssignment.staff_user_id == User.id)
        .where(AgencyClientAssignment.agency_client_id == client_id)
        .order_by(User.email.asc())
    )
    return [
        ClientStaffAssignmentOut(
            user_id=u.id, name=u.name, email=u.email, assigned_at=a.assigned_at
        )
        for u, a in rows.all()
    ]


@router.post(
    "/clients/{client_id}/staff-assigned/{user_id}",
    response_model=ClientStaffAssignmentOut,
    status_code=http_status.HTTP_201_CREATED,
)
async def assign_staff_to_client(
    client_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _caller: User = Depends(require_client_access),
):
    """Assign a staff member to this client. Idempotent."""
    target = await db.get(User, user_id)
    if target is None or not getattr(target, "is_agency_staff", False):
        raise HTTPException(status_code=404, detail="Staff user not found")
    existing = await db.execute(
        select(AgencyClientAssignment).where(
            AgencyClientAssignment.agency_client_id == client_id,
            AgencyClientAssignment.staff_user_id == user_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is None:
        row = AgencyClientAssignment(agency_client_id=client_id, staff_user_id=user_id)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return ClientStaffAssignmentOut(
        user_id=target.id, name=target.name, email=target.email, assigned_at=row.assigned_at
    )


@router.delete(
    "/clients/{client_id}/staff-assigned/{user_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
)
async def unassign_staff_from_client(
    client_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _caller: User = Depends(require_client_access),
):
    """Remove a staff assignment. Idempotent."""
    await db.execute(
        AgencyClientAssignment.__table__.delete().where(
            AgencyClientAssignment.agency_client_id == client_id,
            AgencyClientAssignment.staff_user_id == user_id,
        )
    )
    await db.commit()


# ── Document helpers ──────────────────────────────────────────────────────────

async def _doc_to_out(db: AsyncSession, doc: ClientDocument) -> DocumentOut:
    name: str | None = None
    if doc.generated_by_user_id is not None:
        u = await db.get(User, doc.generated_by_user_id)
        name = (u.name or u.email) if u else None
    return DocumentOut(
        id=doc.id,
        agency_client_id=doc.agency_client_id,
        kind=doc.kind,
        title=doc.title,
        body_markdown=doc.body_markdown,
        generated_by_user_id=doc.generated_by_user_id,
        generated_by_name=name,
        generated_at=doc.generated_at,
        updated_at=doc.updated_at,
    )


# ── Document endpoints ────────────────────────────────────────────────────────

@router.get("/document-templates", response_model=list[DocumentTemplateOut])
async def list_document_templates(
    _user: User = Depends(require_agency_staff),
):
    return [DocumentTemplateOut(kind=t.kind, name=t.name, description=t.description) for t in list_templates()]


@router.get("/clients/{client_id}/documents", response_model=list[DocumentOut])
async def list_client_documents(
    client_id: int,
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    stmt = select(ClientDocument).where(ClientDocument.agency_client_id == client_id)
    if kind:
        stmt = stmt.where(ClientDocument.kind == kind)
    stmt = stmt.order_by(ClientDocument.generated_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _doc_to_out(db, d) for d in rows]


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    await ensure_client_access(db, user, doc.agency_client_id)
    return await _doc_to_out(db, doc)


@router.get("/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    """Render an agency document as PDF (any registered kind)."""
    from fastapi import Response
    import re as _re
    from app.services.document_engine.pdf_renderer import render_pdf

    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    await ensure_client_access(db, user, doc.agency_client_id)
    try:
        pdf_bytes = await render_pdf(db, doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}") from e
    safe_title = _re.sub(r"[^a-zA-Z0-9_-]+", "-", (doc.title or f"weekly-report-{doc.id}"))[:120].strip("-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )


@router.post("/clients/{client_id}/documents", response_model=DocumentOut, status_code=http_status.HTTP_201_CREATED)
async def create_document(
    client_id: int,
    body: DocumentGenerateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    template = get_template(body.kind)
    if template is None:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=f"Unknown template kind: {body.kind}")
    try:
        doc = await generate_document(db, client=client, template=template, actor_user_id=user.id)
    except ValueError as e:
        # e.g., missing ANTHROPIC_API_KEY
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    return await _doc_to_out(db, doc)


@router.post("/clients/{client_id}/documents/{kind}/render")
async def render_document_pdf(
    client_id: int,
    kind: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Render a doc kind to PDF and return as binary download. One-click flow."""
    from fastapi import Response
    import re as _re

    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    template = get_template(kind)
    if template is None or template.typst_template is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown or unmigrated template kind: {kind}",
        )

    try:
        pdf_bytes, doc = await generate_pdf(
            db, client=client, template=template, actor_user_id=user.id,
        )
    except MissingDataError as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Missing required brand data — fill these in before generating.",
                "missing_fields": e.missing,
            },
        ) from e
    except LLMJSONError as e:
        logger.exception("LLM JSON error rendering %s", kind)
        raise HTTPException(status_code=500, detail=f"LLM output error: {e}") from e
    except TypstCompileError as e:
        logger.exception("Typst compile error rendering %s", kind)
        raise HTTPException(status_code=500, detail=f"PDF render error: {e}") from e
    except ValueError as e:
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e

    safe_title = _re.sub(r"[^a-zA-Z0-9_-]+", "-", (doc.title or f"{kind}-{doc.id}"))[:120].strip("-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )


@router.patch("/documents/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: int,
    body: DocumentUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    await ensure_client_access(db, user, doc.agency_client_id)
    doc.body_markdown = body.body_markdown
    doc.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(doc)
    return await _doc_to_out(db, doc)


@router.delete("/documents/{document_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    await ensure_client_access(db, user, doc.agency_client_id)
    await db.delete(doc)
    await db.commit()


@router.post(
    "/clients/{client_id}/drafts/generate",
    status_code=http_status.HTTP_201_CREATED,
)
async def agency_generate_draft(
    client_id: int,
    body: AgencyDraftGenerateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Generate a draft inside the agency portal. Bypasses SaaS tier checks."""
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")

    brand_q = await db.execute(
        select(Brand).where(Brand.agency_client_id == client_id).limit(1)
    )
    brand = brand_q.scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=404, detail="No brand attached to client")
    if brand.brand_type != "agency":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Brand is not agency-tier",
        )

    if body.platform not in ALL_DRAFT_PLATFORMS:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported platform. Must be one of {sorted(ALL_DRAFT_PLATFORMS)}",
        )

    prompt = await db.get(Prompt, body.prompt_id)
    if prompt is None or prompt.brand_id != brand.id:
        raise HTTPException(
            status_code=404,
            detail="Prompt not found for this client's brand",
        )

    try:
        draft = await generate_gap_draft(
            db=db,
            brand_id=brand.id,
            prompt_id=body.prompt_id,
            platform=body.platform,
            custom_brief=body.custom_brief,
            source="agency",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    await emit_event(
        db,
        agency_client_id=client_id,
        event_type=EVENT_DRAFT_GENERATED_BY_STAFF,
        body=f"Generated draft '{draft.title or f'Draft #{draft.id}'}' for {body.platform}",
        actor_user_id=user.id,
        payload={"prompt_id": body.prompt_id, "platform": body.platform, "draft_id": draft.id},
        related_draft_id=draft.id,
    )
    await db.commit()
    await db.refresh(draft)

    return {
        "id": draft.id,
        "brand_id": draft.brand_id,
        "prompt_id": draft.prompt_id,
        "platform": draft.platform,
        "status": draft.status,
        "title": draft.title,
        "content_text": draft.content_text,
        "content_brief": draft.content_brief,
        "estimated_impact": draft.estimated_impact,
        "source": draft.source,
        "assigned_to_user_id": getattr(draft, "assigned_to_user_id", None),
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
    }


@router.post(
    "/clients/{client_id}/tracking/run",
    status_code=http_status.HTTP_202_ACCEPTED,
)
async def agency_trigger_tracking(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Kick off a tracking run for an agency client's brand. Bypasses SaaS tier checks."""
    import asyncio as _asyncio

    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client_id).limit(1))
    brand = brand_q.scalar_one_or_none()
    if brand is None or brand.brand_type != "agency":
        raise HTTPException(status_code=400, detail="Brand is not agency-tier")

    from app.services.tracking_service import run_tracking

    _asyncio.create_task(
        run_tracking(brand_id=brand.id, run_type="manual", schedule_slot=None),
        name=f"agency-manual-{brand.id}",
    )
    return {"detail": "Tracking run started", "brand_id": brand.id}


def _draft_to_out(draft: ContentDraft) -> DraftOut:
    return DraftOut(
        id=draft.id,
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        platform=draft.platform,
        status=draft.status,
        title=draft.title,
        content_text=draft.content_text,
        content_brief=getattr(draft, "content_brief", None),
        estimated_impact=getattr(draft, "estimated_impact", None),
        source=draft.source,
        assigned_to_user_id=getattr(draft, "assigned_to_user_id", None),
        posted_at=getattr(draft, "posted_at", None),
        created_at=getattr(draft, "created_at", None),
        updated_at=getattr(draft, "updated_at", None),
    )


@router.post("/drafts/{draft_id}/mark-posted", response_model=DraftOut)
async def mark_draft_posted(
    draft_id: int,
    body: MarkPostedIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    """Flip a draft to 'posted', set posted_at, create a ContentPost row. Agency-only."""
    draft = await db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    brand = await db.get(Brand, draft.brand_id)
    if brand is None or brand.agency_client_id is None:
        raise HTTPException(status_code=400, detail="Draft is not on an agency brand")
    await ensure_client_access(db, user, brand.agency_client_id)
    if draft.status == "posted":
        return _draft_to_out(draft)
    if draft.status != "approved":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Draft must be 'approved' to mark as posted (current: {draft.status})",
        )
    now = datetime.utcnow()
    draft.status = "posted"
    draft.posted_at = now
    db.add(
        ContentPost(
            draft_id=draft.id,
            platform=draft.platform,
            post_url=body.post_url,
            posted_at=now,
        )
    )
    await emit_event(
        db,
        agency_client_id=brand.agency_client_id,
        event_type=EVENT_DRAFT_MARKED_POSTED,
        body=draft.title or f"Draft #{draft.id}",
        actor_user_id=user.id,
        related_draft_id=draft.id,
        payload={"post_url": body.post_url, "platform": draft.platform},
    )
    await db.commit()
    await db.refresh(draft)
    return _draft_to_out(draft)


@router.patch("/clients/{client_id}/proposal", response_model=AgencyClientOut)
async def update_client_proposal(
    client_id: int,
    body: ClientProposalUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Set the 'this week's proposal' pointer (Google Doc URL + label).

    Either field may be set to null to clear. Used by staff after sending out
    the weekly content proposal Google Doc.
    """
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    data = body.model_dump(exclude_unset=True)
    if "current_proposal_doc_url" in data:
        client.current_proposal_doc_url = data["current_proposal_doc_url"]
    if "current_proposal_label" in data:
        client.current_proposal_label = data["current_proposal_label"]
    client.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return await _client_to_out(db, client)


async def _milestone_to_out(db: AsyncSession, m: AgencyClientMilestone) -> AgencyClientMilestoneOut:
    completed_by_name: str | None = None
    if m.completed_by is not None:
        u = await db.execute(select(User.name, User.email).where(User.id == m.completed_by))
        row = u.first()
        if row is not None:
            completed_by_name = row.name or row.email
    return AgencyClientMilestoneOut(
        id=m.id,
        agency_client_id=m.agency_client_id,
        kind=m.kind,
        status=m.status,
        started_at=m.started_at,
        target_at=m.target_at,
        completed_at=m.completed_at,
        completed_by=m.completed_by,
        completed_by_name=completed_by_name,
        notes=m.notes,
    )


@router.get("/clients/{client_id}/milestones", response_model=list[AgencyClientMilestoneOut])
async def list_client_milestones(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
) -> list[AgencyClientMilestoneOut]:
    existing_q = await db.execute(
        select(AgencyClientMilestone).where(AgencyClientMilestone.agency_client_id == client_id)
    )
    existing = {m.kind: m for m in existing_q.scalars().all()}

    created_any = False
    for kind in MILESTONE_KINDS:
        if kind not in existing:
            row = AgencyClientMilestone(agency_client_id=client_id, kind=kind, status="not_started")
            db.add(row)
            existing[kind] = row
            created_any = True
    if created_any:
        await db.commit()
        for kind in MILESTONE_KINDS:
            await db.refresh(existing[kind])

    out = []
    for kind in MILESTONE_KINDS:
        out.append(await _milestone_to_out(db, existing[kind]))
    return out


@router.patch(
    "/clients/{client_id}/milestones/{kind}",
    response_model=AgencyClientMilestoneOut,
)
async def update_client_milestone(
    client_id: int,
    kind: str,
    body: AgencyClientMilestoneUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
) -> AgencyClientMilestoneOut:
    if kind not in MILESTONE_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown milestone kind: {kind}")
    if body.status is not None and body.status not in MILESTONE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status: {body.status}")

    row_q = await db.execute(
        select(AgencyClientMilestone)
        .where(
            AgencyClientMilestone.agency_client_id == client_id,
            AgencyClientMilestone.kind == kind,
        )
    )
    row = row_q.scalar_one_or_none()
    if row is None:
        row = AgencyClientMilestone(agency_client_id=client_id, kind=kind, status="not_started")
        db.add(row)
        await db.flush()

    prev_status = row.status
    if body.status is not None:
        row.status = body.status
        if body.status == "done" and prev_status != "done":
            row.completed_at = datetime.utcnow()
            row.completed_by = user.id
        elif body.status != "done" and prev_status == "done":
            row.completed_at = None
            row.completed_by = None
    if body.started_at is not None:
        row.started_at = body.started_at
    if body.target_at is not None:
        row.target_at = body.target_at
    if body.notes is not None:
        row.notes = body.notes

    await db.commit()
    await db.refresh(row)
    return await _milestone_to_out(db, row)
