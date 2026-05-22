"""Identify 3–5 peer brands for a prospect via Claude Haiku.

A competitor is marked is_subject when the audit's generated prompts name it
explicitly (e.g. "alternatives to GRAIL?"). Subject competitors are excluded
from the peer-average denominator in RVI scoring.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

import anthropic

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 800
_MIN_COMPETITORS = 1   # hard fail below this — RVI undefined without peers


@dataclass(frozen=True)
class DetectedCompetitor:
    name: str
    website_url: str | None
    is_subject: bool


def _system_prompt(business_name: str, website_url: str, homepage_excerpt: str) -> str:
    context = f"Business: {business_name} ({website_url})"
    if homepage_excerpt.strip():
        context += f"\nHomepage excerpt:\n{homepage_excerpt.strip()[:2500]}"

    return f"""Identify 3–5 real, well-known competitor brands for this business.

{context}

Return ONLY a valid JSON array. Each item: {{"name": "...", "website": "https://..."}}.

CRITICAL RULES:
- Only real, publicly-known brands. If you are not confident a competitor exists, omit it.
- Brands in the same product category and target market.
- Do NOT include the business itself.
- 3–5 entries. Never more than 5.
- No explanation, no markdown — just the JSON array."""


def _subject_matches_prompt(name: str, prompts: list[str]) -> bool:
    """True if any prompt mentions this competitor by name (case-insensitive)."""
    n = name.strip().lower()
    if len(n) < 3:
        return False
    pattern = re.compile(rf"\b{re.escape(n)}\b", re.IGNORECASE)
    return any(pattern.search(p) for p in prompts)


async def detect_competitors(
    *,
    business_name: str,
    website_url: str,
    homepage_excerpt: str,
    prompts: list[str],
) -> list[DetectedCompetitor]:
    """Returns a non-empty list. Raises RuntimeError if 0 detected or API errors."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    client = anthropic.AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        messages=[{"role": "user", "content": _system_prompt(business_name, website_url, homepage_excerpt)}],
    )
    raw = resp.content[0].text.strip() if resp.content else ""
    m = re.search(r"\[[\s\S]*\]", raw)
    try:
        items = json.loads(m.group() if m else raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise RuntimeError(f"Failed to parse competitor JSON: {exc}") from exc

    if not isinstance(items, list):
        raise RuntimeError("Competitor detection did not return a list")

    out: list[DetectedCompetitor] = []
    for raw_item in items[:5]:
        if not isinstance(raw_item, dict):
            continue
        name = (raw_item.get("name") or "").strip()
        if not name:
            continue
        if name.strip().lower() == business_name.strip().lower():
            continue   # skip self
        website = (raw_item.get("website") or "").strip() or None
        if website and not website.startswith(("http://", "https://")):
            website = "https://" + website
        out.append(DetectedCompetitor(
            name=name,
            website_url=website,
            is_subject=_subject_matches_prompt(name, prompts),
        ))

    if len(out) < _MIN_COMPETITORS:
        raise RuntimeError(f"Could not identify peer brands ({len(out)} found, need ≥{_MIN_COMPETITORS})")
    return out
