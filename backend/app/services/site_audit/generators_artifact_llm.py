"""LLM-backed artifact generators.

Each function loads BrandProfile + page context, renders a per-type prompt,
calls Claude Haiku 4.5, and returns the response as an ArtifactResult.
Auto-registered with the dispatcher via @register_llm.

Shared `_call_claude` helper: 30s timeout, single retry on transient errors,
falls through to ValueError on auth/missing-key (caller maps to 503).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from app.services.site_audit.artifact_generator import (
    ArtifactResult,
    GeneratorContext,
    register_llm,
)

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_TIMEOUT_S = 30.0
_MAX_TOKENS = 2048


_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_-]*\n?|\n?```$", re.MULTILINE)


def _strip_code_fences(text: str) -> str:
    """LLMs sometimes wrap output in ``` fences despite instructions.
    Strip leading/trailing fences and any language-tag suffix.
    """
    out = text.strip()
    # Strip a single leading ```lang or ``` line
    if out.startswith("```"):
        first_newline = out.find("\n")
        if first_newline != -1:
            out = out[first_newline + 1 :]
    # Strip a single trailing ```
    if out.endswith("```"):
        out = out[: -3].rstrip()
    return out.strip()


async def _call_claude(prompt: str, *, max_tokens: int = _MAX_TOKENS) -> str:
    """Single-shot Claude call. Returns the text content or raises ValueError.

    Post-processing: strips markdown code fences from the response. LLMs often
    add ```html or ```json wrappers despite explicit instructions; this keeps
    artifacts truly paste-ready.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    import anthropic  # local import keeps boot-time fast

    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=_TIMEOUT_S)
    try:
        resp = await client.messages.create(
            model=_MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.APITimeoutError, anthropic.APIConnectionError) as exc:
        # one retry on transient
        logger.warning("Claude transient error, retrying once: %s", exc)
        resp = await client.messages.create(
            model=_MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIStatusError as exc:
        # one retry on 5xx (server-side errors are usually transient)
        if exc.status_code is not None and 500 <= exc.status_code < 600:
            logger.warning(
                "Claude %d, retrying once: %s", exc.status_code, exc,
            )
            resp = await client.messages.create(
                model=_MODEL,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            raise
    return _strip_code_fences(resp.content[0].text)


def _ctx_pack(ctx: GeneratorContext) -> dict[str, Any]:
    """Common template inputs every prompt may want to interpolate.

    The headline input is `page_content` — up to 1500 chars of cleaned visible
    text from the actual crawled page. This is what makes the difference between
    a generic LLM output and a paste-ready artifact that references real product
    names, real claims, and real numbers from the brand's actual page.
    """
    p = ctx.page
    profile = ctx.profile
    page_content = ""
    page_meta_lines: list[str] = []
    if p:
        if p.title:
            page_meta_lines.append(f"<title>: {p.title}")
        if p.h1_text:
            page_meta_lines.append(f"<h1>: {p.h1_text}")
        if p.word_count is not None:
            page_meta_lines.append(f"word count: {p.word_count}")
        if p.schema_types:
            try:
                import json as _j
                types = _j.loads(p.schema_types) if isinstance(p.schema_types, str) else p.schema_types
                if types:
                    page_meta_lines.append(f"existing schema: {', '.join(types)}")
            except Exception:  # noqa: BLE001
                pass
        page_content = (getattr(p, "content_excerpt", None) or "")[:1500]

    return {
        "brand_name": ctx.brand.name,
        "brand_url": ctx.brand.website_url or "",
        "tone": (profile.tone_of_voice if profile else "") or "professional, clear, specific",
        "what_not_to_say": (profile.what_not_to_say if profile else "") or "—",
        "target_audience": (profile.target_audience if profile else "") or "—",
        "brand_description": (profile.company_description if profile else "") or "—",
        "key_stats": (profile.key_stats if profile else "") or "—",
        "approved_language": (profile.approved_language if profile else "") or "—",
        "page_url": (p.url if p else "—"),
        "page_type": (p.page_type if p else "other"),
        "h1": (p.h1_text if p else "") or "—",
        "title_now": (p.title if p else "") or "—",
        "page_summary": "\n".join(page_meta_lines) or "—",
        "page_content": page_content or "(page content not available — fall back to brand context)",
        "notes_block": (
            f"\nUSER FEEDBACK (apply this verbatim to the output): {ctx.regenerate_notes}\n"
            if ctx.regenerate_notes else ""
        ),
    }


# Shared output-quality block prepended to every LLM prompt. The user wants
# truly paste-ready artifacts — no commentary, no fences, no placeholders.
_QUALITY_RULES = """\
OUTPUT RULES (these are non-negotiable)
- Output ONLY the artifact itself. No commentary, no preamble, no markdown code fences.
- No placeholder text like "TODO", "INSERT_HERE", "lorem ipsum", "Your Company".
- Use the actual brand name, real product/service names, and real claims from the BRAND CONTEXT and PAGE CONTENT below.
- If a field's value is genuinely unknown, omit the field rather than guessing or inserting a placeholder.
- The artifact must validate / be syntactically correct as the requested format (JSON-LD must be valid JSON, HTML must close every tag, etc.).
- Match the brand's voice: TONE = {tone}. WHAT NOT TO SAY: {what_not_to_say}.

