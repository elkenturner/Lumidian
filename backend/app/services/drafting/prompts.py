"""
Prompt construction for the drafting service.
"""
from __future__ import annotations

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
) -> str:
    citation_ref = _build_citation_ref(publications or [], brand_name, website_url)
    pub_note = ""
    if publications:
        p = publications[0]
        pub_note = (
            f"\nCITATION TO USE: The citation is already provided below — copy it exactly as-is:\n"
            f"  {citation_ref}\n"
            f"  (Source: {p.get('title', '')} — {p.get('publisher', '')} {p.get('date', '')})"
        )
    elif website_url:
        pub_note = (
            f"\nCITATION TO USE: No peer-reviewed publications available. "
            f"Use this cite web citation — copy it exactly as-is:\n"
            f"  {citation_ref}"
        )
    else:
        pub_note = (
            "\nCITATION: No source is available. "
            "End the wikitext with {{citation needed}} exactly as shown — do NOT invent any citation data."
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
