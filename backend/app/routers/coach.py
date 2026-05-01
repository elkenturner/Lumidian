"""Coach router: SSE message endpoint + usage endpoint."""
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import CurrentUser, DbDep
from app.models import Brand, User
from app.services.coach_rate_limit import check_and_increment, get_usage, _resets_at_iso
from app.services.coach_service import run_turn


router = APIRouter(prefix="/api/coach", tags=["coach"])


class CoachMessage(BaseModel):
    role: str
    content: object  # str or list of blocks


class CoachMessageRequest(BaseModel):
    messages: list[CoachMessage]


async def _verify_brand(db: AsyncSession, *, user_id: int, brand_id: int) -> Brand:
    brand = (await db.execute(
        select(Brand).where(Brand.id == brand_id, Brand.user_id == user_id)
    )).scalar_one_or_none()
    if brand is None:
        raise HTTPException(status_code=404, detail="Brand not found")
    return brand


@router.get("/{brand_id}/usage")
async def coach_usage(
    brand_id: int,
    user: CurrentUser,
    db: DbDep,
):
    await _verify_brand(db, user_id=user.id, brand_id=brand_id)
    return await get_usage(db, user_id=user.id, tier=user.subscription_tier)


@router.post("/{brand_id}/message")
async def coach_message(
    brand_id: int,
    req: CoachMessageRequest,
    request: Request,
    user: CurrentUser,
    db: DbDep,
):
    brand = await _verify_brand(db, user_id=user.id, brand_id=brand_id)
    # Pitch brands use Free tier caps regardless of subscription
    effective_tier = None if brand.brand_type == "pitch" else user.subscription_tier
    allowed, used, limit = await check_and_increment(db, user_id=user.id, tier=effective_tier)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"used": used, "limit": limit, "resets_at": _resets_at_iso(), "tier": effective_tier},
        )

    async def event_stream():
        try:
            async for event in run_turn(
                db=db, user=user, brand_id=brand_id,
                messages=[m.model_dump() for m in req.messages],
            ):
                if await request.is_disconnected():
                    return
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        except Exception:
            yield "event: error\ndata: {\"message\": \"Coach hit an unexpected error.\"}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
