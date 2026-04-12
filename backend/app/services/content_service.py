"""
Content Service — generates AI drafts, posts content, and calculates attribution.

Public API
----------
get_low_visibility_prompts(db, brand_id, limit) -> list[dict]
generate_draft(db, brand_id, platform, prompt_id, custom_brief) -> ContentDraft
post_draft(db, draft_id, post_url, platform_post_id) -> ContentPost
calculate_attribution(db, tracking_run_id) -> list[ContentAttribution]
"""
from __future__ import annotations

import json
import logging
import os
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
            "Be transparent about brand affiliation if relevant",
            "Match subreddit tone and culture",
            "Answer questions, don't pitch products",
        ],
        "disclaimer": "Always disclose brand affiliation per Reddit's rules.",
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
        "disclaimer": "Disclose any brand affiliation in your Quora credentials.",
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


async def _get_prompt_visibility(db: AsyncSession, prompt_id: int) -> float:
    """
    Return the average mention rate (0-100) for a prompt across all completed runs.
    Returns 0.0 if no data.
    """
    from sqlalchemy import Float, cast

    stmt = (
        select(
            sqlfunc.coalesce(
                sqlfunc.avg(cast(QueryResult.mentioned, Float)),
                0.0,
            )
        )
        .join(TrackingRun, TrackingRun.id == QueryResult.tracking_run_id)
        .where(
            QueryResult.prompt_id == prompt_id,
            TrackingRun.status == "completed",
        )
    )
    result = await db.execute(stmt)
    avg = result.scalar_one_or_none()
    return float(avg) * 100.0 if avg is not None else 0.0


# ── Draft generation ──────────────────────────────────────────────────────────

def _build_claude_prompt(
    brand_name: str,
    platform: str,
    target_query: str,
    visibility_score: float,
    guidelines: dict,
    custom_brief: str | None,
) -> str:
    """Build the system+user prompt string sent to Claude for draft generation."""
    rules_text = "\n".join(f"  - {r}" for r in guidelines["rules"])
    workflow = guidelines["workflow"]
    tone = guidelines["tone"]

    platform_specific = ""
    if platform == "wikipedia":
        platform_specific = (
            "Write suggested edit language for an EXISTING Wikipedia article that would "
            "naturally include factual information about this brand or its category. "
            "Format it as a suggested paragraph or section edit. Do NOT write a new article."
        )
    elif platform == "reddit":
        platform_specific = (
            "Write a comment or post for a relevant subreddit that answers a related question "
            "or contributes to a relevant discussion, naturally mentioning the brand where it "
            "adds genuine value."
        )
    elif platform == "quora":
        platform_specific = (
            "Write a comprehensive Quora answer to a question related to this search query. "
            "Mention the brand naturally where it is relevant and helpful to the reader."
        )
    elif platform == "medium":
        platform_specific = (
            "Write a full Medium article (at least 600 words) with original analysis or "
            "thought leadership. The brand mention should feel earned and contextual, "
            "not promotional."
        )

    brief_section = ""
    if custom_brief:
        brief_section = f"\nAdditional context / brief from user:\n{custom_brief}\n"

    return f"""You are a content strategist helping improve a brand's visibility in AI-generated responses.

Brand: {brand_name}
Target search query / prompt: "{target_query}"
Current visibility score for this prompt: {visibility_score:.1f}% (percentage of AI responses that mention the brand)
Platform: {platform}
Platform tone: {tone}
Platform workflow: {workflow}

Platform rules to follow:
{rules_text}
{brief_section}
Your goal: Write content for {platform} that would naturally cause an LLM to mention "{brand_name}" when answering the query "{target_query}", without being promotional or violating the platform's guidelines.

{platform_specific}

Instructions:
1. Start with a title (if applicable for the platform) on the first line.
2. Write the full content body.
3. The content must genuinely add value to a reader — it should not read as advertising.
4. Naturally incorporate "{brand_name}" in a way that is factual, relevant, and helpful.
5. Follow all platform rules listed above strictly.

Write the content now:"""


