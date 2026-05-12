"""
Centralised per-role and per-tier model selection for the drafting pipeline.

Internal tier keys (DB values): None=Free, "basic"=Starter, "starter"=Growth, "pro"=Pro.
Display names defined in routers/billing.py TIER_DISPLAY_NAMES.
"""
from __future__ import annotations

CRITIC_MODEL = "claude-sonnet-4-6"
CROSS_REF_SUMMARY_MODEL = "claude-haiku-4-5-20251001"
SHORT_REPLY_MODEL = "claude-haiku-4-5-20251001"

_OPUS = "claude-opus-4-7"
_SONNET = "claude-sonnet-4-6"


def writer_model_for_tier(tier: str | None) -> str:
    if tier == "pro":
        return _OPUS
    return _SONNET


def rewriter_model_for_tier(tier: str | None) -> str:
    if tier in ("starter", "pro"):
        return _OPUS
    return _SONNET