ANTI-HALLUCINATION RULES
- Do NOT invent specific statistics (percentages, dollar amounts, dates, customer counts, study citations) that are not present in BRAND CONTEXT / KEY STATS / PAGE CONTENT. Generic words like "many" or "most" are fine; specific numbers are not unless quoted from the inputs.
- Do NOT preserve platform-specific CSS classes from PAGE CONTENT (Wix `font_8`, `wixui-*`, `comp-*`; Webflow `w-*`; Shopify `shopify-*`; etc.). Output clean semantic HTML with no class attributes unless the page's design system clearly relies on them.
- Do NOT cite studies or papers by name unless the citation is verbatim in BRAND CONTEXT or PAGE CONTENT.

BRAND CONTEXT
- Name: {brand_name}
- Website: {brand_url}
- Description: {brand_description}
- Target audience: {target_audience}
- Key stats / facts: {key_stats}
- Approved language: {approved_language}

PAGE CONTEXT
- URL: {page_url}
- Type: {page_type}
- Current <title>: {title_now}
- Current <h1>: {h1}
- Page signals:
{page_summary}

PAGE CONTENT (cleaned visible body text, ground your output in this)
---
{page_content}
---
{notes_block}
"""


# Each per-type prompt prepends the shared _QUALITY_RULES block. The TYPE_SPECIFIC
# section names the artifact and gives concrete output requirements. Together they
# enforce: real-data grounding, paste-ready output, no placeholders, schema validity.


def _prompt(type_specific: str) -> str:
    return _QUALITY_RULES + "\n" + type_specific


# ── meta_title ────────────────────────────────────────────────────────────────

_PROMPT_META_TITLE = _prompt("""\
TASK: Generate a paste-ready <title> tag for this page.

OUTPUT FORMAT
- Plain text only — no quotes, no <title> tag, no HTML
- 50-60 characters
- Lead with the most extractable noun phrase from the page's actual content (real product / service / use-case name pulled from PAGE CONTENT above)
- Include the brand name once when natural (often at the end after a "—" or "|" separator)

EXAMPLES OF SHAPE
- "Sustainable Swimwear for Beach + Pool — Rhythm Livin"
- "Compliance Automation for SOC 2, ISO, HIPAA | Lumidian"
""")


@register_llm("meta_title")
async def gen_meta_title(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_META_TITLE.format(**_ctx_pack(ctx))
    title = await _call_claude(prompt, max_tokens=128)
    return ArtifactResult(artifact=title.strip().strip('"').strip("'"), artifact_type="meta_title")


# ── meta_description ─────────────────────────────────────────────────────────

_PROMPT_META_DESCRIPTION = _prompt("""\
TASK: Generate a paste-ready meta description for this page.

