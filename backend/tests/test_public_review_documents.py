"""Tests for the public client review document endpoints (no auth)."""
from __future__ import annotations

import json
import pytest

from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientDocument, ClientReviewLink


# Minimal SOW data_snapshot that satisfies the typst template.
# The `output` dict must match SowOutput fields exactly.
_SOW_SNAPSHOT = json.dumps({
    "client": {
        "name": "TestClient",
        "primary_contact_name": "Jane Smith",
        "primary_contact_email": "jane@example.com",
        "retainer_amount_usd": 3000,
        "retainer_started_at": None,
    },
    "brand": {"name": "TestCo", "website_url": "https://test.com"},
    "brand_profile": {"company_description": "A test company."},
    "today": "June 8, 2026",
    "output": {
        "sow_number": "SOW-2026-0001",
        "preamble": "We will improve AI visibility for TestCo.",
        "scope": "Weekly tracking, drafting, and reporting.",
        "deliverables": ["8 LinkedIn drafts/mo"],
        "exclusions": ["Paid advertising"],
        "timeline": "Month-to-month engagement.",
        "fees": "USD 3,000/month, Net 30.",
    },
    "charts": {},
    "generated_at": "Jun 08, 2026",
    "generated_by": None,
})


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
            body_markdown="",
            data_snapshot=_SOW_SNAPSHOT,
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
    # Typst docs have no body_markdown — show a PDF-download placeholder
    assert "SOW" in body or "PDF" in body


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
