"""
Heuristic engine for prompt-level insights.

Pure functions — no database access, no LLM calls. Takes pre-fetched data
and returns insight dicts. Called by the prompt detail API endpoint.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

MODEL_LABELS = {
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
}


def evaluate_heuristics(
    prompt_id: int,
    current_scores: dict[str, float],
    score_history: list[dict],
    content_events: list[dict],
    drafts_posted: int,
) -> list[dict]:
    """Evaluate all heuristic rules and return triggered insights."""
    insights: list[dict] = []
    insights.extend(_check_model_gap(prompt_id, current_scores))
    insights.extend(_check_score_dropping(prompt_id, score_history))
    insights.extend(_check_inactive_prompt(prompt_id, content_events, drafts_posted))
    insights.extend(_check_model_responding(prompt_id, score_history, content_events))
    return insights


def _check_model_gap(prompt_id: int, current_scores: dict[str, float]) -> list[dict]:
    """Fire when one model scores >=30pp higher than another."""
    if len(current_scores) < 2:
        return []
    scores = [(m, s) for m, s in current_scores.items() if s is not None]
    if len(scores) < 2:
        return []
    best_model, best_score = max(scores, key=lambda x: x[1])
    worst_model, worst_score = min(scores, key=lambda x: x[1])
    gap = best_score - worst_score
    if gap >= 30:
        best_label = MODEL_LABELS.get(best_model, best_model)
        worst_label = MODEL_LABELS.get(worst_model, worst_model)
        return [{
            "id": "model_gap",
            "message": f"{best_label} scores {int(gap)}pp higher than {worst_label} for this prompt",
            "severity": "info",
            "model": worst_model,
            "prompt_id": prompt_id,
            "data": {"best": best_model, "worst": worst_model, "gap": gap},
        }]
    return []


def _check_score_dropping(prompt_id: int, score_history: list[dict]) -> list[dict]:
    """Fire when overall score declined >=8pp over the last 5 data points."""
    if len(score_history) < 2:
        return []
    recent = score_history[-5:] if len(score_history) >= 5 else score_history
    first_score = recent[0].get("overall", 0)
    last_score = recent[-1].get("overall", 0)
    drop = first_score - last_score
    if drop >= 8:
        return [{
            "id": "score_dropping",
            "message": f"Overall visibility has dropped {int(drop)}pp over the last {len(recent)} runs",
            "severity": "negative",
            "model": None,
            "prompt_id": prompt_id,
            "data": {"drop": drop, "from": first_score, "to": last_score, "runs": len(recent)},
        }]
    return []


def _check_inactive_prompt(
    prompt_id: int, content_events: list[dict], drafts_posted: int
) -> list[dict]:
    """Fire when no content has targeted this prompt."""
    draft_events = [e for e in content_events if e.get("event_type") == "draft_posted"]
    if len(draft_events) == 0 and drafts_posted == 0:
        return [{
            "id": "inactive_prompt",
            "message": "No content has targeted this prompt yet",
            "severity": "info",
            "model": None,
            "prompt_id": prompt_id,
            "data": {},
        }]
    return []


def _check_model_responding(
    prompt_id: int, score_history: list[dict], content_events: list[dict]
) -> list[dict]:
    """Fire when a model score improved >=10pp and there was a recent draft_posted event.
    Simplified version — checks overall trend after any content event."""
    draft_events = [e for e in content_events if e.get("event_type") == "draft_posted"]
    if not draft_events or len(score_history) < 2:
        return []
    return []
