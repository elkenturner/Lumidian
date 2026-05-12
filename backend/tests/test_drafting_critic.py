import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.drafting.evidence import EvidencePack, EvidenceSource


def _pack():
    return EvidencePack(
        sources=[EvidenceSource(ref="S1", kind="web", url="https://x", title="t", snippet="s")],
        query="q", brand_name="b",
    )


@pytest.mark.asyncio
async def test_critic_parses_tool_use_response():
    from app.services.drafting.critic import critic_score, CriticScore

    fake_tool_input = {
        "claim_density": 6,
        "citation_coverage": 5,
        "query_mirroring": 8,
        "concrete_specificity": 6,
        "voice_authenticity": 7,
        "overall_score": 6.2,
        "flagged_paragraphs": [
            {"index": 1, "issue": "claim_density", "note": "needs S1"},
        ],
    }

    fake_response = MagicMock()
    block = MagicMock()
    block.type = "tool_use"
    block.input = fake_tool_input
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        result: CriticScore = await critic_score(
            draft_text="Para 1.\n\nPara 2.",
            pack=_pack(),
            query="q",
            platform="medium",
        )
    assert result.overall_score == pytest.approx(6.2, abs=0.01)
    assert len(result.flagged_paragraphs) == 1
    assert result.flagged_paragraphs[0]["index"] == 1


@pytest.mark.asyncio
async def test_critic_recomputes_overall_when_inconsistent():
    from app.services.drafting.critic import critic_score, WEIGHTS

    fake_tool_input = {
        "claim_density": 4, "citation_coverage": 4, "query_mirroring": 4,
        "concrete_specificity": 4, "voice_authenticity": 4,
        "overall_score": 10.0, "flagged_paragraphs": [],
    }
    fake_response = MagicMock()
    block = MagicMock()
    block.type = "tool_use"
    block.input = fake_tool_input
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        result = await critic_score(
            draft_text="Para 1.", pack=_pack(), query="q", platform="medium",
        )
    expected = sum(WEIGHTS[k] * 4 for k in WEIGHTS)
    assert result.overall_score == pytest.approx(expected, abs=0.01)
