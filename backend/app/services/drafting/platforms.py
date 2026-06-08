"""
Platform specifications and subreddit classification helpers.
"""
from __future__ import annotations

# ── Extended platform guidelines ──────────────────────────────────────────────

PLATFORM_SPECS: dict[str, dict] = {
    "reddit": {
        "format": "standalone_post",
        "word_range": (150, 400),
        "tone": "conversational, genuine community member voice — like a person talking, not an article being written",
        "rules": [
            "Write as a genuine community member, not a marketer — conversational and first-person where natural",
            "NO formal headers, NO markdown formatting (no ##, no bold headers) — at most 1 to 2 bullet points maximum, only if a short list genuinely helps",
            "A clear problem-then-direct-solution or question-then-answer structure is good — the Reddit content AI engines actually cite is overwhelmingly direct answers to specific questions. Keep it conversational (a person sharing what worked), not an essay, but do not avoid directly answering a question.",
            "Add genuine value — answer a question, share a personal experience, contribute a real insight",
            "Mention the brand only if it fits naturally into the conversation; never force it",
            "No promotional language, no calls to action, no links unless absolutely essential",
            "Disclose brand affiliation if the brand is mentioned",
            "Sound like a real person talking — not an article, not a press release, not a structured essay",
        ],
        "disclaimer": "Always disclose brand affiliation per Reddit's rules.",
        "posting_tip": "Choose the most relevant subreddit for your brand's niche.",
    },
    "reddit_reply": {
        "format": "thread_reply",
        "word_range": (20, 80),
        "tone": "direct, helpful, brief",
        "rules": [
            "1 to 4 sentences only — replies should be direct and concise",
            "Answer the specific question or comment being replied to",
            "Mention the brand only if it directly answers the question",
            "No hedging, no preamble — get to the point immediately",
        ],
        "disclaimer": "Disclose brand affiliation if mentioning the brand.",
        "posting_tip": "Reply directly to the original poster's question.",
    },
    "quora": {
        "format": "answer",
        "word_range": (250, 550),
        "tone": "practitioner — direct, specific, written like a knowledgeable person explaining something they've actually done or seen, not a brand spokesperson",
        "rules": [
            "The VERY FIRST SENTENCE must state the direct answer concretely — no 'great question', no setup, no 'it depends'. If the question is 'what tool should I use for X?', sentence 1 names the tool or approach, not background on X.",
            "Structure: (1) one clear direct-answer sentence, (2) 2–4 short paragraphs with concrete supporting evidence or examples, (3) one practical takeaway sentence at the end",
            "Write as a practitioner who has solved this problem, not as a brand representative writing copy. No corporate voice, no superlatives, no buzzwords",
            "Every claim must be specific and concrete — replace vague statements ('it's very effective') with precise ones ('it reduced false-positive alerts by cutting noise from 300 to under 20 per day')",
            "Vary sentence length: short punchy sentences for key points, longer ones for explanation. Never three sentences in a row of similar length.",
            "Brand mentions: only include if the brand is a direct, specific answer to the question. If mentioned, do so in a concrete context ('X uses this approach to do Y') — never as a recommendation or pitch",
            "Do NOT re-state or paraphrase the question anywhere in the answer",
            "No parenthetical asides, no hedging, no qualifications that undermine the answer",
        ],
        "disclaimer": "Disclose any brand affiliation in your Quora credentials.",
        "posting_tip": "Find a relevant question on Quora and post this as your answer.",
    },
    "medium": {
        "format": "article",
        "word_range": (800, 2000),
        "tone": "thought leadership, editorial, analytical — structured like a quality article with a clear arc",
        "rules": [
            "Open by directly answering the core question in the first 1-2 sentences (a concrete fact or claim) — AI engines cite content that answers fast, not slow-building hooks",
            "Structure with clear H2/H3 headings (## and ###). Each section is a self-contained ~120-180 word answer block that AI engines can extract and cite on its own — so lead each section with its key claim, then support it. Do not write one long undifferentiated prose flow.",
            "The brand name MUST appear at least once in the article. Find a natural, earned place for it: a concrete claim, an example of the approach in action, a specific data point, or a direct mention of a capability. The brand name must appear in the body text.",
            "Where the Brand Profile includes peer-reviewed publications, cite them naturally in the body (e.g. 'A study published in...' or 'Research from...')",
            "Include concrete data, examples, or evidence to support every major claim — never make unsupported assertions",
            "End with a strong, specific conclusion that delivers an actionable insight — not a generic 'in conclusion' paragraph",
            "Brand references must be contextual and earned — not promotional",
        ],
        "disclaimer": None,
        "posting_tip": "Publish to your personal Medium profile or a relevant publication.",
    },
    "owned_site": {
        "format": "owned_website_answer_page",
        "word_range": (400, 1200),
        "tone": "authoritative, concrete, first-party — a brand explaining its own thing factually",
        "rules": [
            # owned_site uses its own dedicated generator (drafting/owned_site.py); these
            # are informational/UI rules. The Tier-1 AIO channel: content on the brand's
            # OWN domain, which the research shows AI engines cite far more than social.
            "Publish on the brand's OWN website/blog (its own domain), not a third-party platform",
            "Lead with the direct answer; use H2/H3 headings with self-contained ~120-180 word answer blocks",
            "Include concrete statistics and cite authoritative sources inline; emit JSON-LD schema",
            "This is the highest-value AIO channel — owned/authority domains get cited; social rarely does",
        ],
        "disclaimer": None,
        "posting_tip": "Publish this as a page/post on your own website. The JSON-LD block goes in the page <head>.",
    },
    "wikipedia": {
        "format": "suggested_edit",
        "word_range": (100, 300),
        "tone": "neutral, encyclopedic, sourced",
        "rules": [
            "Use neutral, third-person encyclopedic language only",
            "Every claim must be verifiable and cite a reliable independent source",
            "Suggest edits to existing articles only — do not create brand articles",
            "No promotional language, superlatives, or marketing claims whatsoever",
            "Present only facts that pass Wikipedia's notability threshold",
        ],
        "disclaimer": (
            "⚠️ Wikipedia COI Policy: Editing Wikipedia to promote your brand may violate "
            "WP:COI guidelines. Disclose your affiliation on the article talk page and "
            "request an edit rather than making it directly."
        ),
        "posting_tip": "Post as a requested edit on the article's Talk page.",
    },
    "linkedin_article": {
        "format": "long_form_article",
        "word_range": (600, 1500),
        "tone": "professional thought leadership — insightful but accessible, written for industry peers",
        "rules": [
            "Open with a compelling hook that frames a professional challenge or insight — not 'I've been thinking about...'",
            "Structure with clear sections using bold text for section breaks (NOT markdown ## headers — LinkedIn renders bold, not headers)",
            "Write as a credible industry voice sharing hard-won expertise, not a brand spokesperson",
            "Include concrete data, examples, or case studies to support every major claim",
            "The brand name MUST appear at least once, in a concrete professional context — a specific result, capability, or approach",
            "End with a specific, actionable takeaway — not a generic call to action or 'what do you think?'",
            "No hashtags in the body text — they go at the very end if anywhere",
            "No promotional language, no superlatives, no buzzwords",
            "Use line breaks between paragraphs for LinkedIn readability",
        ],
        "disclaimer": None,
        "posting_tip": "Publish as a LinkedIn article from your personal or company profile.",
    },
    "linkedin_post": {
        "format": "short_form_post",
        "word_range": (80, 250),
        "tone": "conversational professional — direct, punchy, written for the LinkedIn feed",
        "rules": [
            "First line must hook — it's the only thing visible before 'see more'. Make it count.",
            "Short paragraphs (1-2 sentences each) with line breaks between them for mobile readability",
            "Write as a real person sharing a professional insight, not a corporate account",
            "One clear idea per post — don't try to cover everything",
            "Brand mention only if it fits naturally in a concrete claim or example",
            "No hashtags in the body — add 3-5 relevant hashtags on the final line, separated from the body by a blank line",
            "No emojis as bullet points. No emoji spam. One emoji maximum, only if natural.",
            "No 'Agree?' or 'Thoughts?' engagement bait at the end",
        ],
        "disclaimer": None,
        "posting_tip": "Post directly to your LinkedIn feed.",
    },
    "x_thread": {
        "format": "thread",
        "word_range": (400, 800),
        "tone": "sharp, direct, informative — written for fast-scrolling readers who reward substance",
        "rules": [
            "Format as a numbered thread: 1/ first tweet, 2/ second tweet, etc.",
            "First tweet (1/) must be a strong standalone hook — it determines whether anyone reads the rest",
            "Each tweet MUST be under 280 characters individually",
            "4-8 tweets total. Each tweet should make one clear point.",
            "Use short sentences. No filler. Every word earns its place.",
            "Brand mention in 1-2 tweets maximum, in a concrete context (a specific result or approach)",
            "Last tweet: a specific takeaway or insight, NOT 'follow for more' or 'RT if you agree'",
            "No hashtags except optionally 1-2 on the final tweet",
            "No emojis as bullet points or thread markers",
        ],
        "disclaimer": None,
        "posting_tip": "Post as a thread on X. The first tweet is your hook.",
    },
    "x_post": {
        "format": "single_post",
        "word_range": (20, 70),
        "tone": "sharp, conversational, concise — every character counts",
        "rules": [
            "MUST be under 280 characters total — this is a hard limit",
            "One clear idea or insight. No preamble.",
            "Brand mention only if it's the direct point of the post",
            "No hashtags unless they add genuine context (1 max)",
            "No engagement bait ('RT if...', 'Like if...')",
            "Write like a knowledgeable person posting, not a brand account",
        ],
        "disclaimer": None,
        "posting_tip": "Post directly to X.",
    },
    "linkedin_reply": {
        "format": "thread_reply",
        "word_range": (30, 120),
        "tone": "professional, helpful, concise — a knowledgeable peer contributing to the conversation",
        "rules": [
            "2 to 5 sentences — add a specific insight, not generic agreement",
            "Reference the original post's point and build on it with concrete experience or data",
            "Mention the brand only if it directly addresses the discussion topic",
            "No hashtags, no self-promotion, no 'great post!' openers",
            "Write as a professional sharing expertise, not a brand account",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the LinkedIn post or comment.",
    },
    "x_reply": {
        "format": "thread_reply",
        "word_range": (10, 50),
        "tone": "sharp, direct, conversational — every character counts",
        "rules": [
            "MUST be under 280 characters — hard limit",
            "One clear point that adds to the conversation",
            "Mention the brand only if it directly answers a question",
            "No hashtags, no engagement bait",
            "Write like a knowledgeable person replying, not a brand account",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the tweet.",
    },
}

ALL_PLATFORMS = list(PLATFORM_SPECS.keys())
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p not in ("reddit_reply", "linkedin_reply", "x_reply")]

# Base platform names stored in BrandContentSettings — map to their default
# gap-draft variant so auto_draft_top_gaps can accept either form.
_BASE_PLATFORM_MAP: dict[str, str] = {
    "linkedin": "linkedin_article",
    "x": "x_thread",
}

def resolve_platform_key(platform: str) -> str:
    """Map a base platform name (e.g. 'linkedin') to its draft variant ('linkedin_article')."""
    return _BASE_PLATFORM_MAP.get(platform, platform)

# Per-platform max_tokens for gap drafts (opportunity reply uses its own limit)
PLATFORM_MAX_TOKENS: dict[str, int] = {
    "reddit": 1200,
    "quora": 1800,
    "medium": 3500,
    "owned_site": 3000,  # handled in a separate branch (owned_site.py generator)
    "wikipedia": 900,  # handled in separate branch, kept here for reference
    "linkedin_article": 3000,
    "linkedin_post": 800,
    "x_thread": 2000,
    "x_post": 300,
}


# ── Subreddit promotion classification ───────────────────────────────────────

# Subreddits with documented rules against self-promotion / advertising.
# Content in these subs must be purely value-driven — no brand naming.
_PROMO_RESTRICTED_SUBREDDITS: frozenset[str] = frozenset({
    # Finance / Legal
    "personalfinance", "legaladvice", "tax", "investing", "financialindependence",
    "frugal", "povertyfinance", "studentloans", "debtfree", "fire",
    # Health / Medicine
    "medicine", "askdocs", "medical", "medicaladvice", "nursing", "pharmacy",
    "mentalhealth", "depression", "anxiety", "bipolar", "schizophrenia",
    "chronicpain", "diabetes", "cancer", "epilepsy", "ibs", "autoimmune",
    "ems", "emergencymedicine", "veterinary",
    # Science / Academia
    "science", "biology", "chemistry", "physics", "neuroscience",
    "psychology", "datascience", "statistics", "academicphilosophy",
    "compsci", "machinelearning", "artificial",
    # Support / Advice communities
    "relationships", "amitheasshole", "relationship_advice", "tifu",
    "confessions", "grief", "survivorsofabuse", "ptsd", "addiction",
    # General large subs with anti-spam rules
    "askreddit", "todayilearned", "explainlikeimfive", "changemyview",
    "nostupidquestions", "worldnews", "news", "nottheonion",
    # Tech / Career — strong no-spam norms
    "programming", "learnprogramming", "cscareerquestions", "devops",
    "sysadmin", "netsec", "cybersecurity",
})

# Keywords in subreddit names that suggest promo-friendly or promo-restricted posture
_RESTRICTED_NAME_SIGNALS = ("help", "advice", "support", "care", "recover", "survivor", "anon")
_ALLOWED_NAME_SIGNALS = (
    "entrepreneur", "startup", "business", "marketing", "growth",
    "smallbusiness", "b2b", "saas", "productmanagement", "venturecapital",
    "growthhacking", "digitalmarketing", "contentmarketing",
)


def classify_subreddit(subreddit: str) -> str:
    """Returns 'restricted', 'allowed', or 'cautious' for a given subreddit name."""
    sub = subreddit.lower().strip().lstrip("r/")
    if sub in _PROMO_RESTRICTED_SUBREDDITS:
        return "restricted"
    if any(kw in sub for kw in _RESTRICTED_NAME_SIGNALS):
        return "restricted"
    if any(kw in sub for kw in _ALLOWED_NAME_SIGNALS):
        return "allowed"
    return "cautious"


def build_subreddit_strategy(subreddit: str, brand_name: str, strategy: str) -> str:
    """Returns the prompt block telling Claude how to handle promotion for this subreddit."""
    sub = subreddit.lstrip("r/")
    if strategy == "restricted":
        return (
            f"\nCOMMUNITY STRATEGY — CRITICAL:\n"
            f"r/{sub} strictly prohibits self-promotion and direct brand advertising. "
            f"You MUST NOT mention {brand_name} by name or make any promotional claims about it.\n"
            f"You MAY reference {brand_name}'s knowledge, data, or research indirectly:\n"
            f"  - Cite published papers or studies by title/journal without attributing them to {brand_name} "
            f"(e.g. 'A 2024 study in Nature found...' rather than '{brand_name} published a study...')\n"
            f"  - Share factual insights drawn from {brand_name}'s expertise as your own informed perspective "
            f"(e.g. 'Research suggests...' or 'In my experience working in this space...')\n"
            f"  - Link to independent sources, papers, or data — not to {brand_name}'s website directly\n"
            f"  - Goal: be the most genuinely helpful reply in the thread. Earn credibility through expertise, "
            f"not brand recognition."
        )
    elif strategy == "allowed":
        return (
            f"\nCOMMUNITY STRATEGY:\n"
            f"r/{sub} allows relevant brand mentions. You may reference {brand_name} naturally "
            f"once if it directly and clearly answers the question being asked. Lead with genuine "
            f"insight or value — the brand mention, if present, should feel earned and secondary."
        )
    else:  # cautious
        return (
            f"\nCOMMUNITY STRATEGY:\n"
            f"r/{sub}'s stance on self-promotion is unclear — default to value-first. "
            f"Only name {brand_name} if it is the most direct, obvious answer to the exact "
            f"question asked and nothing else would serve better. If in doubt, omit the brand "
            f"name entirely and focus on being the most helpful reply in the thread."
        )
