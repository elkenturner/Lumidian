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


async def _call_claude(prompt: str, *, max_tokens: int = _MAX_TOKENS) -> str:
    """Single-shot Claude call. Returns the text content or raises ValueError."""
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
    return resp.content[0].text.strip()


def _ctx_pack(ctx: GeneratorContext) -> dict[str, Any]:
    """Common template inputs every prompt may want to interpolate."""
    p = ctx.page
    profile = ctx.profile
    page_text = ""
    if p:
        # We don't store full body — use what's available: title, h1, schema types.
        bits = []
        if p.title:
            bits.append(f"<title>: {p.title}")
        if p.h1_text:
            bits.append(f"<h1>: {p.h1_text}")
        if p.word_count is not None:
            bits.append(f"word count: {p.word_count}")
        page_text = "\n".join(bits)
    return {
        "brand_name": ctx.brand.name,
        "brand_url": ctx.brand.website_url or "",
        "tone": (profile.tone_of_voice if profile else "") or "professional, clear, specific",
        "what_not_to_say": (profile.what_not_to_say if profile else "") or "—",
        "target_audience": (profile.target_audience if profile else "") or "—",
        "brand_description": (profile.company_description if profile else "") or "—",
        "key_stats": (profile.key_stats if profile else "") or "—",
        "page_url": (p.url if p else "—"),
        "page_type": (p.page_type if p else "other"),
        "h1": (p.h1_text if p else "") or "—",
        "title_now": (p.title if p else "") or "—",
        "page_summary": page_text or "—",
        "notes_block": (
            f"\nUSER FEEDBACK (apply this to your rewrite): {ctx.regenerate_notes}\n"
            if ctx.regenerate_notes else ""
        ),
    }


# ── meta_title ────────────────────────────────────────────────────────────────

_PROMPT_META_TITLE = """\
You are an AI-search optimization specialist. Generate a paste-ready <title> tag for the page below.

REQUIREMENTS
- 50-60 characters
- Lead with the most extractable noun phrase (brand or product name)
- Match the brand's voice (see TONE)
- Plain text, no quotes, no HTML
- Output ONLY the title text, nothing else

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
CURRENT H1: {h1}
CURRENT TITLE: {title_now}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("meta_title")
async def gen_meta_title(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_META_TITLE.format(**_ctx_pack(ctx))
    title = await _call_claude(prompt, max_tokens=128)
    return ArtifactResult(artifact=title, artifact_type="meta_title")


# ── meta_description ─────────────────────────────────────────────────────────

_PROMPT_META_DESCRIPTION = """\
You are an AI-search optimization specialist. Generate a paste-ready meta description for the page below.

REQUIREMENTS
- 140-160 characters
- Start with the page's primary value statement (what the user gets)
- Include the brand name once if natural
- Match the brand's voice (see TONE)
- Plain text, no quotes, no HTML
- Output ONLY the description, nothing else

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
CURRENT H1: {h1}
PAGE SIGNALS:
{page_summary}
BRAND DESCRIPTION: {brand_description}
{notes_block}
"""


@register_llm("meta_description")
async def gen_meta_description(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_META_DESCRIPTION.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=256)
    return ArtifactResult(artifact=out, artifact_type="meta_description")


# ── h1_text ──────────────────────────────────────────────────────────────────

_PROMPT_H1 = """\
You are an AI-search optimization specialist. Generate a paste-ready <h1> for the page below.

REQUIREMENTS
- 40-80 characters
- Descriptive, search-friendly noun phrase
- One H1 only — this is the page's primary topic anchor
- Match the brand's voice (see TONE)
- Plain text, no quotes, no HTML wrapping
- Output ONLY the H1 text

BRAND: {brand_name}
TONE: {tone}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
CURRENT TITLE: {title_now}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("h1_text")
async def gen_h1_text(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_H1.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=128)
    return ArtifactResult(artifact=out, artifact_type="h1_text")


# ── og_tags ──────────────────────────────────────────────────────────────────

_PROMPT_OG_TAGS = """\
You are an AI-search optimization specialist. Generate Open Graph meta tags for the page below.

REQUIREMENTS
- Output exactly five <meta property="og:..."> tags: title, description, url, type, image
- Description: 110-150 characters
- Title: 50-60 characters
- Use https://… absolute URL for og:image (placeholder /og-image.png is acceptable)
- og:type: choose article/product/website based on the page type
- Output ONLY the HTML block (no commentary)

BRAND: {brand_name}
TONE: {tone}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("og_tags")
async def gen_og_tags(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_OG_TAGS.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=512)
    return ArtifactResult(artifact=out, artifact_type="og_tags")


# ── jsonld_faq ───────────────────────────────────────────────────────────────

_PROMPT_FAQ_SCHEMA = """\
You are an AI-search optimization specialist. Generate a complete FAQPage JSON-LD block for the page below.

