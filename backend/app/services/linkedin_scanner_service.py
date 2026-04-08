"""
LinkedIn Scanner Service

Scans LinkedIn for posts and articles related to each brand's tracked prompts
via Serper.dev and stores them as ContentOpportunity records.

Public API
----------
scan_brand_opportunities(brand_id, clear_existing) -> int
scan_all_brands() -> None
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

_MIN_SCORE = 45.0
_LEAD_CAP = 20

# URL patterns that indicate actual LinkedIn content (not profiles/jobs/company pages)
_VALID_PATH_PATTERNS = ("/posts/", "/pulse/", "/feed/update/")
_REJECT_PATH_PATTERNS = ("/jobs/", "/in/", "/company/", "/school/", "/events/", "/learning/")


def _is_valid_linkedin_url(url: str) -> bool:
    """Return True if this URL points to a LinkedIn post or article."""
    lower = url.lower()
    if "linkedin.com" not in lower:
        return False
    if any(pat in lower for pat in _REJECT_PATH_PATTERNS):
        return False
    return any(pat in lower for pat in _VALID_PATH_PATTERNS)


# ── Scoring ──────────────────────────────────────────────────────────────────

_STOP = frozenset("""
    a an the is are was were be to of and or in on at for with by from
    this that these those it its i we you they he she my your our their
    do does did can could would should may might will what which who when
    where why how have has had been being about up out some any all also
    just now get more most very really quite too so then than
""".split())


def _score_result(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score, matching Reddit/Quora scoring pattern."""
    clean_prompt = re.sub(r"[^a-z0-9\s]", "", prompt_text.lower())
    prompt_kw = {w for w in clean_prompt.split() if w not in _STOP and len(w) > 2}
    if not prompt_kw:
        return 0.0

    combined = (title + " " + snippet).lower()
    combined_kw = {w for w in re.sub(r"[^a-z0-9\s]", "", combined).split()
                   if w not in _STOP and len(w) > 2}
    matches = len(prompt_kw & combined_kw)
    relevance = min(1.0, matches / len(prompt_kw))

    if matches < 2:
        return 0.0

    # Recency — graduated, matching Reddit/Quora approach
    if posted_at is not None:
        age_days = (datetime.now(UTC).replace(tzinfo=None) - posted_at).total_seconds() / 86400
    else:
        age_days = 180

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


# ── Date parsing (reuse from Quora scanner) ──────────────────────────────────

def _parse_serper_date(date_str: str | None) -> datetime | None:
    """Parse Serper.dev date field into UTC-naive datetime."""
    from app.services.quora_scanner_service import _parse_serper_date as _impl
    return _impl(date_str)


# ── Scanner ──────────────────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan LinkedIn for relevant posts/articles for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt
    from app.services.serper_search_service import extract_keywords, search_site

    logger.info("LinkedIn scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

    async with AsyncSessionLocal() as db:
        brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_row.scalar_one_or_none()
        if brand is None:
            return 0

        prompts_row = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
        prompts = list(prompts_row.scalars().all())
        if not prompts:
            logger.info("LinkedIn scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        for prompt in prompts[:5]:
            query = extract_keywords(prompt.text, max_words=5)
            if not query:
                continue

            results = search_site(
                site="linkedin.com",
                query=query,
                num_results=10,
                cache_key=prompt.id,
            )

            for r in results:
                url = r.get("url", "")
                title = r.get("title", "")
                snippet = r.get("snippet", "")

                if not url or not title:
                    continue
                if url in existing_urls:
                    continue
                if not _is_valid_linkedin_url(url):
                    continue

                posted_at = _parse_serper_date(r.get("date"))
                score = _score_result(title, snippet, prompt.text, posted_at)
                if score < _MIN_SCORE:
                    continue

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="linkedin",
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
        logger.info("LinkedIn scanner: %d new opportunities for brand_id=%d", new_count, brand_id)

        # Cap: anchor + fresh split (same as Quora)
        _ANCHOR = _LEAD_CAP // 2
        _FRESH = _LEAD_CAP - _ANCHOR

        all_new_result = await db.execute(
            select(ContentOpportunity).where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "linkedin",
                ContentOpportunity.status == "new",
            )
        )
        all_new = list(all_new_result.scalars().all())
        if len(all_new) > _LEAD_CAP:
            by_relevance = sorted(all_new, key=lambda o: o.relevance_score, reverse=True)
            anchor_ids = {o.id for o in by_relevance[:_ANCHOR]}
            remaining = [o for o in by_relevance if o.id not in anchor_ids]
            by_recency = sorted(remaining, key=lambda o: o.posted_at or datetime.min, reverse=True)
            fresh_ids = {o.id for o in by_recency[:_FRESH]}
            keep_ids = anchor_ids | fresh_ids
            for opp_to_drop in all_new:
                if opp_to_drop.id not in keep_ids:
                    await db.delete(opp_to_drop)
            await db.commit()

        return new_count


async def scan_all_brands() -> None:
    """Run the LinkedIn scanner for every Pro-tier brand."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, User

    logger.info("LinkedIn scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Brand).join(User, Brand.user_id == User.id).where(
                User.subscription_tier == "pro",
            )
        )
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("LinkedIn scanner failed for brand_id=%d", brand.id)

    logger.info("LinkedIn scanner: full sweep complete")
