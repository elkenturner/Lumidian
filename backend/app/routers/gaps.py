"""
Content Gaps router — retrieve gap analysis results.

Routes
------
GET  /api/gaps/{brand_id}            — list all gaps for a brand (sorted by gap_score desc)
GET  /api/gaps/{brand_id}/summary    — summary stats (total gaps, avg score, top competitors)
POST /api/gaps/{brand_id}/refresh    — trigger gap analysis on latest completed run
"""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, check_rate_limit, get_brand_for_user, require_active_subscription, require_brand_active
from app.models import ContentGap, Prompt, TrackingRun
from app.schemas import ContentGapResponse

router = APIRouter(prefix="/gaps", tags=["gaps"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _gap_to_response(gap: ContentGap, prompt_text: str | None = None) -> ContentGapResponse:
    def _parse(val: str | None, default):
        if not val:
            return default
        try:
            return json.loads(val)
        except Exception:
            return default

    return ContentGapResponse(
        id=gap.id,
        brand_id=gap.brand_id,
        prompt_id=gap.prompt_id,
        prompt_text=prompt_text,
        tracking_run_id=gap.tracking_run_id,
        model=gap.model,
        severity_score=gap.severity_score,
        opportunity_score=gap.opportunity_score,
        recency_score=gap.recency_score,
        gap_score=gap.gap_score,
        competitor_mentions=_parse(gap.competitor_mentions, {}),
        platforms_lacking=_parse(gap.platforms_lacking, []),
        quora_questions=_parse(gap.quora_questions, []),
        prompt_visibility=gap.prompt_visibility,
        last_content_at=gap.last_content_at,
        identified_at=gap.identified_at,
        created_at=gap.created_at,
    )


@router.get("/{brand_id}", response_model=list[ContentGapResponse])
async def list_gaps(brand_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)

    gaps_result = await db.execute(
        select(ContentGap)
        .where(ContentGap.brand_id == brand_id)
        .order_by(ContentGap.gap_score.desc())
    )
    gaps = gaps_result.scalars().all()

    # Load prompt texts
    prompt_ids = list({g.prompt_id for g in gaps})
    prompts_by_id: dict[int, str] = {}
    if prompt_ids:
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id.in_(prompt_ids))
        )
        prompts_by_id = {p.id: p.text for p in prompt_result.scalars().all()}

    return [_gap_to_response(g, prompts_by_id.get(g.prompt_id)) for g in gaps]


@router.get("/{brand_id}/summary")
async def gap_summary(brand_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)

    result = await db.execute(
        select(
            func.count(ContentGap.id).label("total_gaps"),
            func.avg(ContentGap.gap_score).label("avg_score"),
            func.avg(ContentGap.prompt_visibility).label("avg_visibility"),
        ).where(ContentGap.brand_id == brand_id)
    )
    row = result.one()

    # Top competitors from JSON blobs
    gaps_result = await db.execute(
        select(ContentGap.competitor_mentions)
        .where(ContentGap.brand_id == brand_id, ContentGap.competitor_mentions.isnot(None))
    )
    combined: dict[str, int] = {}
    for (mentions_json,) in gaps_result.all():
        try:
            d = json.loads(mentions_json)
            for name, count in d.items():
                combined[name] = combined.get(name, 0) + count
        except Exception:
            pass

    top_competitors = sorted(combined.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "brand_id": brand_id,
        "total_gaps": row.total_gaps or 0,
        "avg_gap_score": round(row.avg_score or 0, 2),
        "avg_prompt_visibility": round(row.avg_visibility or 0, 2),
        "top_competitors": [{"name": n, "mention_count": c} for n, c in top_competitors],
    }


@router.post("/{brand_id}/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_gaps(brand_id: int, db: DbDep, user: CurrentUser):
    """Trigger gap analysis on the latest completed run for this brand."""
    require_active_subscription(user)
    check_rate_limit(user.id, limit=3)
    brand = await get_brand_for_user(brand_id, db, user)
    require_brand_active(brand, user)

    run_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    run = run_result.scalar_one_or_none()
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No completed tracking run found for this brand",
        )

    import asyncio

    from app.services.gap_analysis_service import run_gap_analysis
    asyncio.create_task(run_gap_analysis(brand_id, run.id))

    return {"message": "Gap analysis started", "run_id": run.id}
