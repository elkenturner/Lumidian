"""Pro-tier post-generation pass that validates citation markers against sources.

For each [Sn] in the draft, the critic compares the claim around the marker to
the source's snippet and decides keep / drop. We conservatively return the
original text on any parse failure or LLM error.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

_MARKER_RE = re.compile(r"\[S(\d+)\]")

_CRITIC_TEMPLATE = """You are validating citation markers in a draft article.

DRAFT TEXT (citation markers are [S1], [S2], ...):
\"\"\"{text}\"\"\"

SOURCES:
{sources_block}

For each marker that appears in the draft, decide:
- "keep" — the cited source's snippet actually supports the surrounding claim
- "drop" — it does not

Be strict. If you cannot verify support from the snippet alone, choose "drop".

Output strict JSON, no markdown fences:
{{"markers": [{{"original": "S1", "action": "keep" | "drop", "reason": "<one short sentence>"}}, ...]}}"""


def _build_sources_block(sources: list[dict[str, Any]]) -> str:
    lines = []
    for i, s in enumerate(sources, start=1):
        snippet = (s.get("snippet") or "")[:300]
        lines.append(f"[S{i}] ({s.get('tier', '?')}) {s.get('url', '')} — {snippet}")
    return "\n".join(lines)


async def _call_critic(prompt: str) -> str:
    return (await call_claude(prompt=prompt, max_tokens=800, model=CROSS_REF_SUMMARY_MODEL)).strip()


def _parse_json(raw: str) -> dict | None:
    s = raw.strip()
    if s.startswith("```"):
        parts = s.split("```")
        s = parts[1] if len(parts) >= 2 else s
        s = s.lstrip("json").strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


async def critique_citations(
    *,
    text: str,
    pack_sources: list[dict[str, Any]],
) -> str:
    """Run the critic and return the text with bad markers stripped.

    On any failure path returns the original text unmodified (conservative —
    we never make the draft worse than the writer produced).
    """
    if not _MARKER_RE.search(text):
        return text

    prompt = _CRITIC_TEMPLATE.format(
        text=text, sources_block=_build_sources_block(pack_sources),
    )
    try:
        raw = await _call_critic(prompt)
    except Exception as exc:
        logger.warning("Citation critic LLM call failed: %s", exc)
        return text

    data = _parse_json(raw)
    if not data or "markers" not in data:
        return text

    drop_refs: set[str] = set()
    for m in data["markers"]:
        if isinstance(m, dict) and m.get("action") == "drop" and m.get("original"):
            drop_refs.add(m["original"])

    if not drop_refs:
        return text

    def _replace(match: re.Match) -> str:
        ref = f"S{match.group(1)}"
        return "" if ref in drop_refs else match.group(0)

    return _MARKER_RE.sub(_replace, text)
