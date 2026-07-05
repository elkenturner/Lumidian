"""Tests for cluster_evidence.enrich_pack_snippets — full-text snippet upgrade.

Every fetch is mocked at `app.services.cluster_evidence.httpx.AsyncClient` so
these tests never touch the network.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.cluster_evidence import enrich_pack_snippets


def _mock_async_client(get_return_value=None, get_side_effect=None):
    """Build a factory standing in for `httpx.AsyncClient`, supporting the
    `async with httpx.AsyncClient(...) as client: await client.get(url)`
    pattern used by the enricher. Returns (factory, client) so tests can
    assert on `client.get.call_count` / `assert_not_called`.
    """
    client = MagicMock()
    if get_side_effect is not None:
        client.get = AsyncMock(side_effect=get_side_effect)
    else:
        client.get = AsyncMock(return_value=get_return_value)

    client_cm = MagicMock()
    client_cm.__aenter__ = AsyncMock(return_value=client)
    client_cm.__aexit__ = AsyncMock(return_value=False)

    factory = MagicMock(return_value=client_cm)
    return factory, client


def _resp(html: str, content_type: str = "text/html; charset=utf-8") -> MagicMock:
    resp = MagicMock()
    resp.text = html
    resp.headers = {"content-type": content_type}
    return resp


@pytest.mark.asyncio
async def test_snippet_upgraded_from_page_text():
    html = "<html><head><title>Page</title></head><body><p>" + ("word " * 500) + "</p></body></html>"
    factory, client = _mock_async_client(get_return_value=_resp(html))
    sources = [{"url": "https://example.com/a", "title": "t", "snippet": "short"}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources, max_chars=100)

    assert len(out[0]["snippet"]) == 100
    assert out[0]["snippet"] != "short"
    assert "word" in out[0]["snippet"]


@pytest.mark.asyncio
async def test_placeholder_title_replaced_from_page_title():
    html = "<html><head><title>  Real Page Title  </title></head><body><p>content</p></body></html>"
    factory, client = _mock_async_client(get_return_value=_resp(html))
    sources = [{"url": "https://example.com/a", "title": "(cited by AI for this prompt)", "snippet": ""}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    assert out[0]["title"] == "Real Page Title"


@pytest.mark.asyncio
async def test_empty_title_replaced_from_page_title():
    html = "<html><head><title>Fetched Title</title></head><body><p>content</p></body></html>"
    factory, client = _mock_async_client(get_return_value=_resp(html))
    sources = [{"url": "https://example.com/a", "title": "", "snippet": ""}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    assert out[0]["title"] == "Fetched Title"


@pytest.mark.asyncio
async def test_fetch_exception_leaves_source_untouched():
    factory, client = _mock_async_client(get_side_effect=ConnectionError("boom"))
    original = {"url": "https://example.com/a", "title": "t", "snippet": "s"}
    sources = [dict(original)]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    assert out[0] == original


@pytest.mark.asyncio
async def test_internal_url_skipped_no_fetch_attempted():
    factory, client = _mock_async_client(get_return_value=_resp("<html></html>"))
    sources = [{"url": "internal://brand-profile", "title": "t", "snippet": "s"}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    client.get.assert_not_called()
    assert out[0]["snippet"] == "s"
    assert out[0]["title"] == "t"


@pytest.mark.asyncio
async def test_shorter_fetched_text_keeps_existing_snippet():
    long_existing = "x" * 500
    html = "<html><body><p>short</p></body></html>"
    factory, client = _mock_async_client(get_return_value=_resp(html))
    sources = [{"url": "https://example.com/a", "title": "t", "snippet": long_existing}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    assert out[0]["snippet"] == long_existing


# ---------------------------------------------------------------------------
# _persist_pack integration — every pack path benefits from enrichment
# ---------------------------------------------------------------------------

from app.database import AsyncSessionLocal  # noqa: E402
from app.models import Brand, ContentCluster, Prompt, User  # noqa: E402
from app.services.cluster_evidence import _persist_pack  # noqa: E402


@pytest.mark.asyncio
async def test_persist_pack_enriches_snippets_before_saving():
    html = (
        "<html><head><title>Enriched Title</title></head>"
        "<body><p>" + ("word " * 500) + "</p></body></html>"
    )
    factory, client = _mock_async_client(get_return_value=_resp(html))

    async with AsyncSessionLocal() as db:
        user = User(email="enrich@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-enrich-test", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        pack_sources = [
            {
                "url": "https://example.com/a",
                "title": "(cited by AI for this prompt)",
                "snippet": "",
                "domain": "example.com",
                "tier": "T3",
            },
        ]

        with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
            pack = await _persist_pack(
                db, cluster=cluster, pack_sources=pack_sources, version=1,
            )

    assert len(pack.sources[0]["snippet"]) > 0
    assert pack.sources[0]["title"] == "Enriched Title"


@pytest.mark.asyncio
async def test_non_html_content_type_skipped():
    """A PDF response must never replace a snippet with decoded binary garbage."""
    factory, client = _mock_async_client(get_return_value=_resp("%PDF-1.7 " + "x " * 4000, content_type="application/pdf"))
    sources = [{"url": "https://ex.gov/opinion.pdf", "title": "Slip opinion", "snippet": "Good snippet."}]

    with patch("app.services.cluster_evidence.httpx.AsyncClient", factory):
        out = await enrich_pack_snippets(sources)

    assert out[0]["snippet"] == "Good snippet."
    assert out[0]["title"] == "Slip opinion"
