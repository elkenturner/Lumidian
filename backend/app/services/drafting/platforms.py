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
            "CRITICAL: Do NOT pose a question and then answer it yourself. You are writing a comment or contribution to an existing discussion — not a standalone Q&A post. Write as if you are directly responding to something, sharing a perspective, or contributing a genuine insight.",
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
            "Open with a strong hook in the first 1-2 sentences — a surprising fact, a provocative question, or a bold statement that earns the reader's attention",
            "Structure the article clearly with flowing prose sections: hook → context/problem → main argument → strong conclusion. Separate sections with a blank line — do NOT use ## markdown headers",
            "NO ## headings, NO markdown headers of any kind — write in editorial prose that flows naturally from one idea to the next",
            "The brand name MUST appear at least once in the article. Find a natural, earned place for it: a concrete claim, an example of the approach in action, a specific data point, or a direct mention of a capability. The brand name must appear in the body text.",
            "Where the Brand Profile includes peer-reviewed publications, cite them naturally in the body (e.g. 'A study published in...' or 'Research from...')",
            "Include concrete data, examples, or evidence to support every major claim — never make unsupported assertions",
            "End with a strong, specific conclusion that delivers an actionable insight — not a generic 'in conclusion' paragraph",
            "Brand references must be contextual and earned — not promotional",
        ],
        "disclaimer": None,
        "posting_tip": "Publish to your personal Medium profile or a relevant publication.",
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
        "format": "article",
        "word_range": (600, 1500),
        "tone": "long-form editorial, professional thought leadership — structured, authoritative, written by a respected industry voice",
        "rules": [
            "Open with a strong hook in the first 1-2 sentences — a surprising stat, a bold claim, or a direct answer to the target query",
            "Structure with short focused sections separated by blank lines — headers are acceptable on LinkedIn Articles",
            "The brand name must appear at least once, in a concrete context (a claim, an example, a data point) — not as a pitch",
            "Every major claim must be backed by specific data, examples, or evidence from the Brand Profile",
            "Where the Brand Profile includes publications, cite them naturally (e.g. 'A study published in...')",
            "End with a specific, actionable takeaway — not a generic conclusion",
            "No marketing language, no superlatives, no calls to action to 'follow' or 'like'",
            "1-3 relevant hashtags at the very end, on their own line",
            "Content must read as written by a knowledgeable industry professional, not by a brand spokesperson",
        ],
        "disclaimer": None,
        "posting_tip": "Publish as a LinkedIn Article (not a post) for Google indexation — articles are crawled by search engines.",
    },
    "linkedin_post": {
        "format": "post",
        "word_range": (80, 250),
        "tone": "professional but conversational — like a respected colleague sharing an insight",
        "rules": [
            "Open with a direct statement or insight — no 'I've been thinking about...' preamble",
            "Write in short paragraphs (1-3 sentences each) with line breaks between them — LinkedIn's feed rewards scannable formatting",
            "Brand mention only if it directly supports the point being made — never forced",
            "No clickbait hooks ('You won't believe...', 'Stop doing this...')",
            "No excessive emoji or formatting gimmicks",
            "1-3 relevant hashtags at the end",
            "Contractions are fine — sound like a person, not a press release",
            "No links unless essential to the point",
        ],
        "disclaimer": None,
        "posting_tip": "Post from your company's LinkedIn page or personal profile.",
    },
    "linkedin_reply": {
        "format": "reply",
        "word_range": (30, 100),
        "tone": "direct, professional, helpful — like replying to a colleague's post",
        "rules": [
            "1-4 sentences only — replies should be direct and add concrete value",
            "Address the specific point or question in the original post",
            "Brand mention only if it directly answers the question being asked",
            "No hedging, no preamble — get to the point immediately",
            "No hashtags in replies",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the original post.",
    },
    "x_thread": {
        "format": "thread",
        "word_range": (150, 500),
        "tone": "narrative, educational — each tweet stands alone but builds toward a point",
        "rules": [
            "Format each tweet on its own line, prefixed with 1/, 2/, etc.",
            "Each tweet must be under 280 characters — hard limit, no exceptions",
            "First tweet must hook — state a surprising fact, a bold claim, or a direct answer to the target query",
            "Each tweet should make sense on its own if read in isolation",
            "The brand name should appear naturally in one tweet (not the first) where it supports the argument",
            "Last tweet should deliver a concrete takeaway or insight — not a generic wrap-up",
            "0-1 hashtags total, in the last tweet only if natural",
            "No 'Thread:' or 'A thread' prefix — just start with the content",
            "Vary tweet length — mix short punchy tweets with longer substantive ones",
        ],
        "disclaimer": None,
        "posting_tip": "Post as a thread from your brand's X account.",
    },
    "x_post": {
        "format": "post",
        "word_range": (15, 65),
        "tone": "concise, punchy, conversational — like a smart person tweeting an insight",
        "rules": [
            "Must be under 280 characters — hard limit",
            "One clear idea per tweet — do not try to pack multiple points",
            "Brand mention only if it is the most natural way to make the point",
            "0-1 hashtags, only if genuinely relevant",
            "No thread numbering (this is a standalone tweet)",
            "Contractions, casual phrasing, and direct address are encouraged",
        ],
        "disclaimer": None,
        "posting_tip": "Post from your brand's X account.",
    },
    "x_reply": {
        "format": "reply",
        "word_range": (10, 50),
        "tone": "direct, helpful, brief — like replying to someone's tweet",
        "rules": [
            "Must be under 280 characters — hard limit",
            "1-2 sentences maximum — direct and to the point",
            "Answer the specific question or add to the specific discussion",
            "Brand mention only if it directly and obviously answers the question",
            "No hashtags in replies",
            "No hedging — be direct",
        ],
        "disclaimer": None,
        "posting_tip": "Reply directly to the tweet.",
    },
}

ALL_PLATFORMS = list(PLATFORM_SPECS.keys())
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p not in ("reddit_reply", "linkedin_reply", "x_reply")]

# Per-platform max_tokens for gap drafts (opportunity reply uses its own limit)
PLATFORM_MAX_TOKENS: dict[str, int] = {
    "reddit": 1200,
    "quora": 1800,
    "medium": 3500,
    "wikipedia": 900,  # handled in separate branch, kept here for reference
    "linkedin_article": 3000,
    "linkedin_post": 800,
    "linkedin_reply": 400,
    "x_thread": 1500,
    "x_post": 300,
    "x_reply": 200,
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