REQUIREMENTS
- 5-8 question/answer pairs
- Questions phrased as a real user would ask, mixing top-funnel + product-specific
- Answers: 1-3 sentences, factual, in brand voice. Include numbers/specifics when available.
- Use the exact Schema.org FAQPage / Question / Answer types
- Wrap in <script type="application/ld+json">…</script>
- Output ONLY the script block (no commentary)

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
BRAND DESCRIPTION: {brand_description}
KEY STATS: {key_stats}
TARGET AUDIENCE: {target_audience}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("jsonld_faq")
async def gen_jsonld_faq(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_FAQ_SCHEMA.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=2048)
    return ArtifactResult(artifact=out, artifact_type="jsonld_faq")


# ── faq_section (HTML + paired JSON-LD) ──────────────────────────────────────

_PROMPT_FAQ_SECTION = """\
You are an AI-search optimization specialist. Generate a complete FAQ section for the page below.

OUTPUT FORMAT (in this order, exactly):

1. An HTML section using <section class="faq"> containing 5-8 question/answer pairs as <h3>…</h3><p>…</p> pairs.
2. A blank line.
3. The matching FAQPage JSON-LD inside <script type="application/ld+json">…</script>.

REQUIREMENTS
- Questions phrased as a real user would ask
- Answers: 2-4 sentences, factual, in brand voice
- HTML must validate (close every tag, no markdown)
- Output ONLY the section + script (no commentary, no markdown fences)

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
BRAND DESCRIPTION: {brand_description}
KEY STATS: {key_stats}
TARGET AUDIENCE: {target_audience}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("faq_section")
async def gen_faq_section(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_FAQ_SECTION.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=3072)
    return ArtifactResult(artifact=out, artifact_type="faq_section")


# ── section_rewrite ──────────────────────────────────────────────────────────

_PROMPT_SECTION_REWRITE = """\
You are an AI-search optimization specialist. Rewrite the page's intro section to be optimally extractable by AI search.

REQUIREMENTS
- Lead with a 1-2 sentence direct answer to the page's primary question
- Use semantic HTML: <h2> for sub-anchors, <ul>/<ol> for itemizable content, <strong> for key facts
- Include 2-3 concrete numbers/stats if the brand has them
- Avoid hype words and marketing speak
- Match the brand's voice (TONE) and avoid blocked phrases (WHAT NOT TO SAY)
- Output ONLY the HTML block — no commentary, no markdown fences

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
CURRENT H1: {h1}
PAGE SIGNALS:
{page_summary}
BRAND DESCRIPTION: {brand_description}
KEY STATS: {key_stats}
{notes_block}
"""


@register_llm("section_rewrite")
async def gen_section_rewrite(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_SECTION_REWRITE.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=2048)
    return ArtifactResult(artifact=out, artifact_type="section_rewrite")


# ── jsonld_article ───────────────────────────────────────────────────────────

_PROMPT_JSONLD_ARTICLE = """\
You are an AI-search optimization specialist. Generate a complete Article JSON-LD block.

REQUIREMENTS
- Use Schema.org Article type
- Include: headline, description, author (Person or Organization), datePublished, dateModified, image, publisher
- Use https://… absolute URLs (placeholders are fine when actual data unknown)
- Wrap in <script type="application/ld+json">…</script>
- Output ONLY the script block

BRAND: {brand_name}
PAGE URL: {page_url}
CURRENT H1: {h1}
PAGE TYPE: {page_type}
BRAND DESCRIPTION: {brand_description}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("jsonld_article")
async def gen_jsonld_article(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_ARTICLE.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out, artifact_type="jsonld_article")


# ── jsonld_product ───────────────────────────────────────────────────────────

_PROMPT_JSONLD_PRODUCT = """\
You are an AI-search optimization specialist. Generate a complete Product JSON-LD block.

REQUIREMENTS
- Use Schema.org Product type
- Include: name, description, image, brand (use Organization), offers (price, priceCurrency, availability, url)
- Use placeholder price/availability if actual data unknown — mark as TODO
- Wrap in <script type="application/ld+json">…</script>
- Output ONLY the script block

BRAND: {brand_name}
PAGE URL: {page_url}
CURRENT H1: {h1}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("jsonld_product")
async def gen_jsonld_product(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_PRODUCT.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out, artifact_type="jsonld_product")


# ── jsonld_howto ─────────────────────────────────────────────────────────────

_PROMPT_JSONLD_HOWTO = """\
You are an AI-search optimization specialist. Generate a complete HowTo JSON-LD block.

