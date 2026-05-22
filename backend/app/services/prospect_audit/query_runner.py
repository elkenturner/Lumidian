"""Fan out N prompts × M models × K runs against the existing llm_service.

Returns a flat list of result dicts with prompt_index/model/run metadata so the
caller can slot them into the right scoring buckets.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.services.llm_service import query_model

logger = logging.getLogger(__name__)

_MAX_CONCURRENT = 10


async def run_queries_for_audit(
    *,
    prompts: list[str],
    models: list[str],
    runs_per: int,
    brand_name: str,
    on_progress: Callable[[str], Awaitable[None]] | None,
    cancel_event: asyncio.Event | None,
) -> list[dict]:
    """Execute every (prompt × model × run) combination concurrently.

    Each result dict has shape:
        {prompt_index, model, run, response_text, mentioned, latency_ms, error}

    Raises asyncio.CancelledError if cancel_event is set at any check-in point.
    """
    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    sem = asyncio.Semaphore(_MAX_CONCURRENT)
    total = len(prompts) * len(models) * runs_per
    completed = {"n": 0}

    async def one(prompt_index: int, prompt: str, model: str, run: int) -> dict:
        async with sem:
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError()
            res = await query_model(
                model=model,
                prompt=prompt,
                brand_name=brand_name,
                pro=True,   # use upgraded model variants (sonar-pro etc.) for audit quality
                cancel_event=cancel_event,
            )
            completed["n"] += 1
            if on_progress and (completed["n"] % 5 == 0 or completed["n"] == total):
                await on_progress(f"queries: {completed['n']}/{total}")
            return {
                "prompt_index": prompt_index,
                "model": model,
                "run": run,
                "response_text": res.get("response_text") or "",
                "mentioned": bool(res.get("mentioned", False)),
                "latency_ms": int(res.get("latency_ms") or 0),
                "error": res.get("error"),
            }

    tasks: list[asyncio.Task] = []
    for prompt_index, prompt in enumerate(prompts):
        for model in models:
            for run in range(1, runs_per + 1):
                tasks.append(asyncio.create_task(one(prompt_index, prompt, model, run)))

    results = await asyncio.gather(*tasks, return_exceptions=False)
    return results
