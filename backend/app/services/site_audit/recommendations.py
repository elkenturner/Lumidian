"""Rule-based recommendation engine + LLM rewrite helper."""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

from app.services.site_audit.parsers import Finding

logger = logging.getLogger(__name__)


# Effort string → minutes (used in priority_score and surfaced in the UI).
EFFORT_MINUTES: dict[str, int] = {
    "low": 5,
    "medium": 20,
    "high": 60,
}


def compute_priority_score(
    *, expected_lift_pp: float, pages_affected: int, effort_minutes: int
) -> float:
    """Rank recommendations: higher = more bang per minute of work."""
    return (float(expected_lift_pp) * max(int(pages_affected), 1)) / math.sqrt(
        max(int(effort_minutes), 0) + 1
    )


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
    artifact_type: str | None = None
    expected_lift_pp: float | None = None
    impl_steps: list[str] = field(default_factory=list)
    priority_score: float | None = None
    target_url: str | None = None


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

# ── Fix-factory metadata (additive sidecar to _RECS) ─────────────────────────
#
# For each check_id we record:
#   - expected_lift_pp: magnitude this fix moves the relevant scoring axis
#   - artifact_type:   which generator the "Draft this" button calls (or None)
#   - impl_steps:      numbered install instructions shown under the artifact
#
# Values are conservative estimates calibrated to the existing scoring weights.

