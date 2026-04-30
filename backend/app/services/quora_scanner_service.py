"""
Quora Scanner Service

Discovers real Quora questions matching each brand's tracked prompts via
quora_search_service (Serper.dev) and stores them as ContentOpportunity rows
with platform="quora".

Public API
----------
scan_brand_opportunities(brand_id) -> int   (number of new opportunities stored)
scan_all_brands()                  -> None  (runs for every brand)
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from app.services.serper_search_service import parse_serper_date as _parse_serper_date

logger = logging.getLogger(__name__)

# Minimum Serper relevance proxy: we score by title keyword overlap with the prompt.
# A real Quora question URL + at least 1 prompt keyword hit counts.
_MIN_SCORE = 45.0
_LEAD_CAP = 20  # keep top N "new" leads per brand (by relevance_score)


def _score_question(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score for a Quora question, aligned with Reddit scoring."""
    import re

    _STOP = frozenset("""
        a an the is are was were be to of and or in on at for with by from
        this that these those it its i we you they he she my your our their
        do does did can could would should may might will what which who when
        where why how have has had been being about up out some any all also
        just now get more most very really quite too so then than
    """.split())

    def keywords(text: str) -> set[str]:
        words = re.sub(r"[^a-z0-9\s]", "", text.lower()).split()
        return {w for w in words if w not in _STOP and len(w) > 2}

    prompt_kw = keywords(prompt_text)
    if not prompt_kw:
        return 0.0

    combined = title + " " + snippet
    q_kw = keywords(combined)
    matches = len(prompt_kw & q_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    # Need at least 2 keyword matches
    if matches < 2:
        return 0.0

    # Recency — graduated, matching Reddit's approach
    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 180  # Unknown date → assume moderately old

    if age_days <= 7:
        recency = 1.0
    elif age_days <= 30:
        recency = 0.7
    elif age_days <= 60:
        recency = 0.4
    elif age_days <= 90:
        recency = 0.2
    else:
        recency = 0.05

    score = relevance * 70.0 + recency * 30.0
    return round(min(score, 100.0), 1)


async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan Quora for relevant questions for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt
    from app.services.quora_search_service import extract_keywords, invalidate_cache, search_quora_questions

    logger.info("Quora scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

    async with AsyncSessionLocal() as db:
        brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_row.scalar_one_or_none()
        if brand is None:
            return 0

        prompts_row = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompts = list(prompts_row.scalars().all())
        if not prompts:
            logger.info("Quora scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            # Bust Serper in-process cache so fresh scan fetches new results from the API
            for p in prompts:
                invalidate_cache(p.id)
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "quora",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            # Prune quora opportunities older than 14 days (status=new)
            # Tighter window ensures the rotating slots turn over regularly.
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "quora",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "quora",
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        from app.services.prompt_selection import get_priority_prompts
        priority = await get_priority_prompts(brand_id, prompts, limit=10)

        for prompt in priority:
            query = extract_keywords(prompt.text, max_words=5)
            if not query:
                continue

            questions = await search_quora_questions(
                query=query,
                num_results=10,
                cache_key=prompt.id,
            )

            for q in questions:
                url: str = q.get("url", "")
                title: str = q.get("title", "")
                snippet: str = q.get("snippet", "")

                if not url or not title:
                    continue
                if url in existing_urls:
                    continue

                posted_at = _parse_serper_date(q.get("date"))

                score = _score_question(title, snippet, prompt.text, posted_at=posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="quora",
                    thread_url=url,
                    thread_title=title[:500],
                    subreddit=None,
                    body_preview=snippet[:500] if snippet else None,
                    posted_at=posted_at,
                    relevance_score=score,
                    prompt_id=prompt.id,
                    status="new",
                )
                db.add(opp)
                existing_urls.add(url)
                new_count += 1

        await db.commit()
        logger.info(
            "Quora scanner: %d new opportunities for brand_id=%d", new_count, brand_id
        )

        # Cap: split _LEAD_CAP slots between anchors (top relevance) and fresh finds (most recent).
        # This ensures high-quality evergreen questions stay in the feed while new questions
        # rotate in regularly instead of being crowded out by incumbents.
        _ANCHOR = _LEAD_CAP // 2   # 10 — kept by relevance score
        _FRESH  = _LEAD_CAP - _ANCHOR  # 10 — kept by recency (created_at)

        all_new_result = await db.execute(
            select(ContentOpportunity)
            .where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "quora",
                ContentOpportunity.status == "new",
            )
        )
        all_new = list(all_new_result.scalars().all())
        if len(all_new) > _LEAD_CAP:
            by_relevance = sorted(all_new, key=lambda o: o.relevance_score, reverse=True)
            anchor_ids = {o.id for o in by_relevance[:_ANCHOR]}

            remaining = [o for o in by_relevance if o.id not in anchor_ids]
            by_recency = sorted(
                remaining,
                key=lambda o: o.posted_at or o.created_at,
                reverse=True,
            )
            fresh_ids = {o.id for o in by_recency[:_FRESH]}

            keep_ids = anchor_ids | fresh_ids
            for opp_to_drop in all_new:
                if opp_to_drop.id not in keep_ids:
                    await db.delete(opp_to_drop)
            await db.commit()

        return new_count


async def scan_all_brands() -> None:
    """Run the Quora scanner for every brand in the database."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand

    logger.info("Quora scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("Quora scanner failed for brand_id=%d", brand.id)

    logger.info("Quora scanner: full sweep complete")
