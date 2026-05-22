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

# Platforms that get a soft "further reading" reference to the cluster's
# Medium piece (or own-site pillar). Asymmetric — Medium/Wikipedia get nothing.
_APPENDS_PILLAR_REF = {
    "linkedin_post", "linkedin_reply", "linkedin_article",
    "reddit", "reddit_reply",
    "quora",
    "x_post", "x_thread", "x_reply",
}


def append_pillar_reference(
    *,
    text: str,
    platform: str,
    pillar_url: str | None,
) -> str:
    """Append an idiomatic 'further reading' link to the cluster's pillar.

    Deterministic — no LLM. Medium and Wikipedia receive nothing.
    """
    if not pillar_url:
        return text
    if platform not in _APPENDS_PILLAR_REF:
        return text

    if platform.startswith("x_"):
        # Space-constrained — bare URL, no label
        return text.rstrip() + f"\n{pillar_url}"
    if platform.startswith("reddit"):
        return text.rstrip() + f"\n\nI wrote a longer version on Medium: {pillar_url}"
    # linkedin_*, quora
    return text.rstrip() + f"\n\nFurther reading on Medium: {pillar_url}"


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
    rebuild_brief: bool = True,
) -> ContentCluster:
    """Regenerate all pieces in a cluster.

    rebuild_brief=True  (default): runs the brief LLM + builds a fresh
        cluster evidence pack. Use for 'Rebuild brief & pieces'.
    rebuild_brief=False: reuses the existing head brief + most recent
        evidence pack. Use for 'Regenerate pieces'.
    """
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id)
    )).scalar_one()

    # --- BRIEFING PHASE ---
    cluster.status = "briefing"
    cluster.failure_reason = None
    await db.commit()

    if rebuild_brief:
        try:
            brief = await build_brief(db, cluster=cluster, tier=tier)
        except Exception as exc:
            logger.exception("Brief LLM failed for cluster %s: %s", cluster.id, exc)
            cluster.status = "briefing_failed"
            cluster.failure_reason = "brief_llm_failure"
            await db.commit()
            return cluster
    else:
        head = (await db.execute(
            select(ContentBrief).where(ContentBrief.cluster_id == cluster.id)
            .order_by(ContentBrief.version.desc())
        )).scalars().first()
        if head is None:
            cluster.status = "briefing_failed"
            cluster.failure_reason = "no_brief_to_reuse"
            await db.commit()
            return cluster
        brief = head

    # --- EVIDENCE PACK PHASE ---
    from app.services.cluster_evidence import build_cluster_pack, PackGateError
    prompt_row = (await db.execute(
        select(Prompt).where(Prompt.id == cluster.prompt_id)
    )).scalar_one()

    if rebuild_brief or brief.evidence_pack_id is None:
        try:
            pack = await build_cluster_pack(
                db, cluster=cluster, prompt_text=prompt_row.text,
                key_claims=brief.key_claims or [], version=brief.version,
            )
            brief.evidence_pack_id = pack.id
            await db.commit()
        except PackGateError as exc:
            cluster.status = "briefing_failed"
            cluster.failure_reason = str(exc)
            await db.commit()
            return cluster
    else:
        from app.models import ContentEvidencePack as PackModel
        pack = await db.get(PackModel, brief.evidence_pack_id)

    # --- GENERATION PHASE ---
    cluster.status = "generating"
    await db.commit()

    brand_row = (await db.execute(
        select(Brand).where(Brand.id == cluster.brand_id)
    )).scalar_one()
    from app.services.drafting_service import (
        _analyze_responses_for_prompt,
        _get_prompt_visibility,
        _load_profile_context,
    )
    profile_context = await _load_profile_context(db, cluster.brand_id)
    response_analysis = await _analyze_responses_for_prompt(
        db, cluster.brand_id, cluster.prompt_id,
    )
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)

    # Drop existing drafts before regen
    await db.execute(
        delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )
    await db.flush()

    async def _gen(platform: str):
        ctx = _build_brief_context(brief, sibling_platforms=[])
        try:
            title, body, q, citations = await _generate_piece_text(
                db, brand_id=cluster.brand_id, brand_name=brand_row.name,
                prompt_id=cluster.prompt_id, platform=platform,
                prompt_text=prompt_row.text, visibility_pct=visibility_pct,
                profile_context=profile_context,
                response_analysis=response_analysis,
                brief_context=ctx, tier=tier,
            )
            # L3 critic on Pro tier only
            if tier == "pro" and citations:
                from app.services.citation_critic import critique_citations
                body = await critique_citations(
                    text=body,
                    pack_sources=(pack.sources if pack else []),
                )
            # Asymmetric pillar reference
            pillar = cluster.pillar_url if cluster.pillar_mode == "attached" else None
            body = append_pillar_reference(
                text=body, platform=platform, pillar_url=pillar,
            )
            return ("ok", platform, title, body, q, citations)
        except Exception as exc:
            logger.exception("Piece %s failed: %s", platform, exc)
            return ("fail", platform, str(exc))

    results = await asyncio.gather(*[_gen(p) for p in enabled])

    any_failed = False
    drafts_with_citations: list[tuple[ContentDraft, list]] = []
    for r in results:
        if r[0] == "fail":
            any_failed = True
            _, platform, reason = r
            db.add(ContentDraft(
                brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
                cluster_id=cluster.id, platform=platform,
                status="draft", title=None,
                content_text="", source="cluster",
                generation_state="failed", failure_reason=reason[:255],
            ))
            continue
        _, platform, title, body, q, citations = r
        draft = ContentDraft(
            brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
            cluster_id=cluster.id, platform=platform,
            status="draft", title=title or "(untitled)",
            content_text=body, source="cluster",
            quality_score=q, generation_state="done",
        )
        db.add(draft)
        drafts_with_citations.append((draft, citations))

    await db.flush()
    for draft, citations in drafts_with_citations:
        await _persist_citations_and_summary(
            db, draft=draft, citations=citations, query=prompt_row.text,
        )

    cluster.status = "generation_partial" if any_failed else "ready"
    cluster.last_generated_at = datetime.now(UTC)
    cluster.version += 1
    cluster.last_brief_id = brief.id  # promote brief (even on partial — brief succeeded)
    await db.commit()

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
