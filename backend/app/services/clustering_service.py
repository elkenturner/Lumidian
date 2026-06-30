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

from app.database import AsyncSessionLocal

from app.models import (
    Brand,
    BrandContentSettings,
    BrandProfile,
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

# Hard ceiling on a single platform's writer pipeline. asyncio.gather waits for
# every leg, so without this any one hung Claude call freezes the entire batch
# (see SpotitEarly halt-at-prompt-#42 regression).
PIECE_TIMEOUT_SECONDS = 180.0


def _derive_title_fallback(body: str, *, prompt_text: str, platform: str) -> str:
    """Title fallback for platforms whose body has no h1 (x/reddit/quora).

    Order: first sentence of body trimmed to 80 chars → "<platform> draft for <prompt>".
    Never returns "(untitled)".
    """
    import re
    body_clean = (body or "").strip()
    if body_clean:
        parts = re.split(r"(?<=[.!?])\s+|\n", body_clean, maxsplit=1)
        first = (parts[0] if parts else body_clean).strip()
        if first:
            return first[:80].rstrip()
    label = platform.replace("_", " ").title()
    return f"{label} draft for {prompt_text}"[:80].rstrip()

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
        lines.append(
            "POSITIONING CLAIMS — convey these ideas in THIS piece, but in your OWN words. "
            "Do NOT copy them verbatim and do NOT repeat any one of them more than once "
            "(varied wording across pieces is what earns AI citations; identical sentences "
            "read as spam and get removed):"
        )
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
    opportunity_context: str | None = None,
) -> tuple[str, str, float | None, list[RenderedCitation], bool]:
    """Generate one cluster piece via the full content-quality pipeline.

    Delegates to ``drafting_service._generate_with_new_pipeline`` so every
    piece picks up Evidence Pack + critic + rewrite + voice + cross-ref AND the
    citation-integrity stage (claim verify + bounds-drop + support critic)
    according to tier, then renders citations and extracts a title/body.

    Returns ``(title, body, quality_score_or_None, citations, low_evidence)``.
    """
    # Lazy import to avoid the drafting_service ↔ clustering_service cycle
    # introduced by ``dc3c377`` (which routes generate_now through clusters).
    from app.services.drafting_service import _generate_with_new_pipeline

    platform_key = resolve_platform_key(platform)
    spec = PLATFORM_SPECS[platform_key]

    raw_text, quality_score, citations, low_evidence = await _generate_with_new_pipeline(
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
        opportunity_context=opportunity_context,
    )
    # Final polish (same step the gap-draft path applies after the pipeline).
    raw_text = remove_hedging(raw_text)
    title, body = extract_title_and_body(raw_text, platform_key)
    final_title = title or _derive_title_fallback(body, prompt_text=prompt_text, platform=platform)
    return final_title, body, quality_score, citations, low_evidence


