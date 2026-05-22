from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.recommendations import (
    AuditSummaryForRecs,
    PromptInsight,
    draft_recommendations,
)


def _mock_claude(text: str):
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


def _summary() -> AuditSummaryForRecs:
    return AuditSummaryForRecs(
        business_name="Acme Dental",
        location="Austin, TX",
        overall_visibility_pct=18.0,
        peer_avg_visibility_pct=52.0,
        aggregate_rvi=0.35,
        rvi_band="losing",
        worst_prompts=[
            PromptInsight(
                prompt_text="best dentist in Austin?",
                own_visibility_pct=11.0,
                peer_avg_visibility_pct=89.0,
                rvi=0.12,
                top_competitor_name="Brilliant Smile",
                top_competitor_visibility_pct=92.0,
            ),
        ],
    )


@pytest.mark.asyncio
async def test_draft_recommendations_uses_sonnet_first():
    fake_sonnet = AsyncMock(return_value=_mock_claude("1. **Publish 12 articles** — because reasons."))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_sonnet
        result = await draft_recommendations(_summary())
    assert result is not None
    assert "Publish" in result
    # Confirm the sonnet model was used
    call_kwargs = fake_sonnet.await_args.kwargs
    assert "sonnet" in call_kwargs["model"].lower()


@pytest.mark.asyncio
async def test_draft_recommendations_falls_back_to_haiku_on_sonnet_failure():
    sonnet_then_haiku = AsyncMock(side_effect=[
        Exception("sonnet down"),
        _mock_claude("1. **Fallback rec** — body."),
    ])
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = sonnet_then_haiku
        result = await draft_recommendations(_summary())
    assert result is not None
    assert "Fallback" in result
    # Two calls — sonnet then haiku
    assert sonnet_then_haiku.await_count == 2


@pytest.mark.asyncio
async def test_draft_recommendations_returns_none_when_both_fail():
    boom = AsyncMock(side_effect=Exception("both down"))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = boom
        result = await draft_recommendations(_summary())
    assert result is None


@pytest.mark.asyncio
async def test_draft_recommendations_no_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = await draft_recommendations(_summary())
    assert result is None
