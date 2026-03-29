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
import re
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

_REDDIT_BASE = "https://www.reddit.com"
_HEADERS = {"User-Agent": "Lumidian/2.0 (opportunity scanner; contact@lumidian.ai)"}

# ── Industry → subreddit mapping ──────────────────────────────────────────────
# Every subreddit here must be genuinely topic-specific.
# NO generic subreddits (AskReddit, worldnews, etc.) — those produce irrelevant results.

_INDUSTRY_MAP: dict[str, list[str]] = {
    # Healthcare — VOC / breath-based early detection
    # Active general subs first (more posts to score), then niche ones
    "voc_detection": [
        "cancer", "oncology", "CancerResearch",
        "Breathtest", "BreathAnalysis", "breathomics",
        "volatileorganiccompounds", "ExhalBreath",
    ],
    # Oncology / early cancer detection — active communities first
    "oncology": [
        "cancer", "oncology", "CancerResearch", "CancerSupport",
        "earlydetection", "CancerScreening",
        "lungcancer", "colorectalcancer",
    ],
    "diagnostics": [
        "medicalresearch", "clinicalresearch", "medicaldevices",
        "healthtech", "MedicalDevices", "PointOfCare",
        "bioinformatics",
    ],
    "medicine": [
        "medicine", "medical", "AskDocs",
        "oncology", "health", "medtech",
    ],
    # Biotech / pharma
    "biotech": [
        "biotech", "biology", "labrats", "biochemistry",
        "genetics", "DrugNerds",
    ],
    # Investing — biotech / smallcap
    "investing_biotech": [
        "investing", "stocks", "StockMarket", "smallcapstocks", "ValueInvesting",
        "SecurityAnalysis", "biotechstocks",
    ],
    # SaaS / B2B software
    "saas": [
        "SaaS", "startups", "ProductManagement", "EntrepreneurRideAlong",
        "microsaas", "indiehackers",
    ],
    # Developer tools / engineering
    "devtools": [
        "programming", "webdev", "devops", "softwareengineering",
        "cscareerquestions", "ExperiencedDevs",
    ],
    # AI / ML
    "ai": [
        "MachineLearning", "artificial", "deeplearning", "LocalLLaMA",
        "ChatGPT", "LanguageTechnology", "AIAssistants",
    ],
    # Fintech / personal finance
    "fintech": [
        "personalfinance", "financialindependence", "fintech", "CreditCards",
        "churning", "Frugal",
    ],
    # Cybersecurity
    "security": [
        "netsec", "cybersecurity", "hacking", "AskNetsec",
        "securityCTF", "blueteamsec",
    ],
    # E-commerce / retail
    "ecommerce": [
        "ecommerce", "fulfillment", "Flipping", "dropship",
        "AmazonSeller", "smallbusiness",
    ],
    # Marketing / SEO
    "marketing": [
        "marketing", "SEO", "PPC", "content_marketing",
        "digitalmarketing", "socialmedia",
    ],
    # Legal / compliance
    "legal": [
        "legaladvice", "LegalAdviceUK", "LegalAdviceEurope",
        "law", "paralegal",
    ],
    # Education / edtech
    "education": [
        "edtech", "Teachers", "academia", "GradSchool",
        "college", "OnlineLearning",
    ],
    # Climate / cleantech
    "cleantech": [
        "solar", "ClimateActionPlan", "renewable", "EVs",
        "sustainability", "ClimateChange",
    ],
    # Real estate / proptech
    "proptech": [
        "realestateinvesting", "RealEstate", "FirstTimeHomeBuyer",
        "landlord", "CommercialRealEstate",
    ],
    # HR / future of work
    "hrtech": [
        "humanresources", "recruiting", "ExperiencedDevs",
        "remotework", "careerguidance",
    ],
}

