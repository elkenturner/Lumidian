"""Tests for the AI visibility coach."""
import json
import secrets

import pytest
from app.database import AsyncSessionLocal
from app.models import Brand, User
from app.services.coach_tools import (
    BrandNotOwnedError,
    ToolNotFoundError,
    dispatch_tool,
    register_tool,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_user(email: str) -> int:
    """Insert a bare User row and return its id."""
    async with AsyncSessionLocal() as db:
        user = User(
            email=email,
            password_hash="x",
            email_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user.id


async def _create_brand(user_id: int, name: str) -> dict:
    """Insert a bare Brand row and return a dict with id + name."""
    slug = f"{name.lower().replace(' ', '-')}-{secrets.token_hex(4)}"
    async with AsyncSessionLocal() as db:
        brand = Brand(name=name, slug=slug, user_id=user_id)
        db.add(brand)
        await db.commit()
        await db.refresh(brand)
        return {"id": brand.id, "name": brand.name}


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dispatch_tool_unknown_tool_raises():
    async with AsyncSessionLocal() as db:
        with pytest.raises(ToolNotFoundError):
            await dispatch_tool(db, user_id=1, brand_id=1, tool_name="nonexistent", tool_args={})


@pytest.mark.asyncio
async def test_dispatch_tool_enforces_ownership():
    user_a_id = await _create_user("a@example.com")
    user_b_id = await _create_user("b@example.com")
    brand_a = await _create_brand(user_a_id, "Brand A")

    @register_tool(
        name="echo_brand",
        schema={
            "name": "echo_brand",
            "description": "test",
            "input_schema": {"type": "object", "properties": {}},
        },
        token_budget=200,
    )
    async def echo_brand(db, user_id, brand_id, **kwargs):
        return {"brand_id": brand_id}

    async with AsyncSessionLocal() as db:
        with pytest.raises(BrandNotOwnedError):
            await dispatch_tool(
                db,
                user_id=user_b_id,
                brand_id=brand_a["id"],
                tool_name="echo_brand",
                tool_args={},
            )


@pytest.mark.asyncio
async def test_dispatch_tool_truncates_oversize_results():
    user_id = await _create_user("c@example.com")
    brand = await _create_brand(user_id, "Brand C")

    @register_tool(
        name="big_payload",
        schema={
            "name": "big_payload",
            "description": "test",
            "input_schema": {"type": "object", "properties": {}},
        },
        token_budget=50,
    )
    async def big_payload(db, user_id, brand_id, **kwargs):
        return {"items": ["x" * 20 for _ in range(100)]}

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(
            db,
            user_id=user_id,
            brand_id=brand["id"],
            tool_name="big_payload",
            tool_args={},
        )

    serialized = json.dumps(result)
    assert len(serialized) <= 50 * 4 + 200, f"Expected truncation, got {len(serialized)} chars"
    assert result.get("_truncated") is True


@pytest.mark.asyncio
async def test_get_brand_overview_returns_expected_shape():
    user_id = await _create_user("o@example.com")
    brand = await _create_brand(user_id, "Brand O")

    async with AsyncSessionLocal() as db:
        # Add a couple of prompts so the list isn't empty
        from app.models import Prompt
        for text in ("best CRMs", "top sales tools"):
            db.add(Prompt(brand_id=brand["id"], text=text, prompt_type="standard"))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_brand_overview", tool_args={})

    assert result["brand_name"] == "Brand O"
    assert result["brand_type"] in ("standard", "pitch")
    assert "tier" in result and "tier_display" in result
    assert result["prompt_count"] == 2
    assert isinstance(result["prompts"], list) and len(result["prompts"]) == 2
    assert all(set(p.keys()) == {"id", "text"} for p in result["prompts"])
    assert result["latest_score"] is None  # no runs yet
    assert result["total_runs"] == 0


@pytest.mark.asyncio
async def test_get_score_breakdown_returns_per_model_and_per_prompt():
    user_id = await _create_user("sb@example.com")
    brand = await _create_brand(user_id, "Brand SB")

    async with AsyncSessionLocal() as db:
        from app.models import Prompt, TrackingRun, RunModelScore, QueryResult
        prompt = Prompt(brand_id=brand["id"], text="best CRMs", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        run = TrackingRun(brand_id=brand["id"], status="completed", overall_score=50.0, total_queries=4, total_mentions=2)
        db.add(run)
        await db.flush()
        db.add(RunModelScore(tracking_run_id=run.id, model="perplexity", total_queries=2, total_mentions=2, score=100.0))
        db.add(RunModelScore(tracking_run_id=run.id, model="gemini", total_queries=2, total_mentions=0, score=0.0))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=1, response_text="...", mentioned=True))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=2, response_text="...", mentioned=True))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="gemini", run_number=1, response_text="...", mentioned=False))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="gemini", run_number=2, response_text="...", mentioned=False))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_score_breakdown", tool_args={})

    assert result["overall_score"] == 50.0
    by_model = {m["model"]: m for m in result["per_model"]}
    assert by_model["perplexity"]["score"] == 100.0
    assert by_model["gemini"]["score"] == 0.0
    assert len(result["per_prompt"]) == 1
    assert result["per_prompt"][0]["prompt_text"] == "best CRMs"
    assert result["per_prompt"][0]["score"] == 50.0