_RECS_META: dict[str, dict] = {
    # bot_access — small per-bot lifts; OAI-SearchBot is the heaviest hit
    "blocked_oai_searchbot": {
        "expected_lift_pp": 40.0,
        "artifact_type": "robots_snippet",
        "impl_steps": [
            "Open your robots.txt at the site root.",
            "Replace any `Disallow: /` for OAI-SearchBot with the snippet above.",
            "Deploy and verify at https://yoursite.com/robots.txt.",
            "Allow 24-48h for ChatGPT live-search to re-crawl.",
        ],
    },
    "blocked_gptbot": {
        "expected_lift_pp": 15.0,
        "artifact_type": "robots_snippet",
        "impl_steps": [
            "Open robots.txt.",
            "Add `User-agent: GPTBot` block with `Allow: /`.",
            "Deploy.",
        ],
    },
    "blocked_claudebot": {
        "expected_lift_pp": 15.0,
        "artifact_type": "robots_snippet",
        "impl_steps": ["Add `User-agent: ClaudeBot` `Allow: /` to robots.txt.", "Deploy."],
    },
    "blocked_google_extended": {
        "expected_lift_pp": 15.0,
        "artifact_type": "robots_snippet",
        "impl_steps": ["Add `User-agent: Google-Extended` `Allow: /` to robots.txt.", "Deploy."],
    },
    "blocked_perplexitybot": {
        "expected_lift_pp": 5.0,
        "artifact_type": "robots_snippet",
        "impl_steps": ["Add `User-agent: PerplexityBot` `Allow: /` to robots.txt.", "Deploy."],
    },
    "no_robots_txt": {
        "expected_lift_pp": 5.0,
        "artifact_type": "robots_snippet",
        "impl_steps": [
            "Create /robots.txt at your site root.",
            "Paste the snippet above.",
            "Verify at https://yoursite.com/robots.txt.",
        ],
    },
    "llms_txt_missing": {
        "expected_lift_pp": 2.0,
        "artifact_type": "llms_txt",
        "impl_steps": [
            "Create /llms.txt at your site root.",
            "Paste the generated content.",
            "Verify it loads at https://yoursite.com/llms.txt.",
        ],
    },

    # content — per-page text fixes
    "missing_h1": {
        "expected_lift_pp": 12.0,
        "artifact_type": "h1_text",
        "impl_steps": [
            "Open the page's template (e.g. the React component, Liquid file, or HTML).",
            "Add the generated H1 inside <main>, above other headings.",
            "Save and redeploy.",
        ],
    },
    "no_h2": {
        "expected_lift_pp": 8.0,
        "artifact_type": "section_rewrite",
        "impl_steps": [
            "Identify natural break points in the page (every 200-300 words).",
            "Insert H2 headings at each break.",
            "Use the generated rewrite as a starting point for the first section.",
        ],
    },
    "answer_first_failed": {
        "expected_lift_pp": 15.0,
        "artifact_type": "section_rewrite",
        "impl_steps": [
            "Locate the first H2 section.",
            "Replace its opening paragraph with the generated rewrite.",
            "Verify the first 40-75 words read as a self-contained answer.",
        ],
    },
    "fact_density_low": {
        "expected_lift_pp": 10.0,
        "artifact_type": "section_rewrite",
        "impl_steps": [
            "Identify a section weak on specifics.",
            "Paste the rewrite (includes 3-5 concrete stats).",
            "Verify stats reference a source + year inline.",
        ],
    },
    "no_outbound_citations": {
        "expected_lift_pp": 6.0,
        "artifact_type": None,
        "impl_steps": [
            "Identify 2-3 third-party sources that support the page's claims.",
            "Add inline links with descriptive anchor text.",
        ],
    },
    "pronoun_overuse": {
        "expected_lift_pp": 4.0,
        "artifact_type": "section_rewrite",
        "impl_steps": [
            "Find sentences starting with 'It' / 'They' / 'This'.",
            "Replace pronouns with the brand or concept name.",
        ],
    },
    "fake_lists": {
        "expected_lift_pp": 3.0,
        "artifact_type": None,
        "impl_steps": [
            "Find paragraphs that use • or - bullet characters.",
            "Wrap each in real <ul><li>…</li></ul> or <ol><li>…</li></ol>.",
        ],
    },
    "missing_title": {
        "expected_lift_pp": 10.0,
        "artifact_type": "meta_title",
        "impl_steps": [
            "Open the page's <head>.",
            "Add the generated <title>…</title>.",
            "Deploy and verify in the browser's tab title.",
        ],
    },
    "missing_meta_description": {
        "expected_lift_pp": 6.0,
        "artifact_type": "meta_description",
        "impl_steps": [
            "Open the page's <head>.",
            'Add `<meta name="description" content="…">` using the generated text.',
            "Deploy.",
        ],
    },
    "stale_content": {
        "expected_lift_pp": 5.0,
        "artifact_type": "section_rewrite",
        "impl_steps": [
            "Refresh the page's content using the rewrite as a baseline.",
            "Update the dateModified in JSON-LD.",
            "Update any visible 'Last updated' date on the page.",
        ],
    },
    "low_alt_text_coverage": {
        "expected_lift_pp": 3.0,
        "artifact_type": "alt_text_batch",
        "impl_steps": [
            "Pull the JSON of alt-text suggestions.",
            "For each image on the page, apply the closest matching alt.",
            "Aim for 90%+ coverage of meaningful images (decorative can stay empty).",
        ],
    },
    "title_too_long": {
        "expected_lift_pp": 3.0,
        "artifact_type": "meta_title",
        "impl_steps": [
            "Replace your <title> with the generated shorter version.",
            "Verify under 70 characters.",
        ],
    },

    # schema — JSON-LD adds
    "missing_organization_schema": {
        "expected_lift_pp": 21.0,
        "artifact_type": "jsonld_org",
        "impl_steps": [
            "Paste the generated <script type='application/ld+json'> block into your homepage <head>.",
            "If you have a global layout template, put it there so it appears on every page.",
            "Validate at https://search.google.com/test/rich-results.",
        ],
    },
    "incomplete_organization_schema": {
        "expected_lift_pp": 10.0,
        "artifact_type": "jsonld_org",
        "impl_steps": [
            "Replace the existing Organization JSON-LD with the generated one.",
            "Validate at https://search.google.com/test/rich-results.",
        ],
    },
    "article_missing_author": {
        "expected_lift_pp": 8.0,
        "artifact_type": "jsonld_article",
        "impl_steps": [
            "Replace the existing Article JSON-LD with the generated block.",
            "Set the author's `sameAs` to their LinkedIn / personal site if available.",
        ],
    },
    "article_missing_dates": {
        "expected_lift_pp": 8.0,
        "artifact_type": "jsonld_article",
        "impl_steps": [
            "Replace the existing Article JSON-LD with the generated block.",
            "Set datePublished / dateModified to ISO-8601 dates from your CMS.",
        ],
    },
    "product_missing_required": {
        "expected_lift_pp": 12.0,
        "artifact_type": "jsonld_product",
        "impl_steps": [
            "Replace the existing Product JSON-LD with the generated block.",
            "Update placeholder price/availability with real values.",
        ],
    },
    "faqpage_no_questions": {
        "expected_lift_pp": 12.0,
        "artifact_type": "jsonld_faq",
        "impl_steps": [
            "Replace the empty FAQPage JSON-LD with the generated block.",
            "Ensure each Question's text appears as visible content on the page (anti-cloaking).",
        ],
    },
    "malformed_jsonld": {
        "expected_lift_pp": 15.0,
        "artifact_type": None,
        "impl_steps": [
            "Open the existing JSON-LD script tag.",
            "Fix the syntax error (often a trailing comma or unescaped quote).",
            "Validate at https://validator.schema.org/.",
        ],
    },
    "no_jsonld": {
        "expected_lift_pp": 15.0,
        "artifact_type": "jsonld_article",
        "impl_steps": [
            "Decide which schema type fits (Article/Product/FAQPage/etc.).",
            "Paste the generated block into the page's <head>.",
            "Validate at https://search.google.com/test/rich-results.",
        ],
    },

    # authority — E-E-A-T signals
    "missing_byline": {
        "expected_lift_pp": 6.0,
        "artifact_type": None,
        "impl_steps": [
            "Add a visible author byline near the H1 (e.g. 'By Jane Doe').",
            "Link the author name to an author profile page if one exists.",
        ],
    },
    "missing_update_date": {
        "expected_lift_pp": 5.0,
        "artifact_type": None,
        "impl_steps": [
            "Add a visible 'Last updated' date near the byline.",
            "Match it to dateModified in JSON-LD.",
        ],
    },
}