# Keywords that trigger each industry category.
# Matched against the brand profile description + prompt texts combined.
_DETECTION_RULES: list[tuple[str, list[str]]] = [
    # VOC / breath analysis detection — triggers for SpotitEarly-specific tech
    ("voc_detection",    ["breath", "exhaled breath", "volatile organic", "voc", "breathomics",
                          "breath test", "breath analysis", "breath-based", "electronic nose",
                          "mass spectrometry", "gas chromatography", "non-invasive detection",
                          "non-invasive screening", "spotitearly"]),
    ("oncology",         ["cancer", "oncology", "tumor", "tumour", "carcinoma",
                          "early detection", "screening", "biomarker", "liquid biopsy",
                          "breast cancer", "prostate cancer", "lung cancer", "colorectal cancer",
                          "pancreatic cancer", "cancer detection", "cancer screening",
                          "clia", "clinical trial"]),
    ("diagnostics",      ["diagnostic", "early detection", "genomic", "sequencing",
                          "clinical trial", "biomarker", "pathology", "medical device",
                          "health tech", "healthtech", "medtech", "point of care",
                          "non-invasive", "wearable diagnostic", "at-home test"]),
    ("medicine",         ["patient", "hospital", "physician", "doctor", "clinical", "healthcare",
                          "medicine", "medical", "treatment", "therapy", "pharma"]),
    ("biotech",          ["biotech", "biotechnology", "biopharmaceutical", "drug discovery",
                          "cell therapy", "gene therapy", "assay", "lab test"]),
    ("investing_biotech", ["investor", "invest", "stock", "nasdaq", "nyse", "ipo", "funding",
                           "series a", "series b", "venture", "biotech stock", "small cap"]),
    ("saas",             ["saas", "software as a service", "subscription", "b2b software",
                          "product-led", "api", "dashboard", "crm", "erp"]),
    ("devtools",         ["developer", "engineer", "programming", "devops", "ci/cd",
                          "kubernetes", "docker", "open source", "sdk", "api"]),
    ("ai",               ["artificial intelligence", "machine learning", "llm", "gpt", "neural",
                          "deep learning", "nlp", "ai model", "generative"]),
    ("fintech",          ["fintech", "neobank", "payment", "lending", "credit", "banking",
                          "wealth management", "personal finance", "robo-advisor"]),
    ("security",         ["cybersecurity", "security", "vulnerability", "penetration testing",
                          "soc", "endpoint", "zero trust", "devsecops"]),
    ("ecommerce",        ["ecommerce", "e-commerce", "marketplace", "retail", "fulfillment",
                          "dropshipping", "shopify", "amazon seller", "d2c", "dtc"]),
    ("marketing",        ["seo", "ppc", "paid media", "content marketing", "demand generation",
                          "account based", "marketing automation", "growth hacking"]),
    ("legal",            ["legal", "law firm", "compliance", "regulatory", "gdpr", "attorney",
                          "contract", "litigation", "ip"]),
    ("education",        ["edtech", "e-learning", "lms", "course", "online learning",
                          "university", "k-12", "curriculum", "upskilling"]),
    ("cleantech",        ["solar", "renewable", "wind energy", "ev", "electric vehicle",
                          "carbon", "net zero", "sustainability", "climate"]),
    ("proptech",         ["real estate", "property", "reit", "proptech", "mortgage",
                          "landlord", "tenant", "commercial real estate"]),
    ("hrtech",           ["hr", "human resources", "recruiting", "talent", "workforce",
                          "remote work", "hybrid", "payroll", "onboarding"]),
]


def _detect_industries(text: str) -> list[str]:
    """Return all matching industry keys for a given text blob."""
    low = text.lower()
    return [ind for ind, keywords in _DETECTION_RULES if any(kw in low for kw in keywords)]


# ── Subreddit promotion classification (mirrors drafting_service) ─────────────

