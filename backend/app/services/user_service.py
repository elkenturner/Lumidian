"""
User lifecycle helpers — specifically the cascade delete.

Why this exists
---------------
`brands.user_id` uses `ondelete=SET NULL`, so deleting a User without first
removing their brands leaves orphaned brand rows that the scheduler keeps
sweeping. Every path that removes a User must therefore tear down all 21
related tables in leaf-first order before the User row goes away.

Callers:
  - routers/admin.py: admin_remove_user (admin-initiated deletion)
  - routers/auth.py:  register (when an unverified row is replaced)
"""
from __future__ import annotations

from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AnalyticsEvent,
    Brand,
    BrandContentSettings,
    BrandProfile,
    Competitor,
    CompetitorMention,
    ContentAttribution,
    ContentDraft,
    ContentEvent,
    ContentGap,
    ContentOpportunity,
    ContentPost,
    DraftAttribution,
    Notification,
    PasswordResetToken,
    Prompt,
    PromptRunScore,
    QueryResult,
    RunModelScore,
    TeamMember,
    TrackingRun,
    User,
)


async def cascade_delete_user(db: AsyncSession, user_id: int) -> int:
    """Delete a user and all data reachable from them.

    Returns the number of brands removed. The caller is responsible for
    committing (or flushing) the session — this keeps the helper composable
    inside larger transactions like `register()`.
    """
    brand_ids = [
        r[0]
        for r in (
            await db.execute(sa_select(Brand.id).where(Brand.user_id == user_id))
        ).all()
    ]

    if brand_ids:
        run_ids = [
            r[0]
            for r in (
                await db.execute(
                    sa_select(TrackingRun.id).where(TrackingRun.brand_id.in_(brand_ids))
                )
            ).all()
        ]
        prompt_ids = [
            r[0]
            for r in (
                await db.execute(
                    sa_select(Prompt.id).where(Prompt.brand_id.in_(brand_ids))
                )
            ).all()
        ]
        competitor_ids = [
            r[0]
            for r in (
                await db.execute(
                    sa_select(Competitor.id).where(Competitor.brand_id.in_(brand_ids))
                )
            ).all()
        ]
        draft_ids = [
            r[0]
            for r in (
                await db.execute(
                    sa_select(ContentDraft.id).where(ContentDraft.brand_id.in_(brand_ids))
                )
            ).all()
        ]
        post_ids: list[int] = []
        if draft_ids:
            post_ids = [
                r[0]
                for r in (
                    await db.execute(
                        sa_select(ContentPost.id).where(ContentPost.draft_id.in_(draft_ids))
                    )
                ).all()
            ]

        if post_ids:
            await db.execute(
                sa_delete(ContentAttribution).where(
                    ContentAttribution.content_post_id.in_(post_ids)
                )
            )
        if draft_ids:
            await db.execute(sa_delete(ContentPost).where(ContentPost.draft_id.in_(draft_ids)))
            await db.execute(
                sa_delete(DraftAttribution).where(DraftAttribution.draft_id.in_(draft_ids))
            )
        if competitor_ids:
            await db.execute(
                sa_delete(CompetitorMention).where(
                    CompetitorMention.competitor_id.in_(competitor_ids)
                )
            )
        if run_ids:
            await db.execute(
                sa_delete(QueryResult).where(QueryResult.tracking_run_id.in_(run_ids))
            )
            await db.execute(
                sa_delete(RunModelScore).where(RunModelScore.tracking_run_id.in_(run_ids))
            )
        if prompt_ids:
            await db.execute(
                sa_delete(PromptRunScore).where(PromptRunScore.prompt_id.in_(prompt_ids))
            )

        await db.execute(sa_delete(ContentDraft).where(ContentDraft.brand_id.in_(brand_ids)))
        await db.execute(sa_delete(ContentGap).where(ContentGap.brand_id.in_(brand_ids)))
        await db.execute(
            sa_delete(ContentOpportunity).where(ContentOpportunity.brand_id.in_(brand_ids))
        )
        await db.execute(sa_delete(ContentEvent).where(ContentEvent.brand_id.in_(brand_ids)))
        await db.execute(
            sa_delete(BrandContentSettings).where(BrandContentSettings.brand_id.in_(brand_ids))
        )
        await db.execute(sa_delete(BrandProfile).where(BrandProfile.brand_id.in_(brand_ids)))
        await db.execute(sa_delete(Competitor).where(Competitor.brand_id.in_(brand_ids)))
        await db.execute(sa_delete(TrackingRun).where(TrackingRun.brand_id.in_(brand_ids)))
        await db.execute(sa_delete(Prompt).where(Prompt.brand_id.in_(brand_ids)))
        await db.execute(sa_delete(Brand).where(Brand.id.in_(brand_ids)))

    await db.execute(
        sa_delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id)
    )
    await db.execute(sa_delete(Notification).where(Notification.user_id == user_id))
    await db.execute(sa_delete(TeamMember).where(TeamMember.account_owner_id == user_id))
    await db.execute(sa_delete(TeamMember).where(TeamMember.user_id == user_id))
    await db.execute(sa_delete(AnalyticsEvent).where(AnalyticsEvent.user_id == user_id))

    user = await db.get(User, user_id)
    if user is not None:
        await db.delete(user)

    return len(brand_ids)