def enrich_recommendation(check_id: str, base: dict) -> dict:
    """Merge a _RECS entry with its _RECS_META sidecar; missing meta is fine."""
    meta = _RECS_META.get(check_id, {})
    return {**base, **meta}


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

# js_rendered_page metadata (separate because _RENDER_REC isn't in _RECS dict).
_RECS_META["js_rendered_page"] = {
    "expected_lift_pp": 40.0,
    "artifact_type": None,  # rendering switch is infrastructure, not draftable
    "impl_steps": [
        "Identify the rendering framework (Next.js / Nuxt / Astro / SPA).",
        "Switch this page to server-side rendering (SSR) or static generation (SSG).",
        "Verify by curling the URL and grepping for the main content in the raw HTML.",
    ],
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
        enriched = enrich_recommendation(f.check_id, spec)
        priority = enriched.get("priority", "low")
        # Boost priority from severity if higher
        if f.severity == "critical" and priority != "high":
            priority = "high"
        prompt_ids = page_link_map.get(page_id, []) if page_id is not None else []
        effort = enriched.get("effort", "medium")
        lift = enriched.get("expected_lift_pp")
        ps = (
            compute_priority_score(
                expected_lift_pp=lift,
                pages_affected=1,
                effort_minutes=EFFORT_MINUTES.get(effort, 20),
            )
            if lift is not None
            else None
        )
        out.append(Recommendation(
            check_id=f.check_id,
            title=enriched["title"],
            body=enriched["body"],
            category=enriched["category"],
            priority=priority,
            effort=effort,
            linked_prompt_ids=prompt_ids,
            expected_impact=enriched.get("expected_impact"),
            artifact_type=enriched.get("artifact_type"),
            expected_lift_pp=lift,
            impl_steps=list(enriched.get("impl_steps", [])),
            priority_score=ps,
        ))
    return out


def render_rec_for_csr_page(page_id: int, linked_prompt_ids: list[int]) -> Recommendation:
    """Build the 'render server-side' recommendation when is_js_rendered=True."""
    enriched = enrich_recommendation("js_rendered_page", _RENDER_REC)
    lift = enriched.get("expected_lift_pp")
    effort = enriched.get("effort", "high")
    ps = (
        compute_priority_score(
            expected_lift_pp=lift,
            pages_affected=1,
            effort_minutes=EFFORT_MINUTES.get(effort, 60),
        )
        if lift is not None
        else None
    )
    return Recommendation(
        check_id="js_rendered_page",
        title=enriched["title"],
        body=enriched["body"],
        category=enriched["category"],
        priority=enriched["priority"],
        effort=effort,
        linked_prompt_ids=linked_prompt_ids,
        expected_impact=enriched.get("expected_impact"),
        artifact_type=enriched.get("artifact_type"),
        expected_lift_pp=lift,
        impl_steps=list(enriched.get("impl_steps", [])),
        priority_score=ps,
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
