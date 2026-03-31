"""
Reddit Scanner Service — Phase 2

Scans Reddit's public JSON API (no auth required) for threads related to each
brand's tracked prompts, scores them for relevance and recency, and stores the
best ones as ContentOpportunity records.

Public API
----------
scan_brand_opportunities(brand_id) -> int   (number of new opportunities stored)
scan_all_brands()                  -> None  (runs for every brand)
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ── Blocked subreddits ────────────────────────────────────────────────────────
# Posts from these communities are filtered out regardless of relevance score.
# Covers: medical/mental-health support, relationship advice, news mega-subs,
# legal advice, generic catch-alls, and fiction/NSFW communities.

_BLOCKED_SUBS: frozenset[str] = frozenset({
    # Medical / mental health support
    "cancer", "depression", "anxiety", "bipolar", "ptsd", "addiction",
    "chronicpain", "grief", "survivorsofabuse", "mentalhealth", "suicidewatch",
    "askdocs", "medical", "medicaladvice", "nursing", "pharmacy",
    "canceremotionalsupport", "breastcancer", "prostatecancer",
    "lungcancer", "leukemia", "chronicillness", "invisibleillness",
    # Relationship / personal advice
    "relationships", "relationship_advice", "amitheasshole", "tifu",
    "confessions", "legaladvice", "legaladviceuk", "legaladviceeurope",
    "offmychest", "trueoffmychest", "rant",
    # News / politics / mega-subs
    "worldnews", "news", "politics", "conspiracy", "nottheonion",
    "askreddit", "todayilearned", "explainlikeimfive", "changemyview",
    "nostupidquestions", "iama", "casualconversation",
    # Generic / low-signal
    "mildlyinteresting", "interestingasfuck", "damnthatsinteresting",
    "facepalm", "therewasanattempt", "nextfuckinglevel",
})

# Signal words in subreddit *names* that indicate NSFW/harmful content
_BLOCKED_SUB_SIGNALS: tuple[str, ...] = (
    "nsfw", "porn", "gore", "xxx", "nude", "fetish",
    "selfharm", "suicide", "rape", "abuse",
)


def _is_blocked_subreddit(subreddit: str) -> bool:
    """Return True if this subreddit should be excluded from opportunities."""
    lower = subreddit.lower()
    if lower in _BLOCKED_SUBS:
        return True
    return any(sig in lower for sig in _BLOCKED_SUB_SIGNALS)


_REDDIT_BASE = "https://www.reddit.com"
_HEADERS = {"User-Agent": "Lumidian/2.0 (opportunity scanner; contact@lumidian.ai)"}

# ── Relevance scoring ─────────────────────────────────────────────────────────

_STOP = frozenset("""
    a an the is are was were be to of and or in on at for with by from
    this that these those it its
    i me my we our you your he she they them their
    do does did can could would should may might will
    what which who when where why how
    have has had been being
    about up out some any all also just now get got
    more most very really quite too so then than
    new best good great latest current available most using used use
    top leading popular common known major important key high
    many much such only also even still yet both
    here there since while before after during between
    make makes made look looks give gives take takes need needs want wants
    know knows think thinks help helps tell tells say says
    company companies people business work works come comes day days
    year years time times way ways type types kind kinds
    based across among against without within around through across
    recently previously currently generally specifically
