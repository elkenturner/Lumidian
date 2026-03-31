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
import re
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

# Minimum Serper relevance proxy: we score by title keyword overlap with the prompt.
# A real Quora question URL + at least 1 prompt keyword hit counts.
_MIN_SCORE = 40.0
_LEAD_CAP = 20  # keep top N "new" leads per brand (by relevance_score)


_RELATIVE_RE = re.compile(
    r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_serper_date(date_str: str | None) -> datetime | None:
    """
    Parse Serper.dev `date` field into a UTC-naive datetime.
    Handles:
      - Relative: "3 days ago", "2 weeks ago", "1 month ago"
      - Absolute: "Dec 15, 2023" / "December 15, 2023"
    Returns None if unparseable.
    """
    if not date_str:
        return None
    now = datetime.now(timezone.utc)

    m = _RELATIVE_RE.match(date_str.strip())
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta_map = {
            "second": timedelta(seconds=n),
            "minute": timedelta(minutes=n),
            "hour":   timedelta(hours=n),
            "day":    timedelta(days=n),
            "week":   timedelta(weeks=n),
            "month":  timedelta(days=30 * n),
            "year":   timedelta(days=365 * n),
        }
        dt = now - delta_map.get(unit, timedelta(0))
        return dt.replace(tzinfo=None)

    # Absolute: "Dec 15, 2023" or "December 15, 2023"
    abs_m = re.match(
        r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})",
        date_str.strip(),
    )
    if abs_m:
        month_str, day_str, year_str = abs_m.group(1), abs_m.group(2), abs_m.group(3)
        month = _MONTHS.get(month_str[:3].lower())
        if month:
            try:
                return datetime(int(year_str), month, int(day_str))
            except ValueError:
                pass

    return None


def _score_question(title: str, snippet: str, prompt_text: str) -> float:
    """Simple relevance score: keyword overlap between prompt and question."""
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

    return round(relevance * 100.0, 1)


async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan Quora for relevant questions for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, ContentOpportunity
    from app.services.quora_search_service import search_quora_questions, extract_keywords
    from sqlalchemy import select, delete as sql_delete

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
            cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=14)
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

        for prompt in prompts[:5]:
            query = extract_keywords(prompt.text, max_words=5)
            if not query:
                continue

            questions = search_quora_questions(
                query=query,
                num_results=5,
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

                score = _score_question(title, snippet, prompt.text)
                if score < _MIN_SCORE:
                    continue

                posted_at = _parse_serper_date(q.get("date"))

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
            by_recency = sorted(remaining, key=lambda o: o.created_at, reverse=True)
            fresh_ids = {o.id for o in by_recency[:_FRESH]}

            keep_ids = anchor_ids | fresh_ids
            for opp_to_drop in all_new:
                if opp_to_drop.id not in keep_ids:
                    await db.delete(opp_to_drop)
            await db.commit()

        return new_count


async def scan_all_brands() -> None:
    """Run the Quora scanner for every brand in the database."""
    from app.database import AsyncSessionLocal
    from app.models import Brand
    from sqlalchemy import select

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
