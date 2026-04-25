"""Tests for the citation_gaps section of GET /api/dashboard."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Prompt, QueryResult, TrackingRun
from tests.conftest import create_brand, register_and_login

pytestmark = pytest.mark.asyncio


async def _seed_run(brand_id: int, rows: list[dict]) -> int:
    """Insert a TrackingRun + QueryResult rows for a brand.

    Each row dict supports: response_text, mentioned (default False),
    model (default "perplexity"), prompt_id.
    Returns the run_id.
    """
    async with AsyncSessionLocal() as db:
        prompt_q = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt = prompt_q.scalars().first()
        if prompt is None:
            prompt = Prompt(brand_id=brand_id, text="seed prompt", prompt_type="standard")
            db.add(prompt)
            await db.commit()
            await db.refresh(prompt)

        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            total_queries=len(rows),
            total_mentions=sum(1 for r in rows if r.get("mentioned")),
            overall_score=0.0,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        for r in rows:
            db.add(
                QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=r.get("prompt_id", prompt.id),
                    model=r.get("model", "perplexity"),
                    run_number=1,
                    response_text=r["response_text"],
                    mentioned=r.get("mentioned", False),
                )
            )
        await db.commit()
        return run.id


async def _setup_brand(client: httpx.AsyncClient) -> int:
    """Register, login, create a brand. Returns brand_id.

    Auth cookies are set on the `client` instance by `register_and_login`,
    so callers should keep using the same client for subsequent requests.
    """
    await register_and_login(client)
    brand = await create_brand(client, name="Acme")
    return brand["id"]