""".split())

# Subreddits that are creative writing / fiction / entertainment — never valid
# content-marketing opportunities regardless of keyword overlap.
_FICTION_SUBS = frozenset({
    "nosleep", "hfy", "writingprompts", "shortscarystories", "creativewriting",
    "shivers", "twosentencehorror", "thetruthishere", "glitch_in_the_matrix",
    "paranormal", "supernatural", "fanfiction", "fffp",
    "anime", "manga", "animesuggest", "isekai", "lightnovels",
    "fantasy", "scifi", "sciencefiction", "tolkienfans", "dndnext", "dnd",
    "worldbuilding", "magicbuilding", "printsforsale",
    "books", "booksuggestions", "suggestmeabook",
    "gaming", "games", "pcgaming", "truegaming", "gamedesign",
    "movies", "television", "netflixbestof", "marvelstudios", "dc_cinematic",
    "music", "musictheory", "spotify", "hiphopheads",
    "sports", "nfl", "nba", "soccer", "mls", "baseball", "hockey",
    "amateurradio", "memes", "dankmemes", "funny", "humor",
})


# Family member references that are NEVER good reply opportunities regardless of title framing.
# Even "How should I help my dad with cancer?" is a support post, not an info thread.
_FAMILY_SIGNALS = frozenset([
    "my mom", "my dad", "my mother", "my father", "my wife", "my husband",
    "my partner", "my sister", "my brother", "my child", "my son", "my daughter",
    "my aunt", "my uncle", "my grandma", "my grandpa", "my grandmother", "my grandfather",
    "my spouse", "my loved one", "my family member",
])

_PERSONAL_STORY_SIGNALS = frozenset([
    "i graduated", "graduated today", "i rang the bell", "rang the bell",
    "my last radiation", "last chemo", "my chemo", "my diagnosis", "i was diagnosed",
    "my treatment", "i finished treatment", "i completed treatment", "finished chemo",
    "my oncologist", "my surgery", "my scan results", "my results came back",
    "feel like they lie", "my journey", "i am cancer free", "cancer free",
    "my battle with cancer", "just got my results", "my biopsy", "update on my",
    "i beat cancer", "survivor here", "nec free", "no evidence of disease",
    "thank you all for", "wanted to share my", "sharing my story",
    "have cancer", "has cancer",
    "feeling tired", "side effects", "on chemo", "going through", "i need advice",
    "new member", "new in the club", "officially hit", "one year on",
    "close to my end", "i feel i may", "stage iv", "stage 4",
    "venting", "vent", "advice please", "don't know how to cope",
    "how to live", "how do i cope", "i'm scared", "terrified",
    "abusing my", "abusing prescriptions", "abusing medication",
    "financial", "without insurance", "care package",
    "transplantation", "transplant", "mental health",
    "middle east", "flee", "conflict or stay", "surgery or",
    "hair loss", "nausea", "fatigue", "pain management",
    "emotional support", "crying", "praying", "prayers",
])

# Spam / SEO listicle titles — promotional posts masquerading as content
_SPAM_TITLE_RE = re.compile(
    r"^\s*\d+\s+(best|top|leading|greatest|recommended)\b|"
    r"\btop[\s-]\d+\b|"
    r"\b\d+[\s-](best|top|leading)\b|"
    r"\b(app|software|company|companies|agency|agencies|services?|solutions?)\s+(development|provider|company)\b|"
    r"\bdigital\s+transformation\b.*\b(agency|company|service)\b|"
    r"\b(nearshore|offshore|outsourc)\b",
    re.IGNORECASE,
)

# Spam subreddit name patterns (SEO link farms)
_SPAM_SUB_RE = re.compile(
    r"(AppDev|AppInnovation|AIDevelop|FutureTech|AppDevelop|AIApp|AISolution|"
    r"DevSolution|TechSolution|SoftwareDev|DigitalAgency|WebAgency)",
    re.IGNORECASE,
)


# Titles that are almost always personal celebration/update/support posts
_PERSONAL_TITLE_RE = re.compile(
    r"\b(graduated|rang the bell|cancer free|nec free|no evidence of disease|"
    r"i beat|i survived|my update|update on me|my results|my diagnosis|"
    r"my story|sharing my|thank you all|new member|new in the club|"
    r"feel(ing)? (tired|scared|lost|helpless|hopeless|overwhelmed)|"
    r"stage (iv|4|iii|3|ii|2)|vent(ing)?|advice (please|needed)|"
    r"close to (my |the )?end|i may be|how to (cope|live|navigate)|"
    r"financial(ly)?|without insurance|care package|i have cancer|"
    r"has cancer|diagnosed with|abusing (my |prescriptions|medication)|"
    r"drug(s)? (abuse|use)|relapse|suicidal|self.harm)\b",
    re.IGNORECASE,
)

# Titles that look like discussions, questions, or research posts we WANT
_DISCUSSION_TITLE_RE = re.compile(
    r"\b(why|how does|what is|can |could |should |study|research|trial|"
    r"technology|detection|screening|test|biomarker|clinical|approved|"
    r"vs\.|versus|compare|review|analysis|data|results?|evidence|"
    r"ai (can|detect|diagnose)|machine learning|algorithm)\b",
    re.IGNORECASE,
)


def _is_personal_story(title: str, body: str) -> bool:
    """Return True if this looks like a personal treatment/support story with no reply opportunity."""
    combined_lower = (title + " " + body[:600]).lower()

    # Family member references are always support posts — filter regardless of title framing.
    # "What should I ask my oncologist about my dad's cancer?" is still not an opportunity.
    if any(sig in combined_lower for sig in _FAMILY_SIGNALS):
        return True

    # Strong personal title signals
    if _PERSONAL_TITLE_RE.search(title):
        return True

    # For discussion-looking titles, still check body for personal accumulation
    if _DISCUSSION_TITLE_RE.search(title):
        return sum(1 for sig in _PERSONAL_STORY_SIGNALS if sig in combined_lower) >= 3

    return sum(1 for sig in _PERSONAL_STORY_SIGNALS if sig in combined_lower) >= 2


def _score_thread(
    title: str,
    body: str,
    prompt_text: str,
    created_utc: float,
    num_comments: int = 0,
    brand_name: str = "",
    subreddit: str = "",
) -> float:
    # Fiction / entertainment subs are never valid opportunities
    if subreddit.lower() in _FICTION_SUBS:
        return 0.0

    # SEO link-farm / promotional subreddits
    if _SPAM_SUB_RE.search(subreddit):
        return 0.0

    # Listicle / promotional spam titles
    if _SPAM_TITLE_RE.search(title):
        return 0.0

    # Personal support stories aren't actionable content opportunities
    if _is_personal_story(title, body):
        return 0.0

    combined = (title + " " + body).lower()
    clean_prompt = re.sub(r"[^a-z0-9\s]", "", prompt_text.lower())
    prompt_words = {w for w in clean_prompt.split() if w not in _STOP and len(w) > 2}

    if not prompt_words:
        return 0.0

    # Whole-word matching to avoid false substring hits (e.g. "can" in "scanner")
    matches = sum(
        1 for w in prompt_words
        if re.search(r"\b" + re.escape(w) + r"\b", combined)
    )
    relevance = min(1.0, matches / len(prompt_words))

    # Hard minimum: at least 45% keyword overlap AND at least 2 matches
    if relevance < 0.45 or matches < 2:
        return 0.0

    # Recency — graduated, no hard cutoff (old evergreen threads still score)
    now_ts = datetime.now(timezone.utc).timestamp()
    age_days = (now_ts - created_utc) / 86400
    if age_days <= 7:
        recency = 1.0
    elif age_days <= 30:
        recency = 0.7
    elif age_days <= 60:
        recency = 0.4
    elif age_days <= 90:
        recency = 0.2
    else:
        recency = 0.05  # Very old but not zero — evergreen threads still have value

    # Engagement — log scale on comment count (saturates at ~200 comments)
    engagement = min(1.0, math.log10(num_comments + 1) / math.log10(201))

    # Brand mention bonus
    brand_bonus = 10.0 if brand_name and brand_name.lower() in combined else 0.0

    score = relevance * 50.0 + recency * 20.0 + engagement * 20.0 + brand_bonus
    return round(min(score, 100.0), 1)


# ── HTTP fetching (httpx with urllib fallback) ─────────────────────────────────

async def _fetch(url: str) -> Optional[dict]:
    try:
        import httpx
        async with httpx.AsyncClient(headers=_HEADERS, timeout=12.0) as client:
            resp = await client.get(url, follow_redirects=True)
            if resp.status_code == 200:
                return resp.json()
            logger.debug("Reddit API %d for %s", resp.status_code, url)
            return None
    except ImportError:
        pass
    except Exception as exc:
        logger.debug("httpx fetch failed: %s", exc)
        return None

    # urllib fallback (stdlib)
    import urllib.request
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        loop = asyncio.get_event_loop()

        def _blocking_fetch() -> Optional[dict]:
            try:
                with urllib.request.urlopen(req, timeout=12) as r:
                    return json.loads(r.read().decode())
            except Exception:
                return None

        return await loop.run_in_executor(None, _blocking_fetch)
    except Exception as exc:
        logger.debug("urllib fetch failed: %s", exc)
        return None


def _extract_posts(data: Optional[dict]) -> list[dict]:
    if not data:
        return []
    try:
        return [child["data"] for child in data["data"]["children"]]
    except (KeyError, TypeError):
        return []


# ── Main scanner ──────────────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan Reddit for relevant threads for a single brand.
    Returns the number of new ContentOpportunity rows stored.

    clear_existing=True: wipe ALL existing ContentOpportunity rows for this brand
    before inserting new ones.  Use for on-demand scans to flush stale results.
    """
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, ContentOpportunity
    from sqlalchemy import select, delete as sql_delete

    logger.info("Reddit scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

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
            logger.info("Reddit scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        logger.info("Reddit scanner: brand=%r | %d prompts", brand.name, len(prompts))

        if clear_existing:
            # Delete ALL existing opportunities so stale results don't persist
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id
                )
            )
            await db.commit()
            logger.info(
                "Reddit scanner: cleared existing opportunities for brand_id=%d", brand_id
            )
            existing_urls: set[str] = set()
        else:
            # Prune only opportunities older than 14 days (status=new)
            cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        # Build search queries: one per prompt (up to 6) + one for the brand name
        queries: list[tuple[str, int | None]] = [
            (prompt.text, prompt.id) for prompt in prompts[:6]
        ]
        queries.append((brand.name, None))  # brand-name query has no associated prompt

        all_candidates: list[tuple[dict, int | None]] = []  # (post_data, prompt_id)

        for query_text, prompt_id in queries:
            q = urllib.parse.quote(query_text)
            url = (
                f"{_REDDIT_BASE}/search.json"
                f"?q={q}&sort=relevance&t=month&limit=25"
            )
            data = await _fetch(url)
            for post in _extract_posts(data):
                all_candidates.append((post, prompt_id))
            await asyncio.sleep(1.0)

        # Deduplicate by permalink across all queries
        seen_permalinks: set[str] = set()
        deduped: list[tuple[dict, int | None]] = []
        for post, prompt_id in all_candidates:
            pl = post.get("permalink", "")
            if pl and pl not in seen_permalinks:
                seen_permalinks.add(pl)
                deduped.append((post, prompt_id))

        # Score and store
        # Use first prompt text as scoring reference for brand-name query results
        default_prompt_text = prompts[0].text if prompts else ""

        for post, prompt_id in deduped:
            permalink = post.get("permalink", "")
            if not permalink:
                continue
            thread_url = f"https://www.reddit.com{permalink}"
            if thread_url in existing_urls:
                continue

            title = post.get("title", "")
            if not title:
                continue

            subreddit_name = post.get("subreddit", "")
            if _is_blocked_subreddit(subreddit_name):
                continue

            body = post.get("selftext", "")
            created_utc = float(post.get("created_utc", 0))
            num_comments = int(post.get("num_comments", 0))

            # For brand-name query results use first prompt as scoring reference
            scoring_prompt = next(
                (p.text for p in prompts if p.id == prompt_id),
                default_prompt_text,
            )

            score = _score_thread(
                title, body, scoring_prompt, created_utc,
                num_comments=num_comments,
                brand_name=brand.name,
                subreddit=subreddit_name,
            )
            if score < 55.0:
                continue

            posted_dt = (
                datetime.fromtimestamp(created_utc, tz=timezone.utc).replace(tzinfo=None)
                if created_utc else None
            )

            opp = ContentOpportunity(
                brand_id=brand_id,
                platform="reddit",
                thread_url=thread_url,
                thread_title=title[:500],
                subreddit=subreddit_name[:100],
                body_preview=body[:500] if body else None,
                posted_at=posted_dt,
                relevance_score=score,
                prompt_id=prompt_id,
                status="new",
            )
            db.add(opp)
            existing_urls.add(thread_url)
            new_count += 1

        await db.commit()
        logger.info(
            "Reddit scanner: %d new opportunities for brand_id=%d", new_count, brand_id
        )

        # ── Cap: keep only the top 20 "new" leads per brand (by relevance score) ──
        # This prevents the list from ballooning across daily runs and keeps the
        # feed tight and relevant.
        LEAD_CAP = 20
        all_new_result = await db.execute(
            select(ContentOpportunity)
            .where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.status == "new",
            )
            .order_by(ContentOpportunity.relevance_score.desc())
        )
        all_new = list(all_new_result.scalars().all())
        if len(all_new) > LEAD_CAP:
            for opp_to_drop in all_new[LEAD_CAP:]:
                await db.delete(opp_to_drop)
            await db.commit()
            logger.info(
                "Reddit scanner: trimmed to top %d leads for brand_id=%d (had %d)",
                LEAD_CAP, brand_id, len(all_new),
            )

        return new_count


async def scan_all_brands() -> None:
    """Run the Reddit scanner for every brand in the database."""
    from app.database import AsyncSessionLocal
    from app.models import Brand
    from sqlalchemy import select

    logger.info("Reddit scanner: starting full sweep")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Brand))
        brands = result.scalars().all()

    for brand in brands:
        try:
            await scan_brand_opportunities(brand.id)
        except Exception:
            logger.exception("Reddit scanner failed for brand_id=%d", brand.id)

    logger.info("Reddit scanner: full sweep complete")
