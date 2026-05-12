"""Rule-based recommendation engine + LLM rewrite helper."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.services.site_audit.parsers import Finding

logger = logging.getLogger(__name__)


@dataclass
class Recommendation:
    check_id: str
    title: str
    body: str
    category: str
    priority: str
    effort: str
    linked_prompt_ids: list[int] = field(default_factory=list)
    expected_impact: str | None = None
    llm_generated: bool = False


@dataclass
class RecInput:
    findings: list[Finding]
    page_link_map: dict[int, list[int]]
    page_id: int | None


# (check_id) → (title, body, category, priority, effort, expected_impact)
_RECS: dict[str, dict] = {
    "blocked_oai_searchbot": {
        "title": "Unblock OAI-SearchBot (ChatGPT live search)",
        "body": (
            "Your robots.txt disallows `OAI-SearchBot`. This is the user-agent ChatGPT uses to "
            "fetch pages in real time when answering user questions about your brand. While "
            "you're blocking it, ChatGPT cannot read your site.\n\n"
            "Add to robots.txt:\n\n"
            "```\nUser-agent: OAI-SearchBot\nAllow: /\n```\n\n"
            "Use the robots.txt snippet generator on this page for a complete AI-bot allow block."
        ),
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
        "expected_impact": "Restores ChatGPT live-search visibility",
    },
    "blocked_gptbot": {
        "title": "Allow GPTBot",
        "body": "GPTBot is blocked. This excludes your content from OpenAI training. If you want to also block OAI-SearchBot, do it explicitly — they're separate user-agents.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_claudebot": {
        "title": "Allow ClaudeBot",
        "body": "ClaudeBot is blocked from your site. This excludes your content from Claude's training and retrieval.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_google_extended": {
        "title": "Allow Google-Extended",
        "body": "Google-Extended is blocked. This is what Gemini and Google AI Overviews use to read your content.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_perplexitybot": {
        "title": "Allow PerplexityBot",
        "body": "PerplexityBot is blocked. Perplexity is heavily citation-driven; blocking it removes you from a significant share of AI search.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "no_robots_txt": {
        "title": "Add a robots.txt with an AI-bot allow block",
        "body": "Your site has no robots.txt. While the default is allow-all, an explicit `Allow: /` per AI bot signals intent.",
        "category": "bot_access",
        "priority": "low",
        "effort": "low",
    },
    "llms_txt_missing": {
        "title": "Add an llms.txt",
        "body": "Add a `/llms.txt` summarising your key pages for AI agents. Use the generator on this page. Adoption is early but cost is zero.",
        "category": "bot_access",
        "priority": "low",
        "effort": "low",
    },
    "missing_h1": {
        "title": "Add a single H1 heading",
        "body": "Pages without an H1 lose structural anchoring for AI extraction. Add one descriptive H1 at the top.",
        "category": "content",
        "priority": "high",
        "effort": "low",
    },
    "no_h2": {
        "title": "Break the page into H2 sections",
        "body": "AI passages are extracted at section granularity. Without H2s, the entire page is one blob — nothing extracts cleanly.",
        "category": "content",
        "priority": "medium",
        "effort": "medium",
    },
    "answer_first_failed": {
        "title": "Lead each H2 section with a self-contained answer",
        "body": (
            "AI engines extract the first 40–75 words of each section. If those words "
            "rely on pronouns or context from elsewhere, the passage gets dropped. "
            "Rewrite the opening paragraph of each H2 to stand alone with the brand name explicit."
        ),
        "category": "content",
        "priority": "medium",
        "effort": "medium",
        "expected_impact": "Up to +3.1× citation rate on passage-level extraction (KIME 2026)",
    },
    "fact_density_low": {
        "title": "Add specific facts and numbers",
        "body": (
            "Statistics Addition was the second-highest-impact technique in the Aggarwal 2024 GEO paper (+33% citations). "
            "Add 3–5 specific stats with year + source."
        ),
        "category": "content",
        "priority": "medium",
        "effort": "medium",
        "expected_impact": "Aggarwal 2024: +33% citations from Statistics Addition",
    },
    "no_outbound_citations": {
        "title": "Cite your sources",
        "body": "Pages with zero outbound links read as marketing copy to AI engines. Cite at least 2–3 third-party sources.",
        "category": "authority",
        "priority": "low",
        "effort": "low",
        "expected_impact": "Aggarwal 2024: +28% citations from Cite Sources",
    },
    "pronoun_overuse": {
        "title": "Replace leading pronouns with the brand or concept name",
        "body": "Sentences that begin with 'It' or 'They' lose context when extracted independently. Use explicit names.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
    "fake_lists": {
        "title": "Use real <ul>/<ol> instead of paragraphs with bullet characters",
        "body": "AI engines read the underlying HTML. Bullet-prefixed paragraphs are not lists. Convert to `<ul>` / `<ol>`.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
    "missing_organization_schema": {
        "title": "Add Organization JSON-LD on the homepage",
        "body": (
            "Add a JSON-LD `Organization` block with `name`, `url`, `logo`, and `sameAs` pointing "
            "to LinkedIn / X / etc. This is the entity-anchor for the rest of the schema graph."
        ),
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "incomplete_organization_schema": {
        "title": "Complete Organization schema fields",
        "body": "Organization schema is present but missing required fields. Add the missing keys (see finding evidence).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "article_missing_author": {
        "title": "Add a Person-typed author to Article schema",
        "body": "Articles without identified authors are weaker E-E-A-T signals. Add `author` as `{\"@type\":\"Person\",\"name\":\"...\",\"sameAs\":[\"https://linkedin.com/in/...\"]}`.",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "article_missing_dates": {
        "title": "Add datePublished and dateModified",
        "body": "AI engines weight recency — 50% of cited content is <13 weeks old. Always include both dates.",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "product_missing_required": {
        "title": "Complete Product schema",
        "body": "Product schema is missing required fields (see finding evidence).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "faqpage_no_questions": {
        "title": "Remove or populate FAQPage schema",
        "body": "FAQPage schema with no `mainEntity` is misuse and may incur penalties. Either remove it or add real Q&A entries that match what's visible on the page.",
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "malformed_jsonld": {
        "title": "Fix malformed JSON-LD",
        "body": "A `<script type=application/ld+json>` block fails to parse. AI engines skip invalid schema entirely.",
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "no_jsonld": {
        "title": "Add JSON-LD schema",
        "body": "No JSON-LD on this page. Start with the schema type that fits (`Article`, `Product`, `Service`, etc.).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "missing_title": {
        "title": "Add a <title>",
        "body": "Pages without `<title>` are invisible to AI extraction.",
        "category": "content",
        "priority": "high",
        "effort": "low",
    },
    "missing_meta_description": {
        "title": "Add a meta description",
        "body": "Add a 70–160 character description summarising the page in answer form.",
        "category": "content",
        "priority": "medium",
        "effort": "low",
    },
    "missing_byline": {
        "title": "Add a visible author byline",
        "body": "Article pages without an author byline are weaker E-E-A-T signals.",
        "category": "authority",
        "priority": "medium",
        "effort": "low",
    },
    "missing_update_date": {
        "title": "Show a publication or update date on article pages",
        "body": "AI engines prefer recently-updated content. Make the date visible AND include `dateModified` in JSON-LD.",
        "category": "authority",
        "priority": "medium",
        "effort": "low",
    },
    "stale_content": {
        "title": "Refresh stale content",
        "body": "This page hasn't been updated in over 18 months. Pages not refreshed quarterly lose AI citations at ~3× the normal rate.",
        "category": "content",
        "priority": "medium",
        "effort": "medium",
    },
    "low_alt_text_coverage": {
        "title": "Add descriptive alt text",
        "body": "Most images lack descriptive `alt`. Claude treats 35% of its fetches as image-content per Vercel's study; descriptive alts help.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
    "title_too_long": {
        "title": "Shorten the page <title>",
        "body": "Aim for ≤70 characters so it doesn't get truncated in AI snippets and SERPs.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
}

_RENDER_REC = {
    "title": "Render this page server-side",
    "body": (
        "AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) **do not execute "
        "JavaScript** — Vercel's 1B-fetch study found zero JS execution. This page's content "
        "is only present after JS runs, so it's invisible to all four major LLMs.\n\n"
        "Switch the page to SSR / SSG (Next.js getServerSideProps, Nuxt asyncData, etc.) or "
        "use a pre-render proxy."
    ),
    "category": "technical",
    "priority": "high",
    "effort": "high",
    "expected_impact": "Restores AI crawler visibility from zero",
}


def build_rule_based_recs(
    findings: list[Finding],
    page_link_map: dict[int, list[int]],
    page_id: int | None,
) -> list[Recommendation]:
    out: list[Recommendation] = []
    for f in findings:
        spec = _RECS.get(f.check_id)
        if spec is None:
            continue
        priority = spec.get("priority", "low")
        # Boost priority from severity if higher
        if f.severity == "critical" and priority != "high":
            priority = "high"
        prompt_ids = page_link_map.get(page_id, []) if page_id is not None else []
        out.append(Recommendation(
            check_id=f.check_id,
            title=spec["title"],
            body=spec["body"],
            category=spec["category"],
            priority=priority,
            effort=spec.get("effort", "medium"),
            linked_prompt_ids=prompt_ids,
            expected_impact=spec.get("expected_impact"),
        ))
    return out


def render_rec_for_csr_page(page_id: int, linked_prompt_ids: list[int]) -> Recommendation:
    """Build the 'render server-side' recommendation when is_js_rendered=True."""
    return Recommendation(
        check_id="js_rendered_page",
        title=_RENDER_REC["title"],
        body=_RENDER_REC["body"],
        category=_RENDER_REC["category"],
        priority=_RENDER_REC["priority"],
        effort=_RENDER_REC["effort"],
        linked_prompt_ids=linked_prompt_ids,
        expected_impact=_RENDER_REC["expected_impact"],
    )


async def generate_llm_rewrite(
    page_excerpt: str,
    findings: list[Finding],
    brand_profile: dict,
    linked_prompts: list[str],
    *,
    timeout_s: int = 30,
) -> str | None:
    """Generate an answer-first rewrite for the first H2 section. Returns None on any failure."""
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        return None

    try:
        prompt_text = _build_llm_rewrite_prompt(page_excerpt, findings, brand_profile, linked_prompts)
        client = AsyncAnthropic()
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1500,
            timeout=timeout_s,
            messages=[{"role": "user", "content": prompt_text}],
        )
        content = "".join(block.text for block in msg.content if hasattr(block, "text"))
        return content.strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM rewrite failed: %s", exc)
        return None


def _build_llm_rewrite_prompt(page_excerpt: str, findings: list[Finding],
                              brand_profile: dict, linked_prompts: list[str]) -> str:
    findings_summary = "\n".join(f"- {f.check_id}: {f.message}" for f in findings if f.severity in ("critical", "high", "medium"))
    prompts_summary = "\n".join(f"- {p}" for p in linked_prompts[:5])
    return f"""You are rewriting a page section for AI-search visibility. The goal: the first 40–75 words must be a self-contained answer that explicitly names the brand and addresses the query.

Brand: {brand_profile.get('name', 'this brand')}
Tone: {brand_profile.get('tone_of_voice', 'professional, factual')}
Do not say: {brand_profile.get('what_not_to_say', '')}

AI prompts this page should win:
{prompts_summary or '(none specified)'}

Findings to address:
{findings_summary or '(none)'}

Current first section of the page:
---
{page_excerpt[:4000]}
---

Output a rewrite of the FIRST H2 section only:
- Lead with a 40–75-word answer-first paragraph (no leading pronouns, brand name explicit)
- Follow with one comparison table OR a numbered list if relevant
- Include at least one specific statistic with year + source

Output only the rewritten HTML — no commentary."""
