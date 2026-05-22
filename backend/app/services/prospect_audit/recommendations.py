"""Generate 3–5 prescriptive recommendations from the scored audit data.

Sonnet first (better narrative quality). Haiku as fallback if Sonnet errors.
Returns None if both fail — caller substitutes a static block in the PDF.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import anthropic

logger = logging.getLogger(__name__)

_SONNET = "claude-sonnet-4-6"
_HAIKU = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 1500


@dataclass(frozen=True)
class PromptInsight:
    prompt_text: str
    own_visibility_pct: float
    peer_avg_visibility_pct: float
    rvi: float | None
    top_competitor_name: str | None
    top_competitor_visibility_pct: float | None


@dataclass(frozen=True)
class AuditSummaryForRecs:
    business_name: str
    location: str | None
    overall_visibility_pct: float
    peer_avg_visibility_pct: float
    aggregate_rvi: float | None
    rvi_band: str
    worst_prompts: list[PromptInsight]


def _system_prompt(s: AuditSummaryForRecs) -> str:
    loc = f" in {s.location}" if s.location else ""
    rvi_str = f"{s.aggregate_rvi:.2f}" if s.aggregate_rvi is not None else "n/a"

    worst_lines: list[str] = []
    for p in s.worst_prompts:
        line = f"- \"{p.prompt_text}\" — you: {p.own_visibility_pct:.0f}%, peer avg: {p.peer_avg_visibility_pct:.0f}%"
        if p.top_competitor_name and p.top_competitor_visibility_pct is not None:
            line += f" (top competitor: {p.top_competitor_name} at {p.top_competitor_visibility_pct:.0f}%)"
        worst_lines.append(line)
    worst_block = "\n".join(worst_lines) if worst_lines else "(no notably losing prompts)"

    return f"""You are a senior consultant at Lumidian, an AI visibility agency. Write 3–5 prescriptive recommendations for {s.business_name}{loc} based on this audit.

Audit summary:
- Overall visibility: {s.overall_visibility_pct:.0f}% (peer avg: {s.peer_avg_visibility_pct:.0f}%)
- Aggregate RVI: {rvi_str} (band: {s.rvi_band})
- Methodology: 10 prompts × 3 models × 3 runs = 90 queries against ChatGPT search, Perplexity, Gemini.

Worst-performing prompts:
{worst_block}

Lumidian's deliverables (use these explicitly when tying each recommendation to "what we'd do"):
- Content clusters — 12+ AI-optimized articles per month grouped into coordinated clusters (LinkedIn + Medium + Reddit + Quora + X around a single topic, briefed from the audit data so each piece reinforces the same cited claims)
- YouTube video AI-readability optimization — we take {s.business_name}'s existing videos, transcribe them, restructure descriptions/captions/chapters so AI models can pull facts from them, and re-publish for citation surface
- Website AI-readability audit — a future engagement to diagnose the highest-impact technical wins on the prospect's site (schema markup, citation surfaces, FAQ structure). REFERENCE THIS AS FUTURE WORK ONLY
- Lumidian platform — a tracking + content-cluster engine the prospect can use themselves (self-serve dashboard) or have our team run for them (done-for-you). Live per-prompt visibility across ChatGPT, Claude, Perplexity, and Gemini; cluster-level attribution showing which articles moved which queries
- Competitor monitoring — flagged within days when a peer publishes AI-citable content in {s.business_name}'s category, surfaced in the dashboard

CRITICAL CONSTRAINTS — read carefully:
1. DO NOT diagnose specific issues on {s.business_name}'s website. We have NOT audited their site. Never claim "missing schema markup", "thin FAQ", "broken citation surfaces", or any other specific technical finding. The website audit is a FUTURE deliverable, not a completed one.
2. If you mention the website audit, phrase it as future work: "A Lumidian website audit would identify..." NOT "Their website has..." or "We found...".
3. You CAN reference the content gaps revealed by the prompt-level data (e.g. "no LASIK cost content is being cited"). You CANNOT extrapolate from those to specific website diagnoses.
4. When referencing Lumidian, frame it as a platform with self-serve OR done-for-you options — not just an agency service.

Write 3–5 recommendations as numbered markdown items. Each one:
- Bold one-line claim (e.g. "**Publish 12 long-form articles on Invisalign in Austin**")
- 2 sentences of justification tied to the actual gap above (name the competitor where relevant)
- Tie to ONE of the specific Lumidian deliverables listed above (mix across them — don't tie every rec to the same deliverable)

Output ONLY the numbered markdown list. No preamble, no closing remarks, no explanation."""


async def _try_model(model: str, prompt: str) -> str | None:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        resp = await client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip() if resp.content else ""
        return text or None
    except Exception as exc:
        logger.warning("recommendations call to %s failed: %s", model, exc)
        return None


async def draft_recommendations(summary: AuditSummaryForRecs) -> str | None:
    """Returns markdown recommendations, or None if all attempts failed.

    PDF render substitutes a static fallback block when this returns None.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    prompt = _system_prompt(summary)
    # Try Sonnet first
    text = await _try_model(_SONNET, prompt)
    if text:
        return text
    # Fallback to Haiku
    return await _try_model(_HAIKU, prompt)
