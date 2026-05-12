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


# ── Cross-reference ─────────────────────────────────────────────────────────

import os

from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key)


async def select_related_draft(
    brand_id: int,
    prompt_id: int,
    exclude_platform: str,
    db: AsyncSession,
) -> str | None:
    """Return a one-line summary of one sibling approved draft for cross-referencing, or None."""
    row = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.platform != exclude_platform,
            ContentDraft.status.in_(["approved", "posted"]),
        )
        .order_by(desc(ContentDraft.posted_at), desc(ContentDraft.approved_at))
        .limit(1)
    )
    draft = row.scalar_one_or_none()
    if draft is None or not draft.summary:
        return None
    title = (draft.title or "(untitled)")[:200]
    return f"- {draft.platform}: \"{title}\" — {draft.summary}"


async def generate_draft_summary(draft_text: str, query: str) -> str:
    """30-word summary of a draft's central argument, cached on ContentDraft.summary."""
    client = _anthropic_client()
    response = await client.messages.create(
        model=CROSS_REF_SUMMARY_MODEL,
        max_tokens=80,
        messages=[{"role": "user", "content": (
            f"Summarise this draft's central argument in one sentence (≤30 words). "
            f"It was written to answer: \"{query}\". Output ONLY the sentence, no prose around it.\n\n"
            f"DRAFT:\n{draft_text}"
        )}],
    )
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text.strip()
    return ""
