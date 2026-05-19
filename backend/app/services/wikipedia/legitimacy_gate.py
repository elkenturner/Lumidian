"""LLM legitimacy gate — scores whether a brand could legitimately cite a Wikipedia article."""
from __future__ import annotations

import json
import logging

from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

LEGITIMACY_THRESHOLD = 0.55

_PROMPT_TEMPLATE = """You are reviewing whether {brand_name} could legitimately add a neutral, citation-backed contribution to this Wikipedia article.

Article: {article_title}
Article summary: {article_summary}

Brand:
{profile_block}

A LEGITIMATE candidate (score ≥ 0.6):
- The article topic substantively overlaps with the brand's domain expertise.
- The brand could supply a neutral fact or cite-worthy claim, not promotional copy.
- The brand is NOT the article's subject (we never edit our own article).

ILLEGITIMATE (score < 0.5):
- The brand is the article's subject or a direct competitor.
- The article topic is unrelated to brand expertise.
- Any plausible contribution would read as marketing.

Output strict JSON only — no markdown fences, no prose:
{{"score": <float 0..1>, "reasoning": "<one sentence>"}}"""


async def _call_llm(prompt: str) -> str:
    """Thin wrapper for test mocking."""
    return (await call_claude(prompt=prompt, max_tokens=200, model=CROSS_REF_SUMMARY_MODEL)).strip()


def _parse(raw: str) -> tuple[float, str]:
    s = raw.strip()
    if s.startswith("```"):
        parts = s.split("```")
        s = parts[1].lstrip("json").strip() if len(parts) >= 2 else s
    try:
        data = json.loads(s)
        return float(data.get("score", 0.0)), str(data.get("reasoning", ""))
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.warning("Legitimacy gate returned unparseable output: %s", raw[:120])
        return 0.0, "Unparseable LLM response."


async def score_candidate(
    *,
    brand_name: str,
    profile_block: str,
    article_title: str,
    article_summary: str,
) -> tuple[float, str]:
    """Return (score in [0,1], one-sentence reasoning)."""
    prompt = _PROMPT_TEMPLATE.format(
        brand_name=brand_name,
        profile_block=profile_block,
        article_title=article_title,
        article_summary=article_summary[:800],
    )
    raw = await _call_llm(prompt)
    return _parse(raw)
