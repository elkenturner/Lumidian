"""Generate 10 high-value AI-visibility tracking prompts for a prospect.

For local businesses, prompts must be geographically anchored — include the
city name explicitly in roughly half, and use "near me"-style framing in others.
"""
from __future__ import annotations

import json
import logging
import os
import re

import anthropic

logger = logging.getLogger(__name__)

_MIN_PROMPTS_REQUIRED = 10
_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 1500


def _system_prompt(business_name: str, website_url: str, homepage_excerpt: str, location: str | None) -> str:
    context = f"Business name: {business_name}\nWebsite: {website_url}"
    if homepage_excerpt.strip():
        context += f"\nHomepage content (excerpt):\n{homepage_excerpt.strip()[:3000]}"

    if location:
        geo_block = f"""
This is a LOCAL business in {location}. EVERY prompt must be geographically sensitive:
- Include "{location}" or the city name explicitly in at least half of the prompts
- Use "near me", "in {location}", or similar framing in the rest
- DO NOT generate generic prompts — every question must be one a person physically near {location} would ask"""
    else:
        geo_block = ""

    return f"""You generate AI visibility tracking prompts for businesses. Find the real queries a potential customer types into ChatGPT/Perplexity/Gemini when researching solutions — NOT looking up a specific brand.

{context}
{geo_block}

Return ONLY a valid JSON array of exactly {_MIN_PROMPTS_REQUIRED} strings — no explanation, no markdown.
EVERY prompt MUST be phrased as a question and end with "?".

Mix of intents:
- Category queries ("best X")
- Comparison queries ("X vs Y")
- Problem-seeking queries ("how do I...")
- Buying-decision queries ("worth it", "alternatives")

NEVER include the business name "{business_name}" in any question.
Avoid duplicates — each of the {_MIN_PROMPTS_REQUIRED} prompts must explore a distinct angle."""


async def generate_prompts(
    *,
    business_name: str,
    website_url: str,
    homepage_excerpt: str,
    location: str | None,
) -> list[str]:
    """Generate the 10 audit prompts. Raises RuntimeError on failure."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    msg = _system_prompt(business_name, website_url, homepage_excerpt, location)
    client = anthropic.AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        messages=[{"role": "user", "content": msg}],
    )

    raw = resp.content[0].text.strip() if resp.content else ""
    m = re.search(r"\[[\s\S]*\]", raw)
    try:
        items = json.loads(m.group() if m else raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise RuntimeError(f"Failed to parse prompt JSON: {exc}") from exc

    if not isinstance(items, list):
        raise RuntimeError("Prompt generation did not return a list")

    cleaned: list[str] = []
    for s in items:
        if not isinstance(s, str):
            continue
        s = s.strip()
        if not s:
            continue
        if not s.endswith("?"):
            s += "?"
        cleaned.append(s)

    if len(cleaned) < _MIN_PROMPTS_REQUIRED - 2:   # tolerate 8 — 9 hard failures fall here
        raise RuntimeError(f"Only {len(cleaned)} valid prompts returned, need at least {_MIN_PROMPTS_REQUIRED - 1}")

    return cleaned[:_MIN_PROMPTS_REQUIRED]