_PROMO_RESTRICTED_SUBS = frozenset({
    "personalfinance", "legaladvice", "tax", "investing", "financialindependence",
    "frugal", "povertyfinance", "studentloans", "debtfree", "fire",
    "medicine", "askdocs", "medical", "medicaladvice", "nursing", "pharmacy",
    "mentalhealth", "depression", "anxiety", "bipolar", "schizophrenia",
    "chronicpain", "diabetes", "cancer", "epilepsy", "ibs", "autoimmune",
    "ems", "emergencymedicine", "veterinary",
    "science", "biology", "chemistry", "physics", "neuroscience",
    "psychology", "datascience", "statistics", "academicphilosophy",
    "compsci", "machinelearning", "artificial",
    "relationships", "amitheasshole", "relationship_advice", "tifu",
    "confessions", "grief", "survivorsofabuse", "ptsd", "addiction",
    "askreddit", "todayilearned", "explainlikeimfive", "changemyview",
    "nostupidquestions", "worldnews", "news", "nottheonion",
    "programming", "learnprogramming", "cscareerquestions", "devops",
    "sysadmin", "netsec", "cybersecurity",
})
_RESTRICTED_SIGNALS = ("help", "advice", "support", "care", "recover", "survivor", "anon")
_ALLOWED_SIGNALS = (
    "entrepreneur", "startup", "business", "marketing", "growth",
    "smallbusiness", "b2b", "saas", "productmanagement", "venturecapital",
    "growthhacking", "digitalmarketing", "contentmarketing",
)


def _promo_class(sub: str) -> int:
    """0 = promo-allowed, 1 = cautious, 2 = promo-restricted."""
    s = sub.lower()
    if s in _PROMO_RESTRICTED_SUBS or any(kw in s for kw in _RESTRICTED_SIGNALS):
        return 2
    if any(kw in s for kw in _ALLOWED_SIGNALS):
        return 0
    return 1


def _relevant_subreddits(
    description: Optional[str],
    prompt_texts: list[str],
    limit: int = 8,
    extra_profile_text: str = "",
) -> tuple[list[str], list[str]]:
    """
    Return (subreddits, industries) derived from brand profile + prompt texts.
    Applies a 70/30 split: ~70% of slots go to promo-allowed/cautious subreddits,
    ~30% to promo-restricted ones, so direct brand mentions are possible in most results.
    """
    parts = list(filter(None, [description, extra_profile_text] + prompt_texts))
    combined = " ".join(parts)
    if not combined.strip():
        return [], []

    industries = _detect_industries(combined)
    seen: set[str] = set()
    all_subs: list[str] = []
    for ind in industries:
        for sub in _INDUSTRY_MAP.get(ind, []):
            if sub not in seen:
                seen.add(sub)
                all_subs.append(sub)

    # Partition into allowed/cautious vs restricted
    open_subs = [s for s in all_subs if _promo_class(s) < 2]
    restricted_subs = [s for s in all_subs if _promo_class(s) == 2]

    # 70% open, 30% restricted (minimum 1 restricted slot if any exist)
    open_slots = max(1, round(limit * 0.70))
    restricted_slots = limit - open_slots

    result = open_subs[:open_slots] + restricted_subs[:restricted_slots]
    return result[:limit], industries


