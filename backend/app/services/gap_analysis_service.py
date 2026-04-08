"""
Content Gap Analysis Service

After a tracking run completes, this service:
1. Identifies prompts with visibility below 50% on any model
2. Analyzes stored AI responses to find what IS being mentioned instead
3. Identifies which platforms have had the least recent content activity
4. Scores each gap by severity, opportunity, and recency
5. Stores ContentGap records for the drafting system to consume
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import (
    Competitor,
    ContentDraft,
    ContentGap,
    ContentPost,
    Prompt,
    QueryResult,
    RunModelScore,
)
from app.models import (
    utcnow as _utcnow,
)

logger = logging.getLogger(__name__)

PLATFORMS = ["reddit", "quora", "medium", "wikipedia", "linkedin", "x"]
GAP_THRESHOLD = 50.0  # visibility below this triggers a gap


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _find_competitor_mentions(
    response_text: str,
    competitor_names: list[str],
) -> dict[str, int]:
    """Count how many times each competitor is mentioned in the response."""
    counts: dict[str, int] = {}
    if not response_text:
        return counts
    lower = response_text.lower()
    for name in competitor_names:
        count = lower.count(name.lower())
        if count > 0:
            counts[name] = count
    return counts


async def run_gap_analysis(brand_id: int, run_id: int) -> list[int]:
    """
    Run gap analysis for a completed tracking run.
    Returns the list of ContentGap IDs created.
    """
    logger.info("Starting gap analysis for brand=%d run=%d", brand_id, run_id)

    async with AsyncSessionLocal() as db:
        # Load competitors for this brand
        comp_result = await db.execute(
            select(Competitor).where(Competitor.brand_id == brand_id)
        )
        competitors = [c.name for c in comp_result.scalars().all()]

        # Load all query results for this run
        qr_result = await db.execute(
            select(QueryResult)
            .where(QueryResult.tracking_run_id == run_id)
        )
        query_results = qr_result.scalars().all()

        if not query_results:
            logger.info("No query results found for run %d, skipping gap analysis", run_id)
            return []

        # Load prompts
        prompt_ids = list({qr.prompt_id for qr in query_results})
        prompt_result = await db.execute(
            select(Prompt).where(Prompt.id.in_(prompt_ids))
        )
        prompts_by_id = {p.id: p for p in prompt_result.scalars().all()}

        # Load per-model scores for this run (for opportunity scoring)
        model_score_result = await db.execute(
            select(RunModelScore).where(RunModelScore.tracking_run_id == run_id)
        )
        model_scores = model_score_result.scalars().all()
        model_score_map = {ms.model: ms.score for ms in model_scores}

        # Group query results by prompt → model
        # Structure: {prompt_id: {model: [QueryResult, ...]}}
        by_prompt_model: dict[int, dict[str, list[QueryResult]]] = defaultdict(lambda: defaultdict(list))
        for qr in query_results:
            if qr.error == "api_key_not_configured":
                continue
            by_prompt_model[qr.prompt_id][qr.model].append(qr)

        # Find last content post per prompt
        # Check ContentDraft.prompt_id → ContentPost.posted_at
        last_content_per_prompt: dict = {}
        for pid in prompt_ids:
            post_result = await db.execute(
                select(func.max(ContentPost.posted_at))
                .join(ContentDraft, ContentPost.draft_id == ContentDraft.id)
                .where(
                    ContentDraft.brand_id == brand_id,
                    ContentDraft.prompt_id == pid,
                    ContentPost.posted_at.isnot(None),
                )
            )
            last_content_per_prompt[pid] = post_result.scalar_one_or_none()

        # Find platforms with recent activity per brand (last 30 days)
        from datetime import timedelta
        thirty_days_ago_ts = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)

        recent_platforms_result = await db.execute(
            select(ContentPost.platform, func.max(ContentPost.posted_at))
            .join(ContentDraft, ContentPost.draft_id == ContentDraft.id)
            .where(
                ContentDraft.brand_id == brand_id,
                ContentPost.posted_at >= thirty_days_ago_ts,
            )
            .group_by(ContentPost.platform)
        )
        recent_platform_rows = recent_platforms_result.all()
        active_platforms = {row[0] for row in recent_platform_rows}
        platforms_lacking = [p for p in PLATFORMS if p not in active_platforms]

        # Delete existing gaps only for prompt IDs covered in this run.
        # Gaps for prompts not included in this run are preserved to avoid data loss
        # from partial runs or prompts that had no query results.
        covered_prompt_ids = list(by_prompt_model.keys())
        if covered_prompt_ids:
            existing = await db.execute(
                select(ContentGap).where(
                    ContentGap.brand_id == brand_id,
                    ContentGap.prompt_id.in_(covered_prompt_ids),
                )
            )
            for gap in existing.scalars().all():
                await db.delete(gap)
            await db.flush()

        # Analyze each prompt for gaps
        new_gaps: list[ContentGap] = []

        for prompt_id, model_results in by_prompt_model.items():
            prompt = prompts_by_id.get(prompt_id)
            if prompt is None:
                continue

            # Calculate per-model visibility for this prompt
            prompt_model_visibility: dict[str, float] = {}
            for model, results in model_results.items():
                total = len(results)
                mentions = sum(1 for r in results if r.mentioned)
                prompt_model_visibility[model] = (mentions / total * 100.0) if total > 0 else 0.0

            # Overall visibility for this prompt
            all_results = [r for results in model_results.values() for r in results]
            total_all = len(all_results)
            mentions_all = sum(1 for r in all_results if r.mentioned)
            overall_visibility = (mentions_all / total_all * 100.0) if total_all > 0 else 0.0

            # Check if any model is below threshold
            low_models = {
                model: vis
                for model, vis in prompt_model_visibility.items()
                if vis < GAP_THRESHOLD
            }

            if not low_models and overall_visibility >= GAP_THRESHOLD:
                continue  # No gap for this prompt

            # Aggregate competitor mentions from non-mentioning responses
            competitor_mention_counts: dict[str, int] = defaultdict(int)
            for qr in all_results:
                if not qr.mentioned and qr.response_text and competitors:
                    mentions_found = _find_competitor_mentions(qr.response_text, competitors)
                    for name, count in mentions_found.items():
                        competitor_mention_counts[name] += count

            # ── Score calculation ────────────────────────────────────────────

            # Severity: how low is the overall visibility below 50%?
            # Score 0-100 where 100 = completely invisible (0%), 0 = at threshold (50%)
            severity_score = max(0.0, min(100.0, (GAP_THRESHOLD - overall_visibility) / GAP_THRESHOLD * 100.0))

            # Opportunity: how many models have low visibility?
            # Also weighted by how many models are affected and how low they are
            if low_models:
                avg_low_vis = sum(low_models.values()) / len(low_models)
                model_coverage = len(low_models) / max(1, len(prompt_model_visibility))
                opportunity_score = min(100.0, (1 - avg_low_vis / 100.0) * model_coverage * 100.0)
            else:
                opportunity_score = 0.0

            # Recency: how long since content was last created for this prompt?
            last_content = last_content_per_prompt.get(prompt_id)
            if last_content is None:
                recency_score = 100.0  # Never had content → highest urgency
            else:
                from datetime import timedelta
                days_since = (_utcnow() - last_content).days
                # Caps at 30 days = score of 100
                recency_score = min(100.0, days_since / 30.0 * 100.0)

            # Composite gap score
            gap_score = (
                severity_score * 0.4
                + opportunity_score * 0.3
                + recency_score * 0.3
            )

            # Fetch Quora questions relevant to this prompt (non-fatal, runs in thread)
            quora_questions_json: str | None = None
            try:
                from app.services.quora_search_service import extract_keywords, search_quora_questions
                keywords = extract_keywords(prompt.text)
                if keywords:
                    questions = await asyncio.to_thread(
                        search_quora_questions, keywords, 5, prompt_id
                    )
                    if questions:
                        quora_questions_json = json.dumps(questions)
            except Exception as _qe:
                logger.debug("Quora search skipped for prompt %d: %s", prompt_id, _qe)

            gap = ContentGap(
                brand_id=brand_id,
                prompt_id=prompt_id,
                tracking_run_id=run_id,
                model=None,  # overall gap, not model-specific
                severity_score=round(severity_score, 2),
                opportunity_score=round(opportunity_score, 2),
                recency_score=round(recency_score, 2),
                gap_score=round(gap_score, 2),
                competitor_mentions=json.dumps(dict(competitor_mention_counts)) if competitor_mention_counts else None,
                platforms_lacking=json.dumps(platforms_lacking) if platforms_lacking else None,
                quora_questions=quora_questions_json,
                prompt_visibility=round(overall_visibility, 2),
                last_content_at=last_content,
                identified_at=_utcnow(),
            )
            db.add(gap)
            new_gaps.append(gap)

        await db.commit()
        for gap in new_gaps:
            await db.refresh(gap)

        gap_ids = [gap.id for gap in new_gaps]
        logger.info(
            "Gap analysis complete for run %d: %d gaps identified", run_id, len(gap_ids)
        )
        return gap_ids