OUTPUT FORMAT
- Plain text only — no quotes, no HTML, no <meta> wrapper
- 140-160 characters
- Open with the page's primary value statement (what the visitor gets) drawn from PAGE CONTENT
- Include 1-2 concrete specifics (number, named feature, target audience)
- End with a soft CTA or differentiator, not a tagline
""")


@register_llm("meta_description")
async def gen_meta_description(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_META_DESCRIPTION.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=256)
    return ArtifactResult(artifact=out.strip().strip('"').strip("'"), artifact_type="meta_description")


# ── h1_text ──────────────────────────────────────────────────────────────────

_PROMPT_H1 = _prompt("""\
TASK: Generate a paste-ready <h1> for this page.

OUTPUT FORMAT
- Plain text only — no <h1> wrapper, no quotes, no HTML
- 40-80 characters
- Descriptive noun phrase that names the page's primary topic (drawn from PAGE CONTENT)
- Not a marketing tagline — should read as the page's main subject

EXAMPLES OF SHAPE
- "Classic Hi-Cut Swimwear in Olive — Rhythm Livin Women's Swim"
- "AI-Search Citation Tracking Across ChatGPT, Claude, Perplexity, Gemini"
""")


@register_llm("h1_text")
async def gen_h1_text(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_H1.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=128)
    return ArtifactResult(artifact=out.strip().strip('"').strip("'"), artifact_type="h1_text")


# ── og_tags ──────────────────────────────────────────────────────────────────

_PROMPT_OG_TAGS = _prompt("""\
TASK: Generate Open Graph meta tags for this page.

OUTPUT FORMAT
- Exactly five <meta property="og:..."> tags in this order: title, description, url, type, image
- Each on its own line
- og:url = the page URL exactly as given
- og:type = "article" for blog/post, "product" for product pages, "website" otherwise
- og:image = absolute https://... URL. If unknown, omit the og:image line entirely (no placeholders)
- og:title = 50-60 chars, og:description = 110-150 chars (both grounded in PAGE CONTENT)
""")


@register_llm("og_tags")
async def gen_og_tags(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_OG_TAGS.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=512)
    return ArtifactResult(artifact=out.strip(), artifact_type="og_tags")


# ── jsonld_faq ───────────────────────────────────────────────────────────────

_PROMPT_FAQ_SCHEMA = _prompt("""\
TASK: Generate a complete FAQPage JSON-LD block.

OUTPUT FORMAT
- One <script type="application/ld+json">…</script> wrapper around valid JSON
- Schema.org FAQPage with a mainEntity array of Question objects, each with acceptedAnswer.Answer.text
- 5-8 question/answer pairs

QUESTION QUALITY
- Each question must be one a real visitor on this exact page would ask, given PAGE CONTENT
- Mix top-of-funnel ("What is X?") with specific ("How does X handle Y on this page's topic?")
- Phrase them in user voice, not marketing voice

ANSWER QUALITY
- 1-3 sentences, factual, in brand TONE
- Quote or paraphrase real claims from PAGE CONTENT (don't invent features the page doesn't mention)
- Include a number or specific where the page provides one
""")


@register_llm("jsonld_faq")
async def gen_jsonld_faq(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_FAQ_SCHEMA.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=2048)
    return ArtifactResult(artifact=out.strip(), artifact_type="jsonld_faq")


# ── faq_section (HTML + paired JSON-LD) ──────────────────────────────────────

_PROMPT_FAQ_SECTION = _prompt("""\
TASK: Generate a complete FAQ section for this page — BOTH the visible HTML AND the paired JSON-LD.

