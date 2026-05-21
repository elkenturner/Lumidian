import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.citation_critic import critique_citations


@pytest.mark.asyncio
async def test_keeps_supported_markers():
    fake_response = json.dumps({"markers": [
        {"original": "S1", "action": "keep"},
        {"original": "S2", "action": "keep"},
    ]})
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value=fake_response)):
        out = await critique_citations(
            text="The widget grew 47% [S1] and the market doubled [S2].",
            pack_sources=[
                {"url": "https://reuters.com/a", "tier": "T1", "snippet": "widget grew 47%"},
                {"url": "https://nytimes.com/b", "tier": "T1", "snippet": "market doubled"},
            ],
        )
    assert "[S1]" in out
    assert "[S2]" in out


@pytest.mark.asyncio
async def test_drops_unsupported_marker():
    fake_response = json.dumps({"markers": [
        {"original": "S1", "action": "drop", "reason": "snippet does not support claim"},
        {"original": "S2", "action": "keep"},
    ]})
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value=fake_response)):
        out = await critique_citations(
            text="The widget grew 47% [S1] and the market doubled [S2].",
            pack_sources=[
                {"url": "https://reuters.com/a", "tier": "T1", "snippet": "unrelated content"},
                {"url": "https://nytimes.com/b", "tier": "T1", "snippet": "market doubled"},
            ],
        )
    assert "[S1]" not in out
    assert "[S2]" in out


@pytest.mark.asyncio
async def test_returns_original_on_malformed_response():
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value="garbage")):
        out = await critique_citations(
            text="X [S1] Y [S2]",
            pack_sources=[{"url": "u", "tier": "T1", "snippet": "..."}] * 2,
        )
    # Conservative fallback: original text returned unmodified
    assert out == "X [S1] Y [S2]"
