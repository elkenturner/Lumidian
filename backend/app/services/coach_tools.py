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


from datetime import datetime, timezone, timedelta
from app.models import Prompt, TrackingRun, User

# Internal-tier → display-name mapping (mirrors billing.py)
_TIER_DISPLAY = {None: "Free", "basic": "Starter", "starter": "Growth", "pro": "Pro"}


@register_tool(
    name="get_brand_overview",
    schema={
        "name": "get_brand_overview",
        "description": (
            "Get the brand's identity, configured prompts, and a recent-score snapshot. "
            "CALL THIS FIRST in nearly every conversation to establish context."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    token_budget=1500,
)
async def get_brand_overview(db: AsyncSession, user_id: int, brand_id: int) -> dict:
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one()
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()

    # Prompts
    prompts = (await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))).scalars().all()

    # Latest completed runs ordered most-recent first
    runs = (await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
    )).scalars().all()

    now = datetime.now(timezone.utc)

    def _score_at(cutoff_days: int) -> float | None:
        cutoff = now - timedelta(days=cutoff_days)
        for r in runs:
            if r.completed_at and r.completed_at <= cutoff:
                return r.overall_score
        return None

    latest = runs[0] if runs else None
    return {
        "brand_name": brand.name,
        "brand_type": brand.brand_type,
        "tier": user.subscription_tier,
        "tier_display": _TIER_DISPLAY.get(user.subscription_tier, "Free"),
        "website_url": brand.website_url,
        "prompt_count": len(prompts),
        "prompts": [{"id": p.id, "text": p.text} for p in prompts],
        "latest_score": latest.overall_score if latest else None,
        "score_7d_ago": _score_at(7),
        "score_30d_ago": _score_at(30),
        "total_runs": len(runs),
    }


from app.models import RunModelScore, QueryResult


@register_tool(
    name="get_score_breakdown",
    schema={
        "name": "get_score_breakdown",
        "description": (
            "Get per-model and per-prompt scores for a specific tracking run "
            "(defaults to the latest completed run). Use when the user asks "
            "'why X%' or 'which models/prompts are weak'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "integer", "description": "Specific run to inspect; omit for the latest run."},
            },
        },
    },
    token_budget=2000,
)
async def get_score_breakdown(db: AsyncSession, user_id: int, brand_id: int, run_id: int | None = None) -> dict:
    if run_id is None:
        latest = (await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        if latest is None:
            return {"error": "No completed runs yet for this brand."}
        run = latest
    else:
        run = (await db.execute(
            select(TrackingRun).where(TrackingRun.id == run_id, TrackingRun.brand_id == brand_id)
        )).scalar_one_or_none()
        if run is None:
            return {"error": f"Run {run_id} not found for this brand."}

    model_scores = (await db.execute(
        select(RunModelScore).where(RunModelScore.tracking_run_id == run.id)
    )).scalars().all()

    qrs = (await db.execute(
        select(QueryResult).where(QueryResult.tracking_run_id == run.id)
    )).scalars().all()

    # Aggregate per prompt
    prompt_ids = {qr.prompt_id for qr in qrs}
    prompts_map = {p.id: p.text for p in (await db.execute(select(Prompt).where(Prompt.id.in_(prompt_ids)))).scalars().all()}

    per_prompt: dict[int, dict] = {}
    for qr in qrs:
        if qr.error:
            continue
        slot = per_prompt.setdefault(qr.prompt_id, {"prompt_id": qr.prompt_id, "prompt_text": prompts_map.get(qr.prompt_id, ""), "queries": 0, "mentions": 0})
        slot["queries"] += 1
        if qr.mentioned:
            slot["mentions"] += 1

    per_prompt_list = []
    for slot in per_prompt.values():
        score = (slot["mentions"] / slot["queries"]) * 100.0 if slot["queries"] else 0.0
        per_prompt_list.append({**slot, "score": round(score, 2)})

    return {
        "run_id": run.id,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "overall_score": run.overall_score,
        "total_queries": run.total_queries,
        "total_mentions": run.total_mentions,
        "per_model": [
            {"model": ms.model, "queries": ms.total_queries, "mentions": ms.total_mentions, "score": ms.score}
            for ms in model_scores
        ],
        "per_prompt": per_prompt_list,
    }


@register_tool(
    name="get_score_trend",
    schema={
        "name": "get_score_trend",
        "description": (
            "Get the last N completed runs for the brand, with overall and per-model "
            "scores. Use when the user asks if their score is improving, getting worse, "
            "or what changed recently. The runs are returned newest-first."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"n": {"type": "integer", "description": "Number of runs (default 10).", "default": 10}},
        },
    },
    token_budget=1500,
)
async def get_score_trend(db: AsyncSession, user_id: int, brand_id: int, n: int = 10) -> dict:
    n = max(1, min(int(n or 10), 30))
    runs = (await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.desc())
        .limit(n)
    )).scalars().all()

    if not runs:
        return {"runs": [], "note": "No completed runs yet."}

    run_ids = [r.id for r in runs]
    scores = (await db.execute(
        select(RunModelScore).where(RunModelScore.tracking_run_id.in_(run_ids))
    )).scalars().all()
    by_run: dict[int, dict[str, float]] = {}
    for s in scores:
        by_run.setdefault(s.tracking_run_id, {})[s.model] = s.score

    return {
        "runs": [
            {
                "run_id": r.id,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "overall_score": r.overall_score,
                "per_model": by_run.get(r.id, {}),
            }
            for r in runs
        ]
    }


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
