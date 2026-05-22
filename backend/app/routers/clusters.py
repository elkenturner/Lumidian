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
    ContentDraft,
    Prompt,
)
from app.schemas import (
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
        "drafts": [ContentDraftSchema.model_validate(d) for d in drafts],
        "version": cluster.version,
        "last_generated_at": cluster.last_generated_at,
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
