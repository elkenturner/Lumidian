"""
Drafting Service — Phase 2 dynamic drafting engine.

Improvements over content_service.py:
- Pulls the full BrandProfile as context (description, key stats, tone, approved language)
- Reads stored LLM responses for the target prompt to understand the current narrative
- Generates platform-appropriate content that addresses the *specific* gap
- Enforces strict editorial style rules
- Calculates an estimated visibility impact score for each draft
- Supports opportunity-based drafting (reply to a specific Reddit/Quora thread)

Public API
----------
generate_gap_draft(db, brand_id, prompt_id, platform) -> ContentDraft
generate_opportunity_draft(db, opportunity_id)         -> ContentDraft
auto_draft_top_gaps(db, brand_id, max_gaps=3)         -> list[ContentDraft]
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    ContentGap,
    ContentDraft,
    ContentOpportunity,
    Prompt,
    QueryResult,
    TrackingRun,
    BrandContentSettings,
)

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Extended platform guidelines ──────────────────────────────────────────────

PLATFORM_SPECS: dict[str, dict] = {
    "reddit": {
        "format": "standalone_post",
        "word_range": (150, 400),
        "tone": "conversational, genuine community member voice — like a person talking, not an article being written",
        "rules": [
            "Write as a genuine community member, not a marketer — conversational and first-person where natural",
            "NO formal headers or markdown formatting — at most 1 to 2 bullet points maximum, only if a short list genuinely helps",
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
        "word_range": (200, 500),
        "tone": "expert but accessible — the very first sentence delivers the direct answer",
        "rules": [
            "The FIRST SENTENCE must directly and concretely answer the question — absolutely no preamble, no context-setting, no 'great question'",
            "Write a standalone expert answer — do NOT write, invent, or reference any question in your response",
            "Expert but accessible tone — explain clearly without jargon, unless the audience is clearly technical",
            "Zero corporate language, buzzwords, or marketing-speak — write as an informed human being, not a brand representative",
            "Expand on the direct answer with context, evidence, or real examples after the opening sentence",
            "Brand mentions must arise naturally from the answer — not be tacked on",
            "Focus entirely on delivering value to the reader",
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
            "Structure the article clearly: hook → context/problem → main argument with subheadings → strong conclusion",
            "Use subheadings (##) to organize each major section — readers must be able to skim and understand the full structure",
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
}

ALL_PLATFORMS = list(PLATFORM_SPECS.keys())
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p != "reddit_reply"]

# Per-platform max_tokens for gap drafts (opportunity reply uses its own limit)
PLATFORM_MAX_TOKENS: dict[str, int] = {
    "reddit": 1200,
    "quora": 1500,
    "medium": 3500,
    "wikipedia": 900,  # handled in separate branch, kept here for reference
}


# ── Brand profile loader ──────────────────────────────────────────────────────

def _extract_publications(profile: "BrandProfile") -> list[dict]:
    """Return parsed publications list from the profile, or empty list."""
    if not profile or not profile.publications:
        return []
    try:
        return json.loads(profile.publications)
    except Exception:
        return []


async def _load_profile_context(db: AsyncSession, brand_id: int) -> str:
    """Build a rich text block from the BrandProfile for use in prompts."""
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile: Optional[BrandProfile] = result.scalar_one_or_none()

    if profile is None:
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_result.scalar_one_or_none()
        return f"Brand name: {brand.name if brand else 'Unknown'}\nNo brand profile configured."

    lines = []
    if profile.company_description:
        lines.append(f"Company description:\n{profile.company_description}")

    key_stats = json.loads(profile.key_stats) if profile.key_stats else []
    if key_stats:
        lines.append("Key facts and statistics:\n" + "\n".join(f"  - {s}" for s in key_stats))

    if profile.tone_of_voice:
        lines.append(f"Brand tone of voice: {profile.tone_of_voice}")

    if profile.target_audience:
        lines.append(f"Target audience: {profile.target_audience}")

    approved = json.loads(profile.approved_language) if profile.approved_language else []
    if approved:
        lines.append("Approved language / preferred terminology:\n" + "\n".join(f"  - {t}" for t in approved))

    prohibited = json.loads(profile.what_not_to_say) if profile.what_not_to_say else []
    if prohibited:
        lines.append("Do NOT use these phrases or claims:\n" + "\n".join(f"  - {p}" for p in prohibited))

    publications = _extract_publications(profile)
    if publications:
        pub_lines = []
        for p in publications:
            parts = filter(None, [p.get("title"), p.get("publisher"), p.get("date"), p.get("url")])
            pub_lines.append("  - " + " | ".join(parts))
        lines.append("Peer-reviewed publications (use for citations):\n" + "\n".join(pub_lines))

    if profile.internal_brand_context:
        lines.append(
            "SUPPLEMENTARY context from company website — use ONLY to fill gaps not covered by the Brand Profile fields above. "
            "Brand Profile always takes priority over this section. Never invent or paraphrase facts from this section "
            "that contradict the Brand Profile:\n" + profile.internal_brand_context[:3000]
        )

    return "\n\n".join(lines) if lines else "No brand profile details available."


async def _load_publications(db: AsyncSession, brand_id: int) -> list[dict]:
    """Load publications list directly from BrandProfile."""
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile: Optional[BrandProfile] = result.scalar_one_or_none()
    return _extract_publications(profile) if profile else []


DRAFT_CAP = 20
SCHEDULED_CAP = 20


async def _get_existing_drafts_for_prompt(
    db: AsyncSession, brand_id: int, prompt_id: int, platform: str
) -> list[ContentDraft]:
    """Load existing non-dismissed drafts for a prompt/platform combination."""
    result = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.platform == platform,
            ContentDraft.status.in_(["draft", "approved"]),
        )
        .order_by(ContentDraft.created_at.desc())
        .limit(5)
    )
    return list(result.scalars().all())


async def _count_drafts_by_status(
    db: AsyncSession, brand_id: int, status: str
) -> int:
    """Count drafts in a given status for a brand."""
    result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == status,
        )
    )
    return result.scalar_one_or_none() or 0


# ── Response analysis ─────────────────────────────────────────────────────────

async def _analyze_responses_for_prompt(
    db: AsyncSession, brand_id: int, prompt_id: int
) -> str:
    """
    Read the most recent stored LLM responses for a prompt.
    Returns a summary of what is currently being said and what is missing.
    """
    from sqlalchemy import Float, cast

    # Get the latest completed run for this brand
    run_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run = run_result.scalar_one_or_none()
    if latest_run is None:
        return "No tracking data available yet."

    # Load responses for this prompt from the latest run
    qr_result = await db.execute(
        select(QueryResult)
        .where(
            QueryResult.tracking_run_id == latest_run.id,
            QueryResult.prompt_id == prompt_id,
            QueryResult.response_text.isnot(None),
        )
        .limit(8)
    )
    responses = list(qr_result.scalars().all())

    if not responses:
        return "No LLM responses stored for this prompt yet."

    mentioning = [r for r in responses if r.mentioned]
    not_mentioning = [r for r in responses if not r.mentioned]

    lines = []

    if mentioning:
        lines.append(
            f"Responses that DO mention the brand ({len(mentioning)}/{len(responses)}):"
        )
        for r in mentioning[:2]:
            preview = (r.response_text or "")[:300].replace("\n", " ")
            lines.append(f"  [{r.model}]: {preview}...")
    else:
        lines.append(f"None of the {len(responses)} recent LLM responses mention the brand.")

    if not_mentioning:
        lines.append(
            f"\nResponses that do NOT mention the brand — these show what narrative is missing:"
        )
        for r in not_mentioning[:3]:
            preview = (r.response_text or "")[:300].replace("\n", " ")
            lines.append(f"  [{r.model}]: {preview}...")

    return "\n".join(lines)


# ── Estimated impact calculation ──────────────────────────────────────────────

async def _estimate_impact(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int,
    platform: str,
) -> float:
    """
    Estimate the visibility impact of a draft (0–100).
    Higher = more likely to move the needle.
    """
    from sqlalchemy import Float, cast

    # Gap score for this prompt (0-100)
    gap_result = await db.execute(
        select(ContentGap)
        .where(
            ContentGap.brand_id == brand_id,
            ContentGap.prompt_id == prompt_id,
        )
        .order_by(ContentGap.identified_at.desc())
        .limit(1)
    )
    gap = gap_result.scalar_one_or_none()
    gap_score = gap.gap_score if gap else 50.0

    # Current visibility for this prompt (lower = higher impact potential)
    vis_result = await db.execute(
        sqlfunc.coalesce(
            select(sqlfunc.avg(cast(QueryResult.mentioned, Float)))
            .join(TrackingRun, TrackingRun.id == QueryResult.tracking_run_id)
            .where(
                QueryResult.prompt_id == prompt_id,
                TrackingRun.status == "completed",
            )
            .scalar_subquery(),
            0.0,
        )
    )
    visibility_fraction = vis_result.scalar_one_or_none() or 0.0
    visibility_pct = float(visibility_fraction) * 100.0
    low_vis_bonus = max(0.0, (50.0 - visibility_pct))  # 0-50

    # Platform activity — if no content posted on this platform recently, higher impact
    from datetime import timedelta
    from app.models import ContentPost
    thirty_days_ago = _utcnow() - timedelta(days=30)
    post_result = await db.execute(
        select(sqlfunc.count(ContentPost.id))
        .join(ContentDraft, ContentDraft.id == ContentPost.draft_id)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentPost.platform == platform,
            ContentPost.posted_at >= thirty_days_ago,
        )
    )
    recent_posts = post_result.scalar_one_or_none() or 0
    platform_bonus = 20.0 if recent_posts == 0 else max(0.0, 10.0 - recent_posts * 2)

    raw = gap_score * 0.6 + low_vis_bonus * 0.6 + platform_bonus
    return round(min(100.0, raw), 1)


# ── Wikipedia-specific prompt builder and parser ─────────────────────────────

import re as _re

# Patterns that indicate the LLM leaked analysis/instructions into the wiki text
_ANALYSIS_LINE_RE = _re.compile(
    r"^\s*(\*{0,3}\s*)?"
    r"(analysis|missing (angle|information|context)|article to edit|"
    r"suggested (edit|insertion|text|paragraph)|what (is )?missing|"
    r"current narrative|note[:\s]|explanation|insight|instructions?"
    r")\b",
    _re.IGNORECASE,
)


def _clean_wiki_text(text: str) -> str:
    """
    Strip analysis/instruction lines that Claude sometimes leaks into wiki output.
    Also remove markdown headers that aren't valid wiki syntax.
    """
    lines = text.splitlines()
    cleaned: list[str] = []
    for line in lines:
        # Drop analysis commentary lines
        if _ANALYSIS_LINE_RE.match(line):
            continue
        # Drop markdown headers (## Foo) — these are not wiki syntax
        if _re.match(r"^#{1,6}\s+\S", line):
            continue
        # Drop standalone bold-wrapped headings (**Heading**)
        if _re.match(r"^\s*\*{2,3}[^*\n]+\*{2,3}\s*$", line):
            continue
        cleaned.append(line)
    # Collapse runs of blank lines
    result = _re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned))
    return result.strip()


def _build_citation_ref(publications: list[dict], brand_name: str) -> str:
    """Build a <ref> tag from the first publication, or a blank placeholder if none."""
    if publications:
        p = publications[0]
        url = p.get("url", "")
        title = p.get("title", "")
        publisher = p.get("publisher", brand_name)
        date = p.get("date", "")
        return f"<ref>{{{{cite journal|url={url}|title={title}|publisher={publisher}|date={date}}}}}</ref>"
    # No publications — return a blank placeholder; do NOT invent citation data
    return "<ref>{{cite journal|url=|title=|publisher=|date=}}</ref>"


def _build_wikipedia_prompt(
    brand_name: str,
    prompt_text: str,
    profile_context: str,
    response_analysis: str,
    publications: list[dict] | None = None,
) -> str:
    citation_ref = _build_citation_ref(publications or [], brand_name)
    pub_note = ""
    if publications:
        p = publications[0]
        pub_note = (
            f"\nCITATION TO USE: The citation is already provided below — copy it exactly as-is:\n"
            f"  {citation_ref}\n"
            f"  (Source: {p.get('title', '')} — {p.get('publisher', '')} {p.get('date', '')})"
        )
    else:
        pub_note = (
            "\nCITATION: No peer-reviewed publications are available. "
            "Use the blank citation placeholder exactly as shown; do NOT invent any citation data."
        )

    return f"""You are an experienced Wikipedia editor. Given a brand profile and a target query, you must:
