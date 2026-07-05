"""
Content Service — low-visibility prompt discovery, posting, and attribution.

Draft GENERATION lives entirely in drafting_service.py (the unified writer);
the legacy generate_draft path here was removed in B2 Phase 4 (dead code that
bypassed the drafting/ pipeline). PLATFORM_GUIDELINES is kept because it backs
the UI-facing platform-info endpoints in routers/content.py — it is NOT a
generation-rule source (those live in drafting/platforms.py:PLATFORM_SPECS).

Public API
----------
get_low_visibility_prompts(db, brand_id, limit) -> list[dict]
post_draft(db, draft_id, post_url, platform_post_id) -> ContentPost
calculate_attribution(db, tracking_run_id) -> list[ContentAttribution]
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from sqlalchemy import func as sqlfunc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentAttribution,
    ContentDraft,
    ContentPost,
    Prompt,
    QueryResult,
    TrackingRun,
)
from app.models import (
    utcnow as _utcnow,
)

logger = logging.getLogger(__name__)

# ── Platform guidelines ───────────────────────────────────────────────────────

PLATFORM_GUIDELINES: dict[str, dict] = {
    "owned_site": {
        "tone": "Authoritative, concrete, first-party",
        "rules": [
            "Publish on your own website/blog (your own domain) — the highest-value AI-citation channel",
            "Lead with the direct answer; use H2/H3 headings with self-contained ~120-180 word answer blocks",
            "Include concrete statistics and cite authoritative sources inline",
            "Paste the generated JSON-LD schema block into the page's <head>",
        ],
        "disclaimer": None,
        "workflow": "publish_owned",
    },
    "wikipedia": {
        "tone": "Neutral, encyclopedic, fact-based",
        "rules": [
            "No promotional language or marketing claims",
            "Must cite reliable, independent sources",
            "Suggest edits to existing articles only (do not create new articles for brands)",
            "Use third-person perspective throughout",
            "Present only verifiable facts",
        ],
        "disclaimer": (
            "⚠️ Wikipedia Conflict of Interest Policy: Editing Wikipedia to promote your brand "
            "may violate Wikipedia's COI guidelines. You are solely responsible for compliance "
            "with Wikipedia's policies. Consider disclosing your affiliation on the article "
            "talk page."
        ),
        "workflow": "suggest_edits",
    },
    "reddit": {
        "tone": "Conversational, community-focused, authentic",
        "rules": [
            "No overt promotion or marketing language",
            "Must add genuine value to the discussion",
            "If your post endorses your brand, disclose your affiliation casually in the post itself (FTC rules + Reddit norms). Neutral factual mentions don't need it.",
            "Match subreddit tone and culture",
            "Answer questions, don't pitch products",
        ],
        "disclaimer": "If your post endorses your brand, disclose your affiliation casually in the post itself (FTC rules + Reddit norms). Neutral factual mentions don't need it.",
        "workflow": "comment_or_post",
    },
    "quora": {
        "tone": "Expert but accessible, answer-focused",
        "rules": [
            "Answer the specific question comprehensively",
            "Include personal or professional expertise",
            "Brand mentions must be relevant and non-promotional",
            "Cite sources where appropriate",
            "Focus on value to the reader",
        ],
        "disclaimer": "Disclose affiliation via your answer credential; add an inline line only if the answer recommends your product.",
        "workflow": "answer",
    },
    "medium": {
        "tone": "Long-form editorial, thought leadership",
        "rules": [
            "Original insight and analysis required",
            "Brand mentions should be contextual and earned",
            "Tell a story or make an argument",
            "Minimum 600 words for quality",
            "Include actionable takeaways",
        ],
        "disclaimer": None,
        "workflow": "article",
    },
    "linkedin": {
        "tone": "Professional, thought leadership, industry-focused",
        "rules": [
            "Write for a professional audience — avoid casual slang",
            "Brand mentions must be contextual and earned, not promotional",
            "Include concrete data or professional experience",
            "Focus on industry insights, not product features",
            "Original perspective required — not a rehash of common knowledge",
        ],
        "disclaimer": None,
        "workflow": "article_or_post",
    },
    "x": {
        "tone": "Sharp, concise, informative",
        "rules": [
            "Each tweet must be under 280 characters",
            "Threads should have 4-8 tweets with a strong opening hook",
            "Brand mentions must be natural and limited (1-2 per thread)",
            "No engagement bait or empty calls to action",
            "Substance over style — every tweet should deliver value",
        ],
        "disclaimer": None,
        "workflow": "post_or_thread",
    },
}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def get_low_visibility_prompts(
    db: AsyncSession, brand_id: int, limit: int = 5
) -> list[dict]:
    """
    Return prompts sorted by their lowest average visibility (mention rate)
    across all completed runs, most under-performing first.

    Each entry: {prompt_id, prompt_text, avg_score}
    """
    # Subquery: for each prompt_id / tracking_run_id, count queries and mentions
    # then derive a per-run score, then average across all runs.
    # We join QueryResult -> TrackingRun to scope to completed runs for this brand.
    stmt = (
        select(
            Prompt.id.label("prompt_id"),
            Prompt.text.label("prompt_text"),
            sqlfunc.coalesce(
                sqlfunc.avg(
                    sqlfunc.cast(QueryResult.mentioned, sqlfunc.Float)
                    if hasattr(sqlfunc, "Float")
                    else sqlfunc.cast(QueryResult.mentioned, sqlfunc.float)
                ),
                0.0,
            ).label("avg_score"),
        )
        .join(QueryResult, QueryResult.prompt_id == Prompt.id, isouter=True)
        .join(
            TrackingRun,
            (TrackingRun.id == QueryResult.tracking_run_id)
            & (TrackingRun.status == "completed"),
            isouter=True,
        )
        .where(Prompt.brand_id == brand_id)
        .group_by(Prompt.id, Prompt.text)
        .order_by(sqlfunc.coalesce(sqlfunc.avg(sqlfunc.cast(QueryResult.mentioned, sqlfunc.Float if hasattr(sqlfunc, "Float") else sqlfunc.float)), 0.0).asc())
        .limit(limit)
    )

    # Simpler, more portable approach using basic SQLAlchemy constructs
    from sqlalchemy import Float, cast

    stmt = (
        select(
            Prompt.id.label("prompt_id"),
            Prompt.text.label("prompt_text"),
            sqlfunc.coalesce(
                sqlfunc.avg(cast(QueryResult.mentioned, Float)),
                0.0,
            ).label("avg_score"),
        )
        .join(QueryResult, QueryResult.prompt_id == Prompt.id, isouter=True)
        .join(
            TrackingRun,
            (TrackingRun.id == QueryResult.tracking_run_id)
            & (TrackingRun.status == "completed"),
            isouter=True,
        )
        .where(Prompt.brand_id == brand_id)
        .group_by(Prompt.id, Prompt.text)
        .order_by(
            sqlfunc.coalesce(sqlfunc.avg(cast(QueryResult.mentioned, Float)), 0.0).asc()
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            "prompt_id": row.prompt_id,
            "prompt_text": row.prompt_text,
            "avg_score": float(row.avg_score) * 100.0,  # convert fraction to percentage
        }
        for row in rows
    ]


# ── Posting ───────────────────────────────────────────────────────────────────

async def post_draft(
    db: AsyncSession,
    draft_id: int,
    post_url: str | None = None,
    platform_post_id: str | None = None,
) -> ContentPost:
    """
    Mark a draft as posted and create a ContentPost record.

    Actual API posting is mocked — if an account is connected a real post would
    be attempted by a platform-specific service.  For the MVP we simply record
    the post.
    """
    draft_result = await db.execute(
        select(ContentDraft).where(ContentDraft.id == draft_id)
    )
    draft: ContentDraft | None = draft_result.scalar_one_or_none()
    if draft is None:
        raise ValueError(f"ContentDraft {draft_id} not found")

    if draft.status in ("posted",):
        raise ValueError(f"Draft {draft_id} has already been posted")

    now = _utcnow()

    # Update draft status
    draft.status = "posted"
    draft.posted_at = now
    draft.updated_at = now

    # Snapshot visibility at time of posting (if not already set by router)
    if draft.visibility_at_post is None and draft.brand_id:
        latest_run_res = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == draft.brand_id, TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        latest_run = latest_run_res.scalar_one_or_none()
        if latest_run and latest_run.overall_score is not None:
            draft.visibility_at_post = round(latest_run.overall_score, 1)

    # Create ContentPost record
    content_post = ContentPost(
        draft_id=draft_id,
        platform=draft.platform,
        post_url=post_url,
        platform_post_id=platform_post_id,
        posted_at=now,
    )
    db.add(content_post)
    await db.commit()
    await db.refresh(content_post)
    logger.info(
        "Draft %d posted as ContentPost %d on %s",
        draft_id,
        content_post.id,
        draft.platform,
    )

    from app.services.analytics_service import log_event
    await log_event(
        "draft_posted",
        {
            "draft_id": draft_id,
            "platform": draft.platform,
            "target_prompt_id": draft.prompt_id,
        },
        brand_id=draft.brand_id,
    )

    from app.services.content_event_service import log_content_event
    await log_content_event(
        event_type="draft_posted",
        brand_id=draft.brand_id,
        prompt_id=draft.prompt_id,
        data={
            "draft_id": draft_id,
            "platform": draft.platform,
            "visibility_at_post": draft.visibility_at_post,
        },
    )

    return content_post


# ── Attribution ───────────────────────────────────────────────────────────────

async def calculate_attribution(
    db: AsyncSession, tracking_run_id: int
) -> list[ContentAttribution]:
    """
    After a tracking run completes, calculate attribution for content posts
    made in the 7 days prior to this run.

    For each post:
    - Find the linked prompt via the draft.
    - Find visibility_before = score for that prompt in the most recent run
      BEFORE the post's posted_at timestamp.
    - visibility_after = this run's per-prompt score.
    - Calculate improvement_pct.
    - Upsert a ContentAttribution record (one per post per run).
    - Set tracking_run.has_content_influence = True if any posts found.
    """
    from sqlalchemy import Float, cast

    # Load the tracking run
    run_result = await db.execute(select(TrackingRun).where(TrackingRun.id == tracking_run_id))
    run: TrackingRun | None = run_result.scalar_one_or_none()
    if run is None:
        raise ValueError(f"TrackingRun {tracking_run_id} not found")

    brand_id = run.brand_id
    run_completed_at = run.completed_at or _utcnow()
    seven_days_ago = run_completed_at - timedelta(days=7)

    # Find all content posts for this brand in the last 7 days
    posts_stmt = (
        select(ContentPost)
        .join(ContentDraft, ContentDraft.id == ContentPost.draft_id)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentPost.posted_at >= seven_days_ago,
            ContentPost.posted_at <= run_completed_at,
        )
    )
    posts_result = await db.execute(posts_stmt)
    posts: list[ContentPost] = list(posts_result.scalars().all())

    if not posts:
        return []

    attributions: list[ContentAttribution] = []
    now = _utcnow()

    for post in posts:
        # Load the draft to get prompt_id
        draft_result = await db.execute(
            select(ContentDraft).where(ContentDraft.id == post.draft_id)
        )
        draft: ContentDraft | None = draft_result.scalar_one_or_none()
        if draft is None or draft.prompt_id is None:
            continue

        prompt_id = draft.prompt_id
        posted_at = post.posted_at or seven_days_ago

        # visibility_after — this run's mention rate for this prompt
        after_stmt = (
            select(
                sqlfunc.coalesce(sqlfunc.avg(cast(QueryResult.mentioned, Float)), 0.0)
            )
            .where(
                QueryResult.tracking_run_id == tracking_run_id,
                QueryResult.prompt_id == prompt_id,
            )
        )
        after_result = await db.execute(after_stmt)
        visibility_after_fraction = after_result.scalar_one_or_none() or 0.0
        visibility_after = float(visibility_after_fraction) * 100.0

        # visibility_before — most recent completed run BEFORE posted_at for same brand/prompt
        before_run_stmt = (
            select(TrackingRun.id)
            .where(
                TrackingRun.brand_id == brand_id,
                TrackingRun.status == "completed",
                TrackingRun.completed_at < posted_at,
            )
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        before_run_result = await db.execute(before_run_stmt)
        before_run_id = before_run_result.scalar_one_or_none()

        if before_run_id is not None:
            before_stmt = (
                select(
                    sqlfunc.coalesce(sqlfunc.avg(cast(QueryResult.mentioned, Float)), 0.0)
                )
                .where(
                    QueryResult.tracking_run_id == before_run_id,
                    QueryResult.prompt_id == prompt_id,
                )
            )
            before_result = await db.execute(before_stmt)
            visibility_before_fraction = before_result.scalar_one_or_none() or 0.0
            visibility_before: float = float(visibility_before_fraction) * 100.0
        else:
            # No run before this post — treat baseline as zero
            visibility_before = 0.0

        # improvement_pct = (after - before) / before * 100, handle zero denominator
        if visibility_before > 0:
            improvement_pct = (visibility_after - visibility_before) / visibility_before * 100.0
        else:
            # If before is 0 and after is also 0 → no change; if after > 0 → infinite improvement
            # We represent the latter as the raw after score (already a percentage)
            improvement_pct = visibility_after if visibility_after > 0 else 0.0

        attribution = ContentAttribution(
            content_post_id=post.id,
            tracking_run_id=tracking_run_id,
            prompt_id=prompt_id,
            brand_id=brand_id,
            visibility_before=round(visibility_before, 2),
            visibility_after=round(visibility_after, 2),
            improvement_pct=round(improvement_pct, 2),
            measured_at=now,
        )
        db.add(attribution)
        attributions.append(attribution)

    if attributions:
        run.has_content_influence = True

    await db.commit()
    for attr in attributions:
        await db.refresh(attr)

    logger.info(
        "Calculated %d attribution(s) for tracking run %d",
        len(attributions),
        tracking_run_id,
    )
    return attributions
