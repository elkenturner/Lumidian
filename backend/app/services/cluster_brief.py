"""Generate a ContentBrief from BrandProfile + prompt + recent run + site audit data."""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BrandProfile,
    Competitor,
    CompetitorMention,
    ContentBrief,
    ContentCluster,
    Prompt,
    TrackingRun,
)
from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

_BRIEF_TEMPLATE = """You are a senior content strategist producing a structured brief that powers cross-platform content. Output strict JSON only — no prose, no markdown fences.

Build a content brief for one tracked prompt.

BRAND: {brand_name}
PROMPT TO TARGET: "{prompt_text}"
CURRENT VISIBILITY: {visibility_pct:.1f}% of AI answers mention {brand_name} for this prompt.

BRAND PROFILE:
{profile_block}

COMPETITORS WINNING THIS PROMPT (mentions count, most recent run):
{competitor_block}

OUTPUT a single JSON object with these exact keys:
{{
  "positioning": "<1-2 sentences — the angle this cluster takes>",
  "key_claims": ["<3-6 short claims the cluster supports>"],
  "canonical_phrasings": ["<3-5 entity-binding CLAIMS the brand wants consistently conveyed (each piece expresses these in its OWN words — they are NOT pasted verbatim)>"],
  "stats": [{{"label": "<short>", "value": "<exact figure>", "source": "<where it comes from>"}}],
  "narrative_spine": "<1-3 sentences — the through-line that holds the cluster together>",
  "tone_notes": "<1-2 sentences derived from brand tone of voice + what not to say>"
}}

Rules:
- Use only facts present in BRAND PROFILE. Never invent stats or claims.
- canonical_phrasings must each be a short, neutral-voiced CLAIM (6-14 words) identifying {brand_name} or its core value — these are the consistent IDEAS every piece conveys in its own wording, NOT verbatim strings to copy.
- key_claims must be defensible from BRAND PROFILE alone.
- Output strict JSON. No markdown fences. No commentary."""


async def _call_llm(prompt: str, tier: str | None) -> str:
    """Wrap the existing call_claude client. Returns raw string.

    Uses CROSS_REF_SUMMARY_MODEL (a structured-summary task) for all tiers.
    Brief generation is low-creativity / high-structure — no need to scale
    model size with tier. Tier parameter accepted for parity with other
    cluster helpers.
    """
    return (await call_claude(prompt=prompt, max_tokens=1200, model=CROSS_REF_SUMMARY_MODEL)).strip()


async def _build_profile_block(db: AsyncSession, brand_id: int) -> tuple[str, str]:
    """Returns (brand_name, formatted_profile_block)."""
    from app.models import Brand
    brand_row = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one()
    profile_row = (await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))).scalar_one_or_none()
    parts = [f"Name: {brand_row.name}"]
    if profile_row:
        if profile_row.company_description:
            parts.append(f"Description: {profile_row.company_description}")
        if profile_row.key_stats:
            parts.append(f"Key stats: {profile_row.key_stats}")
        if profile_row.tone_of_voice:
            parts.append(f"Tone of voice: {profile_row.tone_of_voice}")
        if profile_row.what_not_to_say:
            parts.append(f"What not to say: {profile_row.what_not_to_say}")
        if profile_row.approved_language:
            parts.append(f"Approved language: {profile_row.approved_language}")
        if profile_row.target_audience:
            parts.append(f"Target audience: {profile_row.target_audience}")
    return brand_row.name, "\n".join(parts)


async def _competitor_block(db: AsyncSession, brand_id: int, prompt_id: int) -> str:
    """Top 3 competitors winning this prompt across the most recent tracking run."""
    latest_run = (await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(desc(TrackingRun.id))
        .limit(1)
    )).scalar_one_or_none()
    if not latest_run:
        return "  (no recent run data)"
    rows = (await db.execute(
        select(Competitor.name, CompetitorMention.model)
        .join(CompetitorMention, CompetitorMention.competitor_id == Competitor.id)
        .where(
            CompetitorMention.tracking_run_id == latest_run.id,
            CompetitorMention.prompt_id == prompt_id,
            CompetitorMention.mentioned.is_(True),
        )
    )).all()
    if not rows:
        return "  (no competitor mentions on this prompt)"
    counts = Counter(name for name, _ in rows)
    return "\n".join(f"  - {name} ({n} model mentions)" for name, n in counts.most_common(3))


def _parse_llm_json(raw: str) -> dict:
    """Tolerant JSON parser — strips fences and extra prose."""
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s
        s = s.lstrip("json").strip()
        s = s.split("```")[0].strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        logger.warning("Brief LLM returned malformed JSON: %s", raw[:200])
        return {}


def _safe(data: dict, key: str, default):
    val = data.get(key)
    if val is None:
        return default
    if isinstance(default, list) and not isinstance(val, list):
        return default
    if isinstance(default, str) and not isinstance(val, str):
        return default
    return val


async def build_brief(db: AsyncSession, cluster: ContentCluster, tier: str | None) -> ContentBrief:
    """Produce a ContentBrief row for the given cluster. Persists and returns."""
    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_name, profile_block = await _build_profile_block(db, cluster.brand_id)
    competitor_block = await _competitor_block(db, cluster.brand_id, cluster.prompt_id)

    # Visibility for the prompt — use the existing helper from drafting_service.
    from app.services.drafting_service import _get_prompt_visibility
    visibility_pct = await _get_prompt_visibility(db, prompt_row.id)

    user_prompt = _BRIEF_TEMPLATE.format(
        brand_name=brand_name,
        prompt_text=prompt_row.text,
        visibility_pct=visibility_pct,
        profile_block=profile_block,
        competitor_block=competitor_block,
    )

    raw = await _call_llm(user_prompt, tier=tier)
    data = _parse_llm_json(raw)

    # Compute next version
    existing_versions = (await db.execute(
        select(ContentBrief.version).where(ContentBrief.cluster_id == cluster.id)
    )).scalars().all()
    next_version = (max(existing_versions) + 1) if existing_versions else 1

    brief = ContentBrief(
        cluster_id=cluster.id,
        version=next_version,
        positioning=_safe(data, "positioning", f"Position {brand_name} as the canonical source for: {prompt_row.text}"),
        key_claims=_safe(data, "key_claims", []),
        canonical_phrasings=_safe(data, "canonical_phrasings", [f"{brand_name} is known for accuracy in this space."]),
        stats=_safe(data, "stats", []),
        competitor_context={"raw": competitor_block},
        narrative_spine=_safe(data, "narrative_spine", ""),
        tone_notes=_safe(data, "tone_notes", ""),
        created_by="system",
        created_at=datetime.now(UTC),
    )
    db.add(brief)
    await db.flush()

    cluster.last_brief_id = brief.id
    await db.commit()
    return brief