1. Identify ONE specific, real, existing Wikipedia article to edit.
2. Write the exact wikitext sentence(s) to insert into it.
3. Specify exactly where in the article to insert the text.

BRAND PROFILE:
{profile_context}

TARGET QUERY:
"{prompt_text}"

WHAT AI SYSTEMS CURRENTLY SAY:
{response_analysis}
{pub_note}

ARTICLE SELECTION — choose the article whose topic most directly matches the key terms in the target query. The article title and section should use the same vocabulary as the query (e.g. if the query mentions "breath test", target the "Breath test" article; if it mentions "cancer detection", target "Cancer screening" or a disease article). Examples of good targets:
  - A technology article (e.g. "Breath test", "Liquid biopsy", "Volatile organic compound")
  - A medical procedure article (e.g. "Cancer screening", "Colonoscopy", "Mammography")
  - A disease article (e.g. "Lung cancer", "Colorectal cancer")
  - A science/method article (e.g. "Gas chromatography", "Mass spectrometry")
  Never target: brand articles, disambiguation pages, or articles you are inventing.

WIKI TEXT RULES (absolute — every rule is mandatory):
  - Neutral encyclopedic tone only — no promotional language, no superlatives, no brand advocacy of any kind
  - NEVER use first person ("we", "our", "I", "us") — third person only
  - No marketing language whatsoever — if a sentence sounds like it belongs in a press release, rewrite it completely
  - Every factual claim must be attributable to the citation provided — do not state facts that cannot be sourced to it
  - Only verifiable, citable facts — nothing invented, nothing approximated
  - Use [[wikilinks]] around key terms that have Wikipedia articles
  - The wikitext must naturally use key noun phrases from the target query (e.g. if the query is "breath test for cancer detection", the sentence must use those exact terms)
  - Structure: 1 to 3 sentences maximum, written as a natural addition to an existing article section — not a standalone paragraph
  - End with the citation ref provided above — copy it exactly, do not modify it
  - The text must read as encyclopedia prose; if it sounds like an advertisement or press release at any point, it is wrong

