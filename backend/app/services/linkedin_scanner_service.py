"""
LinkedIn Scanner Service

Discovers LinkedIn posts and articles matching each brand's tracked prompts via
Serper.dev and stores them as ContentOpportunity rows with platform="linkedin".

Public API
----------
scan_brand_opportunities(brand_id, clear_existing=False) -> int   (number of new opportunities stored)
scan_all_brands()                                         -> None  (runs for every brand)
invalidate_cache(key)                                     -> None  (bust in-process cache entry)
extract_keywords(prompt_text, max_words=5)                -> str   (keyword extraction helper)
"""
from __future__ import annotations

import logging
import os
import re
import time
from datetime import UTC, datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

# Minimum relevance score — slightly lower than Quora because LinkedIn posts can
# be more topically broad while still being genuinely relevant.
_MIN_SCORE = 40.0
_LEAD_CAP = 15  # keep top N "new" leads per brand (by relevance_score)

# ── Serper ─────────────────────────────────────────────────────────────────────

_SERPER_URL = "https://google.serper.dev/search"

# ── In-process cache ───────────────────────────────────────────────────────────

_cache: dict[int, tuple[float, list[dict]]] = {}  # key → (expires_at, results)
_CACHE_TTL = 86_400.0  # 24 hours

# ── URL filtering ──────────────────────────────────────────────────────────────

# Path segments that indicate a real post / article (not a profile or directory page)
_ACCEPT_PATHS = ("/posts/", "/pulse/", "/article/")

# Path segments that should be rejected even if they contain an accepted segment
_REJECT_PATHS = (
    "/jobs/",
    "/in/",
    "/company/",
    "/school/",
    "/showcase/",
    "/learning/",
    "/sales/",
    "/talent/",
    "/ads/",
)

# ── Date parsing ───────────────────────────────────────────────────────────────

_RELATIVE_RE = re.compile(
    r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# ── Stop words (shared with keyword extraction and scoring) ────────────────────

_STOP_WORDS = frozenset({
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that', 'these',
    'those', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'as', 'about', 'into', 'through', 'and', 'or', 'but', 'if', 'when',
    'where', 'what', 'which', 'who', 'how', 'why', 'not', 'no', 'so',
    'than', 'then', 'there', 'here', 'i', 'we', 'you', 'they', 'he', 'she',
    'my', 'your', 'our', 'their', 'me', 'him', 'her', 'us', 'them', 'just',
    'also', 'very', 'much', 'more', 'most', 'some', 'any', 'each', 'all',
})


# ── Helpers ────────────────────────────────────────────────────────────────────

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
    now = datetime.now(UTC)

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


def _clean_title(title: str) -> str:
    """Strip trailing LinkedIn branding from a search result title."""
    for suffix in (" | LinkedIn", " - LinkedIn", " — LinkedIn", " – LinkedIn"):
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title.strip()


def _is_valid_linkedin_url(url: str) -> bool:
    """
    Return True only for LinkedIn post/article/pulse pages.
    Rejects profile, company, jobs, and other directory pages.
    """
    if not url:
        return False
    # Must contain at least one accepted path segment
    if not any(pat in url for pat in _ACCEPT_PATHS):
        return False
    # Must not contain any rejected path segment
    if any(pat in url for pat in _REJECT_PATHS):
        return False
    return True


def _score_post(
    title: str,
    snippet: str,
    prompt_text: str,
    posted_at: datetime | None = None,
) -> float:
    """Relevance + recency score for a LinkedIn post, aligned with Quora scoring."""

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

    # Recency — graduated, matching Quora/Reddit approach
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


# ── Public helpers (match Quora scanner API) ───────────────────────────────────

def invalidate_cache(key: int) -> None:
    """Remove a cached result so the next call fetches fresh data from Serper."""
    _cache.pop(key, None)


def extract_keywords(prompt_text: str, max_words: int = 5) -> str:
    """Return the most meaningful terms from a prompt, stripping stop words."""
    words = [
        w.strip('.,!?;:"\'()[]{}').lower()
        for w in prompt_text.split()
    ]
    keywords = [w for w in words if w and w not in _STOP_WORDS and len(w) > 2]
    return ' '.join(keywords[:max_words])


# ── Serper search (inlined, no separate search-service file) ───────────────────

def _search_linkedin_posts(
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
) -> list[dict]:
    """
    Search for LinkedIn posts/articles matching *query* via Serper.dev.

    Returns a list of dicts: {title, url, snippet, date}
    Returns [] gracefully on missing credentials, API errors, or no matches.
    """
    # Cache check
    if cache_key is not None:
        entry = _cache.get(cache_key)
        if entry and time.monotonic() < entry[0]:
            logger.debug("linkedin_search: cache hit for key=%s", cache_key)
            return entry[1]

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning(
            "linkedin_search: SERPER_API_KEY not configured — "
            "LinkedIn post finder disabled, returning empty list"
        )
        return []

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                _SERPER_URL,
                headers={
                    "X-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json={"q": f"site:linkedin.com {query}", "num": 20},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        try:
            error_body = exc.response.json()
        except Exception:
            error_body = exc.response.text
        logger.error(
            "linkedin_search: HTTP %s from Serper.dev — response: %s",
            exc.response.status_code, error_body,
        )
        return []
    except Exception as exc:
        logger.error("linkedin_search: request failed — %s", exc)
        return []

    items = data.get("organic", [])
    results: list[dict] = []

    for item in items:
        url: str = item.get("link", "")
        title: str = item.get("title", "")
        snippet: str = item.get("snippet", "")

        if not _is_valid_linkedin_url(url):
            continue

        results.append({
            "title": _clean_title(title),
            "url": url,
            "snippet": snippet,
            "date": item.get("date", ""),
        })

        if len(results) >= num_results:
            break

    logger.info(
        "linkedin_search: %d posts found for query=%r (%d raw Serper results)",
        len(results), query, len(items),
    )

    if cache_key is not None:
        _cache[cache_key] = (time.monotonic() + _CACHE_TTL, results)

    return results


# ── Main scanner functions ─────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan LinkedIn for relevant posts/articles for a single brand.
    Returns the number of new ContentOpportunity rows stored.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt

    logger.info("LinkedIn scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

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
            logger.info("LinkedIn scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        if clear_existing:
            # Bust in-process cache so fresh scan fetches new results from the API
            for p in prompts:
                invalidate_cache(p.id)
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "linkedin",
                )
            )
            await db.commit()
            existing_urls: set[str] = set()
        else:
            # Prune linkedin opportunities older than 14 days (status=new)
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

            posts = _search_linkedin_posts(
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
                if url in existing_urls:
                    continue

                posted_at = _parse_serper_date(post.get("date"))

                score = _score_post(title, snippet, prompt.text, posted_at=posted_at)
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
        logger.info(
            "LinkedIn scanner: %d new opportunities for brand_id=%d", new_count, brand_id
        )

        # Cap: split _LEAD_CAP slots between anchors (top relevance) and fresh finds (most recent).
        # High-quality evergreen posts stay in the feed while new posts rotate in regularly.
        _ANCHOR = _LEAD_CAP // 2       # 7 — kept by relevance score
        _FRESH  = _LEAD_CAP - _ANCHOR  # 8 — kept by recency (created_at / posted_at)

        all_new_result = await db.execute(
            select(ContentOpportunity)
            .where(
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
    """Run the LinkedIn scanner for every brand in the database."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand

    logger.info("LinkedIn scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("LinkedIn scanner failed for brand_id=%d", brand.id)

    logger.info("LinkedIn scanner: starting full sweep complete")
