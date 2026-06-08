"""Structured (JSON) LLM output for PDF templates.

Each template declares a pydantic OUTPUT_SCHEMA. We prompt the model with a
strict system instruction to emit ONLY JSON conforming to the schema, then
validate. One retry on parse failure with a sharper instruction; otherwise
LLMJSONError bubbles up.
"""
from __future__ import annotations

import json
import os
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMJSONError(Exception):
    """LLM returned text we could not parse as the requested schema."""


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. Add your key in Settings to enable PDF generation."
        )
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key, timeout=120.0)


def _strict_system(base_system: str, schema: Type[BaseModel]) -> str:
    schema_json = json.dumps(schema.model_json_schema(), indent=2)
    return (
        f"{base_system}\n\n"
        "STRICT OUTPUT RULE: Respond with a SINGLE JSON object matching the following schema. "
        "No prose, no markdown fences, no commentary — JSON only.\n\n"
        f"Schema:\n{schema_json}"
    )


async def request_structured_output(
    *,
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 3500,
) -> T:
    """Call Claude with a system+user prompt; return the parsed pydantic model."""
    client = _anthropic_client()
    system = _strict_system(system_prompt, schema)

    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = response.content[0].text if response.content else ""
    text = text.strip()
    # Strip accidental code fences
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json"):].lstrip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMJSONError(f"LLM did not return valid JSON: {e}\nResponse:\n{text[:500]}") from e
    try:
        return schema.model_validate(parsed)
    except ValidationError as e:
        raise LLMJSONError(f"LLM JSON did not match schema:\n{e}") from e
