"""
Brand Profile router — CRUD for the brand knowledge base.

Routes
------
GET    /api/brands/{brand_id}/profile   — get brand profile (creates if missing)
PUT    /api/brands/{brand_id}/profile   — update brand profile fields
"""

import json
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_brand_for_user
from app.models import Brand, BrandProfile
from app.schemas import BrandProfileResponse, BrandProfileUpdate, Publication

router = APIRouter(prefix="/brands", tags=["brand-profile"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

ALL_FIELDS = [
    "company_description",
    "key_stats",
    "tone_of_voice",
    "what_not_to_say",
    "target_audience",
    "approved_language",
    "publications",
]


def _compute_completion(profile: BrandProfile) -> float:
    filled = 0
    if profile.company_description and profile.company_description.strip():
        filled += 1
    if profile.key_stats:
        try:
            stats = json.loads(profile.key_stats)
            if stats:
                filled += 1
        except Exception:
            pass
    if profile.tone_of_voice and profile.tone_of_voice.strip():
        filled += 1
    if profile.what_not_to_say:
        try:
            items = json.loads(profile.what_not_to_say)
            if items:
                filled += 1
        except Exception:
            pass
    if profile.target_audience and profile.target_audience.strip():
        filled += 1
    if profile.approved_language:
        try:
            items = json.loads(profile.approved_language)
            if items:
                filled += 1
        except Exception:
            pass
    if profile.publications:
        try:
            pubs = json.loads(profile.publications)
            if pubs:
                filled += 1
        except Exception:
            pass
    return round((filled / len(ALL_FIELDS)) * 100, 1)


def _profile_to_response(profile: BrandProfile) -> BrandProfileResponse:
    def _parse_list(val: Optional[str]) -> list:
        if not val:
            return []
        try:
            return json.loads(val)
        except Exception:
            return []

    def _parse_publications(val: Optional[str]) -> list:
        if not val:
            return []
        try:
            raw = json.loads(val)
            return [Publication(**p) if isinstance(p, dict) else p for p in raw]
        except Exception:
            return []

    return BrandProfileResponse(
        id=profile.id,
        brand_id=profile.brand_id,
        company_description=profile.company_description,
        key_stats=_parse_list(profile.key_stats),
        tone_of_voice=profile.tone_of_voice,
        what_not_to_say=_parse_list(profile.what_not_to_say),
        target_audience=profile.target_audience,
        approved_language=_parse_list(profile.approved_language),
        publications=_parse_publications(profile.publications),
        completion_pct=_compute_completion(profile),
        internal_brand_context=profile.internal_brand_context,
        website_context_last_fetched=profile.website_context_last_fetched,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _get_brand_or_404(db: AsyncSession, brand_id: int) -> Brand:
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if brand is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Brand {brand_id} not found",
        )
    return brand


async def _get_or_create_profile(db: AsyncSession, brand_id: int) -> BrandProfile:
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = BrandProfile(brand_id=brand_id)
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return profile


@router.get("/{brand_id}/profile", response_model=BrandProfileResponse)
async def get_brand_profile(brand_id: int, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)
    profile = await _get_or_create_profile(db, brand_id)
    return _profile_to_response(profile)


@router.put("/{brand_id}/profile", response_model=BrandProfileResponse)
async def update_brand_profile(brand_id: int, payload: BrandProfileUpdate, db: DbDep, user: CurrentUser):
    await get_brand_for_user(brand_id, db, user)
    profile = await _get_or_create_profile(db, brand_id)

    if payload.company_description is not None:
        profile.company_description = payload.company_description
    if payload.key_stats is not None:
        profile.key_stats = json.dumps(payload.key_stats)
    if payload.tone_of_voice is not None:
        profile.tone_of_voice = payload.tone_of_voice
    if payload.what_not_to_say is not None:
        profile.what_not_to_say = json.dumps(payload.what_not_to_say)
    if payload.target_audience is not None:
        profile.target_audience = payload.target_audience
    if payload.approved_language is not None:
        profile.approved_language = json.dumps(payload.approved_language)
    if payload.publications is not None:
        profile.publications = json.dumps([p.model_dump() for p in payload.publications])

    await db.commit()
    await db.refresh(profile)
    return _profile_to_response(profile)
