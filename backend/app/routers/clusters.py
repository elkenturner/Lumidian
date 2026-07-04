"""Cluster API endpoints."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser

DbDep = Annotated[AsyncSession, Depends(get_db)]

from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentClusterSource,
    ContentDraft,
    ContentEvidencePack,
    DraftAttribution,
    Prompt,
)
from app.schemas import (
    ClusterPieceStatus,
    ClusterSourceItem,
    ClusterSourcesPayload,
    ClusterStatusPayload,
    ContentBriefSchema,
    ContentClusterDetail,
    ContentClusterSummary,
    ContentDraftSchema,
    EditBriefRequest,
    PillarCandidateSchema,
    RegeneratePieceRequest,
)
from app.services.cluster_pillar import propose_pillar
from app.services.clustering_service import (
    CLUSTER_PLATFORMS,
    get_or_create_cluster,
    regenerate_cluster,
    regenerate_piece,
)
from app.services.drafting_service import _get_prompt_visibility

router = APIRouter(prefix="/clusters", tags=["clusters"])


async def _cluster_lift_for_prompt(
    db: AsyncSession, prompt_id: int, brand_id: int,
) -> float | None:
    """Cluster lift = current visibility for the prompt minus the visibility
    at the time the FIRST posted draft for this prompt went live.

    Keyed on prompt_id (not cluster_id) so every posted draft for the prompt
    contributes — cluster-sourced, legacy gap-driven, Wikipedia surface.
    Returns None if no posted drafts exist for the prompt.
    """
    from app.models import DraftAttribution as _DA
    first_attr = (await db.execute(
        select(_DA)
        .join(ContentDraft, ContentDraft.id == _DA.draft_id)
        .where(
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
        )
        .order_by(_DA.id.asc())
        .limit(1)
    )).scalar_one_or_none()
    if first_attr is None:
        return None
    current = await _get_prompt_visibility(db, prompt_id)
    return round(float(current) - float(first_attr.score_at_posting), 2)


async def _posted_count_for_prompt(
    db: AsyncSession, prompt_id: int, brand_id: int,
) -> int:
    from sqlalchemy import func as _func
    n = (await db.execute(
        select(_func.count(ContentDraft.id)).where(
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "posted",
        )
    )).scalar_one()
    return int(n or 0)


async def _ensure_brand_owned(db: AsyncSession, brand_id: int, user_id: int) -> Brand:
    brand = (await db.execute(
        select(Brand).where(Brand.id == brand_id, Brand.user_id == user_id)
    )).scalar_one_or_none()
    if brand is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Brand not found")
    return brand


def _summarize_pieces(drafts: list[ContentDraft]) -> list[dict]:
    out = []
    for d in drafts:
        out.append({
            "platform": d.platform,
            "draft_id": d.id,
            "status": d.status,
            "title": d.title,
            "excerpt": (d.content_text or "")[:140],
            "low_evidence": d.low_evidence,
        })
    return out


@router.get("/{brand_id}", response_model=list[ContentClusterSummary])
async def list_clusters(brand_id: int, db: DbDep, user: CurrentUser) -> list[dict]:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    rows = (await db.execute(
        select(ContentCluster).where(ContentCluster.brand_id == brand.id)
    )).scalars().all()

    out: list[dict] = []
    for cluster in rows:
        prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
        )).scalars().all()

        # Lift + posted count keyed on prompt_id so legacy + Wikipedia
        # posted drafts (cluster_id=NULL) also contribute to the cluster card.
        cluster_delta = await _cluster_lift_for_prompt(db, cluster.prompt_id, cluster.brand_id)
        posted_count = await _posted_count_for_prompt(db, cluster.prompt_id, cluster.brand_id)

        out.append({
            "id": cluster.id,
            "brand_id": cluster.brand_id,
            "prompt_id": cluster.prompt_id,
            "prompt_text": prompt.text,
            "status": cluster.status,
            "pillar_mode": cluster.pillar_mode,
            "pillar_url": cluster.pillar_url,
            "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
            "pieces": _summarize_pieces(drafts),
            "version": cluster.version,
            "last_generated_at": cluster.last_generated_at,
            "cluster_delta": cluster_delta,
            "posted_count": posted_count,
        })
    # Sort by visibility ascending (lowest needs most attention)
    out.sort(key=lambda c: c["visibility_pct"])
    return out


@router.get("/{brand_id}/{cluster_id}", response_model=ContentClusterDetail)
async def get_cluster(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")

    prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brief = None
    if cluster.last_brief_id:
        brief = (await db.execute(select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id))).scalar_one_or_none()
    drafts = (await db.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )).scalars().all()
    # Per-draft citations — single batched query keyed by draft id.
    from app.models import ContentDraftCitation
    draft_ids = [d.id for d in drafts] or [-1]
    citation_rows = (await db.execute(
        select(ContentDraftCitation).where(
            ContentDraftCitation.draft_id.in_(draft_ids)
        )
    )).scalars().all()
    cites_by_draft: dict[int, list] = {}
    for c in citation_rows:
        cites_by_draft.setdefault(c.draft_id, []).append({
            "source_ref": c.source_ref,
            "url": c.url,
            "title": c.title,
            "position_marker": c.position_marker,
            "tier": c.tier,
        })

    # Per-draft attribution — single batched query keyed by draft id.
    attribution_rows = (await db.execute(
        select(DraftAttribution).where(
            DraftAttribution.draft_id.in_(draft_ids)
        )
    )).scalars().all()
    delta_by_draft: dict[int, float | None] = {a.draft_id: a.delta for a in attribution_rows}

    drafts_out = []
    for d in drafts:
        drafts_out.append({
            "id": d.id,
            "brand_id": d.brand_id,
            "prompt_id": d.prompt_id,
            "cluster_id": d.cluster_id,
            "platform": d.platform,
            "status": d.status,
            "title": d.title,
            "content_text": d.content_text,
            "quality_score": d.quality_score,
            "posted_at": d.posted_at,
            "generation_state": d.generation_state,
            "failure_reason": d.failure_reason,
            "citations": cites_by_draft.get(d.id, []),
            "attribution_delta": delta_by_draft.get(d.id),
            "low_evidence": d.low_evidence,
            "posted_url": d.posted_url,
            "brief_version": d.brief_version,
        })

    # Lift + posted count keyed on prompt_id so legacy + Wikipedia
    # posted drafts (cluster_id=NULL) also contribute to the cluster card.
    cluster_delta = await _cluster_lift_for_prompt(db, cluster.prompt_id, cluster.brand_id)
    posted_count = await _posted_count_for_prompt(db, cluster.prompt_id, cluster.brand_id)

    return {
        "id": cluster.id,
        "brand_id": cluster.brand_id,
        "prompt_id": cluster.prompt_id,
        "prompt_text": prompt.text,
        "status": cluster.status,
        "pillar_mode": cluster.pillar_mode,
        "pillar_url": cluster.pillar_url,
        "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
        "brief": ContentBriefSchema.model_validate(brief) if brief else None,
        "drafts": drafts_out,
        "version": cluster.version,
        "last_generated_at": cluster.last_generated_at,
        "cluster_delta": cluster_delta,
        "posted_count": posted_count,
    }


@router.post("/{brand_id}/by-prompt/{prompt_id}/regenerate", response_model=ContentClusterDetail)
async def regenerate_by_prompt(brand_id: int, prompt_id: int, db: DbDep, user: CurrentUser) -> dict:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    prompt = (await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand.id)
    )).scalar_one_or_none()
    if prompt is None:
        raise HTTPException(404, "Prompt not found")
    cluster = await get_or_create_cluster(db, brand_id=brand.id, prompt_id=prompt.id)
    await regenerate_cluster(db, cluster_id=cluster.id, tier=user.subscription_tier)
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/regenerate-piece", response_model=ContentDraftSchema)
async def regenerate_piece_endpoint(
    brand_id: int,
    cluster_id: int,
    request: RegeneratePieceRequest,
    db: DbDep,
    user: CurrentUser,
) -> ContentDraft:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    if request.platform not in CLUSTER_PLATFORMS:
        raise HTTPException(400, f"Platform {request.platform} not in cluster set")
    # Honor BrandContentSettings: a platform disabled at the brand level cannot
    # have its working draft regenerated.
    from app.models import BrandContentSettings
    bcs = (await db.execute(
        select(BrandContentSettings).where(
            BrandContentSettings.brand_id == brand.id,
            BrandContentSettings.platform == request.platform,
        )
    )).scalar_one_or_none()
    if bcs is not None and not bcs.enabled:
        raise HTTPException(
            400,
            f"Platform {request.platform} is disabled in brand settings. Enable it before regenerating.",
        )
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand.id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    return await regenerate_piece(
        db,
        cluster_id=cluster.id,
        platform=request.platform,
        tier=user.subscription_tier,
    )


@router.patch("/{brand_id}/{cluster_id}/brief", response_model=ContentBriefSchema)
async def edit_brief(
    brand_id: int,
    cluster_id: int,
    request: EditBriefRequest,
    db: DbDep,
    user: CurrentUser,
) -> ContentBrief:
    """Save brief edits as a NEW version. Does NOT update last_brief_id —
    that field only moves when pieces are actually regenerated from the brief
    (see regenerate_cluster). This is the 'draft brief' semantics: edits are
    persisted, but the cluster still reflects pieces generated from an earlier
    version until the user explicitly regenerates."""
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")

    # Find the current head version (highest)
    head = (await db.execute(
        select(ContentBrief).where(ContentBrief.cluster_id == cluster.id)
        .order_by(ContentBrief.version.desc())
    )).scalars().first()
    if head is None:
        raise HTTPException(404, "No brief to edit")

    new = ContentBrief(
        cluster_id=cluster.id,
        version=head.version + 1,
        positioning=request.positioning if request.positioning is not None else head.positioning,
        key_claims=request.key_claims if request.key_claims is not None else head.key_claims,
        canonical_phrasings=request.canonical_phrasings if request.canonical_phrasings is not None else head.canonical_phrasings,
        stats=request.stats if request.stats is not None else head.stats,
        competitor_context=head.competitor_context,
        narrative_spine=request.narrative_spine if request.narrative_spine is not None else head.narrative_spine,
        tone_notes=request.tone_notes if request.tone_notes is not None else head.tone_notes,
        created_by=f"user:{user.id}",
    )
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return new


@router.post("/{brand_id}/{cluster_id}/pillar/accept", response_model=ContentClusterDetail)
async def accept_pillar(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    if cluster.pillar_mode != "proposed":
        raise HTTPException(400, "No pillar proposal to accept")
    cluster.pillar_mode = "attached"
    await db.commit()
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/pillar/reject", response_model=ContentClusterDetail)
async def reject_pillar(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    cluster.pillar_mode = "none"
    cluster.pillar_url = None
    await db.commit()
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/pillar/propose", response_model=PillarCandidateSchema | None)
async def propose_pillar_endpoint(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> PillarCandidateSchema | None:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    cand = await propose_pillar(db, cluster)
    if cand is None:
        return None
    return PillarCandidateSchema(
        page_id=cand.page_id,
        url=cand.url,
        title=cand.title,
        tone_score=cand.tone_score,
        tone_reasoning=cand.tone_reasoning,
    )


@router.get("/{brand_id}/{cluster_id}/status", response_model=ClusterStatusPayload)
async def cluster_status(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    drafts = (await db.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )).scalars().all()
    return ClusterStatusPayload(
        status=cluster.status,
        failure_reason=cluster.failure_reason,
        pieces=[ClusterPieceStatus(
            platform=d.platform, draft_id=d.id, status=d.status,
            generation_state=d.generation_state, failure_reason=d.failure_reason,
        ) for d in drafts],
        version=cluster.version,
        last_generated_at=cluster.last_generated_at,
    )


@router.post("/{brand_id}/{cluster_id}/regenerate-pieces", response_model=ContentClusterDetail)
async def regenerate_pieces(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    await regenerate_cluster(
        db, cluster_id=cluster.id, tier=user.subscription_tier, rebuild_brief=False,
    )
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/rebuild", response_model=ContentClusterDetail)
async def rebuild_cluster(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    await regenerate_cluster(
        db, cluster_id=cluster.id, tier=user.subscription_tier, rebuild_brief=True,
    )
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.get("/{brand_id}/{cluster_id}/sources", response_model=ClusterSourcesPayload)
async def cluster_sources(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    pack = (await db.execute(
        select(ContentEvidencePack)
        .where(ContentEvidencePack.cluster_id == cluster.id)
        .order_by(ContentEvidencePack.version.desc())
    )).scalars().first()
    if pack is None:
        return ClusterSourcesPayload(total_t1=0, total_t2=0, total_t3=0, sources=[])
    rows = (await db.execute(
        select(ContentClusterSource).where(
            ContentClusterSource.cluster_id == cluster.id,
        )
    )).scalars().all()
    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    rows = sorted(rows, key=lambda r: (tier_order[r.tier], -r.times_cited))
    return ClusterSourcesPayload(
        total_t1=pack.total_t1, total_t2=pack.total_t2, total_t3=pack.total_t3,
        sources=[ClusterSourceItem(
            url=r.url, domain=r.domain, tier=r.tier, title=r.title,
            times_cited=r.times_cited,
        ) for r in rows],
    )


@router.get("/{brand_id}/{cluster_id}/briefs", response_model=list[ContentBriefSchema])
async def brief_history(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    rows = (await db.execute(
        select(ContentBrief).where(ContentBrief.cluster_id == cluster_id)
        .order_by(ContentBrief.version.desc())
    )).scalars().all()
    return rows
