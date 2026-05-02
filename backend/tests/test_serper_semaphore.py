"""
Regression tests for the shared Serper concurrency guard.

Without the SERPER_SEMAPHORE wrap on every scanner, 4 scanners running
in parallel via asyncio.gather can flood Serper enough to trip its
rate limiter — which returns HTTP 400 "Query not allowed. Contact
support." instead of a 429. Verified in prod 2026-05-01: a single
opportunity scan triggered 26+ rejections.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.services import (
    linkedin_scanner_service,
    quora_search_service,
    reddit_scanner_service,
    x_scanner_service,
)
from app.services.serper_search_service import SERPER_SEMAPHORE


def test_semaphore_value_is_three():
    """SERPER_SEMAPHORE caps concurrent Serper requests at 3."""
    assert SERPER_SEMAPHORE._value <= 3 or SERPER_SEMAPHORE._value == 3


def test_all_scanners_import_shared_semaphore():
    """All 4 scanner modules must reference the same semaphore object."""
    assert reddit_scanner_service.SERPER_SEMAPHORE is SERPER_SEMAPHORE
    assert linkedin_scanner_service.SERPER_SEMAPHORE is SERPER_SEMAPHORE
    assert x_scanner_service.SERPER_SEMAPHORE is SERPER_SEMAPHORE
    assert quora_search_service.SERPER_SEMAPHORE is SERPER_SEMAPHORE


@pytest.mark.asyncio
async def test_burst_across_scanners_capped_at_three_in_flight(monkeypatch):
    """8 parallel Serper calls across 4 scanners must never exceed 3 in-flight at once."""
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    class _FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"organic": []}

    class _FakeClient:
        def __init__(self, *_a, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def post(self, *_a, **_kw):
            nonlocal in_flight, max_in_flight
            async with lock:
                in_flight += 1
                if in_flight > max_in_flight:
                    max_in_flight = in_flight
            try:
                # Simulate Serper latency so concurrent calls overlap.
                await asyncio.sleep(0.05)
                return _FakeResp()
            finally:
                async with lock:
                    in_flight -= 1

    # Patch httpx.AsyncClient inside every Serper-calling module so the fake
    # is hit regardless of which scanner runs the request.
    with patch.object(reddit_scanner_service.httpx, "AsyncClient", _FakeClient), \
         patch.object(linkedin_scanner_service.httpx, "AsyncClient", _FakeClient), \
         patch.object(x_scanner_service.httpx, "AsyncClient", _FakeClient), \
         patch.object(quora_search_service.httpx, "AsyncClient", _FakeClient):

        async def reddit_call(i):
            return await reddit_scanner_service._search_reddit_posts(f"q{i}")

        async def linkedin_call(i):
            return await linkedin_scanner_service._search_linkedin_posts(f"q{i}")

        async def x_call(i):
            return await x_scanner_service._search_x_posts(f"q{i}")

        async def quora_call(i):
            return await quora_search_service.search_quora_questions(f"q{i}")

        # Mix all 4 scanners together — 2 calls each, 8 total in parallel.
        await asyncio.gather(
            reddit_call(0), reddit_call(1),
            linkedin_call(0), linkedin_call(1),
            x_call(0), x_call(1),
            quora_call(0), quora_call(1),
        )

    assert max_in_flight <= 3, (
        f"SERPER_SEMAPHORE failed to cap concurrency: max_in_flight={max_in_flight} "
        f"(expected ≤ 3). Did a scanner skip the `async with SERPER_SEMAPHORE` wrap?"
    )