async def generate_draft(
    db: AsyncSession,
    brand_id: int,
    platform: str,
    prompt_id: int | None = None,
    custom_brief: str | None = None,
    quora_question_url: str | None = None,
    quora_question_title: str | None = None,
) -> ContentDraft:
    """
    Generate a content draft using Claude (claude-sonnet-4-6).

    1. Load brand info.
    2. If no prompt_id, find the lowest-scoring prompt automatically.
    3. Get current visibility data for that prompt.
    4. Build a detailed prompt for Claude with platform guidelines.
    5. Call Claude to generate the draft.
    6. Store and return the ContentDraft.
    """
    if platform not in PLATFORM_GUIDELINES:
        raise ValueError(f"Unsupported platform: {platform}. Must be one of {list(PLATFORM_GUIDELINES.keys())}")

    # Load brand
    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand: Brand | None = brand_result.scalar_one_or_none()
    if brand is None:
        raise ValueError(f"Brand {brand_id} not found")

    # Resolve prompt
    if prompt_id is not None:
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
        )
        prompt: Prompt | None = prompt_result.scalar_one_or_none()
        if prompt is None:
            raise ValueError(f"Prompt {prompt_id} not found for brand {brand_id}")
    else:
        # Find lowest-scoring prompt automatically
        low_prompts = await get_low_visibility_prompts(db, brand_id, limit=1)
        if not low_prompts:
            raise ValueError(f"Brand {brand_id} has no prompts configured")
        prompt_id = low_prompts[0]["prompt_id"]
        prompt_result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
        prompt = prompt_result.scalar_one_or_none()
        if prompt is None:
            raise ValueError(f"Could not load prompt {prompt_id}")

    # Get visibility score for this prompt
    visibility_score = await _get_prompt_visibility(db, prompt.id)

    # Build guidelines and prompt for Claude
    guidelines = PLATFORM_GUIDELINES[platform]

    # For Quora with a targeted question, inject the question into the brief
    effective_brief = custom_brief
    if platform == "quora" and quora_question_title and quora_question_url:
        question_context = (
            f"Write a Quora answer to this specific question: "
            f"{quora_question_title} ({quora_question_url}). "
            f"The answer should directly address this question while naturally "
            f"incorporating relevant information about {brand.name}."
        )
        effective_brief = question_context + (f"\n\n{custom_brief}" if custom_brief else "")

    claude_prompt = _build_claude_prompt(
        brand_name=brand.name,
        platform=platform,
        target_query=prompt.text,
        visibility_score=visibility_score,
        guidelines=guidelines,
        custom_brief=effective_brief,
    )

    # Call Claude
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not anthropic_api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. "
            "Add your API key in Settings → Connected Accounts to enable draft generation."
        )

    import anthropic

    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        timeout=30.0,
        messages=[{"role": "user", "content": claude_prompt}],
    )
    generated_text: str = response.content[0].text if response.content else ""

    # Extract title from first line if present
    title: str | None = None
    content_body = generated_text.strip()
    lines = content_body.split("\n", 1)
    if len(lines) >= 1:
        first_line = lines[0].strip()
        # Use the first line as title if it's reasonably short (not a full paragraph)
        if 5 < len(first_line) <= 200 and not first_line.endswith("."):
            title = first_line.lstrip("#").strip()
            content_body = lines[1].strip() if len(lines) > 1 else generated_text.strip()

    # Build content brief — for Quora targeted drafts, store question URL in brief
    # and question title in platform_guidelines_applied so the card can render a link
    if platform == "quora" and quora_question_url and quora_question_title:
        brief = quora_question_url
        guidelines_applied = quora_question_title
    else:
        brief = custom_brief or (
            f"Auto-generated to improve visibility for prompt: \"{prompt.text}\" "
            f"(current score: {visibility_score:.1f}%)"
        )
        guidelines_applied = json.dumps(guidelines["rules"])

    draft = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt.id,
        platform=platform,
        status="draft",
        title=title,
        content_text=content_body,
        content_brief=brief,
        platform_guidelines_applied=guidelines_applied,
        visibility_score_at_draft=round(visibility_score, 2),
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    logger.info(
        "Generated %s draft %d for brand %d (prompt %d, visibility %.1f%%)",
        platform,
        draft.id,
        brand_id,
        prompt.id,
        visibility_score,
    )

    from app.services.analytics_service import log_event
    await log_event(
        "draft_created",
        {
            "platform": platform,
            "target_prompt_id": prompt.id,
            "visibility_score_at_creation": round(visibility_score, 2),
        },
        brand_id=brand_id,
    )

    return draft


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