async def _resolve_post_targets(
    db: AsyncSession,
    *,
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    prompt_text: str,
    enabled: list[str],
) -> dict[str, dict]:
    """Resolve a concrete post target AND writer context for reddit/quora pieces.

    Reddit → a real validated subreddit, with that subreddit's promo strategy fed
    into the writer so the post fits its rules. Quora → a real question, fed into
    the writer so the piece is written to ANSWER that specific question (not just
    linked to it). Each entry: ``{"brief": <stored on draft.content_brief>,
    "opportunity"?: <opportunity_context>, "brief_append"?: <appended to brief_context>}``.
    Fully best-effort + timeout-bounded — any failure leaves the piece untargeted,
    never blocks generation.
    """
    targets: dict[str, dict] = {}
    if "reddit" in enabled:
        try:
            from app.services.drafting.platforms import (
                build_subreddit_strategy,
                classify_subreddit,
            )
            from app.services.reddit_scanner_service import (
                find_first_valid_subreddit,
                get_relevant_subreddits,
            )
            prof = (await db.execute(
                select(BrandProfile).where(BrandProfile.brand_id == brand_id)
            )).scalar_one_or_none()
            prompts = list((await db.execute(
                select(Prompt).where(Prompt.brand_id == brand_id)
            )).scalars().all())
            subs = await asyncio.wait_for(
                asyncio.to_thread(
                    get_relevant_subreddits,
                    prof.company_description if prof else None,
                    [p.text for p in prompts], 5,
                ),
                timeout=12,
            )
            sub = await asyncio.wait_for(find_first_valid_subreddit(subs), timeout=8) if subs else None
            if sub:
                strategy = build_subreddit_strategy(sub, brand_name, classify_subreddit(sub))
                targets["reddit"] = {
                    "brief": f"r/{sub}",
                    "brief_append": (
                        f"SUBREDDIT TARGET: this post will be published in r/{sub}. "
                        f"Write it to fit that community.\n{strategy}"
                    ),
                }
        except Exception as exc:
            logger.warning("cluster reddit target resolve skipped: %s", exc)
    if "quora" in enabled:
        try:
            from app.services.quora_search_service import search_quora_questions
            qs = await asyncio.wait_for(
                search_quora_questions(prompt_text, cache_key=prompt_id), timeout=10,
            )
            if qs:
                q = qs[0]
                title, url, snippet = q.get("title", ""), q.get("url", ""), q.get("snippet", "")
                targets["quora"] = {
                    "brief": url,
                    "opportunity": (
                        f"QUESTION: {title}\nURL: {url}\n\n"
                        + (f"QUESTION CONTEXT (excerpt):\n{snippet}\n\n" if snippet else "")
                        + f"Write a Quora answer that directly addresses THIS specific question, "
                        f"and naturally incorporates relevant information about {brand_name}."
                    ),
                }
        except Exception as exc:
            logger.warning("cluster quora target resolve skipped: %s", exc)
    return targets


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
            tier=c.tier,
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
    from app.services.cluster_evidence import (
        build_cluster_pack,
        build_cluster_pack_from_brand_authority,
        PackGateError,
    )
    prompt_row = (await db.execute(
        select(Prompt).where(Prompt.id == cluster.prompt_id)
    )).scalar_one()

    # Tracks whether we fell through to the brand-as-authority soft-fail; sets
    # the final cluster status to "ready_low_evidence" instead of "ready" so
    # the UI can flag these pieces for extra review.
    low_evidence = False

    if rebuild_brief or brief.evidence_pack_id is None:
        try:
            pack = await build_cluster_pack(
                db, cluster=cluster, prompt_text=prompt_row.text,
                key_claims=brief.key_claims or [], version=brief.version,
            )
            brief.evidence_pack_id = pack.id
            await db.commit()
        except PackGateError as exc:
            # Citations + Serper both failed authority gate. For niche
            # commercial prompts (no neutral third-party authority exists),
            # fall back to brand-as-authority: use the brand's own profile +
            # crawled site pages. The claim-verifier critic in _gen keeps
            # fabrication in check.
            logger.info(
                "cluster %d: external authority gate failed (%s) — trying brand-as-authority",
                cluster.id, exc,
            )
            pack = await build_cluster_pack_from_brand_authority(
                db, cluster=cluster, version=brief.version,
            )
            if pack is None:
                # Even brand-authority pack is empty (no profile, no crawl) —
                # genuinely nothing to ground the writer with.
                cluster.status = "briefing_failed"
                cluster.failure_reason = str(exc)
                await db.commit()
                return cluster
            brief.evidence_pack_id = pack.id
            low_evidence = True
            await db.commit()
    else:
        from app.models import ContentEvidencePack as PackModel
        pack = await db.get(PackModel, brief.evidence_pack_id)
        # Existing pack from a prior run: detect brand-authority pack so we
        # preserve the low-evidence status on regen-without-rebuild-brief.
        if pack is not None and pack.sources and pack.sources[0].get("tier") == "brand":
            low_evidence = True

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

    # Resolve concrete post targets (real subreddit / Quora question) so reddit &
    # quora pieces tell the operator exactly where to publish. Best-effort.
    post_targets = await _resolve_post_targets(
        db, brand_id=cluster.brand_id, brand_name=brand_row.name,
        prompt_id=cluster.prompt_id, prompt_text=prompt_row.text, enabled=enabled,
    )

    # Drop ONLY working drafts before regen. Posted drafts are immutable
    # historical record — never deleted by any regen path.
    await db.execute(
        delete(ContentDraft).where(
            ContentDraft.cluster_id == cluster.id,
            ContentDraft.status.in_(["draft", "approved", "failed"]),
        )
    )
    await db.flush()

    async def _gen(platform: str):
        ctx = _build_brief_context(brief, sibling_platforms=[])
        target = post_targets.get(platform, {})
        # Reddit: tailor the post to the resolved subreddit's rules (appended to
        # the brief). Quora: write the answer TO the resolved real question.
        if target.get("brief_append"):
            ctx = ctx + "\n\n" + target["brief_append"]
        try:
            # Each piece runs in the asyncio.gather below, so it MUST use its own
            # DB session — a single AsyncSession shared across concurrent coroutines
            # raises "session is in 'prepared' state" (it's not concurrency-safe).
            # The main `db` is used only for the single-threaded draft writes after
            # the gather. Generation only reads from this per-piece session.
            async with AsyncSessionLocal() as piece_db:
                title, body, q, citations, low_ev = await asyncio.wait_for(
                    _generate_piece_text(
                        piece_db, brand_id=cluster.brand_id, brand_name=brand_row.name,
                        prompt_id=cluster.prompt_id, platform=platform,
                        prompt_text=prompt_row.text, visibility_pct=visibility_pct,
                        profile_context=profile_context,
                        response_analysis=response_analysis,
                        brief_context=ctx, tier=tier,
                        opportunity_context=target.get("opportunity"),
                    ),
                    timeout=PIECE_TIMEOUT_SECONDS,
                )
            # NOTE: the citation SUPPORT CRITIC now runs INSIDE the pipeline
            # (drafting_service._verify_citations), BEFORE render, against the same
            # per-piece pack the [SN] markers map to. It used to run here on the
            # already-rendered body (markers gone) with the wrong (ORM cluster)
            # pack — a guaranteed no-op. Don't re-add it here.
            # Claim verifier — strips factual claims not supported by the pack.
            # Runs on every paid tier so the brand-as-authority soft-fail path
            # can't ship fabricated stats. Best-effort; failures leave body as-is.
            if tier in ("basic", "starter", "pro"):
                from app.services.drafting.claim_verifier import verify_claims
                body = await verify_claims(
                    draft_text=body,
                    sources=(pack.sources if pack else []),
                )
            # Asymmetric pillar reference
            pillar = cluster.pillar_url if cluster.pillar_mode == "attached" else None
            body = append_pillar_reference(
                text=body, platform=platform, pillar_url=pillar,
            )
            # A piece off the brand-authority soft-fail pack is inherently thin.
            low_ev = low_ev or low_evidence
            return ("ok", platform, title, body, q, citations, low_ev)
        except asyncio.TimeoutError:
            logger.warning("Piece %s timed out after %ss", platform, PIECE_TIMEOUT_SECONDS)
            return ("fail", platform, f"timeout after {PIECE_TIMEOUT_SECONDS:.0f}s")
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
        _, platform, title, body, q, citations, low_ev = r
        draft = ContentDraft(
            brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
            cluster_id=cluster.id, platform=platform,
            status="draft", title=title,  # already non-empty via _derive_title_fallback
            content_text=body, source="cluster",
            content_brief=post_targets.get(platform, {}).get("brief"),
            quality_score=q, generation_state="done",
            low_evidence=low_ev,
        )
        db.add(draft)
        drafts_with_citations.append((draft, citations))

    await db.flush()
    for draft, citations in drafts_with_citations:
        await _persist_citations_and_summary(
            db, draft=draft, citations=citations, query=prompt_row.text,
        )

    if any_failed:
        cluster.status = "generation_partial"
    elif low_evidence:
        # Pieces were written from a brand-as-authority pack — flag for review
        # so the user knows the content lacks external corroboration.
        cluster.status = "ready_low_evidence"
    else:
        cluster.status = "ready"
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

    title, body, quality_score, citations, low_ev = await _generate_piece_text(
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
        existing.low_evidence = low_ev
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
            low_evidence=low_ev,
        )
        db.add(draft)

    await db.flush()
    await _persist_citations_and_summary(
        db, draft=draft, citations=citations, query=prompt_row.text,
    )

    await db.commit()
    await db.refresh(draft)
    return draft
