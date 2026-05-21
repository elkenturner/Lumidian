from unittest.mock import patch

import pytest

from app.services.cluster_evidence import expand_queries, fetch_and_dedupe


def test_expand_queries_uses_prompt_and_claims():
    queries = expand_queries(
        prompt_text="best CRM for solo founders",
        key_claims=["Notion bundles tasks and docs", "HubSpot has a free tier"],
    )
    assert "best CRM for solo founders" in queries
    # Each claim becomes its own search query
    assert any("Notion bundles" in q for q in queries)
    assert any("HubSpot" in q for q in queries)
    # Capped at 5
    assert 1 <= len(queries) <= 5


def test_expand_queries_dedupes():
    queries = expand_queries(
        prompt_text="best CRM",
        key_claims=["best CRM", "best CRM"],
    )
    assert len(queries) == 1


@pytest.mark.asyncio
async def test_fetch_and_dedupe_drops_dupes_across_queries():
    fake_results = {
        "q1": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        ],
        "q2": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},  # dup
            {"url": "https://oecd.org/c", "title": "C", "snippet": "..."},
        ],
    }

    async def fake_serper(query: str, num: int = 10):
        return fake_results[query]

    with patch("app.services.cluster_evidence._serper_search", side_effect=fake_serper):
        merged = await fetch_and_dedupe(["q1", "q2"])

    urls = [m["url"] for m in merged]
    assert urls.count("https://reuters.com/a") == 1
    assert "https://nytimes.com/b" in urls
    assert "https://oecd.org/c" in urls
