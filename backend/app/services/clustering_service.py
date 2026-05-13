"""Cluster orchestrator: brief generation + parallel piece generation + pillar."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandContentSettings,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
)
from app.services.cluster_brief import build_brief
from app.services.cluster_pillar import propose_pillar
from app.services.drafting.client import call_claude
from app.services.drafting.models import writer_model_for_tier
from app.services.drafting.platforms import PLATFORM_SPECS, resolve_platform_key
from app.services.drafting.prompts import build_prompt

logger = logging.getLogger(__name__)

CLUSTER_PLATFORMS: tuple[str, ...] = ("linkedin", "medium", "reddit", "quora", "x")


async def get_or_create_cluster(db: AsyncSession, *, brand_id: int, prompt_id: int) -> ContentCluster:
    existing = (await db.execute(
        select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
    )).scalar_one_or_none()
    if existing:
        return existing
    cluster = ContentCluster(
        brand_id=brand_id,
        prompt_id=prompt_id,
        status="pending",
        pillar_mode="none",
        version=1,
        created_at=datetime.now(UTC),
    )
    db.add(cluster)
    await db.commit()
    await db.refresh(cluster)
    return cluster


async def _enabled_platforms(db: AsyncSession, brand_id: int) -> list[str]:
    """Respect BrandContentSettings.enabled per platform. Default = enabled."""
    rows = (await db.execute(
        select(BrandContentSettings.platform, BrandContentSettings.enabled)
        .where(BrandContentSettings.brand_id == brand_id)
    )).all()
    disabled = {p for p, enabled in rows if not enabled}
    return [p for p in CLUSTER_PLATFORMS if p not in disabled]


def _build_brief_context(brief: ContentBrief, sibling_platforms: list[str]) -> str:
    lines = [f"POSITIONING: {brief.positioning}"]
    if brief.canonical_phrasings:
        lines.append("CANONICAL PHRASINGS (use at least 1 verbatim):")
        lines.extend(f"  - {p}" for p in brief.canonical_phrasings)
    if brief.key_claims:
        lines.append("KEY CLAIMS:")
        lines.extend(f"  - {c}" for c in brief.key_claims)
    if brief.stats:
        lines.append("STATS:")
        for s in brief.stats:
            lines.append(f"  - {s.get('label', '')}: {s.get('value', '')}")
    if brief.narrative_spine:
        lines.append(f"NARRATIVE SPINE: {brief.narrative_spine}")
    if brief.tone_notes:
        lines.append(f"TONE NOTES: {brief.tone_notes}")
    if sibling_platforms:
        lines.append("SIBLING PLATFORMS in this cluster (reference by platform name, not URL):")
        lines.append(f"  - {', '.join(sibling_platforms)}")
    return "\n".join(lines)


async def _generate_piece_text(
    *,
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    brief_context: str,
    tier: str | None,
) -> tuple[str, str]:
    """Call the LLM via build_prompt + call_claude. Returns (title, body)."""
    from app.services.drafting.pipeline import extract_title_and_body
    spec = PLATFORM_SPECS[resolve_platform_key(platform)]
    prompt = build_prompt(
        brand_name=brand_name,
        platform=platform,
        prompt_text=prompt_text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        brief_context=brief_context,
    )
    raw = await call_claude(prompt=prompt, max_tokens=1500, model=writer_model_for_tier(tier))
    title, body = extract_title_and_body(raw, platform)
    return (title or "(untitled)"), body


async def regenerate_cluster(
    db: AsyncSession,
    *,
    cluster_id: int,
    tier: str | None,
) -> ContentCluster:
    cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
    cluster.status = "briefing"
    await db.commit()

    brief = await build_brief(db, cluster=cluster, tier=tier)

    cluster.status = "generating"
    await db.commit()

    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_row = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    from app.services.drafting_service import (
        _analyze_responses_for_prompt,
        _get_prompt_visibility,
        _load_profile_context,
    )
    profile_context = await _load_profile_context(db, cluster.brand_id)
    # NOTE: _analyze_responses_for_prompt requires brand_id as second arg
    response_analysis = await _analyze_responses_for_prompt(db, cluster.brand_id, cluster.prompt_id)
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)

    # Delete existing cluster drafts before regenerating, then flush so the
    # DELETE is visible within this session before the parallel gather starts.
    await db.execute(delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id))
    await db.flush()

    async def _gen(platform: str) -> tuple[str, str, str]:
        sibs = [p for p in enabled if p != platform]
        ctx = _build_brief_context(brief, sibs)
        title, body = await _generate_piece_text(
            brand_name=brand_row.name,
            platform=platform,
            prompt_text=prompt_row.text,
            visibility_pct=visibility_pct,
            profile_context=profile_context,
            response_analysis=response_analysis,
            brief_context=ctx,
            tier=tier,
        )
        return platform, title, body

    results = await asyncio.gather(*[_gen(p) for p in enabled], return_exceptions=True)

    any_failed = False
    for r in results:
        if isinstance(r, Exception):
            logger.exception("Piece generation failed: %s", r)
            any_failed = True
            continue
        platform, title, body = r
        db.add(ContentDraft(
            brand_id=cluster.brand_id,
            prompt_id=cluster.prompt_id,
            cluster_id=cluster.id,
            platform=platform,
            status="draft",
            title=title,
            content_text=body,
            source="cluster",
        ))

    cluster.status = "partial_failed" if any_failed else "ready"
    cluster.last_generated_at = datetime.now(UTC)
    cluster.version += 1
    await db.commit()

    # Pillar proposal is non-fatal
    try:
        await propose_pillar(db, cluster)
    except Exception:
        logger.exception("Pillar proposal failed for cluster %s", cluster.id)

    await db.refresh(cluster)
    return cluster


async def regenerate_piece(
    db: AsyncSession,
    *,
    cluster_id: int,
    platform: str,
    tier: str | None,
) -> ContentDraft:
    if platform not in CLUSTER_PLATFORMS:
        raise ValueError(f"Unsupported cluster platform: {platform}")

    cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
    brief_row = (await db.execute(
        select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id)
    )).scalar_one_or_none()
    if brief_row is None:
        # No brief yet — generate one
        brief_row = await build_brief(db, cluster=cluster, tier=tier)

    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_row = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    from app.services.drafting_service import (
        _analyze_responses_for_prompt,
        _get_prompt_visibility,
        _load_profile_context,
    )
    profile_context = await _load_profile_context(db, cluster.brand_id)
    # NOTE: _analyze_responses_for_prompt requires brand_id as second arg
    response_analysis = await _analyze_responses_for_prompt(db, cluster.brand_id, cluster.prompt_id)
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)
    sibs = [p for p in enabled if p != platform]
    ctx = _build_brief_context(brief_row, sibs)

    title, body = await _generate_piece_text(
        brand_name=brand_row.name,
        platform=platform,
        prompt_text=prompt_row.text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        brief_context=ctx,
        tier=tier,
    )

    existing = (await db.execute(
        select(ContentDraft).where(
            ContentDraft.cluster_id == cluster.id,
            ContentDraft.platform == platform,
        )
    )).scalar_one_or_none()

    if existing:
        existing.title = title
        existing.content_text = body
        existing.status = "draft"
        draft = existing
    else:
        draft = ContentDraft(
            brand_id=cluster.brand_id,
            prompt_id=cluster.prompt_id,
            cluster_id=cluster.id,
            platform=platform,
            status="draft",
            title=title,
            content_text=body,
            source="cluster",
        )
        db.add(draft)

    await db.commit()
    await db.refresh(draft)
    return draft
