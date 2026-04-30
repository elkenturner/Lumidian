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
