"""
Prompt construction for the drafting service.
"""
from __future__ import annotations

from app.services.drafting.evidence import EvidencePack

# ── Wikipedia system prompt ───────────────────────────────────────────────────

WIKIPEDIA_SYSTEM_PROMPT = (
    "You are an experienced Wikipedia editor. Your task is to suggest precise, "
    "neutral, encyclopedic edits to existing Wikipedia articles that accurately "
    "cite verifiable sources. Never write promotional content. Output only the "
    "five structured fields requested."
)


# ── Wikipedia-specific helpers ────────────────────────────────────────────────

def _build_citation_ref(
    publications: list[dict],
    brand_name: str,
    website_url: str | None = None,
) -> str:
    """Build a <ref> citation from publications, website URL, or {{citation needed}}."""
    if publications:
        p = publications[0]
        url = p.get("url", "")
        title = p.get("title", "")
        publisher = p.get("publisher", brand_name)
        date = p.get("date", "")
        return f"<ref>{{{{cite journal|url={url}|title={title}|publisher={publisher}|date={date}}}}}</ref>"
    if website_url:
        from datetime import date as _date
        accessdate = _date.today().strftime("%Y-%m-%d")
        return (
            f"<ref>{{{{cite web"
            f"|url={website_url}"
            f"|title={brand_name}"
            f"|publisher={brand_name}"
            f"|accessdate={accessdate}"
            f"}}}}</ref>"
        )
    return "{{citation needed}}"


