"""Claim verification pass — remove unsupported factual claims.

A single Haiku call that reads the draft + the evidence pack and rewrites
the draft to drop any factual claim it can't support from the sources. This
is a SEPARATE pass from the scoring critic in critic.py:
  - critic.py scores draft quality and triggers a rewrite when low
  - this pass removes specific unsupported assertions, no scoring

Used on every paid tier after the writer call, before the pillar-reference
append. Particularly important on the brand-as-authority soft-fail path
where the source pool is the brand's own profile + crawled pages — the
verifier ensures we don't extrapolate claims the brand never actually made.
"""
from __future__ import annotations

import logging

from app.services.drafting.client import call_claude
from app.services.drafting.models import CRITIC_MODEL

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = """You are a fact-checking editor. Read the draft below and the source pack. Rewrite the draft to REMOVE any factual claim that isn't directly supported by at least one source.

Rules:
- A factual claim = a specific statistic, named-entity fact, dated event, or attribution that could be verified.
- Subjective statements, opinions, generic industry knowledge, and the brand's own positioning are NOT factual claims — keep those.
- Do NOT add new claims, sources, or hedging language.
- Do NOT shorten the piece by paraphrasing — only remove unsupported claims, leaving the rest verbatim.
- Preserve the original tone, voice, and structure exactly.
- If the entire draft is unsupported, return the platform-appropriate "removed" placeholder (do NOT invent content).
- If every claim is supported, return the draft unchanged.

SOURCES:
{sources_block}

DRAFT:
{draft_text}

Output the cleaned draft text only — no preamble, no commentary, no markdown fences."""


def _format_sources(sources: list[dict]) -> str:
    """Render the evidence pack as a numbered, snippet-only block."""
    if not sources:
        return "(no sources — every factual claim should be removed)"
    lines: list[str] = []
    for i, s in enumerate(sources, start=1):
        title = s.get("title") or s.get("domain") or s.get("url", "")
        snippet = (s.get("snippet") or "").strip()
        url = s.get("url", "")
        if snippet:
            lines.append(f"[{i}] {title} — {snippet[:400]} ({url})")
        else:
            # Citations-only path has no snippet; surface the URL+title so the
            # verifier knows the SOURCE EXISTED for this topic even without
            # the exact wording.
            lines.append(f"[{i}] {title} ({url})")
    return "\n".join(lines)


async def verify_claims(
    *,
    draft_text: str,
    sources: list[dict],
    model: str = CRITIC_MODEL,
) -> str:
    """Strip unsupported factual claims from the draft.

    Returns the cleaned draft text. On any LLM failure the original draft is
    returned unchanged — the verifier is a quality enhancement, not a hard
    gate. Logs warnings for observability.
    """
    if not draft_text or not draft_text.strip():
        return draft_text
    prompt = _PROMPT_TEMPLATE.format(
        sources_block=_format_sources(sources),
        draft_text=draft_text,
    )
    try:
        cleaned = await call_claude(
            prompt=prompt,
            max_tokens=max(1200, int(len(draft_text) * 1.2)),
            model=model,
        )
    except Exception as exc:
        logger.warning("claim_verifier: LLM call failed — leaving draft unchanged: %s", exc)
        return draft_text

    cleaned = (cleaned or "").strip()
    # Guard against the model returning nothing usable or going off the rails.
    if not cleaned or len(cleaned) < 0.3 * len(draft_text):
        logger.warning(
            "claim_verifier: cleaned text too short (%d → %d chars) — keeping original",
            len(draft_text), len(cleaned),
        )
        return draft_text
    return cleaned