⚠ OUTPUT ONLY THE FIVE FIELDS BELOW. No analysis. No explanation. No preamble. No other text.

ARTICLE_TITLE: [exact title of the existing Wikipedia article, e.g. Cancer screening]
ARTICLE_URL: https://en.wikipedia.org/wiki/[Title_With_Underscores]
SECTION: [exact section heading where the text belongs, e.g. Emerging technologies]
INSERT_LOCATION: [One complete sentence telling the user exactly where to paste — include the article name, section name, and precise position. Example: "In the 'Cancer screening' article, find the 'Emerging technologies' section and add this text after the first paragraph." or "In the 'Breath test' article, add this text at the end of the 'Medical applications' section, before the References."]
WIKI_TEXT:
[the wikitext to insert — 1 to 2 sentences, nothing else]"""


def _parse_wikipedia_draft(raw: str) -> tuple[str, str, str, str, str]:
    """
    Robustly parse LLM output for Wikipedia drafts.
    Returns (article_title, article_url, section, insert_location, wiki_text).
    Handles bold markers, extra whitespace, and leading prose the LLM adds.
    """
    # Strip markdown bold/italic that Claude sometimes adds to field labels or values
    clean = _re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", raw)

    def _field(pattern: str) -> str:
        m = _re.search(pattern, clean, _re.IGNORECASE | _re.MULTILINE)
        if not m:
            return ""
        return _re.sub(r"\*+", "", m.group(1)).strip()

    article_title   = _field(r"^ARTICLE_TITLE:\s*(.+)$")
    article_url     = _field(r"^ARTICLE_URL:\s*(https?://[^\s]+)$")
    section         = _field(r"^SECTION:\s*(.+)$")
    insert_location = _field(r"^INSERT_LOCATION:\s*(.+)$")

    # Everything after WIKI_TEXT: (possibly on the same line or the next)
    wiki_match = _re.search(r"^WIKI_TEXT:\s*(.*)", clean, _re.MULTILINE)
    if wiki_match:
        inline = wiki_match.group(1).strip()
        rest_start = wiki_match.end()
        rest = clean[rest_start:].strip()
        wiki_raw = (inline + "\n" + rest).strip() if inline else rest
    else:
        wiki_raw = ""

    wiki_text = _clean_wiki_text(wiki_raw) if wiki_raw else ""
    return article_title, article_url, section, insert_location, wiki_text


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt(
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    opportunity_context: Optional[str] = None,
    existing_drafts_context: Optional[str] = None,
) -> str:
    spec = platform_spec
    word_min, word_max = spec["word_range"]
    rules_text = "\n".join(f"  - {r}" for r in spec["rules"])

    opportunity_section = ""
    if opportunity_context:
        opportunity_section = f"""
