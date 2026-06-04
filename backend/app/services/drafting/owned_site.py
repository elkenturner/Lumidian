"""Owned-site content generator — the Tier-1 AIO channel (Layer B1).

Produces a structured answer-page draft for the brand's OWN domain. This is the
single highest-value channel from the AIO strategy (docs/strategy/
aio-content-strategy-2026.md): the only surface where every citation driver is
controllable, and the one that actually moves the metric.

This module is the reference implementation of the CITATION-DRIVER rule family
(answer-first, stats, inline citations, schema, freshness, extractable passages,
entity binding) — the counterpart to anti_ai.py's human-credibility family. It is
decoupled from the legacy drafting pipeline (takes plain dict/list inputs and an
injected `writer` callable) so the Layer B2 unified writer can reuse it as-is and
so it's testable without live LLM calls.

Public API:
  build_owned_site_prompt(brand, target_query, evidence=, voice=, avoid=) -> str
  build_jsonld(headline, brand, date_published, faq=) -> dict
  generate_owned_site_draft(writer, brand, target_query, ...) -> OwnedSiteDraft   (async)
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.drafting import anti_ai

# The owned_site ruleset from the strategy doc Part 2, encoded as prompt guidance.
OWNED_SITE_SPEC = {
    "format": "structured answer page; H2/H3 with discrete ~120-180-word answer blocks",
    "length_note": "driven by extractable passages, not a word target; most cited pages are <1000 words",
    "must": [
        "Lead with the direct answer to the target query in the first 1-2 sentences.",
        "Break the body into H2/H3 sections, each a self-contained ~120-180-word answer block.",
        "Include concrete statistics with numbers (in a sentence or a small table), each traceable to an evidence source.",
        "Cite external authoritative sources inline where a claim leans on them.",
        "Name the brand once, in a concrete factual context (not a pitch).",
        "Cover the specific attributes/comparisons the query implies (topical depth over keyword breadth).",
    ],
}

# Citation-driver requirements (the universal rules from the strategy doc).
_CITATION_DRIVERS = [
    "ANSWER-FIRST: the first 1-2 sentences must directly answer the query — no preamble.",
    "STATISTICS: include concrete numbers; never vague 'significant'/'many'.",
    "INLINE CITATIONS: attribute evidence-backed claims to the named source.",
    "EXTRACTABLE PASSAGES: clear H2/H3 headings, ~120-180-word self-contained blocks.",
    "ENTITY BINDING: state the brand name once in a concrete factual context.",
    "EVIDENCE-GROUNDING: every factual claim must trace to the brand profile or an evidence source — never invent data.",
]


@dataclass
class OwnedSiteDraft:
    body: str
    jsonld: dict
    anti_ai_passed: bool
    anti_ai_score: float
    attempts: int
    flagged_for_review: bool = False
    violations: list = field(default_factory=list)


def _evidence_block(evidence: list[dict] | None) -> str:
    if not evidence:
        return "(No external evidence supplied — use only brand-profile facts; do not invent.)"
    lines = []
    for i, e in enumerate(evidence, 1):
        title = e.get("title") or e.get("url") or "source"
        url = e.get("url", "")
        snippet = (e.get("snippet") or "").strip()
        lines.append(f"[S{i}] {title} — {url}\n      {snippet}".rstrip())
    return "\n".join(lines)


def build_owned_site_prompt(
    brand: dict,
    target_query: str,
    evidence: list[dict] | None = None,
    voice: str | None = None,
    avoid: str | None = None,
) -> str:
    """Construct the owned-site writer prompt.

    `brand` keys used (all optional except name): name, description, url,
    audience, approved_language, what_not_to_say.
    `voice`: a voice/guidelines sample or instruction to mirror (Layer B/C input).
    `avoid`: regeneration feedback from a prior anti_ai scan (specific tells to remove).
    """
    name = brand.get("name", "the brand")
    parts: list[str] = []
    parts.append(
        f"Write a page for {name}'s OWN website that will be cited by AI answer "
        f"engines (ChatGPT, Claude, Perplexity, Gemini) when users ask about the "
        f"target query below. The goal is for the brand to be MENTIONED in those answers."
    )
    parts.append(f"TARGET QUERY:\n{target_query}")

    bp = [f"BRAND: {name}"]
    if brand.get("description"):
        bp.append(f"What it is: {brand['description']}")
    if brand.get("audience"):
        bp.append(f"Audience: {brand['audience']}")
    if brand.get("approved_language"):
        bp.append(f"Approved language: {brand['approved_language']}")
    if brand.get("what_not_to_say"):
        bp.append(f"NEVER say: {brand['what_not_to_say']}")
    parts.append("\n".join(bp))

    parts.append("EVIDENCE SOURCES (cite as [S1], [S2], …; never invent figures):\n"
                 + _evidence_block(evidence))

    parts.append("FORMAT: " + OWNED_SITE_SPEC["format"] + ". " + OWNED_SITE_SPEC["length_note"] + ".")
    parts.append("CITATION-DRIVER RULES (these make AI cite the page):\n- "
                 + "\n- ".join(_CITATION_DRIVERS))
    parts.append("REQUIREMENTS:\n- " + "\n- ".join(OWNED_SITE_SPEC["must"]))

    # Human-credibility / anti-AI rules (the other rule family).
    parts.append(
        "HUMAN-CREDIBILITY RULES (must not read as AI-written):\n"
        "- Vary sentence length deliberately — mix short punchy sentences with longer ones.\n"
        "- No 'it's not just X, it's Y' constructions, no 'in conclusion', no 'in today's world'.\n"
        "- Banned words: delve, tapestry, underscore, leverage, seamless, robust (as filler), realm, testament.\n"
        "- No grandiosity ('game-changer', 'paradigm shift'), no vague attribution ('studies show').\n"
        "- Use concrete specifics (names, numbers, dates) over abstraction; write in a real human voice."
    )
    if voice:
        parts.append(f"VOICE — mirror this voice/style closely:\n{voice}")
    if avoid:
        parts.append(f"REVISION — your previous draft was rejected. Fix exactly these:\n{avoid}")

    parts.append(
        "OUTPUT: return the page body only (Markdown with H2/H3). First line: a single H1 "
        "title that states the answer. No meta-commentary, no 'here is your page'."
    )
    return "\n\n".join(parts)


def build_jsonld(
    headline: str,
    brand: dict,
    date_published: str,
    faq: list[dict] | None = None,
) -> dict:
    """Build schema.org JSON-LD (Article + optional FAQPage) — a citation driver.

    `date_published` is passed in (caller stamps it; this module stays deterministic).
    `faq`: list of {"question": ..., "answer": ...}.
    """
    name = brand.get("name", "")
    article = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": headline,
        "datePublished": date_published,
        "dateModified": date_published,
        "author": {"@type": "Organization", "name": name},
        "publisher": {"@type": "Organization", "name": name},
    }
    if brand.get("url"):
        article["mainEntityOfPage"] = {"@type": "WebPage", "@id": brand["url"]}
    if not faq:
        return article
    faq_page = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q["question"],
                "acceptedAnswer": {"@type": "Answer", "text": q["answer"]},
            }
            for q in faq
        ],
    }
    return {"@graph": [article, faq_page]}


def _extract_title(body: str) -> str:
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()
        if s:
            return s
    return ""


async def generate_owned_site_draft(
    writer,
    brand: dict,
    target_query: str,
    evidence: list[dict] | None = None,
    voice: str | None = None,
    date_published: str = "",
    max_retries: int = 2,
) -> OwnedSiteDraft:
    """Generate an owned-site draft, gating through the anti-AI engine.

    `writer` is an async callable `(prompt: str) -> str` (inject the real LLM call,
    or a stub in tests). Loop: generate → autofix → scan → if failing, regenerate
    with the specific tells fed back. Never silently ships a failing draft — it is
    flagged_for_review instead.
    """
    prompt = build_owned_site_prompt(brand, target_query, evidence, voice)
    body = await writer(prompt)
    attempts = 1
    report = anti_ai.scan(anti_ai.autofix(body))
    while not report.passed and attempts <= max_retries:
        feedback = anti_ai.feedback_for_regeneration(report)
        body = await writer(build_owned_site_prompt(brand, target_query, evidence, voice, avoid=feedback))
        attempts += 1
        report = anti_ai.scan(anti_ai.autofix(body))

    body = anti_ai.autofix(body)
    title = _extract_title(body)
    jsonld = build_jsonld(title, brand, date_published)
    return OwnedSiteDraft(
        body=body,
        jsonld=jsonld,
        anti_ai_passed=report.passed,
        anti_ai_score=report.score,
        attempts=attempts,
        flagged_for_review=not report.passed,
        violations=report.violations,
    )
