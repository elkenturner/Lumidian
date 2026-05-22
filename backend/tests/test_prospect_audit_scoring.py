"""Pure unit tests for prospect-audit RVI scoring math."""
import pytest

from app.services.prospect_audit.scoring import (
    PromptScore,
    QueryRecord,
    CompetitorRecord,
    score_prompt,
    aggregate_audit,
    band_for_rvi,
)


def _q(model: str, run: int, mentioned: bool, error: str | None = None) -> QueryRecord:
    return QueryRecord(model=model, run=run, response_text="" if error else "x", mentioned=mentioned, error=error)


def test_band_thresholds():
    assert band_for_rvi(2.5) == "dominant"
    assert band_for_rvi(2.0) == "dominant"
    assert band_for_rvi(1.9) == "winning"
    assert band_for_rvi(1.2) == "winning"
    assert band_for_rvi(1.0) == "even"
    assert band_for_rvi(0.8) == "even"
    assert band_for_rvi(0.79) == "losing"
    assert band_for_rvi(0.2) == "losing"
    assert band_for_rvi(0.19) == "invisible"
    assert band_for_rvi(0.0) == "invisible"


def test_score_prompt_normal_case():
    queries = [_q("chatgpt", 1, True), _q("chatgpt", 2, False), _q("perplexity", 1, True)]
    comp_mentions = {
        1: [True, False, True],   # competitor 1 mentioned in 2/3
        2: [False, False, True],  # competitor 2 mentioned in 1/3
    }
    competitors = [CompetitorRecord(id=1, is_subject=False), CompetitorRecord(id=2, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    # own = 2/3 = 66.67%
    assert score.own_visibility_pct == pytest.approx(66.67, abs=0.01)
    # peer_avg = (66.67 + 33.33) / 2 = 50%
    assert score.peer_avg_visibility_pct == pytest.approx(50.0, abs=0.01)
    # rvi = 66.67 / 50 = 1.33 → winning
    assert score.rvi == pytest.approx(1.33, abs=0.01)
    assert score.rvi_band == "winning"


def test_score_prompt_subject_excluded():
    queries = [_q("chatgpt", 1, False)]
    comp_mentions = {
        1: [True],   # subject — should be excluded
        2: [False],
    }
    competitors = [
        CompetitorRecord(id=1, is_subject=True),
        CompetitorRecord(id=2, is_subject=False),
    ]
    score = score_prompt(queries, comp_mentions, competitors)
    # peer_avg uses only competitor 2 = 0%
    assert score.peer_avg_visibility_pct == 0.0
    # own=0, peer_avg=0 → even (both absent)
    assert score.rvi == 1.0
    assert score.rvi_band == "even"


def test_score_prompt_dominant_band():
    queries = [_q("chatgpt", 1, True), _q("perplexity", 1, True)]
    comp_mentions = {1: [False, False]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    assert score.own_visibility_pct == 100.0
    assert score.peer_avg_visibility_pct == 0.0
    # own>0, peer_avg=0 → rvi=None, band="dominant"
    assert score.rvi is None
    assert score.rvi_band == "dominant"


def test_score_prompt_invisible_band():
    queries = [_q("chatgpt", 1, False)]
    comp_mentions = {1: [True]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    assert score.own_visibility_pct == 0.0
    assert score.peer_avg_visibility_pct == 100.0
    assert score.rvi == 0.0
    assert score.rvi_band == "invisible"


def test_score_prompt_query_errors_excluded():
    queries = [
        _q("chatgpt", 1, False, error=None),
        _q("chatgpt", 2, True, error="timeout"),   # excluded from denom
    ]
    comp_mentions = {1: [False, True]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    # Only 1 non-error query, own not mentioned
    assert score.own_visibility_pct == 0.0
    # Competitor mentioned in same query (after error filtering)
    assert score.peer_avg_visibility_pct == 0.0


def test_aggregate_ignores_infinite_band_rows():
    p1 = PromptScore(prompt_index=0, own_visibility_pct=100.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="dominant")
    p2 = PromptScore(prompt_index=1, own_visibility_pct=20.0, peer_avg_visibility_pct=80.0, rvi=0.25, rvi_band="losing")
    p3 = PromptScore(prompt_index=2, own_visibility_pct=50.0, peer_avg_visibility_pct=50.0, rvi=1.0, rvi_band="even")
    overall_vis, agg_rvi, band = aggregate_audit([p1, p2, p3], total_queries=30, mention_count=17)
    # overall = 17/30 * 100
    assert overall_vis == pytest.approx(56.67, abs=0.01)
    # agg_rvi = (0.25 + 1.0) / 2 = 0.625 — p1 excluded since rvi is None
    assert agg_rvi == pytest.approx(0.625, abs=0.001)
    assert band == "losing"


def test_aggregate_no_finite_rvi():
    p = PromptScore(prompt_index=0, own_visibility_pct=100.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="dominant")
    overall_vis, agg_rvi, band = aggregate_audit([p], total_queries=3, mention_count=3)
    # Only dominant prompts → aggregate_rvi=None, band=dominant
    assert overall_vis == 100.0
    assert agg_rvi is None
    assert band == "dominant"


def test_aggregate_no_queries():
    overall_vis, agg_rvi, band = aggregate_audit([], total_queries=0, mention_count=0)
    assert overall_vis == 0.0
    assert agg_rvi is None
    assert band == "invisible"
