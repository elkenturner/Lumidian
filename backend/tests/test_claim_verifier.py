"""Claim verifier — strips unsupported factual claims from a draft.

This is a separate pass from the scoring critic in critic.py — its only job
is to delete claims that aren't grounded in the evidence pack. Important on
the brand-as-authority soft-fail path where the source pool is thin.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services.drafting.claim_verifier import verify_claims, _format_sources


def test_format_sources_renders_snippet_when_present():
    sources = [
        {"url": "https://nih.gov/x", "title": "NIH", "snippet": "VOC analysis valid"},
    ]
    out = _format_sources(sources)
    assert "[1] NIH — VOC analysis valid" in out
    assert "https://nih.gov/x" in out


def test_format_sources_falls_back_to_url_only_for_citation_path():
    """Citations-only path has no snippet; verifier still gets URL + title."""
    sources = [{"url": "https://nih.gov/x", "title": "NIH", "snippet": ""}]
    out = _format_sources(sources)
    assert "[1] NIH (https://nih.gov/x)" in out


def test_format_sources_handles_empty():
    out = _format_sources([])
    assert "no sources" in out.lower()


@pytest.mark.asyncio
async def test_verify_claims_returns_cleaned_text_on_success():
    sources = [{"url": "https://nih.gov/x", "title": "NIH", "snippet": "valid"}]
    cleaned_response = "Our breath test is a non-invasive screening option."
    with patch(
        "app.services.drafting.claim_verifier.call_claude",
        new=AsyncMock(return_value=cleaned_response),
    ):
        result = await verify_claims(
            draft_text="Our test detects 94% of cancers with 99% accuracy.",
            sources=sources,
        )
    assert result == cleaned_response


@pytest.mark.asyncio
async def test_verify_claims_returns_original_on_llm_failure():
    """LLM errors must not break the writer pipeline — return draft unchanged."""
    draft = "Original draft body that should survive an LLM error."
    with patch(
        "app.services.drafting.claim_verifier.call_claude",
        new=AsyncMock(side_effect=RuntimeError("API down")),
    ):
        result = await verify_claims(draft_text=draft, sources=[])
    assert result == draft


@pytest.mark.asyncio
async def test_verify_claims_guards_against_overly_short_response():
    """If the LLM truncates the draft to under 30% of its length, keep original."""
    draft = "A reasonably long draft body. " * 20
    with patch(
        "app.services.drafting.claim_verifier.call_claude",
        new=AsyncMock(return_value="too short"),
    ):
        result = await verify_claims(draft_text=draft, sources=[])
    assert result == draft


@pytest.mark.asyncio
async def test_verify_claims_passes_through_empty_input():
    """Empty drafts skip the LLM entirely."""
    with patch(
        "app.services.drafting.claim_verifier.call_claude",
        new=AsyncMock(side_effect=RuntimeError("should not be called")),
    ) as mock:
        result = await verify_claims(draft_text="", sources=[])
        result2 = await verify_claims(draft_text="   ", sources=[])
    mock.assert_not_called()
    assert result == ""
    assert result2 == "   "
