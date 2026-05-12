"""
Brand Profile router — CRUD for the brand knowledge base.

Routes
------
GET    /api/brands/{brand_id}/profile   — get brand profile (creates if missing)
PUT    /api/brands/{brand_id}/profile   — update brand profile fields
"""

import json
import logging
from datetime import UTC
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, check_rate_limit, get_brand_for_user
from app.models import Brand, BrandProfile, BrandSource
from app.schemas import (
    AiFillProfileResponse,
    BrandProfileResponse,
    BrandProfileUpdate,
    BrandSourceCreate,
    BrandSourceOut,
    Publication,
    VoiceSampleCreate,
    VoiceSampleOut,
)
from app.services.drafting.evidence import BRAND_SOURCE_LIMIT

router = APIRouter(prefix="/brands", tags=["brand-profile"])
logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

VOICE_SAMPLE_CAP = 3

ALL_FIELDS = [
    "company_description",
    "key_stats",
    "tone_of_voice",
    "what_not_to_say",
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
            logger.warning("Failed to parse key_stats for brand_profile %d", profile.id)
    if profile.tone_of_voice and profile.tone_of_voice.strip():
        filled += 1
    if profile.what_not_to_say:
        try:
            items = json.loads(profile.what_not_to_say)
            if items:
                filled += 1
        except Exception:
            logger.warning("Failed to parse what_not_to_say for brand_profile %d", profile.id)
    if profile.approved_language:
        try:
            items = json.loads(profile.approved_language)
            if items:
                filled += 1
        except Exception:
            logger.warning("Failed to parse approved_language for brand_profile %d", profile.id)
    if profile.publications:
        try:
            pubs = json.loads(profile.publications)
            if pubs:
                filled += 1
        except Exception:
            logger.warning("Failed to parse publications for brand_profile %d", profile.id)
    return round((filled / len(ALL_FIELDS)) * 100, 1)


def _profile_to_response(profile: BrandProfile) -> BrandProfileResponse:
    def _parse_list(val: str | None) -> list:
        if not val:
            return []
        try:
            return json.loads(val)
        except Exception:
            return []

    def _parse_publications(val: str | None) -> list:
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
        approved_language=_parse_list(profile.approved_language),
        publications=_parse_publications(profile.publications),
        market_scope=profile.market_scope,
        geography=profile.geography,
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
    if payload.approved_language is not None:
        profile.approved_language = json.dumps(payload.approved_language)
    if payload.publications is not None:
        profile.publications = json.dumps([p.model_dump() for p in payload.publications])
    if "market_scope" in payload.model_fields_set:
        profile.market_scope = payload.market_scope
    if payload.geography is not None:
        profile.geography = payload.geography.strip() or None

    try:
        await db.commit()
    except OperationalError as exc:
        if "database is locked" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="A background task is running. Please wait a moment and try again.",
            ) from exc
        raise
    await db.refresh(profile)
    return _profile_to_response(profile)


@router.post("/{brand_id}/profile/ai-fill", response_model=AiFillProfileResponse)
async def ai_fill_profile(brand_id: int, db: DbDep, user: CurrentUser):
    """
    Scan the brand's website and return AI-generated suggestions for profile fields.
    Does NOT save anything — the frontend applies suggestions and user saves manually.
    """
    check_rate_limit(user.id, limit=3)

    import json
    import os

    from app.schemas import AiFillProfileResponse

    brand = await get_brand_for_user(brand_id, db, user)
    if not brand.website_url:
        raise HTTPException(status_code=400, detail="Brand has no website URL. Add one in Brand Settings first.")

    profile = await _get_or_create_profile(db, brand_id)

    # Use cached context if available, else fetch now
    context = profile.internal_brand_context
    if not context:
        from app.services.jina_service import fetch_website_context
        try:
            context = await fetch_website_context(brand.website_url)
            from datetime import datetime
            profile.internal_brand_context = context
            profile.website_context_last_fetched = datetime.now(UTC).replace(tzinfo=None)
            await db.commit()
        except Exception as exc:
            logger.warning("AI fill: Jina fetch failed for brand %d: %s", brand_id, exc)
            raise HTTPException(status_code=422, detail="Could not read website content. Check that the URL is publicly accessible.")

    if not context or not context.strip():
        raise HTTPException(status_code=422, detail="Website content appears empty. Try refreshing or updating the URL.")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured.")

    prompt = f"""You are a brand analyst. Based on the website content below, extract structured brand profile information.

IMPORTANT: Always generate a description based on the website content provided, even if the brand name doesn't exactly match the website.

Website content for brand "{brand.name}":
---
{context[:8000]}
---

Return a JSON object with exactly these keys (use null for anything you cannot determine):
{{
  "company_description": "2-3 sentence description of what the company does, its products/services, and what makes it unique",
  "tone_of_voice": "1-2 sentence description of the brand's communication style and personality",
  "key_stats": ["list", "of", "up to 5 specific facts, numbers, or claims found on the site"]
}}

Return ONLY the JSON object, no markdown, no explanation. Never refuse or explain why you cannot generate a description — always produce your best answer from the content."""

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
    except Exception as exc:
        logger.warning("AI fill: LLM call failed for brand %d: %s", brand_id, exc)
        raise HTTPException(status_code=502, detail="AI generation failed. Please try again.")

    # Guard against LLM refusal text leaking through
    desc = data.get("company_description") or ""
    if any(desc.lower().startswith(p) for p in ["i cannot", "i can't", "i'm unable", "sorry,", "unfortunately,"]):
        data["company_description"] = None

    return AiFillProfileResponse(
        company_description=data.get("company_description") or None,
        tone_of_voice=data.get("tone_of_voice") or None,
        key_stats=[s for s in (data.get("key_stats") or []) if isinstance(s, str)],
    )


