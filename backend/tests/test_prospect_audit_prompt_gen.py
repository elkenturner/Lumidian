from unittest.mock import AsyncMock, patch
import json

import pytest

from app.services.prospect_audit.prompt_gen import generate_prompts


def _mock_claude(text: str):
    """Helper to build an anthropic-style response object."""
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


@pytest.mark.asyncio
async def test_generate_prompts_returns_ten():
    fake_json = json.dumps([f"Question {i}?" for i in range(10)])
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await generate_prompts(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="We make widgets",
            location=None,
        )
    assert len(result) == 10
    assert all(q.endswith("?") for q in result)


@pytest.mark.asyncio
async def test_generate_prompts_local_includes_location_in_system_prompt():
    fake_json = json.dumps([f"Q{i}?" for i in range(10)])
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        await generate_prompts(
            business_name="Acme Dental",
            website_url="https://acme.com",
            homepage_excerpt="dentist",
            location="Austin, TX",
        )
    # Check the system prompt sent to Claude mentioned the location
    call_kwargs = fake_create.await_args.kwargs
    msg_text = call_kwargs["messages"][0]["content"]
    assert "Austin, TX" in msg_text
    assert "geographically" in msg_text.lower() or "local" in msg_text.lower()


@pytest.mark.asyncio
async def test_generate_prompts_fails_on_too_few():
    fake_json = json.dumps(["Q1?", "Q2?", "Q3?"])   # only 3
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        with pytest.raises(RuntimeError, match="prompts"):
            await generate_prompts(
                business_name="Acme",
                website_url="https://acme.com",
                homepage_excerpt="",
                location=None,
            )


@pytest.mark.asyncio
async def test_generate_prompts_missing_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await generate_prompts(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="",
            location=None,
        )