REQUIREMENTS
- Use Schema.org HowTo type
- Infer 4-7 steps from the page's topic
- Each step: HowToStep with name and text
- Wrap in <script type="application/ld+json">…</script>
- Output ONLY the script block

BRAND: {brand_name}
PAGE URL: {page_url}
CURRENT H1: {h1}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("jsonld_howto")
async def gen_jsonld_howto(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_JSONLD_HOWTO.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out, artifact_type="jsonld_howto")


# ── alt_text_batch ───────────────────────────────────────────────────────────

_PROMPT_ALT_TEXT = """\
You are an AI-search optimization specialist. Generate alt text for the images on this page.

You don't see the actual images — generate descriptive, contextually-appropriate alt text based on the page topic. Output a JSON object mapping a short filename hint to an alt-text string.

REQUIREMENTS
- 6-10 entries
- Each alt: 6-15 words, describes content + adds context (not just "image of …")
- Don't include "image of" or "picture of" prefixes
- Keys: descriptive slug like "hero-main", "product-detail", "process-step-1"
- Output ONLY valid JSON

BRAND: {brand_name}
PAGE URL: {page_url}
CURRENT H1: {h1}
PAGE SIGNALS:
{page_summary}
{notes_block}
"""


@register_llm("alt_text_batch")
async def gen_alt_text_batch(ctx: GeneratorContext) -> ArtifactResult:
    prompt = _PROMPT_ALT_TEXT.format(**_ctx_pack(ctx))
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out, artifact_type="alt_text_batch")


# ── internal_link_suggestions ────────────────────────────────────────────────

_PROMPT_INTERNAL_LINKS = """\
You are an AI-search optimization specialist. Suggest internal links to add between brand pages to strengthen topical authority.

You're given the target page and a list of sibling pages on the same site. Suggest 4-8 internal-link additions.

REQUIREMENTS
- Each suggestion: {{"from": page-url, "to": page-url, "anchor": link-text-to-use}}
- Use anchors that are real keyword phrases, not "click here" / "read more"
- Both URLs must come from the provided list
- Output ONLY a valid JSON array

BRAND: {brand_name}
TARGET PAGE: {page_url}
TARGET PAGE H1: {h1}
SIBLING PAGES:
{page_summary}
{notes_block}
"""


@register_llm("internal_link_suggestions")
async def gen_internal_links(ctx: GeneratorContext) -> ArtifactResult:
    # Override page_summary to include a list of sibling pages on this brand's audit.
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
    pack["page_summary"] = "\n".join(
        f"- {p.url}  (H1: {p.h1_text or p.title or '—'})" for p in siblings
    ) or "—"
    prompt = _PROMPT_INTERNAL_LINKS.format(**pack)
    out = await _call_claude(prompt, max_tokens=1024)
    return ArtifactResult(artifact=out, artifact_type="internal_link_suggestions")


# ── new_page_draft (experimental, longer output) ─────────────────────────────

_PROMPT_NEW_PAGE = """\
You are an AI-search optimization specialist. Draft a complete new page for the brand based on the recommendation title.

REQUIREMENTS
- Output: Markdown, 600-900 words
- Structure: H1 + intro (2-3 sentences direct answer) + 4-6 H2 sections with body content + an FAQ section at the end
- Lead each H2 with a direct, extractable claim (a sentence AI search can quote)
- Include 3-5 concrete stats or specifics throughout
- Match the brand's voice (TONE) and avoid blocked phrases (WHAT NOT TO SAY)
- Output ONLY the markdown — no commentary, no front matter

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
TARGET AUDIENCE: {target_audience}
RECOMMENDATION TITLE: {rec_title}
BRAND DESCRIPTION: {brand_description}
KEY STATS: {key_stats}
{notes_block}
"""


@register_llm("new_page_draft")
async def gen_new_page_draft(ctx: GeneratorContext) -> ArtifactResult:
    pack = _ctx_pack(ctx)
    pack["rec_title"] = ctx.rec.title
    prompt = _PROMPT_NEW_PAGE.format(**pack)
    out = await _call_claude(prompt, max_tokens=4096)
    return ArtifactResult(artifact=out, artifact_type="new_page_draft")
