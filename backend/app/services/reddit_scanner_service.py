"""
Reddit Scanner Service — Phase 2

Scans Reddit for threads related to each brand's tracked prompts via
Serper.dev (site:reddit.com), scores them for relevance and recency,
and stores the best ones as ContentOpportunity records.

Public API
----------
scan_brand_opportunities(brand_id) -> int   (number of new opportunities stored)
scan_all_brands()                  -> None  (runs for every brand)
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from datetime import UTC, datetime, timedelta

import httpx

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


_SERPER_URL = "https://google.serper.dev/search"


# ── Subreddit existence validation ───────────────────────────────────────────
# LLM-suggested subreddit names are often hallucinated (wrong spelling,
# capitalization, or fully invented). Validating before storing the name in a
# draft prevents users from clicking links that land on Reddit's "this
# subreddit does not exist" search page.
#
# We use Serper (Google search) rather than hitting Reddit directly because
# Reddit blocks datacenter egress IPs (Railway) with 403 across all subdomains.
# A real subreddit has many indexed pages under reddit.com/r/{sub}/; a
# hallucinated name returns no matches.


async def validate_subreddit_exists(sub: str) -> bool:
    """Return True if r/{sub} appears in Google search via Serper.dev.

    Fails open (returns True) on missing API key or transient errors so
    validation outages don't block draft creation.
    """
    cleaned = (sub or "").strip().lstrip("/").removeprefix("r/").removeprefix("R/")
    if not cleaned:
        return False

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning(
            "validate_subreddit_exists(%s): SERPER_API_KEY missing — fail-open",
            cleaned,
        )
        return True

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                _SERPER_URL,
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": f"site:reddit.com/r/{cleaned}", "num": 5},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.debug(
            "validate_subreddit_exists(%s): Serper error — fail-open: %s",
            cleaned, exc,
        )
        return True

    organic = data.get("organic", []) or []
    pattern = re.compile(
        rf"reddit\.com/r/{re.escape(cleaned)}(/|$)", re.IGNORECASE
    )
    return any(pattern.search(item.get("link", "") or "") for item in organic)


async def find_first_valid_subreddit(candidates: list[str]) -> str | None:
    """Return the first candidate that passes validate_subreddit_exists, else None."""
    for cand in candidates:
        if await validate_subreddit_exists(cand):
            return cand.strip().lstrip("/").removeprefix("r/").removeprefix("R/")
    return None

_cache: dict[int, tuple[float, list[dict]]] = {}
_CACHE_TTL = 86_400.0  # 24 hours


def invalidate_cache(key: int) -> None:
    """Remove a cached result so the next call fetches fresh data from Serper."""
    _cache.pop(key, None)

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

# ── Query-time stop words ────────────────────────────────────────────────────
# Minimal set of words too generic to help even within site:reddit.com results.
# Domain-specific terms (capital, invest, startup, etc.) are intentionally kept —
# they are valid search terms when scoped to Reddit via site:reddit.com.
QUERY_STOP: frozenset[str] = frozenset({
    "help", "best", "top", "use", "using", "used",
    "need", "needs", "want", "wants",
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
    - Strips only truly generic filler words (QUERY_STOP); domain-specific terms are
      kept since site:reddit.com scoping prevents false positives from other sites.
    - Returns up to 5 remaining terms joined with spaces.
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

    # Compose: up to 2 quoted phrases + enough single words to reach 5 terms total
    parts = quoted[:2] + words[:max(0, 5 - len(quoted[:2]))]

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
                timeout=10.0,
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

    # Word matching: exact whole-word first, then prefix/stem for longer words
    # (e.g. "detected" matches "detect", "screening" matches "screen")
    def _word_matches(word: str, text: str) -> bool:
        if re.search(r"\b" + re.escape(word) + r"\b", text):
            return True
        # Prefix match for words > 5 chars: check if first N-2 chars appear as word start
        if len(word) > 5:
            stem = word[:len(word) - 2]
            if re.search(r"\b" + re.escape(stem) + r"\w*\b", text):
                return True
        return False

    matches = sum(1 for w in prompt_words if _word_matches(w, combined))
    relevance = min(1.0, matches / len(prompt_words))

    # Need at least 2 keyword matches (aligned with LinkedIn/X/Quora scanners).
    # The Haiku relevance gate provides additional quality filtering.
    if matches < 2:
        return 0.0

    # Recency — graduated, no hard cutoff (old evergreen threads still score)
    now_ts = datetime.now(UTC).timestamp()
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


# ── Serper search + helpers ──────────────────────────────────────────────────

_RELATIVE_RE = re.compile(
    r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago",
    re.IGNORECASE,
)
_MONTHS_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_serper_date(date_str: str | None) -> datetime | None:
    """Parse Serper.dev date field into a UTC-naive datetime."""
    if not date_str:
        return None
    now = datetime.now(UTC)

    m = _RELATIVE_RE.match(date_str.strip())
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta_map = {
            "second": timedelta(seconds=n), "minute": timedelta(minutes=n),
            "hour": timedelta(hours=n), "day": timedelta(days=n),
            "week": timedelta(weeks=n), "month": timedelta(days=30 * n),
            "year": timedelta(days=365 * n),
        }
        return (now - delta_map.get(unit, timedelta(0))).replace(tzinfo=None)

    abs_m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", date_str.strip())
    if abs_m:
        month = _MONTHS_MAP.get(abs_m.group(1)[:3].lower())
        if month:
            try:
                return datetime(int(abs_m.group(3)), month, int(abs_m.group(2)))
            except ValueError:
                pass
    return None


def _extract_subreddit(url: str) -> str:
    """Extract subreddit name from a Reddit URL."""
    m = re.search(r"reddit\.com/r/([^/]+)", url)
    return m.group(1) if m else ""


def _clean_title(title: str) -> str:
    """Strip trailing Reddit/subreddit branding from a Serper result title."""
    for suffix in (" - Reddit", " — Reddit", " – Reddit", " | Reddit"):
        if title.endswith(suffix):
            title = title[: -len(suffix)].strip()
            break
    idx = title.rfind(" : r/")
    if idx > 0:
        title = title[:idx].strip()
    return title


async def _search_reddit_posts(
    query: str,
    num_results: int = 10,
    cache_key: int | None = None,
    subreddit: str | None = None,
) -> list[dict]:
    """
    Search for Reddit posts matching *query* via Serper.dev.

    When *subreddit* is given, scopes the search to that sub
    (`site:reddit.com/r/{sub}`); otherwise searches all of reddit.com.

    Returns a list of dicts: {title, url, snippet, date, subreddit}
    Returns [] gracefully on missing credentials, API errors, or no matches.
    """
    if cache_key is not None:
        entry = _cache.get(cache_key)
        if entry and time.monotonic() < entry[0]:
            logger.debug("reddit_search: cache hit for key=%s", cache_key)
            return entry[1]

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning(
            "reddit_search: SERPER_API_KEY not configured — "
            "Reddit post finder disabled, returning empty list"
        )
        return []

    _TRANSIENT_CODES = {429, 500, 502, 503}
    _MAX_ATTEMPTS = 2
    _RETRY_DELAY = 2.0  # seconds

    site_filter = (
        f"site:reddit.com/r/{subreddit}" if subreddit else "site:reddit.com"
    )

    data = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    _SERPER_URL,
                    headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                    json={"q": f"{site_filter} {query}", "num": 25},
                )
                resp.raise_for_status()
                data = resp.json()
                break  # success
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            try:
                error_body = exc.response.json()
            except Exception:
                error_body = exc.response.text

            if status_code in _TRANSIENT_CODES and attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "reddit_search: HTTP %s from Serper (attempt %d/%d), retrying in %.0fs — %s",
                    status_code, attempt, _MAX_ATTEMPTS, _RETRY_DELAY, error_body,
                )
                await asyncio.sleep(_RETRY_DELAY)
                continue

            logger.error(
                "reddit_search: HTTP %s from Serper (attempt %d/%d, giving up) — %s",
                status_code, attempt, _MAX_ATTEMPTS, error_body,
            )
            return []
        except Exception as exc:
            if attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "reddit_search: request failed (attempt %d/%d), retrying in %.0fs — %s",
                    attempt, _MAX_ATTEMPTS, _RETRY_DELAY, exc,
                )
                await asyncio.sleep(_RETRY_DELAY)
                continue

            logger.error(
                "reddit_search: request failed (attempt %d/%d, giving up) — %s",
                attempt, _MAX_ATTEMPTS, exc,
            )
            return []

    if data is None:
        return []

    items = data.get("organic", [])
    results: list[dict] = []

    for item in items:
        url: str = item.get("link", "")
        title: str = item.get("title", "")
        snippet: str = item.get("snippet", "")

        # Must be an actual Reddit post, not a subreddit/wiki/user page
        if not url or "/comments/" not in url:
            continue

        subreddit = _extract_subreddit(url)

        results.append({
            "title": _clean_title(title),
            "url": url,
            "snippet": snippet,
            "date": item.get("date", ""),
            "subreddit": subreddit,
        })

        if len(results) >= num_results:
            break

    logger.info(
        "reddit_search: %d posts found for query=%r (%d raw Serper results)",
        len(results), query, len(items),
    )

    if cache_key is not None:
        _cache[cache_key] = (time.monotonic() + _CACHE_TTL, results)

    return results


# ── Subreddit suggestion ─────────────────────────────────────────────────────

def get_relevant_subreddits(
    description: str | None,
    prompts: list[str],
    limit: int = 3,
    extra_profile_text: str = "",
) -> list[str]:
    """
    Suggest relevant subreddits for a brand based on description and prompts.
    Uses Claude Haiku for intelligent suggestions. Falls back to empty list on error.
    """
    import os

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.debug("get_relevant_subreddits: no ANTHROPIC_API_KEY")
        return []

    # Build context from available info
    context_parts = []
    if description:
        context_parts.append(f"Company: {description[:500]}")
    if prompts:
        context_parts.append(f"Topics they track: {', '.join(p[:100] for p in prompts[:5])}")
    if extra_profile_text:
        context_parts.append(f"Additional context: {extra_profile_text[:300]}")

    if not context_parts:
        return []

    context = "\n".join(context_parts)

    prompt = f"""Based on this brand profile, suggest {limit} relevant subreddits where they could contribute valuable content (not promotional — genuine expertise sharing).