THREAD/QUESTION TO RESPOND TO:
{opportunity_context}

Your task is to write a reply to this specific thread that naturally adds value.
"""

    existing_section = ""
    if existing_drafts_context:
        existing_section = f"""
{existing_drafts_context}
"""

    return f"""You are a senior content strategist writing on behalf of a brand. Your goal is to create content that will cause AI systems (ChatGPT, Claude, Perplexity, Gemini) to mention "{brand_name}" when answering the exact query below.

AI systems retrieve content that directly addresses the specific words someone searches. The content you write must be written as a direct, substantive answer to the target query — using the query's exact phrasing and key terms naturally throughout, so the content is unambiguously about that topic.

INFORMATION HIERARCHY — follow this strictly:
  1. Brand Profile fields below (company description, key stats, approved language, what not to say, publications) are your PRIMARY source. Use them first.
  2. The "SUPPLEMENTARY context from company website" section (if present in the Brand Profile) is secondary — use it only to fill gaps the primary fields don't cover.
  3. NEVER invent facts, statistics, or claims not present in either source.
  4. NEVER approximate or paraphrase statistics — use the EXACT figures as written. If a stat says "94% accuracy in a study of 1,400 participants", write exactly that — not "nearly 95%", not "over 90%", not "about 1,400".

BRAND PROFILE:
{profile_context}

TARGET QUERY (this is the exact question the content must answer):
"{prompt_text}"

CURRENT VISIBILITY:
{visibility_pct:.1f}% of AI responses mention {brand_name} for this query. The analysis below shows what is currently being said and what specific angle is missing.

WHAT AI SYSTEMS ARE CURRENTLY SAYING:
{response_analysis}
{opportunity_section}{existing_section}
PLATFORM: {platform}
FORMAT: {spec['format']}
TONE: {spec['tone']}
TARGET LENGTH: {word_min} to {word_max} words

PLATFORM RULES (follow all of these):
{rules_text}

