"""Public, no-auth client review router. Token-gated via ClientReviewLink."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    AgencyClient,
    AgencyStaff,
    Brand,
    ClientDocument,
    ClientReviewLink,
    ContentDraft,
    Notification,
)
from app.schemas import (
    ChangesRequestIn,
    PublicDocumentSummaryOut,
    RejectIn,
    ReviewClientPageOut,
    ReviewDraftOut,
)
from app.services.agency_activity import emit_event

router = APIRouter(prefix="/api/public/review", tags=["public-review"])


async def _resolve_client_id(db: AsyncSession, token: str) -> int:
    q = await db.execute(
        select(ClientReviewLink).where(
            ClientReviewLink.token == token,
            ClientReviewLink.revoked_at.is_(None),
        )
    )
    link = q.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Review link not found or revoked")
    return link.agency_client_id


async def _get_pending_draft(db: AsyncSession, client_id: int, draft_id: int) -> ContentDraft:
    """Fetch a draft, verify it belongs to this client AND is in awaiting_client state."""
    brand_q = await db.execute(select(Brand.id).where(Brand.agency_client_id == client_id))
    brand_ids = list(brand_q.scalars().all())
    if not brand_ids:
        raise HTTPException(status_code=404, detail="No brand attached to this client")
    draft = await db.get(ContentDraft, draft_id)
    if draft is None or draft.brand_id not in brand_ids:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "awaiting_client":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Draft is in '{draft.status}' state, not awaiting client review",
        )
    return draft


_ACTION_VERB = {
    "approved": "approved",
    "changes_requested": "requested changes on",
    "rejected": "rejected",
}


async def _notify_staff(db: AsyncSession, client_id: int, draft: ContentDraft) -> None:
    """Insert a Notification row for each active agency staff user."""
    staff_q = await db.execute(
        select(AgencyStaff.user_id).where(AgencyStaff.active == True)  # noqa: E712
    )
    staff_ids = list(staff_q.scalars().all())
    if not staff_ids:
        return
    client_obj = await db.get(AgencyClient, client_id)
    client_label = client_obj.name if client_obj else "A client"
    verb = _ACTION_VERB.get(draft.status, "updated")
    title_text = f"{client_label} {verb} a draft"
    body_text = draft.title or f"Draft #{draft.id}"
    link_url = f"/agency/clients/{client_id}"
    for sid in staff_ids:
        db.add(
            Notification(
                user_id=sid,
                type="draft_reviewed",
                title=title_text,
                body=body_text,
                link=link_url,
                read=False,
            )
        )


@router.get("/{token}", response_model=ReviewClientPageOut)
async def get_review_page(token: str, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    brand_q = await db.execute(select(Brand.id).where(Brand.agency_client_id == client_id))
    brand_ids = list(brand_q.scalars().all())
    drafts: list[ContentDraft] = []
    if brand_ids:
        drafts_q = await db.execute(
            select(ContentDraft)
            .where(
                ContentDraft.brand_id.in_(brand_ids),
                ContentDraft.status == "awaiting_client",
            )
            .order_by(ContentDraft.created_at.asc())
        )
        drafts = list(drafts_q.scalars().all())
    return ReviewClientPageOut(
        client_name=client.name,
        drafts=[
            ReviewDraftOut(
                id=d.id,
                title=getattr(d, "title", None),
                platform=d.platform,
                content_text=d.content_text,
                created_at=d.created_at,
            )
            for d in drafts
        ],
    )


@router.post("/{token}/draft/{draft_id}/approve", status_code=http_status.HTTP_204_NO_CONTENT)
async def approve_draft(token: str, draft_id: int, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    now = datetime.utcnow()
    draft.status = "approved"
    draft.approved_at = now
    draft.client_reviewed_at = now
    await _notify_staff(db, client_id, draft)
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_approved",
        body=f"Client approved '{title_label}'",
        related_draft_id=draft.id,
    )
    await db.commit()


@router.post("/{token}/draft/{draft_id}/request-changes", status_code=http_status.HTTP_204_NO_CONTENT)
async def request_changes(
    token: str,
    draft_id: int,
    body: ChangesRequestIn,
    db: AsyncSession = Depends(get_db),
):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    draft.status = "changes_requested"
    draft.client_feedback = body.feedback
    draft.client_reviewed_at = datetime.utcnow()
    await _notify_staff(db, client_id, draft)
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_changes_requested",
        body=f"Client requested changes on '{title_label}'",
        payload={"feedback": body.feedback},
        related_draft_id=draft.id,
    )
    await db.commit()


@router.post("/{token}/draft/{draft_id}/reject", status_code=http_status.HTTP_204_NO_CONTENT)
async def reject_draft(
    token: str,
    draft_id: int,
    body: RejectIn,
    db: AsyncSession = Depends(get_db),
):
    client_id = await _resolve_client_id(db, token)
    draft = await _get_pending_draft(db, client_id, draft_id)
    draft.status = "rejected"
    draft.client_feedback = body.reason
    draft.client_reviewed_at = datetime.utcnow()
    await _notify_staff(db, client_id, draft)
    title_label = draft.title or f"Draft #{draft.id}"
    await emit_event(
        db,
        agency_client_id=client_id,
        event_type="client_rejected",
        body=f"Client rejected '{title_label}'",
        payload={"reason": body.reason},
        related_draft_id=draft.id,
    )
    await db.commit()


# ── Document library endpoints ────────────────────────────────────────────────

# Kinds that have a registered PDF template — must stay in sync with
# pdf_renderer._KIND_TO_TEMPLATE.
_PDF_AVAILABLE_KINDS = {"agency_weekly_report", "monthly_report", "sow", "audit_initial", "kickoff_checklist"}


@router.get("/{token}/documents", response_model=list[PublicDocumentSummaryOut])
async def list_documents(token: str, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    q = await db.execute(
        select(ClientDocument)
        .where(ClientDocument.agency_client_id == client_id)
        .order_by(ClientDocument.generated_at.desc())
    )
    docs = list(q.scalars().all())
    return [
        PublicDocumentSummaryOut(
            id=d.id,
            kind=d.kind,
            title=d.title,
            generated_at=d.generated_at,
            pdf_available=d.kind in _PDF_AVAILABLE_KINDS,
        )
        for d in docs
    ]


async def _resolve_client_doc(db: AsyncSession, token: str, doc_id: int) -> ClientDocument:
    client_id = await _resolve_client_id(db, token)
    doc = await db.get(ClientDocument, doc_id)
    if doc is None or doc.agency_client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{token}/document/{doc_id}", response_class=Response)
async def get_document_html(token: str, doc_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.document_engine.pdf_renderer import render_html, _resolve_data
    doc = await _resolve_client_doc(db, token, doc_id)
    data = await _resolve_data(db, doc)
    html = render_html(doc, data)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/{token}/document/{doc_id}/pdf", response_class=Response)
async def get_document_pdf(token: str, doc_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.document_engine.pdf_renderer import render_pdf
    doc = await _resolve_client_doc(db, token, doc_id)
    try:
        pdf_bytes = await render_pdf(db, doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}") from e
    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in doc.title)[:120].strip() or f"document-{doc.id}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
