"""Agent loop for the AI visibility coach. Streams SSE events as dicts.

Each yielded event is a dict: {"type": str, "data": dict}. The router
serializes these to the SSE wire format.
"""
import asyncio
import json
import logging
import os
from typing import AsyncIterator

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.services.coach_prompt import build_system_prompt
from app.services.coach_tools import (
    BrandNotOwnedError,
    ToolNotFoundError,
    all_tool_schemas,
    dispatch_tool,
)

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

MAX_TOOL_CYCLES = 8
MAX_OUTPUT_TOKENS = 4096
MODEL = "claude-haiku-4-5-20251001"

_TIER_DISPLAY = {None: "Free", "basic": "Starter", "starter": "Growth", "pro": "Pro"}


def _system_blocks(*, brand_name: str, tier_display: str, brand_type: str) -> list[dict]:
    """Returns the Anthropic-format system blocks with cache_control on the static prefix."""
    text = build_system_prompt(brand_name=brand_name, tier_display=tier_display, brand_type=brand_type)
    return [
        {
            "type": "text",
            "text": text,
            "cache_control": {"type": "ephemeral"},
        }
    ]


async def run_turn(
    *,
    db: AsyncSession,
    user: User,
    brand_id: int,
    messages: list[dict],
) -> AsyncIterator[dict]:
    """Run one user-turn through the agent loop. Yields SSE event dicts."""
    if not ANTHROPIC_API_KEY:
        yield {"type": "error", "data": {"message": "Coach is unavailable — Anthropic API key not configured."}}
        return

    from app.models import Brand
    from sqlalchemy import select
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id, Brand.user_id == user.id))).scalar_one_or_none()
    if brand is None:
        yield {"type": "error", "data": {"message": "Brand not found."}}
        return

    tier_display = _TIER_DISPLAY.get(user.subscription_tier, "Free")
    if brand.brand_type == "pitch":
        tier_display = "Free"

    system = _system_blocks(brand_name=brand.name, tier_display=tier_display, brand_type=brand.brand_type)
    tools = all_tool_schemas()
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    convo: list[dict] = list(messages)
    tool_cycles = 0

    while True:
        try:
            stream_ctx = client.messages.stream(
                model=MODEL,
                system=system,
                messages=convo,
                tools=tools,
                max_tokens=MAX_OUTPUT_TOKENS,
            )
        except Exception:
            logger.exception("Failed to start Anthropic stream")
            yield {"type": "error", "data": {"message": "Coach is busy. Try again in a moment."}}
            yield {"type": "done", "data": {}}
            return

        try:
            async with stream_ctx as stream:
                async for delta in stream.text_stream:
                    if delta:
                        yield {"type": "text_delta", "data": {"text": delta}}
                final = await stream.get_final_message()
        except anthropic.APIStatusError:
            logger.warning("Anthropic API error during stream")
            yield {"type": "text_delta", "data": {"text": "\n\nSomething went wrong on my end. Try again in a moment."}}
            yield {"type": "done", "data": {}}
            return
        except Exception:
            logger.exception("Unexpected stream error")
            yield {"type": "error", "data": {"message": "Coach hit an unexpected error."}}
            yield {"type": "done", "data": {}}
            return

        if final.stop_reason != "tool_use":
            yield {"type": "done", "data": {}}
            return

        # Append assistant turn (text + tool_use blocks) to the conversation
        assistant_blocks = []
        for blk in final.content:
            if getattr(blk, "type", None) == "text":
                assistant_blocks.append({"type": "text", "text": blk.text})
            elif getattr(blk, "type", None) == "tool_use":
                assistant_blocks.append({"type": "tool_use", "id": blk.id, "name": blk.name, "input": blk.input})
        convo.append({"role": "assistant", "content": assistant_blocks})

        # Run all tool_use blocks in this turn, append tool_results
        tool_results = []
        for blk in final.content:
            if getattr(blk, "type", None) != "tool_use":
                continue
            tool_cycles += 1
            yield {"type": "tool_status", "data": {"name": blk.name, "label": _label_for_tool(blk.name)}}
            try:
                result = await dispatch_tool(
                    db,
                    user_id=user.id,
                    brand_id=brand_id,
                    tool_name=blk.name,
                    tool_args=blk.input or {},
                )
                payload = json.dumps(result, default=str)
            except ToolNotFoundError:
                payload = json.dumps({"error": f"Unknown tool: {blk.name}"})
            except BrandNotOwnedError:
                payload = json.dumps({"error": "Brand not accessible."})
            except Exception:
                logger.exception("Tool %s failed", blk.name)
                payload = json.dumps({"error": "Tool dispatch failed."})
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": blk.id,
                "content": payload,
            })

        convo.append({"role": "user", "content": tool_results})

        if tool_cycles >= MAX_TOOL_CYCLES:
            apology = "\n\nI'm not making progress on this — could you try rephrasing the question?"
            yield {"type": "text_delta", "data": {"text": apology}}
            yield {"type": "done", "data": {}}
            return


def _label_for_tool(name: str) -> str:
    return {
        "get_brand_overview": "Loading your brand…",
        "get_score_breakdown": "Reading your score breakdown…",
        "get_score_trend": "Looking at your trend…",
        "get_competitor_comparison": "Comparing to competitors…",
        "get_content_gaps": "Reading your content gaps…",
        "get_drafts_summary": "Checking your drafts…",
        "get_brand_profile": "Reading your brand profile…",
    }.get(name, f"Calling {name}…")
