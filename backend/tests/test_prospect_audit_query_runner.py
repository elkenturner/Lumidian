from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.query_runner import run_queries_for_audit


@pytest.mark.asyncio
async def test_run_queries_produces_one_record_per_combination():
    fake_query = AsyncMock(return_value={
        "response_text": "Acme is great",
        "mentioned": True,
        "latency_ms": 100,
        "error": None,
    })
    progress_updates: list[str] = []

    async def progress(msg: str) -> None:
        progress_updates.append(msg)

    with patch("app.services.prospect_audit.query_runner.query_model", new=fake_query):
        results = await run_queries_for_audit(
            prompts=["q1?", "q2?"],
            models=["chatgpt", "perplexity"],
            runs_per=2,
            brand_name="Acme",
            on_progress=progress,
            cancel_event=None,
        )

    # 2 prompts × 2 models × 2 runs = 8 query records
    assert len(results) == 8
    # Each result tagged with prompt_index, model, run
    by_keys = {(r["prompt_index"], r["model"], r["run"]) for r in results}
    assert (0, "chatgpt", 1) in by_keys
    assert (1, "perplexity", 2) in by_keys
    # Progress notifications fired
    assert any("queries:" in s for s in progress_updates)


@pytest.mark.asyncio
async def test_run_queries_records_errors_without_halting():
    call_count = {"n": 0}

    async def flaky(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] % 3 == 0:
            return {"response_text": None, "mentioned": False, "latency_ms": 0, "error": "rate limited"}
        return {"response_text": "ok", "mentioned": True, "latency_ms": 50, "error": None}

    with patch("app.services.prospect_audit.query_runner.query_model", new=AsyncMock(side_effect=flaky)):
        results = await run_queries_for_audit(
            prompts=["q?"],
            models=["chatgpt", "perplexity", "gemini"],
            runs_per=3,
            brand_name="Acme",
            on_progress=None,
            cancel_event=None,
        )

    assert len(results) == 9
    errored = [r for r in results if r["error"] is not None]
    successful = [r for r in results if r["error"] is None]
    # Roughly 1/3 errored (3 out of 9)
    assert len(errored) >= 1
    assert len(successful) >= 1


@pytest.mark.asyncio
async def test_run_queries_respects_cancellation():
    import asyncio
    cancel = asyncio.Event()
    cancel.set()   # already set before we start

    async def fake_query(*args, **kwargs):
        return {"response_text": "", "mentioned": False, "latency_ms": 0, "error": None}

    with patch("app.services.prospect_audit.query_runner.query_model", new=AsyncMock(side_effect=fake_query)):
        with pytest.raises(asyncio.CancelledError):
            await run_queries_for_audit(
                prompts=["q?"],
                models=["chatgpt"],
                runs_per=3,
                brand_name="Acme",
                on_progress=None,
                cancel_event=cancel,
            )
