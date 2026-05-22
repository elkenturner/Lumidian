"""RVI (Relative Visibility Index) math for prospect audits.

RVI = own_visibility_pct / peer_avg_visibility_pct.
Peer group = detected competitors, excluding any flagged is_subject.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QueryRecord:
    """A single LLM query result held in memory during a prospect-audit run."""
    model: str           # "chatgpt" | "perplexity" | "gemini"
    run: int             # 1, 2, or 3
    response_text: str   # may be empty on error
    mentioned: bool      # own brand mentioned (exact or fuzzy)
    error: str | None


@dataclass(frozen=True)
class CompetitorRecord:
    id: int              # in-memory id (1..N) per audit run
    is_subject: bool     # True if the prompt is "alternative to X" and this competitor IS X


@dataclass(frozen=True)
class PromptScore:
    prompt_index: int
    own_visibility_pct: float
    peer_avg_visibility_pct: float
    rvi: float | None         # None when peer_avg == 0 and own > 0 (band='dominant')
    rvi_band: str             # dominant | winning | even | losing | invisible


_BAND_THRESHOLDS = (
    (2.0, "dominant"),
    (1.2, "winning"),
    (0.8, "even"),
    (0.2, "losing"),
    (0.0, "invisible"),
)


def band_for_rvi(rvi: float) -> str:
    """Return the band label for a finite RVI value."""
    for threshold, band in _BAND_THRESHOLDS:
        if rvi >= threshold:
            return band
    return "invisible"


def score_prompt(
    queries: list[QueryRecord],
    competitor_mentions: dict[int, list[bool]],
    competitors: list[CompetitorRecord],
) -> PromptScore:
    """Compute own_visibility, peer_avg_visibility, and RVI for one prompt.

    Args:
        queries: All query results for this prompt (3 models × 3 runs = 9 in the happy path).
        competitor_mentions: Map from competitor.id to a list[bool] aligned with queries[i].
            Errored queries are filtered using queries[i].error before the mention list is consumed.
        competitors: All competitors detected for this audit.
    """
    # Filter out errored queries from BOTH the own-visibility numerator/denominator
    # and the competitor-mention arrays.
    valid_indices = [i for i, q in enumerate(queries) if q.error is None]
    if not valid_indices:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=0.0,
            peer_avg_visibility_pct=0.0,
            rvi=1.0,
            rvi_band="even",
        )

    valid_queries = [queries[i] for i in valid_indices]
    total = len(valid_queries)
    own_hits = sum(1 for q in valid_queries if q.mentioned)
    own_pct = (own_hits / total) * 100.0

    peer_competitors = [c for c in competitors if not c.is_subject]
    if peer_competitors:
        peer_pcts: list[float] = []
        for c in peer_competitors:
            full = competitor_mentions.get(c.id, [False] * len(queries))
            valid_mentions = [full[i] for i in valid_indices]
            peer_pcts.append((sum(1 for m in valid_mentions if m) / total) * 100.0)
        peer_avg_pct = sum(peer_pcts) / len(peer_pcts)
    else:
        peer_avg_pct = 0.0

    if peer_avg_pct == 0.0 and own_pct > 0.0:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=round(own_pct, 2),
            peer_avg_visibility_pct=0.0,
            rvi=None,
            rvi_band="dominant",
        )
    if peer_avg_pct == 0.0 and own_pct == 0.0:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=0.0,
            peer_avg_visibility_pct=0.0,
            rvi=1.0,
            rvi_band="even",
        )

    rvi = own_pct / peer_avg_pct
    return PromptScore(
        prompt_index=0,
        own_visibility_pct=round(own_pct, 2),
        peer_avg_visibility_pct=round(peer_avg_pct, 2),
        rvi=round(rvi, 3),
        rvi_band=band_for_rvi(rvi),
    )


def aggregate_audit(
    prompt_scores: list[PromptScore],
    total_queries: int,
    mention_count: int,
) -> tuple[float, float | None, str]:
    """Compute audit-level visibility%, aggregate RVI, and band.

    aggregate_rvi = arithmetic mean of finite per-prompt RVIs.
    If all prompts are dominant (rvi=None), aggregate_rvi=None and band='dominant'.
    If no prompts at all, returns (0, None, 'invisible').

    Returns (overall_visibility_pct, aggregate_rvi, rvi_band).
    """
    if total_queries == 0:
        return 0.0, None, "invisible"

    overall_pct = round((mention_count / total_queries) * 100.0, 2)

    finite = [p.rvi for p in prompt_scores if p.rvi is not None]
    if finite:
        agg = round(sum(finite) / len(finite), 3)
        return overall_pct, agg, band_for_rvi(agg)

    # No finite RVI rows. If any prompt has a band, prefer 'dominant' (won the prompts we could score)
    # over 'invisible' (only when nothing was scored at all).
    if any(p.rvi_band == "dominant" for p in prompt_scores):
        return overall_pct, None, "dominant"
    return overall_pct, None, "invisible"
