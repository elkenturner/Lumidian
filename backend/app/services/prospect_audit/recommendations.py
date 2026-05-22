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

Lumidian's deliverables: 12+ AI-optimized long-form drafts per month posted across LinkedIn, Medium, Reddit, Quora, X; weekly AI visibility tracking; site-audit + schema fixes; competitor monitoring.

Write 3–5 recommendations as numbered markdown items. Each one:
- Bold one-line claim (e.g. "**Publish 12 long-form articles on Invisalign in Austin**")
- 2 sentences of justification tied to the actual gap above (name the competitor where relevant)
- Tie to a specific Lumidian deliverable

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