{context}

Return ONLY a comma-separated list of subreddit names (without r/ prefix), nothing else. Example: startups, SaaS, smallbusiness"""

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            timeout=10.0,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        # Parse comma-separated list
        subs = [s.strip().lower().replace("r/", "") for s in text.split(",")]
        # Filter out blocked subreddits and empty strings
        subs = [s for s in subs if s and not _is_blocked_subreddit(s)]
        return subs[:limit]
    except Exception as exc:
        logger.debug("get_relevant_subreddits failed: %s", exc)
        return []


# ── Main scanner ──────────────────────────────────────────────────────────────

async def scan_brand_opportunities(brand_id: int, clear_existing: bool = False) -> int:
    """
    Scan Reddit for relevant threads for a single brand.
    Returns the number of new ContentOpportunity rows stored.

    clear_existing=True: wipe ALL existing ContentOpportunity rows for this brand
    before inserting new ones.  Use for on-demand scans to flush stale results.
    """
    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, ContentOpportunity, Prompt

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
            # Bust Serper in-process cache so fresh scan fetches new results
            for p in prompts:
                invalidate_cache(p.id)
            # Delete only Reddit opportunities so parallel Quora scan rows aren't wiped
            await db.execute(
                sql_delete(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "reddit",
                )
            )
            await db.commit()
            logger.info(
                "Reddit scanner: cleared existing opportunities for brand_id=%d", brand_id
            )
            existing_urls: set[str] = set()
        else:
            # Prune only Reddit opportunities older than 14 days (status=new)
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=14)
            old_row = await db.execute(
                select(ContentOpportunity).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "reddit",
                    ContentOpportunity.created_at < cutoff,
                    ContentOpportunity.status == "new",
                )
            )
            for old_opp in old_row.scalars().all():
                await db.delete(old_opp)

            existing_row = await db.execute(
                select(ContentOpportunity.thread_url).where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.platform == "reddit",
                )
            )
            existing_urls = {r[0] for r in existing_row.all()}

        new_count = 0

        # Select prompts with weakest visibility (up to 10)
        from app.services.prompt_selection import get_priority_prompts
        priority = await get_priority_prompts(brand_id, prompts, limit=10)

        # Load brand description up-front so we can use it for niche-sub
        # discovery as well as the Haiku relevance gate later.
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

        all_candidates: list[tuple[dict, int | None]] = []

        for prompt in priority:
            query = _build_search_query(prompt.text)
            results = await _search_reddit_posts(query, num_results=10, cache_key=prompt.id)
            for r in results:
                all_candidates.append((r, prompt.id))

        # Brand-name search (no cache)
        for r in await _search_reddit_posts(brand.name, num_results=10):
            all_candidates.append((r, None))

        # ── Niche subreddit augmentation ──────────────────────────────────────
        # Site-restricted searches surface threads that the broad
        # `site:reddit.com` query misses entirely (small subs get drowned
        # out by big subs in Serper's ranking). Use Claude Haiku to suggest
        # subs aligned with the brand, then probe each with the top
        # priority prompts.
        niche_subs: list[str] = []
        if priority:
            try:
                niche_subs = get_relevant_subreddits(
                    description=brand_description,
                    prompts=[p.text for p in priority],
                    limit=8,
                )
            except Exception as exc:
                logger.debug(
                    "niche-sub discovery failed for brand_id=%d: %s", brand_id, exc
                )
                niche_subs = []

        if niche_subs:
            logger.info(
                "Reddit scanner: probing %d niche subs for brand_id=%d: %s",
                len(niche_subs[:5]), brand_id, niche_subs[:5],
            )
            for sub in niche_subs[:5]:
                for prompt in priority[:3]:
                    query = _build_search_query(prompt.text)
                    niche_results = await _search_reddit_posts(
                        query, num_results=5, subreddit=sub,
                    )
                    for r in niche_results:
                        all_candidates.append((r, prompt.id))

        # Deduplicate by URL across all queries
        seen_urls: set[str] = set()
        deduped: list[tuple[dict, int | None]] = []
        for result, prompt_id in all_candidates:
            url = result.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                deduped.append((result, prompt_id))

        # ── Phase 1: score all candidates ─────────────────────────────────────
        default_prompt_text = prompts[0].text if prompts else ""

        scored: list[dict] = []  # candidates that pass keyword scoring

        for result, prompt_id in deduped:
            result_url = result.get("url", "")
            if not result_url or result_url in existing_urls:
                continue

            title = result.get("title", "")
            if not title:
                continue

            subreddit_name = result.get("subreddit", "")
            if _is_blocked_subreddit(subreddit_name):
                continue

            snippet = result.get("snippet", "")
            posted_at = _parse_serper_date(result.get("date"))
            # Default to ~30 days ago when Serper provides no date
            created_utc = (
                posted_at.replace(tzinfo=UTC).timestamp()
                if posted_at
                else datetime.now(UTC).timestamp() - 30 * 86400
            )

            scoring_prompt = next(
                (p.text for p in prompts if p.id == prompt_id),
                default_prompt_text,
            )

            score = _score_thread(
                title, snippet, scoring_prompt, created_utc,
                num_comments=0,
                brand_name=brand.name,
                subreddit=subreddit_name,
            )
            if score < 40.0:
                continue

            scored.append({
                "title": title,
                "subreddit": subreddit_name,
                "body_preview": snippet[:300] if snippet else "",
                "thread_url": result_url,
                "score": score,
                "prompt_id": prompt_id,
                "posted_at": posted_at,
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

            opp = ContentOpportunity(
                brand_id=brand_id,
                platform="reddit",
                thread_url=cand["thread_url"],
                thread_title=cand["title"][:500],
                subreddit=cand["subreddit"][:100],
                body_preview=cand["body_preview"] if cand["body_preview"] else None,
                posted_at=cand.get("posted_at"),
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

        # ── Cap: keep only the top 20 "new" Reddit leads per brand (by relevance score) ──
        # This prevents the list from ballooning across daily runs and keeps the
        # feed tight and relevant.  Filter to platform="reddit" so parallel Quora
        # rows don't count against this cap and vice-versa.
        LEAD_CAP = 20
        all_new_result = await db.execute(
            select(ContentOpportunity)
            .where(
                ContentOpportunity.brand_id == brand_id,
                ContentOpportunity.platform == "reddit",
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
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand

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
