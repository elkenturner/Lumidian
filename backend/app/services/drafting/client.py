"""
LLM client for the drafting service.
"""
from __future__ import annotations

import os

# Cap a single Claude HTTP call. Without this the Anthropic SDK default is
# ~10 min, which lets a stuck request freeze the cluster orchestrator (see
# regression in services/clustering_service.py and routers/content.py).
CLAUDE_HTTP_TIMEOUT_SECONDS = 120.0


async def call_claude(
    prompt: str,
    max_tokens: int = 2500,
    model: str = "claude-sonnet-4-6",
) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. "
            "Add your key in Settings to enable draft generation."
        )
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=CLAUDE_HTTP_TIMEOUT_SECONDS)
    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text if response.content else ""