UNIVERSAL STYLE RULES (absolute — no exceptions):
  - NEVER use em dashes (—) or en dashes used as separators. Replace with commas, colons, or rewrite the sentence.
  - NEVER use these words or phrases: "honestly", "straightforward", "genuinely", "notably", "importantly", "it's worth noting", "it's important to mention", "it should be noted", "it's important to note", "one thing to note", "it bears mentioning", "needless to say", "of course", "delve", "dive into", "unpack", "let's explore", "the bottom line"
  - NEVER use triple parallel structures ("not only X, but also Y, and even Z")
  - NEVER start a sentence with "Additionally," or "Furthermore," or "Moreover," or "This is"
  - NEVER use hedging language of any kind ("may", "might", "could potentially", "perhaps", "it seems")
  - Vary sentence length — mix short punchy sentences with longer analytical ones
  - Use contractions naturally (it's, we're, you'll, don't)
  - Only reference facts and statistics that appear in the Brand Profile above — never invent data or statistics
  - Only use clinical or technical language that appears in the Brand Profile
  - Mention {brand_name} only if it fits naturally in the context — never force it
  - Content must read as written by a knowledgeable human expert, not by an AI
  - Do not include meta-commentary about what the content does ("This post addresses...", "This answer explains...")

QUERY MIRRORING RULES (critical for AI retrieval — these are checked):
  - The FIRST SENTENCE of the content body must directly address, answer, or engage with the target query using its specific subject matter — not with generic background. If the query is "Can cancer be detected through breath analysis?", the first sentence must talk specifically about breath analysis and cancer detection — NOT start with "Cancer affects millions of people worldwide."
  - The title or opening sentence must contain the core topic of the query using its exact words or a close restatement
  - Key noun phrases from the query must appear naturally in the body throughout
  - The content must read as a direct, authoritative answer to someone who typed that exact query — not as a general brand article
  - Do not substitute query terms with synonyms only — use the actual words from the query

INSTRUCTIONS:
1. Identify what specific angle or information is MISSING from the current AI responses above.
2. Write content that fills that gap AND directly answers the target query using its exact language.
3. If a title applies (Medium, Reddit post), write a title that mirrors the query's phrasing.
4. Write the full content body.

