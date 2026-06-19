import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit, User
from app.services.prospect_audit.runner import run_audit


async def _make_audit(business_name: str = "Acme", is_local: bool = False, location: str | None = None, prompts: list[str] | None = None) -> int:
    async with AsyncSessionLocal() as db:
        user = User(email=f"staff-{business_name}@x.com", password_hash="x", name="Staff", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()
        a = ProspectAudit(
            staff_user_id=user.id,
            business_name=business_name,
            website_url="https://example.com",
            is_local=is_local,
            location=location,
            prompts=prompts,
        )
        db.add(a)
        await db.commit()
        return a.id


async def _reload(audit_id: int) -> ProspectAudit:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        return result.scalar_one()


@pytest.mark.asyncio
async def test_run_audit_happy_path(tmp_path, monkeypatch):
    """End-to-end happy path with every external call mocked."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)

    audit_id = await _make_audit()

    # Mock all the steps:
    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="example excerpt")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:image/png;base64,xx")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=_fake_queries())), \
         patch("app.services.prospect_audit.runner.draft_recommendations", new=AsyncMock(return_value="1. **Do X**")), \
         patch("app.services.prospect_audit.runner.render_prospect_pdf", new=AsyncMock(return_value=b"%PDF-1.4 fake")):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "completed"
    assert a.overall_visibility_pct is not None
    assert a.aggregate_rvi is not None or a.rvi_band == "dominant"
    assert a.rvi_band in {"dominant", "winning", "even", "losing", "invisible"}
    assert a.pdf_path is not None
    assert (tmp_path / a.pdf_path.split("/")[-1]).exists()
    assert a.completed_at is not None
    assert a.error_message is None


@pytest.mark.asyncio
async def test_run_audit_uses_staff_selected_prompts(tmp_path, monkeypatch):
    """When the audit row carries staff-selected prompts, the runner must use
    those verbatim and never auto-generate."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)

    chosen = ["Best dentist in Austin, TX?", "Cheapest implants near downtown Austin?"]
    audit_id = await _make_audit(prompts=chosen)

    gen_mock = AsyncMock(return_value=[f"Q{i}?" for i in range(10)])
    run_q_mock = AsyncMock(return_value=_fake_queries())

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="excerpt")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=gen_mock), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=run_q_mock), \
         patch("app.services.prospect_audit.runner.draft_recommendations", new=AsyncMock(return_value="1. **Do X**")), \
         patch("app.services.prospect_audit.runner.render_prospect_pdf", new=AsyncMock(return_value=b"%PDF")):
        await run_audit(audit_id)

    gen_mock.assert_not_called()
    assert run_q_mock.call_args.kwargs["prompts"] == chosen

    a = await _reload(audit_id)
    assert a.status == "completed"


@pytest.mark.asyncio
async def test_run_audit_fails_when_anthropic_key_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value=None)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "failed"
    assert a.error_message and "prompts" in a.error_message.lower()


@pytest.mark.asyncio
async def test_run_audit_cancels_mid_run(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    async def cancel_during_queries(*args, **kwargs):
        # Simulate the user hitting cancel while queries are in flight
        raise asyncio.CancelledError()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(side_effect=cancel_during_queries)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "canceled"


@pytest.mark.asyncio
async def test_run_audit_continues_when_recommendations_fail(tmp_path, monkeypatch):
    """Recommendations are non-fatal — PDF uses fallback block but audit completes."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=_fake_queries())), \
         patch("app.services.prospect_audit.runner.draft_recommendations", new=AsyncMock(return_value=None)), \
         patch("app.services.prospect_audit.runner.render_prospect_pdf", new=AsyncMock(return_value=b"%PDF")):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "completed"   # non-fatal


@pytest.mark.asyncio
async def test_run_audit_fails_on_too_many_query_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    # All queries error
    errored = [
        {"prompt_index": pi, "model": m, "run": r, "response_text": "", "mentioned": False, "latency_ms": 0, "error": "boom"}
        for pi in range(10) for m in ("chatgpt", "perplexity", "gemini") for r in (1, 2, 3)
    ]

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=errored)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "failed"
    assert "query" in a.error_message.lower() or "fail" in a.error_message.lower()


def _fake_competitors():
    from app.services.prospect_audit.competitor_detect import DetectedCompetitor
    return [
        DetectedCompetitor(name="CompA", website_url="https://a.com", is_subject=False),
        DetectedCompetitor(name="CompB", website_url="https://b.com", is_subject=False),
    ]


def _fake_queries():
    """10 prompts × 3 models × 3 runs = 90 results, with own mentioned in some."""
    results = []
    for pi in range(10):
        for m in ("chatgpt", "perplexity", "gemini"):
            for r in (1, 2, 3):
                results.append({
                    "prompt_index": pi,
                    "model": m,
                    "run": r,
                    "response_text": f"text about Acme {pi}",
                    "mentioned": pi % 2 == 0,
                    "latency_ms": 100,
                    "error": None,
                })
    return results
