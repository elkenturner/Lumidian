"""
Critic + rewriter for the drafting pipeline.

After the first-draft Claude call, this module:
  1. Runs a structured tool-use critic call returning per-dimension scores
  2. If overall score < REWRITE_THRESHOLD, rewrites only the flagged paragraphs
  3. If overall score < HARD_FAIL, signals that the whole draft should be regenerated
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from app.services.drafting.evidence import EvidencePack
from app.services.drafting.models import CRITIC_MODEL, rewriter_model_for_tier

logger = logging.getLogger(__name__)

WEIGHTS: dict[str, float] = {
    "claim_density":        0.25,
    "citation_coverage":    0.25,
    "concrete_specificity": 0.20,
    "voice_authenticity":   0.20,
    "query_mirroring":      0.10,
}
REWRITE_THRESHOLD = 7.0
HARD_FAIL = 4.0
INCONSISTENCY_TOLERANCE = 0.5


@dataclass
class CriticScore:
    claim_density: int
    citation_coverage: int
    query_mirroring: int
    concrete_specificity: int
    voice_authenticity: int
    overall_score: float
    flagged_paragraphs: list[dict[str, Any]] = field(default_factory=list)

    @property
    def hard_fail(self) -> bool:
        return self.overall_score < HARD_FAIL

    @property
    def needs_rewrite(self) -> bool:
        return self.overall_score < REWRITE_THRESHOLD


_CRITIC_TOOL = {
    "name": "score_draft",
    "description": "Score a draft along five dimensions and return flagged paragraphs.",
    "input_schema": {
        "type": "object",
        "properties": {
            "claim_density":        {"type": "integer", "minimum": 0, "maximum": 10},
            "citation_coverage":    {"type": "integer", "minimum": 0, "maximum": 10},
            "query_mirroring":      {"type": "integer", "minimum": 0, "maximum": 10},
            "concrete_specificity": {"type": "integer", "minimum": 0, "maximum": 10},
            "voice_authenticity":   {"type": "integer", "minimum": 0, "maximum": 10},
            "overall_score":        {"type": "number"},
            "flagged_paragraphs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer"},
                        "issue": {"type": "string"},
                        "note":  {"type": "string"},
                    },
                    "required": ["index", "issue", "note"],
                },
            },
        },
        "required": ["claim_density", "citation_coverage", "query_mirroring",
                     "concrete_specificity", "voice_authenticity",
                     "overall_score", "flagged_paragraphs"],
    },
}


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key)


def _build_critic_prompt(draft_text: str, pack: EvidencePack, query: str, platform: str) -> str:
    sources_block = "\n".join(
        f"[{s.ref}] {s.title} — {s.url}\n     \"{s.snippet}\""
        for s in pack.sources
    ) or "(no evidence sources were provided)"

    return f"""You are a strict editor scoring a draft on five dimensions.

TARGET QUERY:
"{query}"

PLATFORM: {platform}

EVIDENCE SOURCES that were available to the writer:
{sources_block}

DRAFT (paragraphs separated by blank lines, 0-indexed):
{draft_text}

Score the draft along these 5 dimensions, 0-10 each:
- claim_density: how many specific, citable claims per paragraph (vs vague filler)
- citation_coverage: % of paragraphs that include at least one [SN] citation
- query_mirroring: does the first sentence + key noun phrases mirror the target query
- concrete_specificity: precise stats and named approaches vs vague statements ("very effective")
- voice_authenticity: human, varied, non-AI tone vs AI-tells (hedging, triple parallels, generic openers)

Compute overall_score as the weighted average using these weights:
  claim_density=0.25, citation_coverage=0.25, concrete_specificity=0.20,
  voice_authenticity=0.20, query_mirroring=0.10.

flagged_paragraphs: list each paragraph (by 0-based index) that has a fixable issue, with the issue name and a one-sentence note saying what should change. Be specific (e.g. "ground the 'breath analysis' claim in [S2] or remove it").

