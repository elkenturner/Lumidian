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
    utcnow,
)
from app.services.cluster_brief import build_brief
from app.services.cluster_pillar import propose_pillar
from app.services.drafting.citations import RenderedCitation
from app.services.drafting.pipeline import extract_title_and_body, remove_hedging
from app.services.drafting.platforms import PLATFORM_SPECS, resolve_platform_key
from app.services.drafting.voice import generate_draft_summary

logger = logging.getLogger(__name__)

CLUSTER_PLATFORMS: tuple[str, ...] = ("owned_site", "linkedin", "medium", "reddit", "quora", "x")

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


async def _gen_owned_site_piece(
    *, cluster, brand_row, prompt_row, brief_context, pack, tier, low_evidence: bool = False,
):
    """Cluster anchor piece: the brand's own site. Evidence = the cluster pack.

    Mirrors the owned_site branch in drafting_service.py's onboarding/manual
    draft flow, but is fed by the CLUSTER evidence pack (not the brand's
    crawled publications) and threads the shared cluster brief through so the
    page anchors the same positioning as the other platform pieces.

    `low_evidence`: the cluster-level "brand-as-authority soft-fail" flag
    (see `_gen` in `regenerate_cluster`). Folded into the returned low_ev the
    same way every other platform does (`low_ev or low_evidence`) so the
    anchor piece doesn't understate its evidence quality relative to its
    siblings just because its own pack slice happened to be non-empty.
    """
    import json as _json
    from datetime import datetime, timezone
    from app.services.drafting.client import call_claude
    from app.services.drafting.platforms import PLATFORM_MAX_TOKENS
    from app.services.drafting import owned_site

    try:
        async with AsyncSessionLocal() as piece_db:
            prof = (await piece_db.execute(
                select(BrandProfile).where(BrandProfile.brand_id == cluster.brand_id)
            )).scalar_one_or_none()
        brand_dict = {
            "name": brand_row.name,
            "description": prof.company_description if prof else None,
            "url": brand_row.website_url or None,
            "audience": prof.target_audience if prof else None,
        }
        evidence = [
            {"title": s.get("title"), "url": s.get("url", ""), "snippet": s.get("snippet", "")}
            for s in (pack.sources if pack else [])
            if s.get("url") and not str(s.get("url")).startswith("internal://")
        ] or None
        from app.services.drafting_service import _voice_directive_from_profile
        voice = _voice_directive_from_profile(prof)

        async def _writer(p: str) -> str:
            return await call_claude(p, max_tokens=PLATFORM_MAX_TOKENS.get("owned_site", 3000))

        owned = await asyncio.wait_for(
            owned_site.generate_owned_site_draft(
                writer=_writer, brand=brand_dict, target_query=prompt_row.text,
                evidence=evidence, voice=voice, brief=brief_context,
                date_published=datetime.now(timezone.utc).date().isoformat(),
            ),
            timeout=PIECE_TIMEOUT_SECONDS,
        )
        body = (
            owned.body
            + "\n\n---\nSchema markup (JSON-LD — paste inside the page's <head>):\n\n```json\n"
            + _json.dumps(owned.jsonld, indent=2)
            + "\n```\n"
        )
        title = owned.jsonld.get("headline") or _derive_title_fallback(
            owned.body, prompt_text=prompt_row.text, platform="owned_site")
        low_ev = (not evidence) or low_evidence
        return ("ok", "owned_site", title, body, owned.anti_ai_score, [], low_ev)
    except asyncio.TimeoutError:
        return ("fail", "owned_site", f"timeout after {PIECE_TIMEOUT_SECONDS:.0f}s")
    except Exception as exc:
        logger.exception("owned_site piece failed: %s", exc)
        return ("fail", "owned_site", str(exc))

