"""
X (Twitter) Scanner Service

Discovers real X posts matching each brand's tracked prompts via
Serper.dev and stores them as ContentOpportunity rows with platform="x".

Public API
----------
scan_brand_opportunities(brand_id, clear_existing=False) -> int   (number of new opportunities stored)
scan_all_brands()                                        -> None  (runs for every brand)
invalidate_cache(key)                                    -> None  (bust in-process cache)
extract_keywords(prompt_text, max_words=5)               -> str   (keyword extraction)
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

from app.services.serper_search_service import (
    _STOP_WORDS,
    extract_keywords,
    invalidate_cache as _invalidate_site_cache,
    parse_serper_date as _parse_serper_date,
    search_site_async,
)

logger = logging.getLogger(__name__)

_SITE = "x.com"

# Minimum composite score required to store an opportunity
_MIN_SCORE = 40.0
_LEAD_CAP = 15  # keep top N "new" leads per brand (by relevance_score)
_MAX_AGE_DAYS = 90

# Accept only concrete post URLs; reject profiles, lists, search pages, etc.
_POST_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:x|twitter)\.com/[A-Za-z0-9_]+/status/\d+",
    re.IGNORECASE,
)


def _is_valid_x_url(url: str) -> bool:
    return bool(_POST_URL_RE.match(url))


# ── Public helpers ─────────────────────────────────────────────────────────────

def invalidate_cache(key: int) -> None:
    """Remove a cached result so the next call fetches fresh data from Serper."""
    _invalidate_site_cache(_SITE, key)


# ── Serper search ──────────────────────────────────────────────────────────────

async def _search_x_posts(
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
) -> list[dict]:
    """Search for X posts matching *query* via Serper.dev (site:x.com)."""
    return await search_site_async(
        site=_SITE,
        query=query,
        num_results=num_results,
        cache_key=cache_key,
        url_filter=_is_valid_x_url,
        log_label="x_scanner",
    )


# ── Scoring ────────────────────────────────────────────────────────────────────

def _score_post(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """
    Composite relevance + recency score for an X post.

    Weighting: relevance 60% + recency 40%.
    X content is more ephemeral than Quora, so recency carries more weight
    and the decay curve is tighter.
    """

    def keywords(text: str) -> set[str]:
        words = re.sub(r"[^a-z0-9\s]", "", text.lower()).split()
        return {w for w in words if w not in _STOP_WORDS and len(w) > 2}

    prompt_kw = keywords(prompt_text)
    if not prompt_kw:
        return 0.0

    combined = title + " " + snippet
    post_kw = keywords(combined)
    matches = len(prompt_kw & post_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    # Need at least 2 keyword matches
    if matches < 2:
        return 0.0

    # Tighter recency decay — X content ages faster than Quora
    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 90  # Unknown date → assume moderately old

    if age_days <= 3:
        recency = 1.0
    elif age_days <= 7:
        recency = 0.8
    elif age_days <= 14:
        recency = 0.5
    elif age_days <= 30:
        recency = 0.3
    else:
        recency = 0.05

    score = relevance * 60.0 + recency * 40.0
    return round(min(score, 100.0), 1)


# ── Public scanner functions ───────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan X for relevant posts for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt

    logger.info("X scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

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
            logger.info("X scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            # Bust Serper in-process cache so fresh scan fetches new results from the API
            for p in prompts:
                invalidate_cache(p.id)
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            # Prune X opportunities older than 7 days (status=new).
            # X content ages faster — tighter pruning window keeps the feed fresh.
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "x",
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

            posts = await _search_x_posts(
                query=query,
                num_results=10,
                cache_key=prompt.id,
            )

            for post in posts:
                url: str = post.get("url", "")
                title: str = post.get("title", "")
                snippet: str = post.get("snippet", "")

                if not url or not title:
                    continue
                if not _is_valid_x_url(url):
                    continue
                if url in existing_urls:
                    continue

                posted_at = _parse_serper_date(post.get("date"))
                if posted_at and (datetime.now(UTC).replace(tzinfo=None) - posted_at).days > _MAX_AGE_DAYS:
                    continue

                score = _score_post(title, snippet, prompt.text, posted_at=posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="x",
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
            "X scanner: %d new opportunities for brand_id=%d", new_count, brand_id
        )

        # Cap: split _LEAD_CAP slots between anchors (top relevance) and fresh finds (most recent).
        # High-quality posts stay visible while new posts rotate in regularly.
        _ANCHOR = _LEAD_CAP // 2       # 7 — kept by relevance score
        _FRESH  = _LEAD_CAP - _ANCHOR  # 8 — kept by recency (posted_at / created_at)

        all_new_result = await db.execute(
            select(ContentOpportunity)
            .where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "x",
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
    """Run the X scanner for every brand in the database."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand

    logger.info("X scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("X scanner failed for brand_id=%d", brand.id)

    logger.info("X scanner: starting full sweep complete")
