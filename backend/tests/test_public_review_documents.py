"""Tests for the public client review document endpoints (no auth)."""
from __future__ import annotations

import pytest

from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientDocument, ClientReviewLink


async def _setup(client_name: str = "DocsClient") -> tuple[str, int, int]:
    """Returns (token, client_id, doc_id)."""
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=client_name, slug=client_name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        Brand_ = Brand(name=client_name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="agency")
        db.add(Brand_)
        link = ClientReviewLink(agency_client_id=ac.id, token=f"tok-docs-{ac.slug}")
        db.add(link)
        doc = ClientDocument(
            agency_client_id=ac.id,
            kind="sow",
            title=f"SOW — {client_name}",
            body_markdown="# SOW\n\n## 1. Engagement Summary\n\nx\n",
        )
        db.add(doc)
        await db.commit()
        return link.token, ac.id, doc.id


@pytest.mark.asyncio
async def test_list_documents_invalid_token_returns_404(client):
    resp = await client.get("/api/public/review/does-not-exist/documents")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_documents_returns_only_this_clients_docs(client):
    token, client_id, doc_id = await _setup("AClient")
    other_token, _, other_doc_id = await _setup("BClient")

    resp = await client.get(f"/api/public/review/{token}/documents")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    ids = [d["id"] for d in body]
    assert doc_id in ids
    assert other_doc_id not in ids
    for d in body:
        assert "kind" in d
        assert "title" in d
        assert "generated_at" in d


@pytest.mark.asyncio
async def test_list_documents_empty_when_no_docs(client):
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name="Empty", slug="empty")
        db.add(ac)
        await db.flush()
        link = ClientReviewLink(agency_client_id=ac.id, token="tok-empty")
        db.add(link)
        await db.commit()

    resp = await client.get("/api/public/review/tok-empty/documents")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_document_html_returns_rendered_html(client):
    token, _, doc_id = await _setup("HtmlClient")
    resp = await client.get(f"/api/public/review/{token}/document/{doc_id}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "<!DOCTYPE html>" in body
    assert "HtmlClient" in body


@pytest.mark.asyncio
async def test_get_document_html_rejects_doc_from_other_client(client):
    token_a, _, _ = await _setup("AAA")
    _, _, doc_b = await _setup("BBB")
    resp = await client.get(f"/api/public/review/{token_a}/document/{doc_b}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_document_pdf_returns_pdf_bytes(client):
    token, _, doc_id = await _setup("PdfClient")
    resp = await client.get(f"/api/public/review/{token}/document/{doc_id}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"


@pytest.mark.asyncio
async def test_get_document_pdf_rejects_doc_from_other_client(client):
    token_a, _, _ = await _setup("PdfA")
    _, _, doc_b = await _setup("PdfB")
    resp = await client.get(f"/api/public/review/{token_a}/document/{doc_b}/pdf")
    assert resp.status_code == 404