# Platforms that get a soft "further reading" reference to the cluster's
# Medium piece (or own-site pillar). Reddit is EXCLUDED — outbound links to
# own content are the classic spam fingerprint there (July 2026 research);
# Medium/Wikipedia get nothing either.
_APPENDS_PILLAR_REF = {
    "linkedin_post", "linkedin_reply", "linkedin_article",
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
    # linkedin_*, quora — the pillar is the brand's own-site page, not Medium.
    return text.rstrip() + f"\n\nMore detail here: {pillar_url}"


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
        created_at=utcnow(),
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
    angle_directive: str | None = None,
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
        angle_directive=angle_directive,
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
            # 1) Prefer a real, relevant, un-actioned thread — replies to open
            # evergreen threads are the highest-value Reddit play for AI
            # retrieval (July 2026 research). Best-effort like everything here.
            from app.models import ContentOpportunity
            opp = (await db.execute(
                select(ContentOpportunity)
                .where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.prompt_id == prompt_id,
                    ContentOpportunity.platform == "reddit",
                    ContentOpportunity.status == "new",
                    ContentOpportunity.relevance_score >= 60,
                )
                .order_by(ContentOpportunity.relevance_score.desc())
                .limit(1)
            )).scalars().first()
            if opp is not None:
                sub = (opp.subreddit or "").removeprefix("r/")
                strategy = (
                    build_subreddit_strategy(sub, brand_name, classify_subreddit(sub))
                    if sub else ""
                )
                preview = getattr(opp, "body_preview", None) or ""
                targets["reddit"] = {
                    "brief": opp.thread_url,
                    "target_title": (opp.thread_title or "")[:300] or None,
                    "platform_key_override": "reddit_comment",
                    "opportunity_id": opp.id,
                    "subreddit": sub or None,
                    "opportunity": (
                        f"THREAD: {opp.thread_title}\nURL: {opp.thread_url}\n"
                        + (f"SUBREDDIT: r/{sub}\n" if sub else "")
                        + (f"THREAD EXCERPT:\n{preview}\n" if preview else "")
                        + f"\nWrite a top-level comment that directly answers this thread."
                        + (f"\n{strategy}" if strategy else "")
                    ),
                }
            else:
                # 2) Fall back to a standalone post in a validated subreddit
                #    (existing behavior).
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
                        "target_title": None,
                        "subreddit": sub,
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
                    "target_title": (title or "")[:300] or None,
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
        build_cluster_pack_ungated,
        pack_meets_gate,
        PackGateError,
        SearchUnavailableError,
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
        except SearchUnavailableError as exc:
            # Serper was throttled on every query and returned nothing at
            # all — distinct from a genuine no-authority result. Retryable
            # via the sweep's retry_failed mode, so don't fall through to the
            # brand-authority chain; a retry once the provider recovers is
            # more useful than a synthesized low-evidence pack.
            logger.info(
                "cluster %d: search provider unavailable (%s) — marking retryable",
                cluster.id, exc,
            )
            cluster.status = "briefing_failed"
            cluster.failure_reason = str(exc)
            await db.commit()
            return cluster
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
            if pack is None and exc.sources:
                # No profile/crawl to lean on, but the web DID return sources —
                # generate from them ungated rather than producing nothing.
                # ready_low_evidence + claim verifier keep it honest.
                logger.info(
                    "cluster %d: proceeding ungated with %d low-authority sources",
                    cluster.id, len(exc.sources),
                )
                pack = await build_cluster_pack_ungated(
                    db, cluster=cluster, sources=exc.sources, version=brief.version,
                )
            if pack is None:
                # Truly nothing anywhere — no profile, no crawl, no sources at all.
                cluster.status = "briefing_failed"
                cluster.failure_reason = "no_sources_found"
                await db.commit()
                return cluster
            brief.evidence_pack_id = pack.id
            low_evidence = True
            await db.commit()
    else:
        from app.models import ContentEvidencePack as PackModel
        pack = await db.get(PackModel, brief.evidence_pack_id)
        # Existing pack from a prior run: re-check the pack's own sources
        # against the current authority gate rather than sniffing for the
        # synthetic "brand" tier. This also catches ungated T1/T2/T3 packs
        # (from build_cluster_pack_ungated) that failed the gate — those were
        # previously missed and would silently flip to "ready" on regen.
        # Brand-authority packs count zero T1/T2 in gate_pack, so they still
        # yield low_evidence=True — this strictly generalizes the old check.
        low_evidence = pack is not None and not pack_meets_gate(pack.sources or [])

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
        # Reddit thread routing: generate via the reddit_comment spec while the
        # draft's stored platform stays the base "reddit" card slot.
        platform_for_generation = target.get("platform_key_override") or platform
        if platform == "owned_site":
            return await _gen_owned_site_piece(
                cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
                brief_context=ctx, pack=pack, tier=tier, low_evidence=low_evidence,
            )
        # Resolve the insider/neutral angle for this piece. Both reddit target
        # modes (routed thread + standalone post) carry a bare "subreddit" key.
        # Use the resolved platform KEY (e.g. "linkedin" -> "linkedin_article")
        # so it matches the matrix's platform vocabulary.
        from app.services.drafting.angle import angle_directive as _angle_text, effective_angle
        angle_platform_key = resolve_platform_key(platform_for_generation)
        sub_cls = None
        if angle_platform_key.startswith("reddit") and target.get("subreddit"):
            from app.services.drafting.platforms import classify_subreddit
            sub_cls = classify_subreddit(target["subreddit"])
        resolved_angle = effective_angle(angle_platform_key, cluster.angle or "auto", sub_cls)
        angle_text = _angle_text(resolved_angle, brand_row.name)
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
                        prompt_id=cluster.prompt_id, platform=platform_for_generation,
                        prompt_text=prompt_row.text, visibility_pct=visibility_pct,
                        profile_context=profile_context,
                        response_analysis=response_analysis,
                        brief_context=ctx, tier=tier,
                        opportunity_context=target.get("opportunity"),
                        angle_directive=angle_text,
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
            # Asymmetric pillar reference. `_APPENDS_PILLAR_REF` keys on the
            # resolved variant vocabulary (linkedin_article, x_thread, ...),
            # not the base platform name this loop iterates over, so resolve
            # before the lookup — otherwise linkedin/x pieces never match and
            # silently never receive the reference.
            pillar = cluster.pillar_url if cluster.pillar_mode == "attached" else None
            body = append_pillar_reference(
                text=body, platform=resolve_platform_key(platform), pillar_url=pillar,
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
                status="failed", title=None,
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
            target_title=post_targets.get(platform, {}).get("target_title"),
            opportunity_id=post_targets.get(platform, {}).get("opportunity_id"),
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

    # Mark any opportunity we routed a reddit piece to as drafted so it isn't
    # re-selected by a future regen. Best-effort — never blocks the cluster.
    # Only mark opportunities whose piece actually generated ("ok") — a
    # failed piece must leave its opportunity untouched so a future regen
    # can retry it, rather than silently burning it on the first attempt.
    ok_platforms = {r[1] for r in results if r[0] == "ok"}
    routed_opp_ids = [
        t["opportunity_id"] for platform, t in post_targets.items()
        if platform in ok_platforms and t.get("opportunity_id")
    ]
    if routed_opp_ids:
        from app.models import ContentOpportunity
        for o in (await db.execute(
            select(ContentOpportunity).where(ContentOpportunity.id.in_(routed_opp_ids))
        )).scalars().all():
            o.status = "drafted"

    if any_failed:
        cluster.status = "generation_partial"
    elif low_evidence:
        # Pieces were written from a brand-as-authority pack — flag for review
        # so the user knows the content lacks external corroboration.
        cluster.status = "ready_low_evidence"
    else:
        cluster.status = "ready"
    cluster.last_generated_at = utcnow()
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

    if platform == "owned_site":
        # Anchor piece — must go through the dedicated owned_site generator
        # (JSON-LD, anti-AI gate), not the generic social-piece pipeline.
        pack = None
        if brief_row.evidence_pack_id is not None:
            from app.models import ContentEvidencePack as PackModel
            pack = await db.get(PackModel, brief_row.evidence_pack_id)
        # This function has no separate briefing-phase state tracking a
        # brand-authority soft-fail (unlike regenerate_cluster's `_gen`), so
        # derive it the same way regenerate_cluster does when reusing an
        # existing pack: re-check the pack's own sources against the
        # authority gate. Brand-authority packs count zero T1/T2 sources and
        # so still yield low_evidence=True.
        from app.services.cluster_evidence import pack_meets_gate
        low_evidence = pack is not None and not pack_meets_gate(pack.sources or [])
        res = await _gen_owned_site_piece(
            cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
            brief_context=ctx, pack=pack, tier=tier, low_evidence=low_evidence,
        )
        if res[0] == "fail":
            raise RuntimeError(f"owned_site piece generation failed: {res[2]}")
        _, _, title, body, quality_score, citations, low_ev = res
    else:
        # No target-resolution pass here (unlike regenerate_cluster's `_gen`),
        # so there's no known subreddit to classify — falls back to "neutral"
        # for auto reddit pieces, same as any other unclassified subreddit.
        from app.services.drafting.angle import angle_directive as _angle_text, effective_angle
        resolved_angle = effective_angle(resolve_platform_key(platform), cluster.angle or "auto", None)
        angle_text = _angle_text(resolved_angle, brand_row.name)
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
            angle_directive=angle_text,
        )

    # Exclude posted drafts: a piece regen must never mutate a draft the user
    # has already published. Order by id desc so, if more than one non-posted
    # row somehow exists for this (cluster, platform), the newest wins instead
    # of raising MultipleResultsFound.
    existing = (await db.execute(
        select(ContentDraft).where(
            ContentDraft.cluster_id == cluster.id,
            ContentDraft.platform == platform,
            ContentDraft.status != "posted",
        ).order_by(ContentDraft.id.desc())
    )).scalars().first()

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
