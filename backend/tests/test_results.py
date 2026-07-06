"""
Tests for:
  GET /api/results/{brand_id}/overview    — latest run stats + model breakdown
  GET /api/results/{brand_id}/trends      — all completed runs
  GET /api/results/{brand_id}/responses   — paginated query results
  GET /api/reports/{brand_id}/export      — PDF download
"""
from __future__ import annotations

from datetime import UTC

import httpx
import pytest

from app.database import AsyncSessionLocal
from app.models import QueryResult, RunModelScore, TrackingRun
from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _insert_completed_run(
    brand_id: int,
    prompt_id: int,
    *,
    overall_score: float = 75.0,
    model: str = "chatgpt",
) -> int:
    """Insert a completed TrackingRun with one QueryResult and one RunModelScore.
    Returns the run id."""
    from datetime import datetime
    async with AsyncSessionLocal() as db:
        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            overall_score=overall_score,
            total_queries=1,
            total_mentions=1,
            has_content_influence=False,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            completed_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.add(run)
        await db.flush()

        qr = QueryResult(
            tracking_run_id=run.id,
            prompt_id=prompt_id,
            model=model,
            run_number=1,
            response_text="Lumidian is a great tool for AI visibility tracking.",
            mentioned=True,
        )
        db.add(qr)

        ms = RunModelScore(
            tracking_run_id=run.id,
            model=model,
            total_queries=1,
            total_mentions=1,
            score=overall_score,
        )
        db.add(ms)

        await db.commit()
        return run.id


# ── Overview ──────────────────────────────────────────────────────────────────

async def test_overview_no_runs(client: httpx.AsyncClient):
    """Overview returns nulls when no completed runs exist."""
    await register_and_login(client, email="ov_empty@example.com")
    brand = await create_brand(client, name="OV Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_id"] == brand["id"]
    assert data["latest_run"] is None
    assert data["overall_score"] is None
    assert data["model_breakdown"] == []


