"""Website AIO API router."""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import desc, func, select

from app.database import AsyncSessionLocal
from app.dependencies import get_current_user
from app.models import (
    AgencyClient,
    AgencyStaff,
    Brand,
    BrandProfile,
    CitationSource,
    User,
    WebsiteAudit,
    WebsiteAuditFinding,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
    utcnow,
)
from app.schemas import (
    CitationDomainAgg,
    DraftArtifactRequest,
    DraftArtifactResponse,
    TriggerAuditOut,
    UpdateRecStatusRequest,
    WebsiteAuditFindingOut,
    WebsiteAuditPageOut,
    WebsiteAuditRecommendationOut,
    WebsiteAuditSummary,
)
from app.services.site_audit.constants import TIER_AUDIT_LIMITS
from app.services.site_audit.generators import (
    BrandSummary,
    KeyPage,
    build_llms_txt,
    build_robots_snippet,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/site-audit", tags=["site-audit"])


# ── Access helpers ────────────────────────────────────────────────────────────


async def _ensure_brand_access(brand_id: int, user: User) -> Brand:
    """Brand must belong to user, OR brand must belong to an AgencyClient and
    user must be active agency staff.
    """
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if brand is None:
            raise HTTPException(404, "brand not found")
        if brand.user_id == user.id:
            return brand
        # Agency staff: brand must be linked to an AgencyClient
        if user.is_agency_staff and brand.agency_client_id is not None:
            staff = (
                await db.execute(
                    select(AgencyStaff).where(
                        AgencyStaff.user_id == user.id,
                        AgencyStaff.active == True,  # noqa: E712
                    )
                )
            ).scalar_one_or_none()
            if staff:
                agency_client = await db.get(AgencyClient, brand.agency_client_id)
                if agency_client:
                    return brand
        raise HTTPException(403, "forbidden")


def _tier_or_403(brand: Brand, user: User) -> dict:
    """Gate audits to paid tiers. Pitch brands and Free users are blocked.

    Agency staff trigger via clients' brands. If staff has no personal sub,
    fall back to 'basic' since agency clients are paid (validated at signup).
    """
    if getattr(brand, "brand_type", None) == "pitch":
        raise HTTPException(403, "site audits not available for pitch brands")
    sub_tier: str | None = user.subscription_tier
    if not sub_tier and user.is_agency_staff:
        sub_tier = "basic"
    if not sub_tier:
        raise HTTPException(403, "site audits require a paid plan (Starter or above)")
    limits = TIER_AUDIT_LIMITS.get(sub_tier)
    if not limits:
        raise HTTPException(403, "site audits require a paid plan (Starter or above)")
    return limits


# ── Background task wrapper (module-level so tests can patch it) ─────────────


async def _create_pending_audit(brand_id: int) -> int:
    async with AsyncSessionLocal() as db:
        audit = WebsiteAudit(
            brand_id=brand_id,
            status="pending",
            triggered_by="user",
            started_at=utcnow(),
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        return audit.id


async def _run_audit_safe(*, brand_id: int, max_pages: int, audit_id: int) -> None:
    """Wrapper so background-task exceptions don't bubble; auditor handles its own errors too."""
    try:
        from app.services.site_audit.auditor import _run_audit_inner

        await _run_audit_inner(audit_id, brand_id, max_pages)
    except Exception as exc:  # noqa: BLE001
        logger.exception("background audit failed")
        from app.services.site_audit.auditor import _mark_failed

        await _mark_failed(audit_id, f"unexpected error: {exc}")


# ── Output helpers ────────────────────────────────────────────────────────────


def _finding_out(f: WebsiteAuditFinding) -> WebsiteAuditFindingOut:
    try:
        ev = json.loads(f.evidence) if f.evidence else {}
    except (json.JSONDecodeError, TypeError):
        ev = {}
    return WebsiteAuditFindingOut(
        id=f.id,
        audit_id=f.audit_id,
        page_id=f.page_id,
        check_id=f.check_id,
        severity=f.severity,
        category=f.category,
        message=f.message,
        evidence=ev,
    )


def _rec_out(r: WebsiteAuditRecommendation) -> WebsiteAuditRecommendationOut:
    try:
        ids = json.loads(r.linked_prompt_ids) if r.linked_prompt_ids else []
    except (json.JSONDecodeError, TypeError):
        ids = []
    return WebsiteAuditRecommendationOut(
        id=r.id,
        audit_id=r.audit_id,
        page_id=r.page_id,
        priority=r.priority,
        effort=r.effort,
        category=r.category,
        title=r.title,
        body=r.body,
        linked_prompt_ids=ids,
        expected_impact=r.expected_impact,
        llm_generated=r.llm_generated,
    )


def _page_out(p: WebsiteAuditPage) -> WebsiteAuditPageOut:
    try:
        schema_types = json.loads(p.schema_types) if p.schema_types else []
    except (json.JSONDecodeError, TypeError):
        schema_types = []
    return WebsiteAuditPageOut(
        id=p.id,
        audit_id=p.audit_id,
        url=p.url,
        page_type=p.page_type,
        http_status=p.http_status,
        title=p.title,
        h1_text=p.h1_text,
        word_count=p.word_count,
        fact_density=p.fact_density,
        is_js_rendered=p.is_js_rendered,
        page_score=p.page_score,
        content_score=p.content_score,
        structure_score=p.structure_score,
        schema_score=p.schema_score,
        schema_types=schema_types,
    )


# ── Endpoints (13) ───────────────────────────────────────────────────────────


@router.post("/{brand_id}/trigger", response_model=TriggerAuditOut, status_code=202)
async def trigger_audit(
    brand_id: int,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
):
    brand = await _ensure_brand_access(brand_id, user)
    if not brand.website_url:
        raise HTTPException(400, "brand has no website_url")
    limits = _tier_or_403(brand, user)

    async with AsyncSessionLocal() as db:
        # In-progress check
        running = (
            await db.execute(
                select(WebsiteAudit).where(
                    WebsiteAudit.brand_id == brand_id,
                    WebsiteAudit.status.in_(["pending", "crawling", "analyzing"]),
                )
            )
        ).scalar_one_or_none()
        if running:
            raise HTTPException(409, "an audit is already in progress")

        # Monthly cap
        cutoff = utcnow() - timedelta(days=30)
        recent_count = (
            await db.execute(
                select(func.count())
                .select_from(WebsiteAudit)
                .where(
                    WebsiteAudit.brand_id == brand_id,
                    WebsiteAudit.started_at >= cutoff,
                )
            )
        ).scalar_one()
        if recent_count >= limits["monthly_audits"]:
            raise HTTPException(403, f"monthly audit cap reached ({limits['monthly_audits']})")

    audit_id = await _create_pending_audit(brand_id)
    background.add_task(
        _run_audit_safe,
        brand_id=brand_id,
        max_pages=limits["max_pages"],
        audit_id=audit_id,
    )
    return TriggerAuditOut(audit_id=audit_id, status="pending")


@router.get("/{brand_id}/latest", response_model=WebsiteAuditSummary)
async def latest_audit(brand_id: int, user: User = Depends(get_current_user)):
    await _ensure_brand_access(brand_id, user)
    async with AsyncSessionLocal() as db:
        audit = (
            await db.execute(
                select(WebsiteAudit)
                .where(WebsiteAudit.brand_id == brand_id)
                .order_by(desc(WebsiteAudit.started_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        if not audit:
            raise HTTPException(404, "no audit yet")
        return WebsiteAuditSummary.model_validate(audit, from_attributes=True)


@router.get("/{brand_id}/history", response_model=list[WebsiteAuditSummary])
async def audit_history(
    brand_id: int,
    limit: int = Query(10, le=50),
    user: User = Depends(get_current_user),
):
    await _ensure_brand_access(brand_id, user)
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(WebsiteAudit)
                .where(WebsiteAudit.brand_id == brand_id)
                .order_by(desc(WebsiteAudit.started_at))
                .limit(limit)
            )
        ).scalars().all()
        return [WebsiteAuditSummary.model_validate(a, from_attributes=True) for a in rows]


@router.get("/audit/{audit_id}", response_model=WebsiteAuditSummary)
async def audit_detail(audit_id: int, user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)
    return WebsiteAuditSummary.model_validate(audit, from_attributes=True)


@router.get("/audit/{audit_id}/status", response_model=dict)
async def audit_status(audit_id: int, user: User = Depends(get_current_user)):
    """Lightweight status poll for in-progress audits (cheaper than full summary)."""
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)
    return {
        "audit_id": audit.id,
        "status": audit.status,
        "started_at": audit.started_at,
        "completed_at": audit.completed_at,
        "total_pages": audit.total_pages,
        "pages_failed": audit.pages_failed,
        "error_message": audit.error_message,
    }


@router.get("/audit/{audit_id}/pages", response_model=list[WebsiteAuditPageOut])
async def audit_pages(
    audit_id: int,
    page: int = 1,
    per_page: int = 50,
    sort: str = "score",
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id)
        if sort == "score":
            q = q.order_by(WebsiteAuditPage.page_score.asc().nulls_last())
        else:
            q = q.order_by(WebsiteAuditPage.url)
        offset = (page - 1) * per_page
        rows = (await db.execute(q.offset(offset).limit(per_page))).scalars().all()
        return [_page_out(r) for r in rows]


@router.get("/audit/{audit_id}/page/{page_id}", response_model=dict)
async def page_detail(
    audit_id: int,
    page_id: int,
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        page = await db.get(WebsiteAuditPage, page_id)
        if not page or page.audit_id != audit_id:
            raise HTTPException(404)
        findings = (
            await db.execute(
                select(WebsiteAuditFinding).where(
                    WebsiteAuditFinding.audit_id == audit_id,
                    WebsiteAuditFinding.page_id == page_id,
                )
            )
        ).scalars().all()
        recs = (
            await db.execute(
                select(WebsiteAuditRecommendation).where(
                    WebsiteAuditRecommendation.audit_id == audit_id,
                    WebsiteAuditRecommendation.page_id == page_id,
                )
            )
        ).scalars().all()
        return {
            "page": _page_out(page).model_dump(),
            "findings": [_finding_out(f).model_dump() for f in findings],
            "recommendations": [_rec_out(r).model_dump() for r in recs],
        }


@router.get("/audit/{audit_id}/findings", response_model=list[WebsiteAuditFindingOut])
async def audit_findings(
    audit_id: int,
    severity: str | None = None,
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditFinding).where(WebsiteAuditFinding.audit_id == audit_id)
        if severity:
            q = q.where(WebsiteAuditFinding.severity == severity)
        rows = (await db.execute(q)).scalars().all()
        return [_finding_out(f) for f in rows]


@router.get(
    "/audit/{audit_id}/recommendations",
    response_model=list[WebsiteAuditRecommendationOut],
)
async def audit_recommendations(
    audit_id: int,
    priority: str | None = None,
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditRecommendation).where(
            WebsiteAuditRecommendation.audit_id == audit_id
        )
        if priority:
            q = q.where(WebsiteAuditRecommendation.priority == priority)
        rows = (await db.execute(q)).scalars().all()
        return [_rec_out(r) for r in rows]


@router.get("/{brand_id}/citations", response_model=dict)
async def citations_overview(
    brand_id: int,
    days: int = 30,
    user: User = Depends(get_current_user),
):
    await _ensure_brand_access(brand_id, user)
    cutoff = utcnow() - timedelta(days=days)

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(
                    CitationSource.domain,
                    CitationSource.kind,
                    func.count(),
                )
                .where(
                    CitationSource.brand_id == brand_id,
                    CitationSource.extracted_at >= cutoff,
                )
                .group_by(CitationSource.domain, CitationSource.kind)
                .order_by(desc(func.count()))
                .limit(50)
            )
        ).all()
        by_domain = [
            CitationDomainAgg(domain=d, kind=k, count=c).model_dump()
            for d, k, c in rows
        ]
        total = sum(r["count"] for r in by_domain)
        own = sum(r["count"] for r in by_domain if r["kind"] == "own")
        comp = sum(r["count"] for r in by_domain if r["kind"] == "competitor")
        own_pct = (own / total * 100) if total else 0
        comp_pct = (comp / total * 100) if total else 0
        top_competitors = [r for r in by_domain if r["kind"] == "competitor"][:10]
        return {
            "by_domain": by_domain,
            "own_pct": round(own_pct, 1),
            "competitor_pct": round(comp_pct, 1),
            "top_competitor_domains": top_competitors,
        }


@router.get("/{brand_id}/llms-txt", response_class=Response)
async def llms_txt(brand_id: int, user: User = Depends(get_current_user)):
    brand = await _ensure_brand_access(brand_id, user)

    async with AsyncSessionLocal() as db:
        profile = (
            await db.execute(
                select(BrandProfile).where(BrandProfile.brand_id == brand_id)
            )
        ).scalar_one_or_none()
        latest = (
            await db.execute(
                select(WebsiteAudit)
                .where(
                    WebsiteAudit.brand_id == brand_id,
                    WebsiteAudit.status == "completed",
                )
                .order_by(desc(WebsiteAudit.started_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        pages: list[KeyPage] = []
        if latest:
            page_rows = (
                await db.execute(
                    select(WebsiteAuditPage)
                    .where(
                        WebsiteAuditPage.audit_id == latest.id,
                        WebsiteAuditPage.http_status == 200,
                    )
                    .order_by(desc(WebsiteAuditPage.page_score))
                    .limit(10)
                )
            ).scalars().all()
            for p in page_rows:
                pages.append(
                    KeyPage(
                        url=p.url,
                        title=p.title or p.url,
                        page_type=p.page_type,
                        score=p.page_score or 0.0,
                    )
                )

    summary = BrandSummary(
        name=brand.name,
        website_url=brand.website_url or "https://example.com",
        description=(profile.company_description if profile else None),
    )
    txt = build_llms_txt(summary, pages)
    return Response(content=txt, media_type="text/plain")


@router.get("/{brand_id}/robots-snippet", response_class=Response)
async def robots_snippet(
    brand_id: int,
    mode: str = Query("allow_all"),
    user: User = Depends(get_current_user),
):
    await _ensure_brand_access(brand_id, user)
    if mode not in ("allow_all", "search_only"):
        raise HTTPException(400, "mode must be 'allow_all' or 'search_only'")
    return Response(content=build_robots_snippet(mode), media_type="text/plain")


@router.post("/audit/{audit_id}/cancel", status_code=204)
async def cancel_audit(audit_id: int, user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit.status in ("completed", "failed", "cancelled"):
            return Response(status_code=204)
        audit.status = "cancelled"
        audit.completed_at = utcnow()
        await db.commit()
    return Response(status_code=204)


@router.post("/recommendation/{rec_id}/draft", response_model=DraftArtifactResponse)
async def draft_recommendation_artifact(
    rec_id: int,
    body: DraftArtifactRequest = DraftArtifactRequest(),
    user: User = Depends(get_current_user),
):
    """Generate (or regenerate) the paste-ready artifact for a recommendation."""
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec:
            raise HTTPException(404, "recommendation not found")
        audit = await db.get(WebsiteAudit, rec.audit_id)
        if not audit:
            raise HTTPException(404, "audit not found")
    brand = await _ensure_brand_access(audit.brand_id, user)
    _tier_or_403(brand, user)
    raise HTTPException(501, "draft generator not wired yet")


_VALID_REC_STATUS = {"pending", "applied", "dismissed"}


@router.patch("/recommendation/{rec_id}/status", status_code=204)
async def update_recommendation_status(
    rec_id: int,
    body: UpdateRecStatusRequest,
    user: User = Depends(get_current_user),
):
    if body.status not in _VALID_REC_STATUS:
        raise HTTPException(400, f"status must be one of {sorted(_VALID_REC_STATUS)}")
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec:
            raise HTTPException(404, "recommendation not found")
        audit = await db.get(WebsiteAudit, rec.audit_id)
        if not audit:
            raise HTTPException(404, "audit not found")
    await _ensure_brand_access(audit.brand_id, user)
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        rec.status = body.status
        await db.commit()
    return Response(status_code=204)
