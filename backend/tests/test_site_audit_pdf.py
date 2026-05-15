"""Tests for the site audit PDF endpoint."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand,
    User,
    WebsiteAudit,
    WebsiteAuditRecommendation,
)
from app.services.site_audit.pdf_renderer import _score_to_letter, _md_to_html
from tests.conftest import register_and_login


# ── Unit tests ────────────────────────────────────────────────────────────────


def test_score_to_letter():
    assert _score_to_letter(95) == ("A", "good")
    assert _score_to_letter(80) == ("B", "good")
    assert _score_to_letter(75) == ("C", "ok")
    assert _score_to_letter(60) == ("D", "ok")
    assert _score_to_letter(40) == ("F", "bad")
    assert _score_to_letter(None) == ("—", "")


def test_md_to_html_empty():
    assert _md_to_html("") == ""
    assert _md_to_html(None) == ""


def test_md_to_html_paragraph():
    out = _md_to_html("Hello **world**.")
    assert "<p>" in out
    assert "<strong>world</strong>" in out


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _make_user_with_brand(client, email: str = "audit@example.com") -> tuple[int, int]:
    """Register a user and create a brand owned by them. Returns (user_id, brand_id)."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        brand = Brand(
            name="Test Site",
            slug=f"test-site-{user.id}",
            user_id=user.id,
            tier="basic",
            brand_type="standard",
            website_url="https://test-site.example.com",
        )
        db.add(brand)
        await db.commit()
        await db.refresh(brand)
        return user.id, brand.id


async def _insert_completed_audit(brand_id: int, with_recs: bool = True) -> int:
    """Insert a completed audit with optional recommendations. Returns audit_id."""
    from datetime import datetime

    async with AsyncSessionLocal() as db:
        audit = WebsiteAudit(
            brand_id=brand_id,
            status="completed",
            triggered_by="manual",
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            total_pages=12,
            pages_failed=0,
            overall_score=72.0,
            bot_access_score=85.0,
            content_score=68.0,
            schema_score=60.0,
            technical_score=80.0,
            render_mode="server",
            llms_txt_present=False,
            llms_txt_valid=False,
        )
        db.add(audit)
        await db.flush()

        if with_recs:
            db.add(
                WebsiteAuditRecommendation(
                    audit_id=audit.id,
                    priority="high",
                    effort="low",
                    category="schema",
                    title="Add Organization JSON-LD",
                    body="Paste the Organization schema block on every page.",
                    expected_impact="+8pp visibility",
                    target_url="https://test-site.example.com/",
                    artifact='{"@context": "https://schema.org", "@type": "Organization"}',
                    artifact_type="jsonld",
                    priority_score=0.92,
                    status="pending",
                    llm_generated=False,
                )
            )
            db.add(
                WebsiteAuditRecommendation(
                    audit_id=audit.id,
                    priority="medium",
                    effort="medium",
                    category="content",
                    title="Increase fact density on /blog",
                    body="Add 2-3 concrete stats per paragraph.",
                    target_url="https://test-site.example.com/blog",
                    priority_score=0.62,
                    status="pending",
                    llm_generated=True,
                )
            )

        await db.commit()
        return audit.id


# ── Endpoint tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_pdf_returns_pdf_bytes(client):
    _uid, bid = await _make_user_with_brand(client)
    audit_id = await _insert_completed_audit(bid)
    resp = await client.get(f"/api/site-audit/audit/{audit_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    body = resp.content
    assert body[:4] == b"%PDF", f"Bytes do not start with PDF magic: {body[:20]!r}"


@pytest.mark.asyncio
async def test_audit_pdf_unknown_id_404(client):
    _uid, _bid = await _make_user_with_brand(client, email="audit2@example.com")
    resp = await client.get("/api/site-audit/audit/99999/pdf")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_audit_pdf_other_user_brand_denied(client):
    """User A's audit should not be accessible to user B."""
    _uid_a, bid_a = await _make_user_with_brand(client, email="audit3a@example.com")
    audit_id = await _insert_completed_audit(bid_a)
    # Log out user A and log in as user B
    await client.post("/api/auth/logout")
    await register_and_login(client, email="audit3b@example.com")
    resp = await client.get(f"/api/site-audit/audit/{audit_id}/pdf")
    # _ensure_brand_access raises 403 (or 404, depending on implementation)
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_audit_pdf_with_no_recommendations(client):
    """Audit with zero recs should still render — just no fix list."""
    _uid, bid = await _make_user_with_brand(client, email="audit4@example.com")
    audit_id = await _insert_completed_audit(bid, with_recs=False)
    resp = await client.get(f"/api/site-audit/audit/{audit_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.content[:4] == b"%PDF"