# ── BrandSource library ─────────────────────────────────────────────────────


@router.post("/{brand_id}/sources", response_model=BrandSourceOut)
async def create_brand_source(
    brand_id: int,
    payload: BrandSourceCreate,
    db: DbDep,
    user: CurrentUser,
):
    """Add a curated source (paper / article / stat / case study) to a brand's
    evidence library. Capped at BRAND_SOURCE_LIMIT per brand."""
    await get_brand_for_user(brand_id, db, user)

    count_result = await db.execute(
        select(func.count(BrandSource.id)).where(BrandSource.brand_id == brand_id)
    )
    count = count_result.scalar_one() or 0
    if count >= BRAND_SOURCE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Source cap reached ({BRAND_SOURCE_LIMIT}). "
                "Delete one before adding more."
            ),
        )

    title = payload.title or payload.url
    snippet = payload.snippet or ""

    src = BrandSource(
        brand_id=brand_id,
        title=title[:500],
        url=payload.url,
        snippet=snippet[:1500] if snippet else None,
        source_type=payload.source_type,
        added_by_user_id=user.id,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return src


@router.get("/{brand_id}/sources", response_model=list[BrandSourceOut])
async def list_brand_sources(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
):
    """List all curated sources for a brand (most-recently-added first)."""
    await get_brand_for_user(brand_id, db, user)
    result = await db.execute(
        select(BrandSource)
        .where(BrandSource.brand_id == brand_id)
        .order_by(BrandSource.added_at.desc())
    )
    return list(result.scalars().all())


@router.delete("/{brand_id}/sources/{source_id}", status_code=204)
async def delete_brand_source(
    brand_id: int,
    source_id: int,
    db: DbDep,
    user: CurrentUser,
):
    """Remove a curated source from the brand's evidence library."""
    await get_brand_for_user(brand_id, db, user)
    src = await db.get(BrandSource, source_id)
    if src is None or src.brand_id != brand_id:
        raise HTTPException(status_code=404, detail="Source not found")
    await db.delete(src)
    await db.commit()
    return Response(status_code=204)


# ── Voice samples ───────────────────────────────────────────────────────────


def _load_voice_samples(profile: BrandProfile | None) -> list[dict]:
    if profile is None or not profile.voice_samples:
        return []
    try:
        data = json.loads(profile.voice_samples)
        return data if isinstance(data, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


@router.post("/{brand_id}/voice-samples", response_model=VoiceSampleOut)
async def add_voice_sample(
    brand_id: int,
    payload: VoiceSampleCreate,
    db: DbDep,
    user: CurrentUser,
):
    """Add a writing sample to the brand's voice library.
    New samples insert at index 0 (most-recent-first). Capped at VOICE_SAMPLE_CAP."""
    await get_brand_for_user(brand_id, db, user)
    profile = await _get_or_create_profile(db, brand_id)
    samples = _load_voice_samples(profile)
    if len(samples) >= VOICE_SAMPLE_CAP:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Voice sample cap reached ({VOICE_SAMPLE_CAP}). "
                "Delete one before adding more."
            ),
        )
    samples.insert(0, {"title": payload.title, "text": payload.text})
    profile.voice_samples = json.dumps(samples)
    await db.commit()
    return VoiceSampleOut(index=0, title=payload.title, text=payload.text)


@router.get("/{brand_id}/voice-samples", response_model=list[VoiceSampleOut])
async def list_voice_samples(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
):
    """List all writing samples for a brand (most-recently-added first)."""
    await get_brand_for_user(brand_id, db, user)
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile = result.scalar_one_or_none()
    samples = _load_voice_samples(profile)
    return [
        VoiceSampleOut(index=i, title=s.get("title", ""), text=s.get("text", ""))
        for i, s in enumerate(samples)
    ]


@router.delete("/{brand_id}/voice-samples/{index}", status_code=204)
async def delete_voice_sample(
    brand_id: int,
    index: int,
    db: DbDep,
    user: CurrentUser,
):
    """Remove a voice sample by its index in the most-recent-first list."""
    await get_brand_for_user(brand_id, db, user)
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile = result.scalar_one_or_none()
    samples = _load_voice_samples(profile)
    if index < 0 or index >= len(samples):
        raise HTTPException(status_code=404, detail="Voice sample index out of range")
    samples.pop(index)
    if profile is not None:
        profile.voice_samples = json.dumps(samples)
        await db.commit()
    return Response(status_code=204)