OUTPUT FORMAT (exactly this order)
1. <section class="faq"> containing an <h2>Frequently Asked Questions</h2> and 5-8 <h3>Question</h3><p>Answer</p> pairs
2. A blank line
3. <script type="application/ld+json">…</script> with a FAQPage where every Question/Answer EXACTLY matches the HTML above (anti-cloaking requirement — schema and visible content must align)

QUALITY
- HTML must validate (close every tag, no markdown)
- Questions and answers grounded in PAGE CONTENT — real product/service references
- Answers 2-4 sentences in brand TONE
""")


@register_llm("faq_section")
async def gen_faq_section(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_FAQ_SECTION.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=3072)
    return ArtifactResult(artifact=out.strip(), artifact_type="faq_section")


# ── section_rewrite ──────────────────────────────────────────────────────────

_PROMPT_SECTION_REWRITE = _prompt("""\
TASK: Rewrite this page's intro/first H2 section for AI-search extractability.

OUTPUT FORMAT
- Valid HTML only — no markdown fences, no commentary
- Structure: <h2>...</h2><p>...</p> optional <ul>/<ol>/<table>... <p>...</p>
- Wrap key facts in <strong>...</strong>

QUALITY
- The first sentence of the first <p> must be a 1-2 sentence self-contained answer (no leading pronouns, brand name explicit)
- Pull every claim from PAGE CONTENT — don't invent capabilities the page doesn't describe
- Include 2-3 concrete numbers/stats if the page provides them (or pull from KEY STATS)
- Avoid hype words (revolutionary, world-class, best-in-class, etc.)
""")


@register_llm("section_rewrite")
async def gen_section_rewrite(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_SECTION_REWRITE.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=2048)
    return ArtifactResult(artifact=out.strip(), artifact_type="section_rewrite")


# ── jsonld_article ───────────────────────────────────────────────────────────

_PROMPT_JSONLD_ARTICLE = _prompt("""\
TASK: Generate a complete Article JSON-LD block for this page.

OUTPUT FORMAT
- One <script type="application/ld+json">…</script> wrapper
- Schema.org Article with: headline, description, image, author (Person or Organization), datePublished, dateModified, publisher (Organization with name + logo)
- headline = pull from PAGE CONTENT's first H1 or main subject
- description = 140-160 char summary of PAGE CONTENT in brand voice
- author = if PAGE CONTENT mentions a byline, use {{"@type":"Person","name":"…"}}. Otherwise use the brand as Organization.
- datePublished / dateModified = today's ISO date if unknown (don't use placeholder strings)
- All URLs absolute https://...
""")


@register_llm("jsonld_article")
async def gen_jsonld_article(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_ARTICLE.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out.strip(), artifact_type="jsonld_article")


# ── jsonld_product ───────────────────────────────────────────────────────────

_PROMPT_JSONLD_PRODUCT = _prompt("""\
TASK: Generate a complete Product JSON-LD block for this page.

OUTPUT FORMAT
- One <script type="application/ld+json">…</script> wrapper
- Schema.org Product with: name (pull from PAGE CONTENT), description, image (absolute URL), brand (Organization with the brand name), aggregateRating (if PAGE CONTENT mentions ratings/reviews), offers
- offers should include availability + url. Omit price entirely if unknown — do not insert "0" or "TBD"
- All URLs absolute https://...
""")


@register_llm("jsonld_product")
async def gen_jsonld_product(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_PRODUCT.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out.strip(), artifact_type="jsonld_product")


# ── jsonld_howto ─────────────────────────────────────────────────────────────

_PROMPT_JSONLD_HOWTO = _prompt("""\
TASK: Generate a complete HowTo JSON-LD block for this page.

