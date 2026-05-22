"""Generate 10 high-value AI-visibility tracking prompts for a prospect.

For local businesses, EVERY prompt must contain the explicit city name —
"near me" and "in my area" don't anchor for AI search engines and return
generic results, which makes the audit useless for local prospects.
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
        # First token of location is usually the city ("Austin" from "Austin, TX")
        city = location.split(",")[0].strip() or location
        geo_block = f"""
This is a LOCAL business in {location}. CRITICAL: every single prompt MUST include the literal text "{location}" OR "{city}" — by name.

AI search engines (ChatGPT, Perplexity, Gemini) cannot anchor "near me" or "in my area" to a specific city. Generic geo phrasing returns empty or non-local results, which makes the audit useless. The prompt MUST name the city.

REQUIRED phrasing examples:
  ✓ "Best LASIK surgery clinic in {location}?"
  ✓ "Where to find Invisalign treatment in {city}?"
  ✓ "How much does dental implant surgery cost in {location}?"
  ✓ "{city} dermatologists who specialize in acne treatment?"

FORBIDDEN phrasing:
  ✗ "Best dentist near me?"  (unanchored)
  ✗ "LASIK clinics in my area?"  (unanchored)
  ✗ "Dental implants nearby?"  (unanchored)

Every one of the {_MIN_PROMPTS_REQUIRED} prompts must contain "{location}" or "{city}". If you generate even one prompt without explicit city naming, the audit fails."""
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

    # For local prospects, drop any prompts that don't actually mention the city.
    # The system prompt forbids this but Claude occasionally slips up — better
    # to have 8 city-anchored prompts than 10 mixed.
    if location:
        city = location.split(",")[0].strip().lower() or location.lower()
        loc_lower = location.lower()
        anchored = [
            s for s in cleaned
            if city in s.lower() or loc_lower in s.lower()
        ]
        if len(anchored) >= _MIN_PROMPTS_REQUIRED - 2:
            cleaned = anchored
        # If too many were dropped, keep the original list — better to have
        # some non-anchored prompts than fail the audit outright.

    return cleaned[:_MIN_PROMPTS_REQUIRED]
