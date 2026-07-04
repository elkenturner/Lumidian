"""Serper rate-limit handling for the cluster evidence pipeline.

Regression test for the silent-fail cascade: Serper returns HTTP 400 with body
'Query not allowed. Contact support.' under burst load, the old _serper_search
swallowed it as an empty list, and the gate then aborted clusters with
'insufficient_T1_sources: found 0' instead of surfacing the throttling.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class _StubResponse:
    def __init__(self, status_code: int, json_data: dict | None = None,
                 text: str = "") -> None:
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self) -> dict:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            from httpx import HTTPStatusError, Request, Response
            raise HTTPStatusError(
                f"status {self.status_code}",
                request=Request("POST", "https://google.serper.dev/search"),
                response=Response(self.status_code),
            )


class _StubAsyncClient:
    """Fake httpx.AsyncClient that returns pre-canned responses in order."""

    def __init__(self, responses: list[_StubResponse]) -> None:
        self._responses = list(responses)
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def post(self, *args, **kwargs) -> _StubResponse:
        self.calls += 1
        if not self._responses:
            raise RuntimeError("no more stub responses")
        return self._responses.pop(0)


@pytest.fixture
def serper_env(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")


@pytest.mark.asyncio
async def test_serper_retries_on_query_not_allowed(serper_env, monkeypatch):
    """A 'Query not allowed' 400 must be retried with backoff, not swallowed."""
    from app.services.drafting import evidence

    responses = [
        _StubResponse(400, text="Query not allowed. Contact support."),
        _StubResponse(400, text="Query not allowed. Contact support."),
        _StubResponse(
            200,
            json_data={"organic": [{"link": "https://reuters.com/a", "title": "A", "snippet": "..."}]},
        ),
    ]
    client = _StubAsyncClient(responses)

    monkeypatch.setattr(evidence, "SERPER_RETRY_DELAYS", (0.0, 0.0, 0.0))

    def _client_factory(*args, **kwargs):
        return client

    with patch("httpx.AsyncClient", side_effect=_client_factory):
        results = await evidence._serper_search("q")

    assert client.calls == 3
    assert len(results) == 1
    assert results[0]["link"] == "https://reuters.com/a"


@pytest.mark.asyncio
async def test_serper_returns_empty_after_exhausting_retries(serper_env, monkeypatch):
    """If every retry hits the rate limit, return [] (don't crash the pack)."""
    from app.services.drafting import evidence

    responses = [
        _StubResponse(400, text="Query not allowed. Contact support.")
        for _ in range(4)
    ]
    client = _StubAsyncClient(responses)

    monkeypatch.setattr(evidence, "SERPER_RETRY_DELAYS", (0.0, 0.0, 0.0))

    with patch("httpx.AsyncClient", side_effect=lambda *a, **k: client):
        results = await evidence._serper_search("q")

    assert results == []
    assert client.calls == 4  # initial attempt + 3 retries


@pytest.mark.asyncio
async def test_serper_does_not_retry_on_generic_400(serper_env, monkeypatch):
    """Non-rate-limit errors are NOT retried — preserve original behavior."""
    from app.services.drafting import evidence

    responses = [_StubResponse(400, text="Malformed JSON body")]
    client = _StubAsyncClient(responses)

    monkeypatch.setattr(evidence, "SERPER_RETRY_DELAYS", (0.0, 0.0, 0.0))

    with patch("httpx.AsyncClient", side_effect=lambda *a, **k: client):
        results = await evidence._serper_search("q")

    assert results == []
    assert client.calls == 1


@pytest.mark.asyncio
async def test_serper_treats_429_as_rate_limit(serper_env, monkeypatch):
    """HTTP 429 from Serper also triggers retry path."""
    from app.services.drafting import evidence

    responses = [
        _StubResponse(429, text="Too Many Requests"),
        _StubResponse(
            200,
            json_data={"organic": [{"link": "https://reuters.com/a", "title": "A", "snippet": "..."}]},
        ),
    ]
    client = _StubAsyncClient(responses)

    monkeypatch.setattr(evidence, "SERPER_RETRY_DELAYS", (0.0, 0.0, 0.0))

    with patch("httpx.AsyncClient", side_effect=lambda *a, **k: client):
        results = await evidence._serper_search("q")

    assert len(results) == 1
    assert client.calls == 2


# ---------------------------------------------------------------------------
# Task 9: rate-limit becomes a distinct, retryable failure in the cluster path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_serper_search_raises_when_flagged(serper_env, monkeypatch):
    """All attempts rate-limited + raise_on_rate_limit=True -> SerperRateLimitError."""
    from app.services.drafting import evidence
    from app.services.drafting.evidence import SerperRateLimitError

    responses = [
        _StubResponse(400, text="Query not allowed. Contact support.")
        for _ in range(4)
    ]
    client = _StubAsyncClient(responses)

    monkeypatch.setattr(evidence, "SERPER_RETRY_DELAYS", (0.0, 0.0, 0.0))

    with patch("httpx.AsyncClient", side_effect=lambda *a, **k: client):
        with pytest.raises(SerperRateLimitError):
            await evidence._serper_search("q", raise_on_rate_limit=True)

    assert client.calls == 4  # initial attempt + 3 retries, still exhausted


@pytest.mark.asyncio
async def test_cluster_pack_reports_search_unavailable(monkeypatch):
    """fetch_and_dedupe hits rate limit on every query and citations are empty ->
    build_cluster_pack raises SearchUnavailableError (not PackGateError)."""
    from app.database import AsyncSessionLocal
    from app.models import ContentCluster
    from app.services.cluster_evidence import (
        SearchUnavailableError,
        SerperRateLimitError,
        build_cluster_pack,
    )
    from tests.conftest import _seed_minimal_user_brand_prompt

    async def fake_serper(query, num=10, raise_on_rate_limit=False):
        raise SerperRateLimitError(f"Serper rate-limited for {query!r}")

    async with AsyncSessionLocal() as db:
        cluster_id, _prompt_id = await _seed_minimal_user_brand_prompt(
            db, slug="search-unavail-pack",
        )

    with patch("app.services.cluster_evidence._serper_search", side_effect=fake_serper):
        async with AsyncSessionLocal() as db:
            cluster = await db.get(ContentCluster, cluster_id)
            with pytest.raises(SearchUnavailableError):
                await build_cluster_pack(
                    db, cluster=cluster, prompt_text="best CRM",
                    key_claims=[], version=1,
                )


@pytest.mark.asyncio
async def test_regenerate_cluster_marks_search_unavailable(monkeypatch):
    """Cluster ends briefing_failed with failure_reason.startswith('search_unavailable')."""
    from app.database import AsyncSessionLocal
    from app.models import ContentCluster
    from app.services import cluster_evidence
    from app.services.clustering_service import regenerate_cluster
    from tests.conftest import _seed_minimal_user_brand_prompt

    async def fake_fetch(queries):
        raise cluster_evidence.SearchUnavailableError(
            "search_unavailable: Serper rate-limited on 1/1 queries"
        )
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({
            "positioning": "p", "key_claims": [], "canonical_phrasings": [],
            "stats": [], "narrative_spine": "", "tone_notes": "",
        })
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        cluster_id, _prompt_id = await _seed_minimal_user_brand_prompt(
            db, slug="search-unavail-regen",
        )

    async with AsyncSessionLocal() as db:
        await regenerate_cluster(db, cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert cluster.failure_reason is not None
        assert cluster.failure_reason.startswith("search_unavailable")
