"""Declarative tool definitions and dispatch for the AI visibility coach.

Each tool is registered via @register_tool(name, schema, token_budget).
Handlers take (db, user_id, brand_id, **kwargs), enforce ownership, query
the DB, and return a dict. The dispatch wrapper truncates oversized
results.
"""
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand


class ToolNotFoundError(Exception):
    pass


class BrandNotOwnedError(Exception):
    pass


ToolHandler = Callable[..., Awaitable[dict[str, Any]]]


@dataclass
class ToolDef:
    name: str
    schema: dict
    token_budget: int
    handler: ToolHandler


_REGISTRY: dict[str, ToolDef] = {}


def register_tool(*, name: str, schema: dict, token_budget: int):
    """Decorator. Registers a coach tool by name."""
    def _wrap(handler: ToolHandler) -> ToolHandler:
        _REGISTRY[name] = ToolDef(name=name, schema=schema, token_budget=token_budget, handler=handler)
        return handler
    return _wrap


def all_tool_schemas() -> list[dict]:
    """Returns the Anthropic-format schema for every registered tool."""
    return [t.schema for t in _REGISTRY.values()]


def _approx_tokens(payload: Any) -> int:
    """Rough token estimate: 1 token per ~4 characters of JSON."""
    return max(1, len(json.dumps(payload, default=str)) // 4)


def _truncate_to_budget(payload: dict[str, Any], budget: int) -> dict[str, Any]:
    """If payload exceeds budget, truncate list-valued fields from the end and mark."""
    if _approx_tokens(payload) <= budget:
        return payload
    trimmed = dict(payload)
    # Iteratively shorten the longest list field until under budget or all empty
    for _ in range(50):
        list_fields = [(k, v) for k, v in trimmed.items() if isinstance(v, list) and v]
        if not list_fields:
            break
        longest_key, longest_val = max(list_fields, key=lambda kv: len(kv[1]))
        trimmed[longest_key] = longest_val[: max(1, len(longest_val) - max(1, len(longest_val) // 4))]
        if _approx_tokens(trimmed) <= budget:
            break
    trimmed["_truncated"] = True
    trimmed["_note"] = (
        "Result was truncated to fit token budget. "
        "Ask a narrower follow-up question if you need more."
    )
    return trimmed


async def _verify_brand_ownership(db: AsyncSession, user_id: int, brand_id: int) -> Brand:
    result = await db.execute(
        select(Brand).where(Brand.id == brand_id, Brand.user_id == user_id)
    )
    brand = result.scalar_one_or_none()
    if brand is None:
        raise BrandNotOwnedError(f"Brand {brand_id} not found for user {user_id}")
    return brand


async def dispatch_tool(
    db: AsyncSession,
    *,
    user_id: int,
    brand_id: int,
    tool_name: str,
    tool_args: dict[str, Any],
) -> dict[str, Any]:
    """Run a registered tool. Enforces brand ownership; truncates oversized results."""
    if tool_name not in _REGISTRY:
        raise ToolNotFoundError(tool_name)
    tool = _REGISTRY[tool_name]
    # Enforce ownership before running the handler
    await _verify_brand_ownership(db, user_id, brand_id)
    # Strip brand_id/user_id from tool_args — we always inject the URL-bound values
    safe_args = {k: v for k, v in tool_args.items() if k not in ("brand_id", "user_id")}
    result = await tool.handler(db, user_id, brand_id, **safe_args)
    return _truncate_to_budget(result, tool.token_budget)
