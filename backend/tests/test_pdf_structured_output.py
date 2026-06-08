"""Tests for structured-JSON LLM output."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel

from app.services.document_engine.structured_output import (
    LLMJSONError,
    request_structured_output,
)


class SampleOutput(BaseModel):
    current_state: str
    gaps: list[str]


@pytest.mark.asyncio
async def test_returns_validated_model(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = '{"current_state": "Doing fine", "gaps": ["one", "two"]}'
    fake_response = MagicMock()
    fake_response.content = [fake_content]

    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    out = await request_structured_output(
        system_prompt="You produce JSON.",
        user_prompt="Generate.",
        schema=SampleOutput,
    )
    assert isinstance(out, SampleOutput)
    assert out.current_state == "Doing fine"
    assert out.gaps == ["one", "two"]


@pytest.mark.asyncio
async def test_raises_on_invalid_json(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = "not json at all"
    fake_response = MagicMock()
    fake_response.content = [fake_content]
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)
    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    with pytest.raises(LLMJSONError):
        await request_structured_output(
            system_prompt="You produce JSON.",
            user_prompt="Generate.",
            schema=SampleOutput,
        )


@pytest.mark.asyncio
async def test_raises_on_schema_mismatch(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = '{"current_state": 42}'   # wrong type + missing field
    fake_response = MagicMock()
    fake_response.content = [fake_content]
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)
    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    with pytest.raises(LLMJSONError):
        await request_structured_output(
            system_prompt="x", user_prompt="y", schema=SampleOutput,
        )
