"""Tests for the LLM legitimacy gate."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.wikipedia.legitimacy_gate import LEGITIMACY_THRESHOLD, score_candidate


@pytest.mark.asyncio
async def test_score_candidate_parses_strict_json() -> None:
    raw = '{"score": 0.82, "reasoning": "Article topic overlaps with brand domain."}'
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value=raw)):
        score, reasoning = await score_candidate(
            brand_name="Acme",
            profile_block="Name: Acme\nDescription: Tracks LLM citations",
            article_title="Brand visibility in LLMs",
            article_summary="A discipline focused on…",
        )
    assert score == pytest.approx(0.82)
    assert "overlaps" in reasoning


@pytest.mark.asyncio
async def test_score_candidate_strips_markdown_fences() -> None:
    raw = '```json\n{"score": 0.6, "reasoning": "ok"}\n```'
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value=raw)):
        score, reasoning = await score_candidate(
            brand_name="Acme", profile_block="x", article_title="T", article_summary="S",
        )
    assert score == pytest.approx(0.6)


@pytest.mark.asyncio
async def test_score_candidate_handles_garbage() -> None:
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value="totally not json")):
        score, reasoning = await score_candidate(
            brand_name="Acme", profile_block="x", article_title="T", article_summary="S",
        )
    assert score == 0.0
    assert "unparseable" in reasoning.lower()


def test_threshold_is_in_range() -> None:
    assert 0.0 < LEGITIMACY_THRESHOLD < 1.0
