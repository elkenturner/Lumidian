from unittest.mock import AsyncMock, patch
import json

import pytest

from app.services.prospect_audit.competitor_detect import detect_competitors, DetectedCompetitor


def _mock_claude(text: str):
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


@pytest.mark.asyncio
async def test_detect_competitors_returns_list():
    payload = json.dumps([
        {"name": "GRAIL", "website": "https://grail.com"},
        {"name": "Freenome", "website": "https://freenome.com"},
        {"name": "Delfi", "website": "https://delfi.com"},
    ])
    fake_create = AsyncMock(return_value=_mock_claude(payload))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await detect_competitors(
            business_name="Spot It Early",
            website_url="https://spotitearly.com",
            homepage_excerpt="early cancer detection",
            prompts=["best cancer screening test?"],
        )
    assert len(result) == 3
    assert all(isinstance(c, DetectedCompetitor) for c in result)
    assert result[0].name == "GRAIL"
    assert all(not c.is_subject for c in result)


@pytest.mark.asyncio
async def test_detect_competitors_flags_subject_when_named_in_prompts():
    payload = json.dumps([
        {"name": "GRAIL", "website": "https://grail.com"},
        {"name": "Freenome", "website": "https://freenome.com"},
    ])
    fake_create = AsyncMock(return_value=_mock_claude(payload))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await detect_competitors(
            business_name="Spot It Early",
            website_url="https://spotitearly.com",
            homepage_excerpt="",
            prompts=["alternatives to GRAIL?", "best cancer screening?"],
        )
    by_name = {c.name: c for c in result}
    assert by_name["GRAIL"].is_subject is True
    assert by_name["Freenome"].is_subject is False


@pytest.mark.asyncio
async def test_detect_competitors_fails_on_zero():
    fake_create = AsyncMock(return_value=_mock_claude("[]"))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        with pytest.raises(RuntimeError, match="peer"):
            await detect_competitors(
                business_name="Acme",
                website_url="https://acme.com",
                homepage_excerpt="",
                prompts=["test?"],
            )


@pytest.mark.asyncio
async def test_detect_competitors_missing_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await detect_competitors(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="",
            prompts=["t?"],
        )