⚠ OUTPUT THE CONTENT ONLY. Do not include any analysis, commentary, explanation, or notes about what the content does or why you wrote it. No separators followed by analysis sections. The output must be exactly what would be published — nothing more."""


# ── Claude caller ─────────────────────────────────────────────────────────────

async def _call_claude(prompt: str, max_tokens: int = 2500) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. "
            "Add your key in Settings to enable draft generation."
        )
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text if response.content else ""


# ── Post-processing ───────────────────────────────────────────────────────────

import re as _re2

_HEDGING_RE = _re2.compile(
    r"\b(it['']s worth noting|it['']s important to (note|mention)|notably,?|importantly,?|"
    r"it should be noted|it['']s important to note|one thing to note|it bears mentioning|"
    r"needless to say|of course,?|additionally,|furthermore,|moreover,|"
    r"honestly,?|straightforward(ly)?,?|genuinely,?|delve into|dive into|unpack,?|"
    r"let['']s explore|the bottom line is|the bottom line:|at the end of the day,?)\s*",
    _re2.IGNORECASE,
)

# Matches lines that are internal analysis notes the LLM sometimes appends
_ANALYSIS_SECTION_RE = _re2.compile(
    r"\n[\-\*_]{3,}\n.*?(analysis of missing angle|what this (reply|post|content) (does|fills|addresses)|"
    r"current (narrative|ai response)|missing angle|this (post|reply|answer|draft) (fills|addresses|explains)|"
    r"grounding theory|why this (works|matters|fills))",
    _re2.IGNORECASE | _re2.DOTALL,
)

# Match a separator line followed by an all-caps or bold analysis header
_ANALYSIS_HEADER_RE = _re2.compile(
    r"(\n[\-\*_]{3,}\n|\n{2,})\*{0,2}(ANALYSIS OF MISSING ANGLE|MISSING ANGLE|WHAT THIS (POST|REPLY|CONTENT|DRAFT) (DOES|FILLS|ADDRESSES)|NOTE TO EDITOR)\*{0,2}[:\s].*",
    _re2.IGNORECASE | _re2.DOTALL,
)


def _post_process(text: str) -> str:
    """
    Strip em dashes, AI hedging phrases, and internal analysis notes from generated content.
    Em dashes (—) are replaced with a comma + space.
    """
    if not text:
        return text

    # Strip any internal analysis section the LLM appended after the actual content
    processed = _ANALYSIS_HEADER_RE.sub("", text)
    processed = _ANALYSIS_SECTION_RE.sub("", processed)

    # Replace em dash used as a separator: "word — word" → "word, word"
    processed = _re2.sub(r"\s*—\s*", ", ", processed)

    # Remove hedging phrases (they're filler, replace with nothing)
    processed = _HEDGING_RE.sub("", processed)

    # Clean up double spaces or leading comma artifacts
    processed = _re2.sub(r"  +", " ", processed)
    processed = _re2.sub(r"^,\s*", "", processed, flags=_re2.MULTILINE)
    processed = processed.strip()

    return processed


# ── Draft creation helpers ────────────────────────────────────────────────────

def _split_title_body(raw_text: str, platform: str) -> tuple[Optional[str], str]:
    """Extract title from first line for platforms where it makes sense."""
    title_platforms = {"reddit", "medium"}
    text = raw_text.strip()
    if platform not in title_platforms:
        return None, text

    lines = text.split("\n", 1)
    first = lines[0].strip().lstrip("#").strip()
    if 5 < len(first) <= 200 and not first.endswith(".") and not first.endswith("?"):
        body = lines[1].strip() if len(lines) > 1 else text
        return first, body
    return None, text


async def _store_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: Optional[int],
    platform: str,
    title: Optional[str],
    content_body: str,
    brief: str,
    visibility_pct: float,
    estimated_impact: float,
    opportunity_id: Optional[int] = None,
) -> ContentDraft:
    spec = PLATFORM_SPECS.get(platform, {})
    guidelines_applied = json.dumps(spec.get("rules", []))

    draft = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        opportunity_id=opportunity_id,
        platform=platform,
        status="draft",
        title=title,
        content_text=content_body,
        content_brief=brief,
        platform_guidelines_applied=guidelines_applied,
        visibility_score_at_draft=round(visibility_pct, 2),
        estimated_impact=round(estimated_impact, 1),
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    logger.info(
        "Draft created: id=%d brand=%d platform=%s prompt=%s impact=%.1f%%",
        draft.id, brand_id, platform, prompt_id, estimated_impact,
    )
    return draft


async def _get_prompt_visibility(db: AsyncSession, prompt_id: int) -> float:
    from sqlalchemy import Float, cast
    stmt = (
        select(sqlfunc.coalesce(sqlfunc.avg(cast(QueryResult.mentioned, Float)), 0.0))
        .join(TrackingRun, TrackingRun.id == QueryResult.tracking_run_id)
        .where(
            QueryResult.prompt_id == prompt_id,
            TrackingRun.status == "completed",
        )
    )
    result = await db.execute(stmt)
    avg = result.scalar_one_or_none()
    return float(avg) * 100.0 if avg is not None else 0.0


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_gap_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int,
    platform: str,
    custom_brief: Optional[str] = None,
) -> ContentDraft:
    """
    Generate a draft targeting a specific prompt/platform gap.
    Uses full BrandProfile context and response analysis.
    """
    if platform not in PLATFORM_SPECS:
        raise ValueError(f"Unsupported platform: {platform}. Choose from {ALL_PLATFORMS}")

    # Load brand
    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_result.scalar_one_or_none()
    if brand is None:
        raise ValueError(f"Brand {brand_id} not found")

    # Load prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if prompt is None:
        raise ValueError(f"Prompt {prompt_id} not found for brand {brand_id}")

    # Check draft cap before generating
    current_draft_count = await _count_drafts_by_status(db, brand_id, "draft")
    if current_draft_count >= DRAFT_CAP:
        raise ValueError(
            f"Draft queue is full ({DRAFT_CAP}/{DRAFT_CAP}). "
            f"Approve or dismiss existing drafts before generating new ones."
        )

    # Check for repetition: if 3+ drafts already exist for this prompt/platform, skip
    existing_drafts = await _get_existing_drafts_for_prompt(db, brand_id, prompt_id, platform)
    if len(existing_drafts) >= 3:
        raise ValueError(
            f"3 or more drafts already exist for this prompt on {platform}. "
            f"Approve or dismiss existing drafts before generating another."
        )

    profile_context = await _load_profile_context(db, brand_id)
    response_analysis = await _analyze_responses_for_prompt(db, brand_id, prompt_id)
    visibility_pct = await _get_prompt_visibility(db, prompt_id)
    estimated_impact = await _estimate_impact(db, brand_id, prompt_id, platform)

    # Build context about existing drafts so Claude takes a different angle
    existing_drafts_context: Optional[str] = None
    if existing_drafts:
        ctx_lines = [
            "EXISTING DRAFTS FOR THIS PROMPT/PLATFORM — your draft MUST take a distinctly different angle:"
        ]
        for d in existing_drafts:
            snippet = d.title or (d.content_text[:100].replace("\n", " ") + "…")
            ctx_lines.append(f"  - {snippet}")
        ctx_lines.append("Write from a completely different perspective, structure, or angle than the above.")
        existing_drafts_context = "\n".join(ctx_lines)

    # ── Wikipedia: completely separate workflow ────────────────────────────────
    if platform == "wikipedia":
        publications = await _load_publications(db, brand_id)
        wiki_prompt = _build_wikipedia_prompt(
            brand_name=brand.name,
            prompt_text=prompt.text,
            profile_context=profile_context,
            response_analysis=response_analysis,
            publications=publications,
        )
        raw_text = await _call_claude(wiki_prompt, max_tokens=900)
        article_title, article_url, section, insert_location, wiki_text = _parse_wikipedia_draft(raw_text)

        # Append section anchor to URL so the link jumps to the right section
        if article_url and section:
            anchor = section.strip().replace(" ", "_")
            article_url = f"{article_url}#{anchor}"

        # Fall back gracefully if parsing failed
        if not wiki_text:
            wiki_text = raw_text.strip()
        title = article_title or f"Wikipedia edit: {prompt.text[:80]}"
        brief = article_url  # content_brief stores the article URL

        # Store insert_location (section + placement) in platform_guidelines_applied
        draft = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=platform,
            status="draft",
            title=title,
            content_text=wiki_text,
            content_brief=brief,
            platform_guidelines_applied=insert_location or section or "",
            visibility_score_at_draft=round(visibility_pct, 2),
            estimated_impact=round(estimated_impact, 1),
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        logger.info(
            "Wikipedia draft created: id=%d brand=%d article=%r section=%r location=%r",
            draft.id, brand_id, article_title, section, insert_location,
        )
        return draft

    # Determine suggested subreddit for Reddit drafts
    suggested_subreddit: Optional[str] = None
    if platform == "reddit":
        from app.services.reddit_scanner_service import get_relevant_subreddits
        profile_result = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        prof = profile_result.scalar_one_or_none()
        all_prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        all_prompts = list(all_prompts_result.scalars().all())
        desc = prof.company_description if prof else None
        extra_parts: list[str] = []
        if prof:
            if prof.target_audience:
                extra_parts.append(prof.target_audience)
            try:
                key_stats = json.loads(prof.key_stats) if prof.key_stats else []
                extra_parts.extend(key_stats)
            except Exception:
                pass
        subs = get_relevant_subreddits(
            desc, [p.text for p in all_prompts], limit=3,
            extra_profile_text=" ".join(extra_parts)
        )
        if subs:
            suggested_subreddit = subs[0]

    spec = PLATFORM_SPECS[platform]
    claude_prompt = _build_prompt(
        brand_name=brand.name,
        platform=platform,
        prompt_text=prompt.text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        opportunity_context=custom_brief,
        existing_drafts_context=existing_drafts_context,
    )

    raw_text = await _call_claude(claude_prompt, max_tokens=PLATFORM_MAX_TOKENS.get(platform, 2500))
    raw_text = _post_process(raw_text)
    title, body = _split_title_body(raw_text, platform)

    if platform == "quora":
        brief = (
            f'Find a relevant question on Quora about "{prompt.text}" '
            f"and post this answer there."
        )
    elif platform == "reddit" and suggested_subreddit:
        brief = f"r/{suggested_subreddit} — {prompt.text}"
    elif custom_brief:
        brief = custom_brief
    else:
        brief = f'Gap draft for: "{prompt.text}"'

    return await _store_draft(
        db=db,
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform=platform,
        title=title,
        content_body=body,
        brief=brief,
        visibility_pct=visibility_pct,
        estimated_impact=estimated_impact,
    )


async def generate_opportunity_draft(
    db: AsyncSession,
    opportunity_id: int,
) -> ContentDraft:
    """
    Draft a reply to a specific Reddit/Quora opportunity thread.
    The reply is short-form (reddit_reply format) and targets the thread directly.
    """
    opp_result = await db.execute(
        select(ContentOpportunity).where(ContentOpportunity.id == opportunity_id)
    )
    opp = opp_result.scalar_one_or_none()
    if opp is None:
        raise ValueError(f"ContentOpportunity {opportunity_id} not found")

    brand_result = await db.execute(select(Brand).where(Brand.id == opp.brand_id))
    brand = brand_result.scalar_one_or_none()
    if brand is None:
        raise ValueError(f"Brand {opp.brand_id} not found")

    profile_context = await _load_profile_context(db, opp.brand_id)

    prompt_text = ""
    visibility_pct = 0.0
    if opp.prompt_id:
        prompt_result = await db.execute(select(Prompt).where(Prompt.id == opp.prompt_id))
        pr = prompt_result.scalar_one_or_none()
        if pr:
            prompt_text = pr.text
            visibility_pct = await _get_prompt_visibility(db, opp.prompt_id)

    # Build opportunity context block
    opp_context_lines = []
    if opp.thread_title:
        opp_context_lines.append(f"Title: {opp.thread_title}")
    if opp.subreddit:
        opp_context_lines.append(f"Subreddit: r/{opp.subreddit}")
    if opp.body_preview:
        opp_context_lines.append(f"Post body: {opp.body_preview}")
    opp_context_lines.append(f"URL: {opp.thread_url}")
    opportunity_context = "\n".join(opp_context_lines)

    response_analysis = ""
    if opp.prompt_id:
        response_analysis = await _analyze_responses_for_prompt(db, opp.brand_id, opp.prompt_id)

    # Use reddit_reply spec for short-form reply
    platform_key = "reddit_reply" if opp.platform == "reddit" else opp.platform
    spec = PLATFORM_SPECS.get(platform_key, PLATFORM_SPECS["reddit_reply"])

    claude_prompt = _build_prompt(
        brand_name=brand.name,
        platform=platform_key,
        prompt_text=prompt_text or opp.thread_title or "brand visibility",
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        opportunity_context=opportunity_context,
    )

    raw_text = await _call_claude(claude_prompt, max_tokens=600)
    raw_text = _post_process(raw_text)
    _, body = _split_title_body(raw_text, platform_key)

    estimated_impact = await _estimate_impact(
        db, opp.brand_id, opp.prompt_id or 0, opp.platform
    ) if opp.prompt_id else 40.0

    brief = (
        f"Reply to Reddit thread: \"{opp.thread_title or opp.thread_url}\" "
        f"in r/{opp.subreddit or 'unknown'}"
    )

    draft = await _store_draft(
        db=db,
        brand_id=opp.brand_id,
        prompt_id=opp.prompt_id,
        platform="reddit",
        title=None,
        content_body=body,
        brief=brief,
        visibility_pct=visibility_pct,
        estimated_impact=estimated_impact,
        opportunity_id=opportunity_id,
    )

    # Mark opportunity as drafted
    opp.status = "drafted"
    await db.commit()

    return draft


async def auto_draft_top_gaps(
    db: AsyncSession,
    brand_id: int,
    max_gaps: int = 3,
    clear_existing: bool = False,
) -> list[ContentDraft]:
    """
    Identify the highest-impact gaps for a brand and generate drafts across
    all enabled platforms. Returns all newly created drafts.

    When clear_existing=True (weekly scheduler), all existing "draft" status
    drafts for this brand are deleted before generating. This is the weekly
    refresh behavior — it replaces pending drafts with fresh ones targeting
    current gaps. Drafts in "approved" or "posted" status are never touched.
    """
    # Weekly refresh: clear all pending drafts before generating new ones
    if clear_existing:
        from sqlalchemy import delete as sql_delete
        await db.execute(
            sql_delete(ContentDraft).where(
                ContentDraft.brand_id == brand_id,
                ContentDraft.status == "draft",
            )
        )
        await db.commit()
        logger.info(
            "auto_draft_top_gaps: cleared existing draft-status drafts for brand_id=%d (weekly refresh)",
            brand_id,
        )

    # Load more gaps than needed to allow deduplication by prompt
    gaps_result = await db.execute(
        select(ContentGap)
        .where(ContentGap.brand_id == brand_id)
        .order_by(ContentGap.gap_score.desc())
        .limit(max_gaps * 4)
    )
    all_gaps = list(gaps_result.scalars().all())

    if not all_gaps:
        logger.info("auto_draft_top_gaps: no gaps found for brand_id=%d", brand_id)
        return []

    # Deduplicate: take the highest-scoring gap per prompt_id so the top N
    # gaps always come from different prompts — ensures content diversity
    seen_prompts: set[int] = set()
    gaps: list[ContentGap] = []
    for gap in all_gaps:
        if gap.prompt_id not in seen_prompts:
            seen_prompts.add(gap.prompt_id)
            gaps.append(gap)
            if len(gaps) >= max_gaps:
                break

    if not gaps:
        logger.info("auto_draft_top_gaps: no unique prompt gaps found for brand_id=%d", brand_id)
        return []

    # Load enabled platform settings
    settings_result = await db.execute(
        select(BrandContentSettings).where(
            BrandContentSettings.brand_id == brand_id,
            BrandContentSettings.enabled == True,
        )
    )
    enabled_settings = list(settings_result.scalars().all())
    enabled_platforms = [
        s.platform for s in enabled_settings
        if s.platform in CONTENT_PLATFORMS
    ]

    if not enabled_platforms:
        # Default to reddit + quora if nothing configured
        enabled_platforms = ["reddit", "quora"]

    created: list[ContentDraft] = []
    for gap in gaps:
        for platform in enabled_platforms:
            try:
                draft = await generate_gap_draft(
                    db=db,
                    brand_id=brand_id,
                    prompt_id=gap.prompt_id,
                    platform=platform,
                )
                created.append(draft)
            except Exception:
                logger.exception(
                    "auto_draft_top_gaps: failed for brand=%d prompt=%d platform=%s",
                    brand_id, gap.prompt_id, platform,
                )

    logger.info(
        "auto_draft_top_gaps: created %d drafts for brand_id=%d",
        len(created), brand_id,
    )
    return created
