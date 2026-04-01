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

# ── Query-time stop words (too generic to make a good Reddit search query) ────
# These words appear in completely unrelated contexts and flood results.
# Distinct from _STOP (scoring-time): a word can be scored but not searched.
QUERY_STOP: frozenset[str] = frozenset({
    "capital", "raise", "raises", "raised", "service", "services",
    "platform", "platforms", "advisory", "advisor", "advisors",
    "company", "companies", "business", "businesses",
    "fund", "funds", "funding", "help", "best", "top",
    "use", "using", "used", "invest", "investor", "investors",
    "market", "markets", "money", "growth", "scale",
    "solution", "solutions", "provider", "providers",
    "startup", "startups", "enterprise", "product", "products",
    "strategy", "strategies", "need", "needs", "want", "wants",
    "find", "choose", "choosing", "getting", "making",
})

# Multi-word regulatory/technical terms to search as quoted phrases.
# Presence of these in a post is a near-perfect relevance signal.
# Note: single-word entries like "ipo" and "spac" were removed — quoting single
# words provides no Reddit search benefit and they appeared twice (quoted + bare).
# Longer phrases are listed before shorter subsets to prevent duplicate matches.
_PHRASE_TERMS: list[str] = [
    "reg a+", "reg d", "reg s", "regulation a", "regulation d", "regulation s",
    "capital raise", "securities offering", "direct listing",
    "crowdfunding", "equity crowdfunding", "investor relations",
    "accredited investors", "accredited investor",  # longer first to prevent subset match
    "venture capital", "private equity", "angel investor",
    "initial public offering", "reverse merger",
]


def _build_search_query(prompt_text: str) -> str:
    """
    Extract the most search-effective terms from a prompt.

    - Detects multi-word regulatory/technical phrases and quotes them for exact match.
    - Strips generic finance/SaaS words (QUERY_STOP) that cause false-positive results.
    - Returns top-3 remaining specific keywords joined with spaces.
    - Falls back to raw prompt text if nothing survives filtering.
    """
    lower = prompt_text.lower()

    # Detect and quote multi-word technical phrases (sorted longest-first to avoid subset matches)
    quoted: list[str] = []
    consumed_words: set[str] = set()
    for phrase in sorted(_PHRASE_TERMS, key=len, reverse=True):
        if phrase in lower:
            # Check no word in this phrase was already consumed by a longer match
            phrase_words = set(phrase.split())
            if not phrase_words & consumed_words:
                quoted.append(f'"{phrase}"')
                consumed_words |= phrase_words

    # Extract remaining single keywords (not consumed by phrases, not in stop sets, length > 3)
    clean = re.sub(r"[^a-z0-9\s]", " ", lower)
    words = [
        w for w in clean.split()
        if w not in _STOP and w not in QUERY_STOP and len(w) > 3 and w not in consumed_words
    ]

    # Compose: up to 2 quoted phrases + enough single words to reach 3 terms total
    parts = quoted[:2] + words[:max(0, 3 - len(quoted[:2]))]

    return " ".join(parts) if parts else prompt_text


async def _haiku_relevance_check(
    brand_name: str,
    brand_description: str,
    candidates: list[dict],
) -> list[bool]:
    """
    Ask Claude Haiku whether each candidate is a genuine content opportunity.
    candidates: list of {title, subreddit, body_preview}
    Returns a list of booleans (True = keep). Fails open on any error.
    """
    import os
    import anthropic

    if not candidates:
        return []

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.debug("haiku_relevance_check: no ANTHROPIC_API_KEY, failing open")
        return [True] * len(candidates)

    client = anthropic.AsyncAnthropic(api_key=api_key)
    results: list[bool] = []

    for c in candidates:
        prompt = (
            f"Brand: {brand_name}\n"
            f"What they do: {brand_description}\n\n"
            f"Reddit post title: {c['title']}\n"
            f"Subreddit: r/{c.get('subreddit', '')}\n"
            f"Post preview: {c.get('body_preview', '')[:300]}\n\n"
            "Is this a genuine opportunity for this brand to contribute expert value "
            "as a reply or comment? Answer only YES or NO."
        )
        try:
            msg = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=5,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text if msg.content else ""
            results.append("YES" in text.upper())
        except Exception as exc:
            logger.debug("haiku_relevance_check: API error for candidate %r: %s", c.get("title"), exc)
            results.append(True)  # fail open

    return results


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

    # Hard minimum: at least 45% keyword overlap AND at least 3 matches
    if relevance < 0.45 or matches < 3:
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

    score = relevance * 70.0 + recency * 20.0 + engagement * 10.0 + brand_bonus
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
            (_build_search_query(prompt.text), prompt.id) for prompt in prompts[:6]
        ]
        queries.append((brand.name, None))  # brand-name query: already specific, no extraction

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

        # ── Phase 1: score all candidates ─────────────────────────────────────
        default_prompt_text = prompts[0].text if prompts else ""

        # Get brand description for Haiku gate
        from app.models import BrandProfile
        profile_result = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        profile = profile_result.scalar_one_or_none()
        brand_description = (
            (profile.company_description if profile and profile.company_description else None)
            or brand.website_url
            or brand.name
        )

        scored: list[dict] = []  # candidates that pass keyword scoring

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
            if score < 65.0:
                continue

            scored.append({
                "title": title,
                "subreddit": subreddit_name,
                "body_preview": body[:300] if body else "",
                "thread_url": thread_url,
                "score": score,
                "prompt_id": prompt_id,
                "created_utc": created_utc,
                "num_comments": num_comments,
                "body": body,
            })

        # ── Phase 2: Haiku relevance gate ──────────────────────────────────────
        haiku_decisions = await _haiku_relevance_check(
            brand.name, brand_description, scored
        )

        # ── Phase 3: Store approved candidates ────────────────────────────────
        for cand, keep in zip(scored, haiku_decisions):
            if not keep:
                logger.debug(
                    "haiku_relevance_check: rejected %r in r/%s",
                    cand["title"][:60], cand["subreddit"],
                )
                continue

            posted_dt = (
                datetime.fromtimestamp(cand["created_utc"], tz=timezone.utc).replace(tzinfo=None)
                if cand["created_utc"] else None
            )

            opp = ContentOpportunity(
                brand_id=brand_id,
                platform="reddit",
                thread_url=cand["thread_url"],
                thread_title=cand["title"][:500],
                subreddit=cand["subreddit"][:100],
                body_preview=cand["body_preview"] if cand["body_preview"] else None,
                posted_at=posted_dt,
                relevance_score=cand["score"],
                prompt_id=cand["prompt_id"],
                status="new",
            )
            db.add(opp)
            existing_urls.add(cand["thread_url"])
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
