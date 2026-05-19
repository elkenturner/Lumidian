"""Tests for the Wikipedia REST API client wrapper."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.wikipedia.api_client import (
    WIKIPEDIA_USER_AGENT,
    fetch_lead_extract,
    fetch_wikitext_and_sections,
    search_articles,
)


@pytest.mark.asyncio
async def test_search_articles_returns_top_results() -> None:
    body = {
        "query": {
            "search": [
                {"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "Brand visibility…"},
                {"title": "AI search", "pageid": 1002, "snippet": "AI search…"},
            ]
        }
    }
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        results = await search_articles("brand visibility LLM", limit=5)

    assert len(results) == 2
    assert results[0]["title"] == "Brand visibility in LLMs"
    assert results[0]["pageid"] == 1001


@pytest.mark.asyncio
async def test_search_articles_empty() -> None:
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value={"query": {"search": []}})):
        results = await search_articles("nonsense query", limit=5)
    assert results == []


@pytest.mark.asyncio
async def test_fetch_lead_extract() -> None:
    # formatversion=2 returns pages as a list with keys at the top level
    body = {"query": {"pages": [{"pageid": 1001, "title": "Brand visibility in LLMs", "extract": "Brand visibility tracking is…"}]}}
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        result = await fetch_lead_extract(1001)

    assert result is not None
    title, extract = result
    assert title == "Brand visibility in LLMs"
    assert extract.startswith("Brand visibility")


@pytest.mark.asyncio
async def test_fetch_lead_extract_missing_page() -> None:
    body = {"query": {"pages": [{"missing": True, "title": "Nonexistent"}]}}
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        result = await fetch_lead_extract(99999)
    assert result is None


@pytest.mark.asyncio
async def test_fetch_wikitext_and_sections() -> None:
    body = {
        "parse": {
            "wikitext": {"*": "== History ==\nSome history text.\n\n== Methodology ==\nSome methodology."},
            "sections": [
                {"line": "History", "level": "2"},
                {"line": "Methodology", "level": "2"},
            ],
        }
    }
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        wikitext, sections = await fetch_wikitext_and_sections(1001)

    assert "== History ==" in wikitext
    assert sections == ["History", "Methodology"]


def test_user_agent_descriptive() -> None:
    assert "Lumidian" in WIKIPEDIA_USER_AGENT
    assert "lumidian.app" in WIKIPEDIA_USER_AGENT