async def test_overview_returns_latest_run(client: httpx.AsyncClient):
    """Overview returns score and model breakdown from the most recent completed run."""
    await register_and_login(client, email="ov_run@example.com")
    brand = await create_brand(
        client,
        name="OV Run Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=80.0)

    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["overall_score"] == pytest.approx(80.0, abs=0.1)
    assert data["latest_run"] is not None
    assert len(data["model_breakdown"]) == 1
    assert data["model_breakdown"][0]["score"] == pytest.approx(80.0, abs=0.1)


async def test_overview_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand overview."""
    await register_and_login(client, email="ov_owner@example.com")
    brand = await create_brand(client, name="OV Owner Brand")

    await register_and_login(client, email="ov_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/overview")
    assert resp.status_code == 403


# ── Trends ────────────────────────────────────────────────────────────────────

async def test_trends_empty(client: httpx.AsyncClient):
    """Trends returns empty list when no completed runs exist."""
    await register_and_login(client, email="tr_empty@example.com")
    brand = await create_brand(client, name="Trends Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_id"] == brand["id"]
    assert data["trend_data"] == []


async def test_trends_returns_runs_in_order(client: httpx.AsyncClient):
    """Trends returns all completed runs with model_scores populated."""
    await register_and_login(client, email="tr_runs@example.com")
    brand = await create_brand(
        client,
        name="Trends Runs Brand",
        prompts=["Best AI visibility tools?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=50.0)
    await _insert_completed_run(brand["id"], prompt_id, overall_score=70.0)

    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["trend_data"]) == 2
    for point in data["trend_data"]:
        assert "chatgpt" in point["model_scores"]


async def test_trends_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand trends."""
    await register_and_login(client, email="tr_owner@example.com")
    brand = await create_brand(client, name="Trends Owner Brand")

    await register_and_login(client, email="tr_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/trends")
    assert resp.status_code == 403


# ── Responses ─────────────────────────────────────────────────────────────────

async def test_responses_empty(client: httpx.AsyncClient):
    """Responses returns empty paginated list when no runs exist."""
    await register_and_login(client, email="resp_empty@example.com")
    brand = await create_brand(client, name="Resp Empty Brand")
    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_responses_returns_prompt_text(client: httpx.AsyncClient):
    """Responses includes prompt_text without triggering lazy loading."""
    await register_and_login(client, email="resp_data@example.com")
    brand = await create_brand(
        client,
        name="Resp Data Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=60.0)

    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["prompt_text"] == "What is the best AI visibility tool?"
    assert item["mentioned"] is True


async def test_responses_filter_by_run_id(client: httpx.AsyncClient):
    """Responses filtered by run_id returns only results for that run."""
    await register_and_login(client, email="resp_filter@example.com")
    brand = await create_brand(
        client,
        name="Resp Filter Brand",
        prompts=["Best AI tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    run_a = await _insert_completed_run(brand["id"], prompt_id, overall_score=40.0)
    await _insert_completed_run(brand["id"], prompt_id, overall_score=80.0)

    resp = await client.get(
        f"/api/results/{brand['id']}/responses",
        params={"run_id": run_a},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["tracking_run_id"] == run_a


async def test_responses_access_control(client: httpx.AsyncClient):
    """User cannot see another user's brand responses."""
    await register_and_login(client, email="resp_owner@example.com")
    brand = await create_brand(client, name="Resp Owner Brand")

    await register_and_login(client, email="resp_thief@example.com")
    resp = await client.get(f"/api/results/{brand['id']}/responses")
    assert resp.status_code == 403


# ── PDF Export ────────────────────────────────────────────────────────────────

async def test_export_pdf_no_runs(client: httpx.AsyncClient):
    """PDF export with no runs returns a valid PDF (empty report)."""
    await register_and_login(client, email="pdf_empty@example.com")
    brand = await create_brand(client, name="PDF Empty Brand")
    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


async def test_export_pdf_with_run(client: httpx.AsyncClient):
    """PDF export with completed run returns valid PDF.

    This test catches the qr.prompt_text AttributeError bug: accessing a
    non-existent column on QueryResult crashes the endpoint when iterating
    over query_results in the prompt-group loop.
    """
    await register_and_login(client, email="pdf_run@example.com")
    brand = await create_brand(
        client,
        name="PDF Run Brand",
        prompts=["What is the best AI visibility tool?"],
    )
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=65.0)

    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


async def test_export_pdf_access_control(client: httpx.AsyncClient):
    """User cannot export another user's brand PDF."""
    await register_and_login(client, email="pdf_owner@example.com")
    brand = await create_brand(client, name="PDF Owner Brand")

    await register_and_login(client, email="pdf_thief@example.com")
    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 403


def _pdf_text(pdf_bytes: bytes) -> bytes:
    """Concatenate all zlib-decompressed content streams of a ReportLab PDF."""
    import re
    import zlib

    import base64

    out = b""
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf_bytes, re.DOTALL):
        body = m.group(1).strip(b"\r\n")
        if body.endswith(b"~>"):  # ReportLab default: ASCII85 wrapping FlateDecode
            try:
                body = zlib.decompress(base64.a85decode(body, adobe=True))
            except (ValueError, zlib.error):
                pass
        else:
            try:
                body = zlib.decompress(body)
            except zlib.error:
                pass  # uncompressed stream — search it raw
        out += body
    return out


async def test_export_pdf_includes_rvi_section(client: httpx.AsyncClient):
    """A brand with a peer registering on its prompt gets a Relative Visibility
    section in the PDF, including the index value and the peer's name."""
    await register_and_login(client, email="pdf_rvi@example.com")
    brand = await create_brand(
        client,
        name="Lumidian",
        prompts=["best AI visibility tool"],
    )
    prompt_id = brand["prompts"][0]["id"]
    comp = await client.post(f"/api/brands/{brand['id']}/competitors", json={"name": "Profound"})
    assert comp.status_code == 201, comp.text

    async with AsyncSessionLocal() as db:
        from datetime import datetime, timedelta
        now = datetime.now(UTC).replace(tzinfo=None)
        # current window: brand 1/2, peer 2/2 -> RVI 0.50
        # prior 30d window (35 days back): brand 2/2, peer 2/2 -> RVI 1.00 -> delta -0.50
        for when, texts in [
            (now, [("chatgpt", True, "Lumidian and Profound are both options."),
                   ("gemini", False, "Profound is one option.")]),
            (now - timedelta(days=35), [("chatgpt", True, "Lumidian beats Profound."),
                                        ("gemini", True, "Lumidian over Profound.")]),
        ]:
            run = TrackingRun(
                brand_id=brand["id"], status="completed", run_type="manual",
                overall_score=50.0, total_queries=2, total_mentions=1,
                has_content_influence=False, created_at=when, completed_at=when,
            )
            db.add(run)
            await db.flush()
            for model, mentioned, text_ in texts:
                db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt_id, model=model,
                                   run_number=1, mentioned=mentioned, response_text=text_))
        await db.commit()

    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"
    text = _pdf_text(resp.content)
    assert b"Relative Visibility" in text
    # brand 50% vs Profound 100% -> RVI 0.50
    assert b"0.50" in text
    assert b"Profound" in text
    # delta vs the prior-window RVI of 1.00 renders with an ASCII sign
    assert b"-0.50 vs prior 30 days" in text


async def test_export_pdf_survives_rvi_failure(client: httpx.AsyncClient, monkeypatch):
    """RVI is additive garnish — if it blows up, the report still generates."""
    await register_and_login(client, email="pdf_rvi_fail@example.com")
    brand = await create_brand(client, name="PDF RVI Fail Brand")
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=65.0)

    async def _boom(**kwargs):
        raise RuntimeError("rvi exploded")

    monkeypatch.setattr("app.services.rvi.compute_rvi", _boom)

    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"
    assert b"Relative Visibility" not in _pdf_text(resp.content)


async def test_export_pdf_no_peers_omits_rvi_section(client: httpx.AsyncClient):
    """No competitors → no Relative Visibility section (no empty-state noise in PDFs)."""
    await register_and_login(client, email="pdf_rvi_nopeers@example.com")
    brand = await create_brand(client, name="PDF No Peers Brand")
    prompt_id = brand["prompts"][0]["id"]
    await _insert_completed_run(brand["id"], prompt_id, overall_score=65.0)

    resp = await client.get(f"/api/reports/{brand['id']}/export")
    assert resp.status_code == 200
    assert b"Relative Visibility" not in _pdf_text(resp.content)
