"""Cluster orchestrator: brief generation + parallel piece generation + pillar.

Piece generation delegates to ``drafting_service._generate_with_new_pipeline`` so
every cluster piece flows through Layer 1 (Evidence Pack) + Layer 2 (critic +
Opus rewrite) + Layer 3 (voice anchor + cross-references) per the tier matrix,
with citations resolved and persisted. The cluster's shared ``ContentBrief`` is
forwarded as ``brief_context`` into the writer prompt.
"""
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
    ContentDraftCitation,
    Prompt,
)
from app.services.cluster_brief import build_brief
from app.services.cluster_pillar import propose_pillar
from app.services.drafting.citations import RenderedCitation
from app.services.drafting.pipeline import extract_title_and_body, remove_hedging
from app.services.drafting.platforms import PLATFORM_SPECS, resolve_platform_key
from app.services.drafting.voice import generate_draft_summary

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
    """Brief context fed to every piece in the cluster.

    Note: sibling_platforms is intentionally NOT included in the writer prompt.
    Dangling sibling platform names invites the LLM to fabricate
    cross-references it can't possibly know (the sibling text doesn't exist
    yet when this piece is being generated). Cross-references are inserted
    deterministically post-generation, see `_append_pillar_reference`.
    The parameter is retained in the signature for call-site compatibility.
    """
    _ = sibling_platforms  # explicitly unused
    lines = [f"POSITIONING: {brief.positioning}"]
    if brief.canonical_phrasings:
        lines.append("CANONICAL PHRASINGS — VERBATIM REQUIRED (include each at least once, word-for-word):")
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
    return "\n".join(lines)


async def _generate_piece_text(
    db: AsyncSession,
    *,
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    brief_context: str,
    tier: str | None,
) -> tuple[str, str, float | None, list[RenderedCitation]]:
    """Generate one cluster piece via the full content-quality pipeline.

    Delegates to ``drafting_service._generate_with_new_pipeline`` so every
    piece picks up Evidence Pack + critic + rewrite + voice + cross-ref
    according to tier, then renders citations and extracts a title/body.

    Returns ``(title, body, quality_score_or_None, citations)``.
    """
    # Lazy import to avoid the drafting_service ↔ clustering_service cycle
    # introduced by ``dc3c377`` (which routes generate_now through clusters).
    from app.services.drafting_service import _generate_with_new_pipeline

    platform_key = resolve_platform_key(platform)
    spec = PLATFORM_SPECS[platform_key]

    raw_text, quality_score, citations = await _generate_with_new_pipeline(
        brand_id=brand_id,
        brand_name=brand_name,
        prompt_id=prompt_id,
        prompt_text=prompt_text,
        platform_key=platform_key,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        tier=tier,
        db=db,
        brief_context=brief_context,
    )
    # Final polish (same step the gap-draft path applies after the pipeline).
    raw_text = remove_hedging(raw_text)
    title, body = extract_title_and_body(raw_text, platform_key)
    return (title or "(untitled)"), body, quality_score, citations


async def _persist_citations_and_summary(
    db: AsyncSession,
    *,
    draft: ContentDraft,
    citations: list[RenderedCitation],
    query: str,
) -> None:
    """Attach ContentDraftCitation rows + cache a Haiku summary on the draft.

    Both writes are best-effort: a Haiku failure or a citation insert failure
    must not block the cluster from saving the draft itself.
    """
    for c in citations:
        db.add(ContentDraftCitation(
            draft_id=draft.id,
            source_ref=c.source_ref,
            url=c.url,
            title=c.title,
            position_marker=c.position_marker,
        ))
    try:
        summary = await generate_draft_summary(
            draft_text=draft.content_text or "", query=query,
        )
        draft.summary = (summary or "")[:500] or None
    except Exception as exc:
        logger.warning(
            "Draft summary generation failed for cluster draft %s: %s",
            draft.id, exc,
        )


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

    async def _gen(platform: str) -> tuple[str, str, str, float | None, list[RenderedCitation]]:
        sibs = [p for p in enabled if p != platform]
        ctx = _build_brief_context(brief, sibs)
        title, body, quality_score, citations = await _generate_piece_text(
            db,
            brand_id=cluster.brand_id,
            brand_name=brand_row.name,
            prompt_id=cluster.prompt_id,
            platform=platform,
            prompt_text=prompt_row.text,
            visibility_pct=visibility_pct,
            profile_context=profile_context,
            response_analysis=response_analysis,
            brief_context=ctx,
            tier=tier,
        )
        return platform, title, body, quality_score, citations

    results = await asyncio.gather(*[_gen(p) for p in enabled], return_exceptions=True)

    any_failed = False
    drafts_with_citations: list[tuple[ContentDraft, list[RenderedCitation]]] = []
    for r in results:
        if isinstance(r, Exception):
            logger.exception("Piece generation failed: %s", r)
            any_failed = True
            continue
        platform, title, body, quality_score, citations = r
        draft = ContentDraft(
            brand_id=cluster.brand_id,
            prompt_id=cluster.prompt_id,
            cluster_id=cluster.id,
            platform=platform,
            status="draft",
            title=title,
            content_text=body,
            source="cluster",
            quality_score=quality_score,
        )
        db.add(draft)
        drafts_with_citations.append((draft, citations))

    # Flush so each draft gets an id, then attach citations + per-draft summary.
    await db.flush()
    for draft, citations in drafts_with_citations:
        await _persist_citations_and_summary(
            db, draft=draft, citations=citations, query=prompt_row.text,
        )

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

    title, body, quality_score, citations = await _generate_piece_text(
        db,
        brand_id=cluster.brand_id,
        brand_name=brand_row.name,
        prompt_id=cluster.prompt_id,
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
        existing.quality_score = quality_score
        # Replace prior citations so the row reflects the regenerated body.
        await db.execute(
            delete(ContentDraftCitation).where(ContentDraftCitation.draft_id == existing.id)
        )
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
            quality_score=quality_score,
        )
        db.add(draft)

    await db.flush()
    await _persist_citations_and_summary(
        db, draft=draft, citations=citations, query=prompt_row.text,
    )

    await db.commit()
    await db.refresh(draft)
    return draft