def get_relevant_subreddits(
    description: Optional[str],
    prompt_texts: list[str],
    limit: int = 8,
    extra_profile_text: str = "",
) -> list[str]:
    """Public wrapper — returns just the subreddit list."""
    subs, _ = _relevant_subreddits(description, prompt_texts, limit, extra_profile_text)
    return subs


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
    upvotes: int = 0,
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

    # Use whole-word matching to avoid false substring hits (e.g. "can" in "scanner")
    matches = sum(
        1 for w in prompt_words
        if re.search(r"\b" + re.escape(w) + r"\b", combined)
    )
    relevance = min(1.0, matches / len(prompt_words))

    # Hard minimum: post must share at least 45% of prompt keywords AND at least 2 matches.
    # This prevents high-recency/engagement posts from passing on 1–2 coincidental word hits.
    if relevance < 0.45 or matches < 2:
        return 0.0

    now_ts = datetime.now(timezone.utc).timestamp()
    age_s = now_ts - created_utc
    recency = max(0.0, 1.0 - age_s / (7 * 86400))

    engagement = min(1.0, upvotes / 50.0) if upvotes > 0 else 0.0

    score = relevance * 0.55 + recency * 0.30 + engagement * 0.15
    return round(score * 100.0, 1)


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
    from app.models import Brand, Prompt, BrandProfile, ContentOpportunity
    from sqlalchemy import select, delete as sql_delete

    logger.info("Reddit scanner: brand_id=%d clear_existing=%s", brand_id, clear_existing)

    async with AsyncSessionLocal() as db:
        brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_row.scalar_one_or_none()
        if brand is None:
            return 0

        profile_row = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        profile = profile_row.scalar_one_or_none()
        description = profile.company_description if profile else None

        # Build extra profile text from target_audience + key_stats for richer detection
        extra_parts: list[str] = []
        if profile:
            if profile.target_audience:
                extra_parts.append(profile.target_audience)
            try:
                key_stats = json.loads(profile.key_stats) if profile.key_stats else []
                extra_parts.extend(key_stats)
            except Exception:
                pass
        extra_profile_text = " ".join(extra_parts)

        prompts_row = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompts = list(prompts_row.scalars().all())
        if not prompts:
            logger.info("Reddit scanner: no prompts for brand_id=%d, skipping", brand_id)
            return 0

        prompt_texts = [p.text for p in prompts]
        subreddits, industries = _relevant_subreddits(
            description, prompt_texts, limit=8, extra_profile_text=extra_profile_text
        )

        logger.info(
            "Reddit scanner: brand=%r desc=%r | detected industries=%s | subreddits=%s",
            brand.name,
            (description or "")[:120],
            industries,
            subreddits,
        )

        if not subreddits:
            logger.info(
                "Reddit scanner: no relevant subreddits for brand_id=%d (%s), skipping",
                brand_id, brand.name,
            )
            return 0

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
        month_ago_ts = datetime.now(timezone.utc).timestamp() - 30 * 86400

        for prompt in prompts[:5]:
            q = urllib.parse.quote(prompt.text)

            # 1. Search within topically relevant subreddits (high precision)
            all_posts: list[dict] = []
            for sub in subreddits[:8]:
                sub_url = (
                    f"{_REDDIT_BASE}/r/{sub}/search.json"
                    f"?q={q}&restrict_sr=1&sort=relevance&t=month&limit=15"
                )
                all_posts.extend(_extract_posts(await _fetch(sub_url)))
                await asyncio.sleep(1.0)

            # 2. Global search — catches relevant threads in unmapped subreddits.
            #    Uses spam/fiction filters in _score_thread to block low-quality results.
            global_url = (
                f"{_REDDIT_BASE}/search.json"
                f"?q={q}&sort=relevance&t=month&limit=15"
            )
            all_posts.extend(_extract_posts(await _fetch(global_url)))
            await asyncio.sleep(1.0)

            for post in all_posts:
                permalink = post.get("permalink", "")
                if not permalink:
                    continue
                url = f"https://www.reddit.com{permalink}"
                if url in existing_urls:
                    continue

                created_utc = float(post.get("created_utc", 0))
                if created_utc < month_ago_ts:
                    continue

                title = post.get("title", "")
                body = post.get("selftext", "")
                upvotes = int(post.get("score", 0))
                subreddit_name = post.get("subreddit", "")

                if not title:
                    continue

                score = _score_thread(
                    title, body, prompt.text, created_utc, upvotes,
                    subreddit=subreddit_name,
                )
                # Require 55+ to avoid low-relevance posts inflated by recency/engagement
                if score < 55.0:
                    continue

                posted_dt = (
                    datetime.fromtimestamp(created_utc, tz=timezone.utc).replace(tzinfo=None)
                    if created_utc
                    else None
                )

                opp = ContentOpportunity(
                    brand_id=brand_id,
                    platform="reddit",
                    thread_url=url,
                    thread_title=title[:500],
                    subreddit=subreddit_name[:100],
                    body_preview=body[:500] if body else None,
                    posted_at=posted_dt,
                    relevance_score=score,
                    prompt_id=prompt.id,
                    status="new",
                )
                db.add(opp)
                existing_urls.add(url)
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
