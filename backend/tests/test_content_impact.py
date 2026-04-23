"""Tests for content hub impact feature — orphan matching, late-attach attribution,
suggestion endpoint. Added 2026-04-23."""

import pytest

from app.services.drafting_service import rank_prompts_by_similarity


class _FakePrompt:
    """Stand-in for app.models.Prompt — we only need `id` and `text`."""
    def __init__(self, id: int, text: str) -> None:
        self.id = id
        self.text = text


def test_rank_identical_texts_scores_one():
    prompts = [_FakePrompt(1, "best ai tools for sales teams")]
    result = rank_prompts_by_similarity("best ai tools for sales teams", prompts)
    assert len(result) == 1
    p, score = result[0]
    assert p.id == 1
    assert score == pytest.approx(1.0)


def test_rank_disjoint_texts_scores_zero():
    prompts = [_FakePrompt(1, "submarine navigation deep ocean")]
    result = rank_prompts_by_similarity("vegetarian recipes weeknight dinner", prompts)
    p, score = result[0]
    assert score == 0.0


def test_rank_partial_overlap_between_zero_and_one():
    prompts = [_FakePrompt(1, "ai tools for sales teams")]
    result = rank_prompts_by_similarity("ai tools help founders ship faster", prompts)
    p, score = result[0]
    assert 0.0 < score < 1.0


def test_rank_orders_multiple_prompts_desc():
    prompts = [
        _FakePrompt(1, "submarine navigation"),
        _FakePrompt(2, "best ai tools for sales"),
        _FakePrompt(3, "ai tools for marketing"),
    ]
    result = rank_prompts_by_similarity("ai tools sales teams", prompts)
    ids_in_order = [p.id for p, _ in result]
    # Prompt 2 is most similar (3 tokens overlap), 3 second, 1 last
    assert ids_in_order[0] == 2
    assert ids_in_order[-1] == 1


def test_rank_ignores_short_tokens_and_stopwords():
    # "a", "to", "of" are stopwords; "ai" is too short (<3 chars).
    # Only "tools" remains on each side — full overlap.
    prompts = [_FakePrompt(1, "a tools of")]
    result = rank_prompts_by_similarity("to tools", prompts)
    p, score = result[0]
    assert score == pytest.approx(1.0)


def test_rank_empty_prompts_returns_empty():
    result = rank_prompts_by_similarity("anything", [])
    assert result == []


def test_rank_empty_draft_text_all_zero():
    prompts = [_FakePrompt(1, "ai tools for sales")]
    result = rank_prompts_by_similarity("", prompts)
    p, score = result[0]
    assert score == 0.0


from app.schemas import UpdateDraftRequest


def test_update_draft_request_accepts_prompt_id():
    req = UpdateDraftRequest(prompt_id=42)
    assert req.prompt_id == 42


def test_update_draft_request_prompt_id_defaults_none():
    req = UpdateDraftRequest(title="new title")
    assert req.prompt_id is None


def test_update_draft_request_prompt_id_rejects_negative():
    with pytest.raises(Exception):
        UpdateDraftRequest(prompt_id=-1)


def test_update_draft_request_all_fields_together():
    req = UpdateDraftRequest(prompt_id=7, status="posted", title="hi")
    assert req.prompt_id == 7
    assert req.status == "posted"
    assert req.title == "hi"