OUTPUT FORMAT
- One <script type="application/ld+json">…</script> wrapper
- Schema.org HowTo with: name, description, step (array of HowToStep)
- 4-7 steps inferred from PAGE CONTENT. Each step needs name (action verb) and text (1-2 sentences)
- If the page's topic doesn't actually describe a procedure, return an empty JSON-LD block — don't fabricate steps
""")


@register_llm("jsonld_howto")
async def gen_jsonld_howto(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_HOWTO.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out.strip(), artifact_type="jsonld_howto")


# ── alt_text_batch ───────────────────────────────────────────────────────────

_PROMPT_ALT_TEXT = _prompt("""\
TASK: Generate alt text for the images on this page.

OUTPUT FORMAT
- Valid JSON object — no commentary, no code fences
- 6-10 entries
- Keys: descriptive slug like "hero-main", "product-detail-front", "process-step-1"
- Values: alt text strings, 6-15 words each. Describe what's likely visible (grounded in PAGE CONTENT's topic). No "image of" / "picture of" prefixes.
""")


@register_llm("alt_text_batch")
async def gen_alt_text_batch(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_ALT_TEXT.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out.strip(), artifact_type="alt_text_batch")


# ── internal_link_suggestions ────────────────────────────────────────────────

_PROMPT_INTERNAL_LINKS = _prompt("""\
TASK: Suggest internal links to add between brand pages to strengthen topical authority.

You're given the target page and a list of sibling pages. Suggest 4-8 link additions.

OUTPUT FORMAT
- Valid JSON array — no commentary, no code fences
- Each item: {{"from": "<page url>", "to": "<page url>", "anchor": "<exact anchor text>"}}
- Both URLs must come from the SIBLING PAGES list below
- Anchors must be specific noun phrases (real keywords for the target page), never "click here" / "read more" / "learn more"

SIBLING PAGES
{sibling_pages}
""")


@register_llm("internal_link_suggestions")
async def gen_internal_links(ctx: GeneratorContext) -> ArtifactResult:
    pack = _ctx_pack(ctx)
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models import WebsiteAuditPage

    async with AsyncSessionLocal() as db:
        siblings = (
            await db.execute(
                select(WebsiteAuditPage)
                .where(
                    WebsiteAuditPage.audit_id == ctx.audit.id,
                    WebsiteAuditPage.http_status == 200,
                )
                .limit(20)
            )
        ).scalars().all()
    pack["sibling_pages"] = "\n".join(
        f"- {p.url}  (H1: {p.h1_text or p.title or '—'})" for p in siblings
    ) or "—"
    prompt = _PROMPT_INTERNAL_LINKS.format(**pack)
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out.strip(), artifact_type="internal_link_suggestions")


# ── new_page_draft (experimental, longer output) ─────────────────────────────

_PROMPT_NEW_PAGE = _prompt("""\
TASK: Draft a complete new page for this brand based on the RECOMMENDATION TITLE: "{rec_title}"

OUTPUT FORMAT (Markdown only, no code fences, no front matter)
- Line 1: a single comment with a suggested URL slug, e.g. `<!-- Suggested URL: /guide/ai-search-optimization -->`
- Line 2: blank
- Line 3+: the page content:
  - # H1 (40-80 chars)
  - 2-3 sentence intro that directly answers the page's primary question
  - 4-6 ## H2 sections, each opening with a direct, extractable claim
  - At least one bulleted list or numbered procedure
  - At least 3 concrete stats or specifics (drawn from KEY STATS, BRAND CONTEXT, or commonly-known industry data)
  - End with a ## Frequently Asked Questions section containing 4-6 question/answer pairs

QUALITY
- 600-900 words total
- Brand TONE throughout, avoid blocked phrases (WHAT NOT TO SAY)
- Each H2 lead sentence should stand alone as a quotable answer
""")


@register_llm("new_page_draft")
async def gen_new_page_draft(ctx: GeneratorContext) -> ArtifactResult:
    pack = _ctx_pack(ctx)
    pack["rec_title"] = ctx.rec.title
    prompt = _PROMPT_NEW_PAGE.format(**pack)
    out = await _call_claude(prompt, max_tokens=4096)
    return ArtifactResult(artifact=out.strip(), artifact_type="new_page_draft")
