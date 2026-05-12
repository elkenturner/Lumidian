"""
Voice anchoring and cross-referencing for Pro-tier drafts.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BrandProfile, ContentDraft

logger = logging.getLogger(__name__)


async def select_voice_sample(
    brand_id: int,
    platform: str,
    db: AsyncSession,
) -> str | None:
    """
    Precedence:
      1. Most recent entry in BrandProfile.voice_samples (user-uploaded)
      2. Highest-quality_score approved ContentDraft on the same platform
      3. None
    """
    profile_row = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile = profile_row.scalar_one_or_none()
    if profile and profile.voice_samples:
        try:
            samples = json.loads(profile.voice_samples)
            if isinstance(samples, list) and samples:
                first = samples[0]
                text = (first or {}).get("text")
                if text:
                    return text
        except (json.JSONDecodeError, AttributeError):
            logger.warning("Malformed voice_samples JSON for brand %d", brand_id)

    draft_row = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.platform == platform,
            ContentDraft.status == "approved",
            ContentDraft.quality_score.is_not(None),
        )
        .order_by(desc(ContentDraft.quality_score), desc(ContentDraft.posted_at))
        .limit(1)
    )
    draft = draft_row.scalar_one_or_none()
    if draft and draft.content_text:
        return draft.content_text

    return None