Output ONLY through the score_draft tool. No prose."""


async def critic_score(
    draft_text: str,
    pack: EvidencePack,
    query: str,
    platform: str,
) -> CriticScore:
    client = _anthropic_client()
    response = await client.messages.create(
        model=CRITIC_MODEL,
        max_tokens=400,
        tools=[_CRITIC_TOOL],
        tool_choice={"type": "tool", "name": "score_draft"},
        messages=[{"role": "user", "content": _build_critic_prompt(draft_text, pack, query, platform)}],
    )

    tool_input: dict[str, Any] | None = None
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input
            break
    if tool_input is None:
        raise ValueError("Critic did not return a tool_use block")

    score = CriticScore(
        claim_density=int(tool_input["claim_density"]),
        citation_coverage=int(tool_input["citation_coverage"]),
        query_mirroring=int(tool_input["query_mirroring"]),
        concrete_specificity=int(tool_input["concrete_specificity"]),
        voice_authenticity=int(tool_input["voice_authenticity"]),
        overall_score=float(tool_input["overall_score"]),
        flagged_paragraphs=list(tool_input.get("flagged_paragraphs", [])),
    )

    # Defensive: if the critic's overall_score drifts from the weighted sum, recompute.
    computed = (
        WEIGHTS["claim_density"]        * score.claim_density +
        WEIGHTS["citation_coverage"]    * score.citation_coverage +
        WEIGHTS["concrete_specificity"] * score.concrete_specificity +
        WEIGHTS["voice_authenticity"]   * score.voice_authenticity +
        WEIGHTS["query_mirroring"]      * score.query_mirroring
    )
    if abs(score.overall_score - computed) > INCONSISTENCY_TOLERANCE:
        logger.info("Critic overall_score %.2f differs from weighted sum %.2f — using weighted.",
                    score.overall_score, computed)
        score.overall_score = round(computed, 2)
    return score


# ── Paragraph-scoped rewriter ───────────────────────────────────────────────

_PARAGRAPH_DELIMITER = "---PARAGRAPH---"


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def _build_rewrite_prompt(
    draft_text: str,
    flagged: list[dict[str, Any]],
    pack: EvidencePack,
    query: str,
    platform: str,
) -> str:
    paras = _split_paragraphs(draft_text)
    indexed = "\n\n".join(f"[Paragraph {i}]\n{p}" for i, p in enumerate(paras))
    flagged_block = "\n".join(
        f"- Paragraph {f['index']}: {f.get('issue', 'issue')} — {f.get('note', '')}"
        for f in flagged
    )
    sources_block = "\n".join(
        f"[{s.ref}] {s.title} — {s.url}\n     \"{s.snippet}\""
        for s in pack.sources
    ) or "(no evidence sources were provided)"

    return f"""You are rewriting flagged paragraphs of an existing draft. The full draft is shown for context — but you must only return the REPLACEMENT paragraphs.

TARGET QUERY: "{query}"
PLATFORM: {platform}

EVIDENCE SOURCES (use [SN] markers, no inventions):
{sources_block}

FULL DRAFT (read-only — for context):
{indexed}

PARAGRAPHS TO REWRITE (in this exact order):
{flagged_block}

INSTRUCTIONS:
- Return ONLY the replacement paragraphs.
- Separate paragraphs with the delimiter line:  {_PARAGRAPH_DELIMITER}
- Return the same number of paragraphs as flagged, in the same order.
- Each replacement must address its specific issue: claim_density → add concrete claims with [SN] citations; citation_coverage → add [SN] citations to existing claims; voice_authenticity → remove AI-tells and vary sentence rhythm; concrete_specificity → replace vague language with precise figures; query_mirroring → echo the target query's key noun phrases.
- If a claim cannot be backed by one of the EVIDENCE SOURCES, remove the claim rather than hedging.
- No analysis, no headers, no labels. Just the paragraphs and the delimiter.

OUTPUT:"""


async def rewrite_flagged(
    draft_text: str,
    flagged: list[dict[str, Any]],
    pack: EvidencePack,
    query: str,
    platform: str,
    tier: str | None,
) -> str:
    if not flagged:
        return draft_text

    model = rewriter_model_for_tier(tier)
    client = _anthropic_client()
    response = await client.messages.create(
        model=model,
        max_tokens=2000,
        messages=[{"role": "user", "content": _build_rewrite_prompt(draft_text, flagged, pack, query, platform)}],
    )
    raw_text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            raw_text = block.text
            break
    if not raw_text:
        return draft_text

    replacements = [p.strip() for p in raw_text.split(_PARAGRAPH_DELIMITER) if p.strip()]
    paras = _split_paragraphs(draft_text)

    for offset, flag in enumerate(flagged):
        idx = flag.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(paras):
            continue
        if offset >= len(replacements):
            continue
        paras[idx] = replacements[offset]

    return "\n\n".join(paras)


# ── Hard-fail handling ──────────────────────────────────────────────────────

def should_hard_retry(score: CriticScore) -> bool:
    return score.hard_fail


def pick_better(
    a: tuple[str, CriticScore],
    b: tuple[str, CriticScore],
) -> tuple[str, CriticScore]:
    """Return whichever draft has the higher overall_score."""
    return a if a[1].overall_score >= b[1].overall_score else b