def build_wikipedia_prompt(
    brand_name: str,
    prompt_text: str,
    profile_context: str,
    response_analysis: str,
    publications: list[dict] | None = None,
    website_url: str | None = None,
    evidence_pack: EvidencePack | None = None,
    locked_article_title: str | None = None,
    article_section_list: list[str] | None = None,
    citation_needed_hints: list[str] | None = None,
) -> str:
    pack_section = ""
    citation_instructions = ""
    if evidence_pack is not None and evidence_pack.sources:
        lines = ["EVIDENCE SOURCES — cite each fact you use with [S1], [S2], etc.:", ""]
        for src in evidence_pack.sources:
            lines.append(f"[{src.ref}] {src.title}")
            lines.append(f"     URL: {src.url}")
            lines.append(f'     "{src.snippet}"')
            lines.append("")
        pack_section = "\n".join(lines)
        citation_instructions = (
            "CITATION HANDLING: Insert [SN] markers after each citable fact. "
            "The pipeline converts each [SN] to a proper Wikipedia <ref>{{cite web|url=...|title=...}}</ref>."
        )
    else:
        # Backwards-compatible path
        citation_ref = _build_citation_ref(publications or [], brand_name, website_url)
        if publications:
            p = publications[0]
            citation_instructions = (
                f"CITATION TO USE: The citation is already provided below — copy it exactly as-is:\n"
                f"  {citation_ref}\n"
                f"  (Source: {p.get('title', '')} — {p.get('publisher', '')} {p.get('date', '')})"
            )
        elif website_url:
            citation_instructions = (
                f"CITATION TO USE: No peer-reviewed publications available. "
                f"Use this cite web citation — copy it exactly as-is:\n  {citation_ref}"
            )
        else:
            citation_instructions = (
                "CITATION: No source is available. "
                "End the wikitext with {{citation needed}} exactly as shown — do NOT invent any citation data."
            )

    fixed_article_section = ""
    if locked_article_title:
        sections_block = ""
        if article_section_list:
            sections_block = "\nEXISTING SECTIONS in this article (pick the best fit):\n" + "\n".join(
                f"  - {s}" for s in article_section_list
            )
        cn_block = ""
        if citation_needed_hints:
            cn_block = "\n\nCITATION NEEDED hints (existing {{citation needed}} locations the brand could help fill):\n" + "\n".join(
                f"  - {h}" for h in citation_needed_hints
            )
        fixed_article_section = (
            f"\nFIXED ARTICLE — non-negotiable. Insert into the Wikipedia article titled "
            f'"{locked_article_title}". Do not choose a different article. Do not invent a title.'
            f"{sections_block}{cn_block}\n"
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

{pack_section}

{citation_instructions}

{fixed_article_section if locked_article_title else "ARTICLE SELECTION — choose the article whose topic most directly matches the key terms in the target query. The article title and section should use the same vocabulary as the query. Never target: brand articles, disambiguation pages, or articles you are inventing."}

WIKI TEXT RULES (absolute — every rule is mandatory):
  - Neutral encyclopedic tone only — no promotional language, no superlatives, no brand advocacy of any kind
  - NEVER use first person ("we", "our", "I", "us") — third person only
  - Every factual claim must be attributable to one of the sources above — do not state facts that cannot be sourced
  - Use [[wikilinks]] around key terms that have Wikipedia articles
  - Structure: 1 to 3 sentences maximum, written as a natural addition to an existing article section
  - Insert [SN] markers (or the single citation ref provided) after each citable fact — the pipeline converts them to Wikipedia <ref> tags

⚠ OUTPUT ONLY THE FIVE FIELDS BELOW. No analysis. No explanation. No preamble.

ARTICLE_TITLE: [exact title of the existing Wikipedia article]
ARTICLE_URL: https://en.wikipedia.org/wiki/[Title_With_Underscores]
SECTION: [exact section heading where the text belongs]
INSERT_LOCATION: [One complete sentence telling the user exactly where to paste]
WIKI_TEXT:
[the wikitext to insert — 1 to 2 sentences, nothing else]"""


# ── Main prompt builder ───────────────────────────────────────────────────────

def build_prompt(
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    opportunity_context: str | None = None,
    existing_drafts_context: str | None = None,
    evidence_pack: EvidencePack | None = None,
    voice_sample: str | None = None,
    related_draft_summary: str | None = None,
    brief_context: str | None = None,
    voice_directive: str | None = None,
    angle_directive: str | None = None,
) -> str:
    spec = platform_spec
    word_min, word_max = spec["word_range"]
    rules_text = "\n".join(f"  - {r}" for r in spec["rules"])

    opportunity_section = ""
    if opportunity_context:
        if platform == "quora":
            opportunity_section = f"""
QUORA QUESTION TO ANSWER:
{opportunity_context}

Your task: write an answer to this specific Quora question. If existing answers are shown above, study them carefully and write from a DIFFERENT angle — add concrete value that is not already covered. Do not summarise what others said. Go straight to the answer.
"""
        else:
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

    evidence_section = ""
    if evidence_pack is not None and evidence_pack.sources:
        lines = ["EVIDENCE SOURCES — cite these inline using [S1], [S2], etc.:", ""]
        for src in evidence_pack.sources:
            lines.append(f"[{src.ref}] {src.title}")
            lines.append(f"     URL: {src.url}")
            lines.append(f'     "{src.snippet}"')
            lines.append("")
        lines.append("CITATION RULES (mandatory):")
        lines.append("- Every statistic, study reference, or specific factual claim must end with [SN].")
        lines.append("- If you cannot back a claim with one of the sources above, REMOVE the claim — do not hedge, do not paraphrase.")
        lines.append("- Never invent sources or cite sources not listed above.")
        lines.append("")
        evidence_section = "\n".join(lines)

    angle_section = f"{angle_directive}\n\n" if angle_directive else ""

    voice_directive_section = ""
    if voice_directive:
        voice_directive_section = (
            "BRAND VOICE — write EVERY sentence in this brand's voice. This is not "
            "optional styling; it governs word choice, rhythm, and phrasing throughout:\n"
            f"{voice_directive}\n\n"
        )

    voice_section = ""
    if voice_sample:
        voice_section = (
            "VOICE EXAMPLE — the draft should match the rhythm, claim density, "
            "and tone of this passage written for this brand:\n\n"
            f'"{voice_sample}"\n\n'
        )

    related_section = ""
    if related_draft_summary:
        related_section = (
            "RELATED PUBLISHED CONTENT — this brand already has approved content "
            "on this exact query. Do not duplicate its angle. You may reference it "
            "naturally (e.g. \"in a recent LinkedIn piece\") but take a different angle:\n\n"
            f"{related_draft_summary}\n\n"
        )

    cluster_section = ""
    if brief_context:
        cluster_section = f"""
CLUSTER BRIEF (this content is part of a coordinated cross-platform cluster — adhere strictly):
{brief_context}

CLUSTER RULES (in addition to all other rules below):
  - Express the brand's POSITIONING and KEY CLAIMS in your OWN words, framed naturally for {platform}. Do NOT copy any phrase verbatim, and never repeat the same claim more than once in this piece — identical/repeated brand sentences read as spam, get removed on Reddit/Quora, and lower AI-citation odds.
  - Name the brand clearly once, as a concrete fact.
  - You may reference sibling platforms semantically (e.g. "there's a longer breakdown of this on Medium"), but never invent URLs.
  - Maintain the narrative spine without restating it verbatim.
  - Do not open with the brand name. Do not include CTAs. Maintain practitioner voice — the brand is mentioned as a fact, not a pitch.
"""

    return f"""You are a senior content strategist writing on behalf of a brand. Your goal is to create content that will cause AI systems (ChatGPT, Claude, Perplexity, Gemini) to mention "{brand_name}" when answering the exact query below.

AI systems retrieve content that directly addresses the specific words someone searches. The content you write must be written as a direct, substantive answer to the target query — using the query's exact phrasing and key terms naturally throughout, so the content is unambiguously about that topic.

INFORMATION HIERARCHY — follow this strictly:
  1. EVIDENCE SOURCES listed above (if present) are your PRIMARY source. Every concrete claim must be backed by a [SN] citation.
  2. Brand Profile fields (company description, key stats, approved language, what not to say, publications) are SECONDARY — use them for brand-specific framing, tone, and details the Evidence Sources don't cover.
  3. The "SUPPLEMENTARY context from company website" section in the Brand Profile is tertiary — fill gaps only.
  4. NEVER invent facts, statistics, or claims not present in either source.
  5. NEVER approximate or paraphrase statistics — use the EXACT figures as written.

BRAND PROFILE:
{profile_context}

TARGET QUERY (this is the exact question the content must answer):
"{prompt_text}"

CURRENT VISIBILITY:
{visibility_pct:.1f}% of AI responses mention {brand_name} for this query. The analysis below shows what is currently being said and what specific angle is missing.

{angle_section}{voice_directive_section}{evidence_section}{voice_section}{related_section}WHAT AI SYSTEMS ARE CURRENTLY SAYING:
{response_analysis}
{opportunity_section}{existing_section}{cluster_section}
PLATFORM: {platform}
FORMAT: {spec['format']}
TONE: {spec['tone']}
TARGET LENGTH: {word_min} to {word_max} words

PLATFORM RULES (follow all of these):
{rules_text}

WRITING RULES (evidence-backed — these drive whether AI engines cite the content):
  - Lead with the answer: the first sentence directly answers the target query — no preamble, no scene-setting.
  - Back every factual claim with the Brand Profile or Evidence Sources above — never invent data, never approximate a statistic.
  - Prefer concrete specifics (exact numbers, names, dates) over vague claims, and place key statistics where they stand out — concrete, well-sourced claims are what get cited.
  - When you cite a source, name it in the same sentence as the claim ("per a 2026 Ahrefs study, ...") so the claim and its source travel together — a footnote alone is not attribution.
  - No hedging language ("may", "might", "could potentially", "perhaps", "it seems").
  - Mention {brand_name} only where it fits as a concrete fact in context — never forced, never promotional.
  - NEVER write as a satisfied customer or user of {brand_name} ("I've been using it and love it") when writing on the brand's behalf — undisclosed insider testimonials are an FTC violation. First-person experience is fine only in an openly affiliated voice.
  - Write in a genuine human voice: vary sentence length, and avoid AI clichés (no "delve", "tapestry", em dashes, "in conclusion", "it's not just X — it's Y"). Drafts that read as AI-written are automatically rejected, so this is not optional.
  - No meta-commentary about the content itself ("This post addresses...", "This answer explains...").

QUERY MIRRORING RULES (critical for AI retrieval — these are checked):
  - The FIRST SENTENCE of the content body must directly address, answer, or engage with the target query using its specific subject matter — not with generic background. If the query is "Can cancer be detected through breath analysis?", the first sentence must talk specifically about breath analysis and cancer detection — NOT start with "Cancer affects millions of people worldwide."
  - The title or opening sentence must contain the core topic of the query using its exact words or a close restatement
  - Key noun phrases from the query must appear naturally in the body throughout
  - The content must read as a direct, authoritative answer to someone who typed that exact query — not as a general brand article
  - Use the query's key terms naturally where they genuinely fit — but do NOT repeat them mechanically or pack them in. Keyword stuffing is penalized; relevance comes from actually answering the question, not from term frequency.

INSTRUCTIONS:
1. Identify what specific angle or information is MISSING from the current AI responses above.
2. Write content that fills that gap AND directly answers the target query using its exact language.
3. OUTPUT FORMAT — follow exactly:
   - Reddit post: Line 1 = post title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the post body.
   - Medium article: Line 1 = article title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the article body.
   - LinkedIn Article: Line 1 = article title (plain text, ≤120 chars, no trailing punctuation, no markdown). Blank line. Then the article body. Final line = 1-3 hashtags.
   - LinkedIn post: No title line — start directly with the content body. Final line = 1-3 hashtags.
   - LinkedIn reply: No title line — start directly with the reply. 1-4 sentences.
   - X thread: Each tweet on its own line, prefixed with 1/, 2/, etc. Each tweet under 280 characters. 3-7 tweets total.
   - X post: A single tweet under 280 characters. No title, no numbering.
   - X reply: A single reply tweet under 280 characters. No title, no numbering.
   - Quora answer, Wikipedia edit: no title line — start directly with the content.
4. Write the full content body.

⚠ OUTPUT THE CONTENT ONLY. Do not include any analysis, commentary, explanation, or notes about what the content does or why you wrote it. No separators followed by analysis sections. The output must be exactly what would be published — nothing more."""
