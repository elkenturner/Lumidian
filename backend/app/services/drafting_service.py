"""
Drafting Service — Phase 2 dynamic drafting engine.

Improvements over content_service.py:
- Pulls the full BrandProfile as context (description, key stats, tone, approved language)
- Reads stored LLM responses for the target prompt to understand the current narrative
- Generates platform-appropriate content that addresses the *specific* gap
- Enforces strict editorial style rules
- Calculates an estimated visibility impact score for each draft
- Supports opportunity-based drafting (reply to a specific opportunity thread)

Public API
----------
generate_gap_draft(db, brand_id, prompt_id, platform) -> ContentDraft
generate_opportunity_draft(db, opportunity_id)         -> ContentDraft
auto_draft_top_gaps(db, brand_id, max_gaps=3)         -> list[ContentDraft]
make_cluster_draft(brand_id, prompt_id, cluster_id, **kwargs) -> ContentDraft
    Service-layer factory that enforces cluster_id is set. Use for any new
    draft created after the 2026-05-20 cluster redesign. Legacy creation
    sites (generate_gap_draft, generate_opportunity_draft) remain unchanged
    until their flows are migrated.
"""
from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import func as sqlfunc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandContentSettings,
    BrandProfile,
    ContentDraft,
    ContentDraftCitation,
    ContentGap,
    ContentOpportunity,
    Prompt,
    QueryResult,
    TrackingRun,
    User,
)
from app.models import (
    utcnow as _utcnow,
)
from app.services.drafting import (
    ALL_PLATFORMS,
    CONTENT_PLATFORMS,
    PLATFORM_MAX_TOKENS,
    PLATFORM_SPECS,
    build_prompt,
    build_subreddit_strategy,
    build_wikipedia_prompt,
    call_claude,
    classify_subreddit,
    enforce_x_char_limit,
    estimate_visibility_impact,
    extract_title_and_body,
    parse_wikipedia_draft,
    remove_hedging,
)
from app.services.drafting import anti_ai, owned_site
from app.services.drafting.citations import RenderedCitation, render_citations
from app.services.drafting.critic import (
    REWRITE_THRESHOLD,
    critic_score,
    pick_better,
    rewrite_flagged,
    should_hard_retry,
)
from app.services.drafting.evidence import build_evidence_pack
from app.services.drafting.models import writer_model_for_tier
from app.services.drafting.platforms import resolve_platform_key
from app.services.drafting.voice import (
    generate_draft_summary,
    select_related_draft,
    select_voice_sample,
)

logger = logging.getLogger(__name__)

import re as _re

_CONTROL_CHAR_RE = _re.compile(r'[\x00-\x1f\x7f]')


def _sanitize_user_input(text, max_length: int = 500) -> str:
    """Strip control characters and truncate user-supplied text before LLM injection."""
    if not text:
        return ""
    cleaned = _CONTROL_CHAR_RE.sub("", str(text))
    return cleaned[:max_length]


# ── Build citation ref (re-exported from prompts module for local use) ─────────

def _build_citation_ref(
    publications: list[dict],
    brand_name: str,
    website_url: str | None = None,
) -> str:
    """Build a <ref> citation from publications, website URL, or {{citation needed}}."""
    from app.services.drafting.prompts import _build_citation_ref as _impl
    return _impl(publications, brand_name, website_url)


# ── Brand profile loader ──────────────────────────────────────────────────────

def _extract_publications(profile: BrandProfile) -> list[dict]:
    """Return parsed publications list from the profile, or empty list."""
    if not profile or not profile.publications:
        return []
    try:
        return json.loads(profile.publications)
    except Exception:
        return []


async def _load_profile_context(db: AsyncSession, brand_id: int) -> str:
    """Build a rich text block from the BrandProfile for use in prompts."""
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile: BrandProfile | None = result.scalar_one_or_none()

    if profile is None:
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_result.scalar_one_or_none()
        return f"Brand name: {brand.name if brand else 'Unknown'}\nNo brand profile configured."

    lines = []
    if profile.company_description:
        lines.append(f"Company description:\n{profile.company_description}")

    key_stats = json.loads(profile.key_stats) if profile.key_stats else []
    if key_stats:
        lines.append("Key facts and statistics:\n" + "\n".join(f"  - {s}" for s in key_stats))

    if profile.tone_of_voice:
        lines.append(f"Brand tone of voice: {profile.tone_of_voice}")

    approved = json.loads(profile.approved_language) if profile.approved_language else []
    if approved:
        lines.append("Approved language / preferred terminology:\n" + "\n".join(f"  - {t}" for t in approved))

    prohibited = json.loads(profile.what_not_to_say) if profile.what_not_to_say else []
    if prohibited:
        lines.append("Do NOT use these phrases or claims:\n" + "\n".join(f"  - {p}" for p in prohibited))

    publications = _extract_publications(profile)
    if publications:
        pub_lines = []
        for p in publications:
            parts = filter(None, [p.get("title"), p.get("publisher"), p.get("date"), p.get("url")])
            pub_lines.append("  - " + " | ".join(parts))
        lines.append("Peer-reviewed publications (use for citations):\n" + "\n".join(pub_lines))

    if profile.internal_brand_context:
        lines.append(
            "SUPPLEMENTARY context from company website — use ONLY to fill gaps not covered by the Brand Profile fields above. "
            "Brand Profile always takes priority over this section. Never invent or paraphrase facts from this section "
            "that contradict the Brand Profile:\n" + profile.internal_brand_context[:3000]
        )

    return "\n\n".join(lines) if lines else "No brand profile details available."


async def _load_voice_directive(db: AsyncSession, brand_id: int) -> str | None:
    """Build a focused brand-VOICE directive from existing BrandProfile fields.

    Reuses tone_of_voice + approved_language + what_not_to_say (already captured per
    brand) but surfaces them as one emphatic directive that drives every draft on
    every tier — rather than three lines buried in the profile blob. Returns None
    when the brand has no voice fields set (behavior unchanged for those brands).
    """
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    return _voice_directive_from_profile(result.scalar_one_or_none())


def _voice_directive_from_profile(profile: BrandProfile | None) -> str | None:
    """Pure builder for the voice directive — lets callers that already hold the
    BrandProfile row (e.g. the owned_site branch) reuse it without a second query."""
    if profile is None:
        return None
    parts: list[str] = []
    if profile.tone_of_voice:
        parts.append(f"Tone: {profile.tone_of_voice.strip()}")
    approved = json.loads(profile.approved_language) if profile.approved_language else []
    if approved:
        parts.append("Prefer these words/phrases where natural: " + ", ".join(approved))
    prohibited = json.loads(profile.what_not_to_say) if profile.what_not_to_say else []
    if prohibited:
        parts.append("Never use these phrases or claims: " + ", ".join(prohibited))
    return "\n".join(parts) if parts else None


async def _load_publications(db: AsyncSession, brand_id: int) -> list[dict]:
    """Load publications list directly from BrandProfile."""
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile: BrandProfile | None = result.scalar_one_or_none()
    return _extract_publications(profile) if profile else []


# Public alias so agency router can import from one place
ALL_DRAFT_PLATFORMS = ALL_PLATFORMS

DRAFT_CAP = 20  # default / max cap (pro tier)

TIER_DRAFT_CAPS: dict[str | None, int] = {
    None: 5, "": 5,
    "basic": 10,
    "starter": 20,
    "pro": 20,
}


def get_draft_cap(subscription_tier: str | None = None, brand_type: str = "standard") -> int:
    """Return the draft queue cap for the given tier/brand type."""
    if brand_type == "pitch":
        return 5
    return TIER_DRAFT_CAPS.get(subscription_tier, 5)


async def _resolve_brand_draft_cap(db: AsyncSession, brand_id: int) -> int:
    """Resolve the per-tier draft cap for a brand by loading its owner.
    Falls back to the free-tier cap if brand or owner can't be loaded."""
    from app.models import User as _User

    row = (
        await db.execute(
            select(Brand, _User)
            .join(_User, Brand.user_id == _User.id)
            .where(Brand.id == brand_id)
        )
    ).first()
    if row is None:
        return get_draft_cap(None, "standard")
    brand, user = row
    return get_draft_cap(user.subscription_tier, brand.brand_type or "standard")


async def _get_existing_drafts_for_prompt(
    db: AsyncSession, brand_id: int, prompt_id: int, platform: str
) -> list[ContentDraft]:
    """
    Load existing active or recently-posted drafts for a prompt/platform combination.
    Includes "posted" drafts from the last 30 days so the deduplication context
    instructs Claude to take a completely different angle (different edit, same platform is ok).
    """
    from datetime import timedelta
    recent_cutoff = _utcnow() - timedelta(days=30)
    result = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.platform == platform,
            # Include active queued drafts AND recently posted ones
            (
                ContentDraft.status.in_(["draft", "approved"]) |
                (
                    (ContentDraft.status == "posted") &
                    (ContentDraft.created_at >= recent_cutoff)
                )
            ),
        )
        .order_by(ContentDraft.created_at.desc())
        .limit(5)
    )
    return list(result.scalars().all())


async def _count_drafts_by_status(
    db: AsyncSession, brand_id: int, status: str
) -> int:
    """Count drafts in a given status for a brand."""
    result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == status,
        )
    )
    return result.scalar_one_or_none() or 0


# ── Response analysis ─────────────────────────────────────────────────────────

async def _analyze_responses_for_prompt(
    db: AsyncSession, brand_id: int, prompt_id: int
) -> str:
    """
    Read the most recent stored LLM responses for a prompt.
    Returns a summary of what is currently being said and what is missing.
    """

    # Get the latest completed run for this brand
    run_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run = run_result.scalar_one_or_none()
    if latest_run is None:
        return "No tracking data available yet."

    # Load responses for this prompt from the latest run
    qr_result = await db.execute(
        select(QueryResult)
        .where(
            QueryResult.tracking_run_id == latest_run.id,
            QueryResult.prompt_id == prompt_id,
            QueryResult.response_text.isnot(None),
            QueryResult.response_text != "",
        )
        .limit(8)
    )
    responses = list(qr_result.scalars().all())

    if not responses:
        return "No LLM responses stored for this prompt yet."

    mentioning = [r for r in responses if r.mentioned]
    not_mentioning = [r for r in responses if not r.mentioned]

    lines = []

    if mentioning:
        lines.append(
            f"Responses that DO mention the brand ({len(mentioning)}/{len(responses)}):"
        )
        for r in mentioning[:2]:
            preview = (r.response_text or "")[:300].replace("\n", " ")
            lines.append(f"  [{r.model}]: {preview}...")
    else:
        lines.append(f"None of the {len(responses)} recent LLM responses mention the brand.")

    if not_mentioning:
        lines.append(
            "\nResponses that do NOT mention the brand — these show what narrative is missing:"
        )
        for r in not_mentioning[:3]:
            preview = (r.response_text or "")[:300].replace("\n", " ")
            lines.append(f"  [{r.model}]: {preview}...")

    return "\n".join(lines)


# ── Estimated impact calculation ──────────────────────────────────────────────

async def _estimate_impact(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int,
    platform: str,
) -> float:
    """
    Estimate the visibility impact of a draft (0–100).
    Higher = more likely to move the needle.
    """
    from sqlalchemy import Float, cast

    # Gap score for this prompt (0-100)
    gap_result = await db.execute(
        select(ContentGap)
        .where(
            ContentGap.brand_id == brand_id,
            ContentGap.prompt_id == prompt_id,
        )
        .order_by(ContentGap.identified_at.desc())
        .limit(1)
    )
    gap = gap_result.scalar_one_or_none()
    gap_score = gap.gap_score if gap else 50.0

    # Current visibility for this prompt (lower = higher impact potential)
    vis_result = await db.execute(
        sqlfunc.coalesce(
            select(sqlfunc.avg(cast(QueryResult.mentioned, Float)))
            .join(TrackingRun, TrackingRun.id == QueryResult.tracking_run_id)
            .where(
                QueryResult.prompt_id == prompt_id,
                TrackingRun.status == "completed",
            )
            .scalar_subquery(),
            0.0,
        )
    )
    visibility_fraction = vis_result.scalar_one_or_none() or 0.0
    visibility_pct = float(visibility_fraction) * 100.0

    # Platform activity — if no content posted on this platform recently, higher impact
    from datetime import timedelta

    from app.models import ContentPost
    thirty_days_ago = _utcnow() - timedelta(days=30)
    post_result = await db.execute(
        select(sqlfunc.count(ContentPost.id))
        .join(ContentDraft, ContentDraft.id == ContentPost.draft_id)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentPost.platform == platform,
            ContentPost.posted_at >= thirty_days_ago,
        )
    )
    recent_posts = post_result.scalar_one_or_none() or 0

    return estimate_visibility_impact(gap_score, visibility_pct, recent_posts)


# ── Text similarity (orphan-draft matching) ──────────────────────────────────

_SIMILARITY_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "these", "those",
    "have", "has", "had", "but", "not", "are", "was", "were", "will", "would",
    "can", "could", "should", "may", "might", "about", "into", "onto", "than",
    "what", "when", "where", "which", "who", "why", "how", "all", "any",
    "some", "one", "two", "out", "off", "over", "under", "also", "just",
    "like", "very", "more", "most", "such", "you", "your", "our", "their",
    "his", "her", "its", "them", "they", "his", "been", "being",
})


def _tokenize_for_similarity(text: str) -> set[str]:
    """Lowercase → split on non-alphanumeric → keep tokens length ≥3 that are not stopwords."""
    out: set[str] = set()
    lowered = text.lower()
    buf: list[str] = []
    for ch in lowered:
        if ch.isalnum():
            buf.append(ch)
        else:
            if buf:
                tok = "".join(buf)
                if len(tok) >= 3 and tok not in _SIMILARITY_STOPWORDS:
                    out.add(tok)
                buf = []
    if buf:
        tok = "".join(buf)
        if len(tok) >= 3 and tok not in _SIMILARITY_STOPWORDS:
            out.add(tok)
    return out


def rank_prompts_by_similarity(draft_text: str, prompts: list) -> list[tuple[object, float]]:
    """
    Rank prompts by Jaccard token-overlap similarity to draft_text, descending.

    Returns a list of (prompt, score) tuples. `prompt` is the input object
    unchanged — any object with `.id` and `.text` attributes works.
    Deterministic: no LLM, no external deps.
    """
    draft_tokens = _tokenize_for_similarity(draft_text)
    scored: list[tuple[object, float]] = []
    for p in prompts:
        prompt_tokens = _tokenize_for_similarity(getattr(p, "text", "") or "")
        union = draft_tokens | prompt_tokens
        if not union:
            score = 0.0
        else:
            intersection = draft_tokens & prompt_tokens
            score = len(intersection) / len(union)
        scored.append((p, score))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored


# ── Draft creation helpers ────────────────────────────────────────────────────

async def _store_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int | None,
    platform: str,
    title: str | None,
    content_body: str,
    brief: str,
    visibility_pct: float,
    estimated_impact: float,
    opportunity_id: int | None = None,
    guidelines_override: str | None = None,
    source: str | None = None,
    quality_score: float | None = None,
    citations: list[RenderedCitation] | None = None,
    query_for_summary: str | None = None,
) -> ContentDraft:
    spec = PLATFORM_SPECS.get(platform, {})
    guidelines_applied = guidelines_override if guidelines_override is not None else json.dumps(spec.get("rules", []))

    # Final atomic recount immediately before INSERT — catches concurrent requests
    # that both passed the earlier cap check before either committed.
    cap = await _resolve_brand_draft_cap(db, brand_id)
    final_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "draft",
        )
    )
    if final_count_result.scalar_one() >= cap:
        raise ValueError(
            f"Draft queue is full ({cap}/{cap}). "
            "Another draft was just created — try again after approving or dismissing one."
        )

    draft = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        opportunity_id=opportunity_id,
        platform=platform,
        status="draft",
        title=title,
        content_text=content_body,
        content_brief=brief,
        platform_guidelines_applied=guidelines_applied,
        visibility_score_at_draft=round(visibility_pct, 2),
        estimated_impact=round(estimated_impact, 1),
        quality_score=quality_score,
        source=source,
    )
    db.add(draft)
    await db.flush()  # populate draft.id so we can attach citations

    if citations:
        for c in citations:
            db.add(ContentDraftCitation(
                draft_id=draft.id,
                source_ref=c.source_ref,
                url=c.url,
                title=c.title,
                position_marker=c.position_marker,
            ))

    # Cross-ref summary — only generate if we ran the new pipeline (query supplied)
    if query_for_summary and (draft.content_text or "").strip():
        try:
            summary = await generate_draft_summary(
                draft_text=draft.content_text or "",
                query=query_for_summary,
            )
            if summary:
                draft.summary = summary[:500]
        except Exception as exc:
            logger.warning(
                "Draft summary generation failed for brand %d prompt %s: %s",
                brand_id, prompt_id, exc,
            )

    await db.commit()
    await db.refresh(draft)
    logger.info(
        "Draft created: id=%d brand=%d platform=%s prompt=%s impact=%.1f%% quality=%s",
        draft.id, brand_id, platform, prompt_id, estimated_impact,
        f"{quality_score:.2f}" if quality_score is not None else "n/a",
    )
    return draft


async def _get_prompt_visibility(db: AsyncSession, prompt_id: int) -> float:
    from sqlalchemy import Float, cast
    # Use latest completed run only — matches _analyze_responses_for_prompt
    latest_run_result = await db.execute(
        select(TrackingRun.id)
        .join(QueryResult, QueryResult.tracking_run_id == TrackingRun.id)
        .where(
            TrackingRun.status == "completed",
            QueryResult.prompt_id == prompt_id,
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(1)
    )
    latest_run_id = latest_run_result.scalar_one_or_none()
    if latest_run_id is None:
        return 0.0
    stmt = (
        select(sqlfunc.coalesce(sqlfunc.avg(cast(QueryResult.mentioned, Float)), 0.0))
        .where(
            QueryResult.prompt_id == prompt_id,
            QueryResult.tracking_run_id == latest_run_id,
        )
    )
    result = await db.execute(stmt)
    avg = result.scalar_one_or_none()
    return float(avg) * 100.0 if avg is not None else 0.0


# ── New pipeline orchestrator (tier-gated) ────────────────────────────────────


async def _generate_with_new_pipeline(
    *,
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    prompt_text: str,
    platform_key: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    tier: str | None,
    db: AsyncSession,
    opportunity_context: str | None = None,
    existing_drafts_context: str | None = None,
    brief_context: str | None = None,
    enforce_brand_mention: bool = False,
    model_override: str | None = None,
) -> tuple[str, float | None, list[RenderedCitation]]:
    """
    Run the full retrieve → draft → critique → rewrite → render pipeline.
    Returns ``(final_text, quality_score_or_None, citations)``.

    Tier gating:
      - ``None`` / ``'pitch'`` → cheap single-shot (no pack/critic/voice-sample); still
        runs the brand-mention guard + anti-AI gate. (Since B2 Phase 3 ALL tiers route
        through here — there is no separate fallback path.)
      - ``'basic'``  (Starter) → Evidence Pack only
      - ``'starter'`` (Growth) → Evidence Pack + critic + rewrite (Layer 2)
      - ``'pro'``    (Pro)    → Evidence Pack + critic + rewrite + voice + cross-ref (Layer 3)

    ``brief_context`` is forwarded to ``build_prompt`` for cluster-pipeline callers
    that need to inject a shared ContentBrief (positioning, canonical phrasings, etc.).
    """
    # Layer 1: Evidence Pack — paid tiers only
    pack = None
    if tier in ("basic", "starter", "pro"):
        try:
            pack = await build_evidence_pack(
                brand_id=brand_id,
                brand_name=brand_name,
                prompt_id=prompt_id,
                prompt_text=prompt_text,
                db=db,
            )
        except Exception as exc:
            logger.warning(
                "Evidence pack build failed for brand %d prompt %d: %s",
                brand_id, prompt_id, exc,
            )

    # Layer 3: Voice + cross-ref — Pro only
    voice_sample = None
    related_summary = None
    if tier == "pro":
        try:
            voice_sample = await select_voice_sample(
                brand_id=brand_id, platform=platform_key, db=db,
            )
        except Exception as exc:
            logger.warning("Voice sample lookup failed for brand %d: %s", brand_id, exc)
        try:
            related_summary = await select_related_draft(
                brand_id=brand_id,
                prompt_id=prompt_id,
                exclude_platform=platform_key,
                db=db,
            )
        except Exception as exc:
            logger.warning("Related draft lookup failed for brand %d: %s", brand_id, exc)

    # Writer call
    writer_model = model_override or writer_model_for_tier(tier)
    voice_directive = await _load_voice_directive(db, brand_id)
    claude_prompt = build_prompt(
        brand_name=brand_name,
        platform=platform_key,
        prompt_text=prompt_text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=platform_spec,
        opportunity_context=opportunity_context,
        existing_drafts_context=existing_drafts_context,
        brief_context=brief_context,
        evidence_pack=pack,
        voice_sample=voice_sample,
        related_draft_summary=related_summary,
        voice_directive=voice_directive,
    )
    raw_text = await call_claude(
        claude_prompt,
        max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
        model=writer_model,
    )

    # Brand-mention guard — for no-critic (free/pitch) tiers only. Paid tiers rely
    # on the critic+rewrite layer for brand relevance, so this is gated off there
    # to avoid an extra writer call. Caller sets the flag (it knows e.g. restricted
    # subreddits intentionally omit the brand).
    if enforce_brand_mention and brand_name.lower() not in raw_text.lower():
        retry = await call_claude(
            claude_prompt
            + f"\n\n⚠ QUALITY REQUIREMENT: your previous output did not mention "
            f"'{brand_name}'. Include '{brand_name}' naturally at least once in the body.",
            max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
            model=writer_model,
        )
        if brand_name.lower() in retry.lower():
            raw_text = retry
        else:
            logger.warning(
                "Brand '%s' not mentioned after retry — brand_id=%d platform=%s",
                brand_name, brand_id, platform_key,
            )
            raw_text = "[Brand not mentioned — review or regenerate this draft]\n\n" + raw_text

    # Layer 2: Critic + rewrite — Growth + Pro only
    quality_score: float | None = None
    if tier in ("starter", "pro") and pack is not None:
        try:
            score = await critic_score(
                draft_text=raw_text, pack=pack, query=prompt_text, platform=platform_key,
            )
            quality_score = score.overall_score

            if should_hard_retry(score):
                retry_raw = await call_claude(
                    claude_prompt,
                    max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
                    model=writer_model,
                )
                retry_score = await critic_score(
                    draft_text=retry_raw, pack=pack, query=prompt_text, platform=platform_key,
                )
                better_text, better_score = pick_better(
                    (raw_text, score), (retry_raw, retry_score),
                )
                raw_text = better_text
                quality_score = better_score.overall_score
                score = better_score

            if score.overall_score < REWRITE_THRESHOLD and score.flagged_paragraphs:
                raw_text = await rewrite_flagged(
                    draft_text=raw_text,
                    flagged=score.flagged_paragraphs,
                    pack=pack,
                    query=prompt_text,
                    platform=platform_key,
                    tier=tier,
                )
        except Exception as exc:
            logger.warning(
                "Critic/rewrite failed for brand %d prompt %d: %s",
                brand_id, prompt_id, exc,
            )

    # Layer 4 (B2 Phase 0): universal anti-AI gate — every draft, every tier.
    # IMPORTANT: this runs on the writer PROSE, BEFORE citation rendering, so
    # autofix's em-dash→comma replacement never mangles the rendered citation
    # footer (linkedin_post / reddit footers use " — " separators). The writer's
    # [SN] markers pass through untouched and are rendered once below.
    raw_text = anti_ai.autofix(raw_text)
    report = anti_ai.scan(raw_text)
    if not report.passed:
        feedback = anti_ai.feedback_for_regeneration(report)
        try:
            retry = anti_ai.autofix(await call_claude(
                claude_prompt
                + "\n\nREVISION REQUIRED — your draft reads as AI-written. Rewrite to "
                "remove these specific tells. Keep every fact and claim. Vary sentence "
                "length deliberately:\n" + feedback,
                max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
                model=writer_model,
            ))
            retry_report = anti_ai.scan(retry)
            if retry_report.passed or retry_report.score < report.score:
                raw_text, report = retry, retry_report
        except Exception as exc:
            logger.warning(
                "Anti-AI regeneration failed for brand %d prompt %d: %s",
                brand_id, prompt_id, exc,
            )
    if not report.passed:
        logger.info(
            "Draft for brand %d prompt %d (%s) still trips anti-AI gate after retry "
            "(score=%.1f) — flagged, not blocked.",
            brand_id, prompt_id, platform_key, report.score,
        )

    # Render citations per platform AFTER the gate (only if we have a pack), so the
    # rendered footer's " — " separators survive autofix untouched.
    citations: list[RenderedCitation] = []
    if pack is not None:
        try:
            raw_text, citations = render_citations(
                text=raw_text, pack=pack, platform=platform_key,
            )
        except Exception as exc:
            logger.warning(
                "Citation rendering failed for brand %d prompt %d: %s",
                brand_id, prompt_id, exc,
            )

    return raw_text, quality_score, citations


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_gap_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int,
    platform: str,
    custom_brief: str | None = None,
    quora_question_url: str | None = None,
    quora_question_title: str | None = None,
    quora_question_snippet: str | None = None,
    source: str | None = None,
    max_per_combo: int = 3,
) -> ContentDraft:
    """
    Generate a draft targeting a specific prompt/platform gap.
    Uses full BrandProfile context and response analysis.
    """
    if platform not in PLATFORM_SPECS:
        raise ValueError(f"Unsupported platform: {platform}. Choose from {ALL_PLATFORMS}")

    # Load brand
    brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_result.scalar_one_or_none()
    if brand is None:
        raise ValueError(f"Brand {brand_id} not found")

    # Load prompt
    prompt_result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = prompt_result.scalar_one_or_none()
    if prompt is None:
        raise ValueError(f"Prompt {prompt_id} not found for brand {brand_id}")

    # Check draft cap before generating (per-tier, not the hardcoded max)
    cap = await _resolve_brand_draft_cap(db, brand_id)
    current_draft_count = await _count_drafts_by_status(db, brand_id, "draft")
    if current_draft_count >= cap:
        raise ValueError(
            f"Draft queue is full ({cap}/{cap}). "
            f"Approve or dismiss existing drafts before generating new ones."
        )

    # Check for repetition: if max_per_combo+ pending "draft" items already exist
    # for this prompt/platform, skip.  Approved drafts are committed content the user
    # already acted on — they should not block new generation.  Posted drafts are
    # fetched for deduplication context below so Claude takes a different angle.
    existing_drafts = await _get_existing_drafts_for_prompt(db, brand_id, prompt_id, platform)
    pending_draft_count = sum(1 for d in existing_drafts if d.status == "draft")
    if pending_draft_count >= max_per_combo:
        raise ValueError(
            f"{max_per_combo} or more pending drafts already exist for this prompt on {platform}. "
            f"Approve or dismiss existing drafts before generating another."
        )

    profile_context, response_analysis, visibility_pct, estimated_impact = await asyncio.gather(
        _load_profile_context(db, brand_id),
        _analyze_responses_for_prompt(db, brand_id, prompt_id),
        _get_prompt_visibility(db, prompt_id),
        _estimate_impact(db, brand_id, prompt_id, platform),
    )

    # Build context about existing drafts so Claude takes a different angle
    existing_drafts_context: str | None = None
    if existing_drafts:
        ctx_lines = [
            "EXISTING DRAFTS FOR THIS PROMPT/PLATFORM — your draft MUST take a distinctly different angle:"
        ]
        for d in existing_drafts:
            snippet = d.title or (d.content_text[:100].replace("\n", " ") + "…")
            ctx_lines.append(f"  - {snippet}")
        ctx_lines.append("Write from a completely different perspective, structure, or angle than the above.")
        existing_drafts_context = "\n".join(ctx_lines)

    # ── Wikipedia: completely separate workflow ────────────────────────────────
    if platform == "wikipedia":
        if not brand.website_url:
            raise ValueError(
                "A website URL is required to generate Wikipedia drafts. "
                "Add one in your brand settings."
            )
        publications = await _load_publications(db, brand_id)
        wiki_prompt = build_wikipedia_prompt(
            brand_name=brand.name,
            prompt_text=prompt.text,
            profile_context=profile_context,
            response_analysis=response_analysis,
            publications=publications,
            website_url=brand.website_url or None,
        )
        raw_text = await call_claude(wiki_prompt, max_tokens=900)
        article_title, article_url, section, insert_location, wiki_text = parse_wikipedia_draft(raw_text)

        # Append section anchor to URL so the link jumps to the right section
        if article_url and section:
            anchor = section.strip().replace(" ", "_")
            article_url = f"{article_url}#{anchor}"

        # Fall back gracefully if parsing failed
        if not wiki_text:
            wiki_text = raw_text.strip()
        # B2 Phase 0: anti-AI cosmetic pass on the wikitext (Wikipedia editors are
        # especially AI-vigilant). autofix is safe for wikitext; we log a scan but
        # don't regenerate in place to avoid breaking the parsed structure/<ref>s.
        wiki_text = anti_ai.autofix(wiki_text)
        _wiki_report = anti_ai.scan(wiki_text)
        if not _wiki_report.passed:
            logger.info(
                "Wikipedia draft for brand %d trips anti-AI gate (score=%.1f) — "
                "flagged for human review before submission.",
                brand_id, _wiki_report.score,
            )
        title = article_title or f"Wikipedia edit: {prompt.text[:80]}"
        brief = article_url  # content_brief stores the article URL

        # Citation check: verify the actual wikitext paste contains a <ref> tag or {{citation needed}}.
        # If Claude omitted it, append the citation built from the brand's publications/website.
        if "<ref>" not in wiki_text and "{{citation needed}}" not in wiki_text:
            publications = publications if publications else []
            citation_ref = _build_citation_ref(publications, brand.name, brand.website_url or None)
            wiki_text = wiki_text.rstrip() + " " + citation_ref
            logger.warning(
                "Wikipedia draft for brand %d was missing <ref> — appended citation",
                brand_id,
            )

        # Store insert_location (section + placement) in platform_guidelines_applied
        draft = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=platform,
            status="draft",
            title=title,
            content_text=wiki_text,
            content_brief=brief,
            platform_guidelines_applied=insert_location or section or "",
            visibility_score_at_draft=round(visibility_pct, 2),
            estimated_impact=round(estimated_impact, 1),
            source=source,
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        logger.info(
            "Wikipedia draft created: id=%d brand=%d article=%r section=%r location=%r",
            draft.id, brand_id, article_title, section, insert_location,
        )
        return draft

    if platform == "owned_site":
        # Tier-1 AIO channel — content on the brand's OWN domain (AI engines cite
        # owned/authority pages far more than social). Uses the dedicated owned_site
        # generator: citation-driver prompt + JSON-LD schema + anti-AI gate loop.
        from datetime import datetime, timezone

        _prof_res = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        _prof = _prof_res.scalar_one_or_none()
        brand_dict = {
            "name": brand.name,
            "description": _prof.company_description if _prof else None,
            "url": brand.website_url or None,
            "audience": _prof.target_audience if _prof else None,
            "approved_language": (
                ", ".join(json.loads(_prof.approved_language))
                if _prof and _prof.approved_language else None
            ),
            "what_not_to_say": (
                ", ".join(json.loads(_prof.what_not_to_say))
                if _prof and _prof.what_not_to_say else None
            ),
        }
        _pubs = await _load_publications(db, brand_id)
        _evidence = [
            {"title": p.get("title"), "url": p.get("url", ""), "snippet": p.get("publisher", "")}
            for p in _pubs
        ] or None
        _voice = _voice_directive_from_profile(_prof)  # reuse the row already loaded

        async def _owned_writer(p: str) -> str:
            return await call_claude(p, max_tokens=PLATFORM_MAX_TOKENS.get("owned_site", 3000))

        owned = await owned_site.generate_owned_site_draft(
            writer=_owned_writer,
            brand=brand_dict,
            target_query=prompt.text,
            evidence=_evidence,
            voice=_voice,
            date_published=datetime.now(timezone.utc).date().isoformat(),
        )
        body_with_schema = (
            owned.body
            + "\n\n---\nSchema markup (JSON-LD — paste inside the page's <head>):\n\n```json\n"
            + json.dumps(owned.jsonld, indent=2)
            + "\n```\n"
        )
        _owned_title = owned.jsonld.get("headline") or f"Owned-site page: {prompt.text[:80]}"
        if owned.flagged_for_review:
            logger.info(
                "Owned-site draft for brand %d trips anti-AI gate (score=%.1f) — flagged.",
                brand_id, owned.anti_ai_score,
            )
        draft = ContentDraft(
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=platform,
            status="draft",
            title=_owned_title,
            content_text=body_with_schema,
            content_brief=brand.website_url or "",
            platform_guidelines_applied="",
            visibility_score_at_draft=round(visibility_pct, 2),
            estimated_impact=round(estimated_impact, 1),
            source=source,
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        logger.info("Owned-site draft created: id=%d brand=%d", draft.id, brand_id)
        return draft

    # Determine suggested subreddit for Reddit drafts
    suggested_subreddit: str | None = None
    if platform == "reddit":
        from app.services.reddit_scanner_service import (
            find_first_valid_subreddit,
            get_relevant_subreddits,
        )
        profile_result = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        prof = profile_result.scalar_one_or_none()
        all_prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )
        all_prompts = list(all_prompts_result.scalars().all())
        desc = prof.company_description if prof else None
        extra_parts: list[str] = []
        if prof:
            try:
                key_stats = json.loads(prof.key_stats) if prof.key_stats else []
                extra_parts.extend(key_stats)
            except Exception:
                pass
        # Ask for more candidates than we need — the LLM hallucinates
        # subreddit names, so we validate each against Reddit's about.json
        # and pick the first one that actually exists.
        subs = get_relevant_subreddits(
            desc, [p.text for p in all_prompts], limit=5,
            extra_profile_text=" ".join(extra_parts)
        )
        if subs:
            suggested_subreddit = await find_first_valid_subreddit(subs)
            if suggested_subreddit is None:
                logger.warning(
                    "generate_gap_draft: no valid subreddit found among %r "
                    "for brand_id=%d — draft will omit subreddit",
                    subs, brand_id,
                )

    # For restricted subreddits, brand name must NOT appear — skip mention retry
    _reddit_strategy: str | None = None
    if platform == "reddit" and suggested_subreddit:
        _reddit_strategy = classify_subreddit(suggested_subreddit)

    # Map base platform names to their gap-draft variants
    platform_key = platform
    if platform == "linkedin":
        platform_key = "linkedin_article"
    elif platform == "x":
        platform_key = "x_thread"

    spec = PLATFORM_SPECS[platform_key]

    # For Quora targeted drafts, build context from the question.
    # Serper snippet is the primary source — Quora blocks all Jina requests with a
    # CAPTCHA/bot-check page, so attempting Jina for quora.com is a guaranteed 4–5s
    # wasted round-trip. Skip it and use the snippet directly.
    # Jina is retained for any other URL that may be passed as quora_question_url.
    effective_opportunity_context = _sanitize_user_input(custom_brief) if custom_brief else None
    if platform == "quora" and quora_question_url and quora_question_title:
        _quora_page_content: str | None = None
        _is_quora_url = "quora.com" in quora_question_url.lower()
        if not _is_quora_url:
            # Non-Quora URL: attempt Jina fetch for richer context
            try:
                from app.services.jina_service import fetch_website_context
                _raw = await fetch_website_context(quora_question_url)
                _blocked_markers = ("verify you are human", "enable javascript", "please wait", "just a moment")
                _is_blocked = any(m in _raw.lower() for m in _blocked_markers)
                if len(_raw) > 400 and not _is_blocked:
                    _MAX = 4_000
                    if len(_raw) > _MAX:
                        _cut = _raw[:_MAX]
                        _boundary = max(_cut.rfind(". "), _cut.rfind(".\n"), _cut.rfind("\n\n"))
                        _quora_page_content = (_cut[:_boundary + 1] if _boundary > _MAX // 2 else _cut) + "\n[…]"
                    else:
                        _quora_page_content = _raw
                    logger.info(
                        "Quora page fetched via Jina for draft: %d chars from %s",
                        len(_quora_page_content), quora_question_url,
                    )
            except Exception as _je:
                logger.debug("Quora Jina fetch skipped (%s): %s", quora_question_url, _je)

        if _quora_page_content:
            # Best case: full page content with existing answers
            effective_opportunity_context = (
                f"QUESTION: {_sanitize_user_input(quora_question_title)}\n"
                f"URL: {quora_question_url}\n\n"
                f"PAGE CONTENT (question details and existing answers — "
                f"your answer MUST add new value not already covered below):\n"
                f"{_quora_page_content}"
                + (f"\n\nADDITIONAL CONTEXT: {_sanitize_user_input(custom_brief)}" if custom_brief else "")
            )
        elif quora_question_snippet:
            # Reliable fallback: snippet from Serper search (always present if question was found)
            effective_opportunity_context = (
                f"QUESTION: {_sanitize_user_input(quora_question_title)}\n"
                f"URL: {quora_question_url}\n\n"
                f"QUESTION CONTEXT (excerpt from the page):\n"
                f"{_sanitize_user_input(quora_question_snippet)}\n\n"
                f"Write a Quora answer that directly addresses this question and naturally "
                f"incorporates relevant information about {brand.name}."
                + (f"\n\nADDITIONAL CONTEXT: {_sanitize_user_input(custom_brief)}" if custom_brief else "")
            )
        else:
            # Minimal fallback: title + URL only
            effective_opportunity_context = (
                f"Write a Quora answer to this specific question: "
                f"{_sanitize_user_input(quora_question_title)} ({quora_question_url}). "
                f"The answer should directly address this question while naturally "
                f"incorporating relevant information about {brand.name}."
                + (f"\n\n{_sanitize_user_input(custom_brief)}" if custom_brief else "")
            )

    # Look up the brand owner's subscription tier to gate the new pipeline.
    # Pitch brands always use the free single-shot flow regardless of subscription.
    brand_user = await db.get(User, brand.user_id) if brand.user_id else None
    user_tier: str | None = brand_user.subscription_tier if brand_user else None
    if brand.brand_type == "pitch":
        user_tier = None

    quality_score: float | None = None
    rendered_citations: list[RenderedCitation] = []

    # B2 Phase 3: single path for all tiers. The core handles paid (evidence pack /
    # critic / voice / citations) and free-pitch (cheap single-shot) via tier gating,
    # plus the brand-mention guard and the universal anti-AI gate. Free tier uses the
    # same writer model (call_claude default == writer_model_for_tier(None) == sonnet).
    raw_text, quality_score, rendered_citations = await _generate_with_new_pipeline(
        brand_id=brand.id,
        brand_name=brand.name,
        prompt_id=prompt.id,
        prompt_text=prompt.text,
        platform_key=platform_key,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        tier=user_tier,
        db=db,
        opportunity_context=effective_opportunity_context,
        existing_drafts_context=existing_drafts_context,
        # Free/pitch tiers have no critic to enforce brand relevance — guard it.
        # Restricted subreddits intentionally omit the brand, so skip the guard there.
        enforce_brand_mention=(
            user_tier not in ("basic", "starter", "pro")
            and _reddit_strategy != "restricted"
        ),
    )

    raw_text = remove_hedging(raw_text)
    raw_text = enforce_x_char_limit(raw_text, platform_key)

    title, body = extract_title_and_body(raw_text, platform_key)

    # Only feed the cross-ref summary generator when the new pipeline ran.
    summary_query = prompt.text if user_tier in ("basic", "starter", "pro") else None

    if platform == "quora" and quora_question_url and quora_question_title:
        # Targeted draft: store URL in brief, title in guidelines_override
        return await _store_draft(
            db=db,
            brand_id=brand_id,
            prompt_id=prompt_id,
            platform=platform,
            title=title,
            content_body=body,
            brief=quora_question_url,
            visibility_pct=visibility_pct,
            estimated_impact=estimated_impact,
            guidelines_override=quora_question_title,
            source=source,
            quality_score=quality_score,
            citations=rendered_citations,
            query_for_summary=summary_query,
        )
    elif platform == "quora":
        brief = (
            f'Find a relevant question on Quora about "{prompt.text}" '
            f"and post this answer there."
        )
    elif platform == "reddit" and suggested_subreddit:
        brief = f"r/{suggested_subreddit} — {prompt.text}"
    elif platform == "reddit":
        brief = (
            f'Find a relevant subreddit about "{prompt.text}" '
            f"and post this answer there."
        )
    elif platform in ("linkedin_article", "linkedin_post"):
        brief = custom_brief or f'LinkedIn draft for: "{prompt.text}"'
    elif platform in ("x_thread", "x_post"):
        brief = custom_brief or f'X draft for: "{prompt.text}"'
    elif custom_brief:
        brief = custom_brief
    else:
        brief = f'Gap draft for: "{prompt.text}"'

    return await _store_draft(
        db=db,
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform=platform,
        title=title,
        content_body=body,
        brief=brief,
        visibility_pct=visibility_pct,
        estimated_impact=estimated_impact,
        source=source,
        quality_score=quality_score,
        citations=rendered_citations,
        query_for_summary=summary_query,
    )


async def generate_opportunity_draft(
    db: AsyncSession,
    opportunity_id: int,
) -> ContentDraft:
    """
    Draft a reply to a specific opportunity thread.
    The reply is short-form and targets the thread directly.
    """
    opp_result = await db.execute(
        select(ContentOpportunity).where(ContentOpportunity.id == opportunity_id)
    )
    opp = opp_result.scalar_one_or_none()
    if opp is None:
        raise ValueError(f"ContentOpportunity {opportunity_id} not found")

    brand_result = await db.execute(select(Brand).where(Brand.id == opp.brand_id))
    brand = brand_result.scalar_one_or_none()
    if brand is None:
        raise ValueError(f"Brand {opp.brand_id} not found")

    # Enforce per-tier draft cap — opportunity drafts count toward the same queue
    cap = await _resolve_brand_draft_cap(db, opp.brand_id)
    draft_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == opp.brand_id,
            ContentDraft.status == "draft",
        )
    )
    draft_count = draft_count_result.scalar_one()
    if draft_count >= cap:
        raise ValueError(
            f"Draft queue is full ({cap}/{cap}). "
            "Approve or dismiss existing drafts before creating new ones."
        )

    profile_context = await _load_profile_context(db, opp.brand_id)

    prompt_text = ""
    visibility_pct = 0.0
    if opp.prompt_id:
        prompt_result = await db.execute(select(Prompt).where(Prompt.id == opp.prompt_id))
        pr = prompt_result.scalar_one_or_none()
        if pr:
            prompt_text = pr.text
            visibility_pct = await _get_prompt_visibility(db, opp.prompt_id)

    # Select platform spec based on opportunity platform
    platform_key_map = {
        "reddit": "reddit_reply",
        "linkedin": "linkedin_reply",
        "x": "x_reply",
    }
    platform_key = platform_key_map.get(opp.platform, opp.platform)
    spec = PLATFORM_SPECS.get(platform_key, PLATFORM_SPECS["reddit_reply"])

    # Build opportunity context block
    promo_strategy = "cautious"  # default; overridden for Reddit below
    opp_context_lines = []
    if opp.thread_title:
        opp_context_lines.append(f"Title: {_sanitize_user_input(opp.thread_title)}")
    if opp.body_preview:
        opp_context_lines.append(f"Post body: {_sanitize_user_input(opp.body_preview)}")
    opp_context_lines.append(f"URL: {opp.thread_url}")

    # Subreddit promotion strategy is Reddit-specific
    if opp.platform == "reddit":
        promo_strategy = classify_subreddit(opp.subreddit) if opp.subreddit else "cautious"
        if opp.subreddit:
            opp_context_lines.append(f"Subreddit: r/{opp.subreddit}")
        opp_context_lines.append(
            build_subreddit_strategy(opp.subreddit or "this subreddit", brand.name, promo_strategy)
        )

    opportunity_context = "\n".join(opp_context_lines)

    response_analysis = ""
    if opp.prompt_id:
        response_analysis = await _analyze_responses_for_prompt(db, opp.brand_id, opp.prompt_id)

    # Use haiku for short reply formats — cheaper and fast enough for short content
    _opp_model = (
        "claude-haiku-4-5-20251001" if platform_key in ("reddit_reply", "linkedin_reply", "x_reply")
        else "claude-sonnet-4-6"
    )
    # B2 Phase 3b: route opportunity replies through the core. tier=None preserves the
    # cheap single-shot behavior (replies never used pack/critic/voice-sample);
    # model_override keeps haiku for short formats. The core supplies the brand-voice
    # directive, the brand-mention guard, and the universal anti-AI gate.
    raw_text, _opp_quality, _ = await _generate_with_new_pipeline(
        brand_id=opp.brand_id,
        brand_name=brand.name,
        prompt_id=opp.prompt_id or 0,
        prompt_text=prompt_text or opp.thread_title or "brand visibility",
        platform_key=platform_key,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        tier=None,
        db=db,
        opportunity_context=opportunity_context,
        enforce_brand_mention=(promo_strategy != "restricted"),
        model_override=_opp_model,
    )
    raw_text = remove_hedging(raw_text)
    if platform_key.startswith("x_"):
        from app.services.drafting import enforce_x_char_limit
        raw_text = enforce_x_char_limit(raw_text, platform_key)

    _, body = extract_title_and_body(raw_text, platform_key)

    estimated_impact = await _estimate_impact(
        db, opp.brand_id, opp.prompt_id or 0, opp.platform
    ) if opp.prompt_id else 40.0

    if opp.platform == "reddit":
        brief = (
            f"Reply to Reddit thread: \"{opp.thread_title or opp.thread_url}\" "
            f"in r/{opp.subreddit or 'unknown'}"
        )
    else:
        brief = f"Reply to {opp.platform.title()} question: \"{opp.thread_title or opp.thread_url}\""

    draft = await _store_draft(
        db=db,
        brand_id=opp.brand_id,
        prompt_id=opp.prompt_id,
        platform=opp.platform,
        title=None,
        content_body=body,
        brief=brief,
        visibility_pct=visibility_pct,
        estimated_impact=estimated_impact,
        opportunity_id=opportunity_id,
        guidelines_override=opp.thread_url,  # frontend uses this to link directly to the thread
        source="opportunity",
    )

    # Mark opportunity as drafted
    opp.status = "drafted"
    await db.commit()

    return draft


async def auto_draft_top_gaps(
    db: AsyncSession,
    brand_id: int,
    max_gaps: int = 20,
    clear_existing: bool = False,
    source: str | None = None,
) -> list[ContentDraft]:
    """
    Generate up to max_gaps total drafts for a brand across all enabled platforms.

    Strategy:
    1. Prioritise prompts that have ContentGap entries (sorted by gap_score desc).
    2. Fall back to ALL tracked prompts so we fill the queue even when gap data
       is sparse — this prevents the hard cap of "only 3 drafts because only 3
       gaps exist".
    3. For each prompt, cycle through enabled platforms, stopping when
       max_gaps drafts have been created or DRAFT_CAP is hit.

    When clear_existing=True (weekly scheduler), all pending "draft" status rows
    for this brand are wiped first. Approved/posted drafts are never touched.
    """
    from app.models import Prompt

    # Weekly refresh: clear all pending drafts before generating new ones
    if clear_existing:
        from sqlalchemy import delete as sql_delete
        await db.execute(
            sql_delete(ContentDraft).where(
                ContentDraft.brand_id == brand_id,
                ContentDraft.status == "draft",
            )
        )
        await db.commit()
        logger.info(
            "auto_draft_top_gaps: cleared existing draft-status drafts for brand_id=%d (weekly refresh)",
            brand_id,
        )

    # --- Build ordered prompt list ---
    # Best gap per prompt (highest gap_score), ordered desc
    gaps_result = await db.execute(
        select(ContentGap)
        .where(ContentGap.brand_id == brand_id)
        .order_by(ContentGap.gap_score.desc())
    )
    all_gaps = list(gaps_result.scalars().all())

    # Map prompt_id → best gap
    best_gap_by_prompt: dict[int, ContentGap] = {}
    for g in all_gaps:
        if g.prompt_id not in best_gap_by_prompt:
            best_gap_by_prompt[g.prompt_id] = g

    # All prompts for the brand — ordered: gapped prompts first (by score), then the rest
    prompts_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == brand_id)
    )
    all_prompts = list(prompts_result.scalars().all())

    gapped = sorted(
        [p for p in all_prompts if p.id in best_gap_by_prompt],
        key=lambda p: best_gap_by_prompt[p.id].gap_score,
        reverse=True,
    )
    ungapped = [p for p in all_prompts if p.id not in best_gap_by_prompt]
    ordered_prompts = gapped + ungapped

    if not ordered_prompts:
        logger.info("auto_draft_top_gaps: no prompts found for brand_id=%d", brand_id)
        return []

    # --- Load enabled platforms ---
    settings_result = await db.execute(
        select(BrandContentSettings).where(
            BrandContentSettings.brand_id == brand_id,
            BrandContentSettings.enabled == True,
        )
    )
    enabled_settings = list(settings_result.scalars().all())
    enabled_platforms = [
        resolved for s in enabled_settings
        if (resolved := resolve_platform_key(s.platform)) in CONTENT_PLATFORMS
    ]
    # Check if user explicitly disabled any platforms (some settings exist with enabled=False)
    all_settings_result = await db.execute(
        select(BrandContentSettings).where(BrandContentSettings.brand_id == brand_id)
    )
    all_settings = list(all_settings_result.scalars().all())
    disabled_count = sum(1 for s in all_settings if not s.enabled)
    has_disabled_platforms = disabled_count > 0

    if not enabled_platforms:
        enabled_platforms = ["reddit", "quora"]

    # --- Compute caps ---
    import math
    n_combos = len(ordered_prompts) * len(enabled_platforms)

    if has_disabled_platforms:
        # User explicitly disabled platforms — keep per-platform allocation constant
        # so remaining platforms don't inflate to fill the gap.
        total_settings = len(all_settings)
        enabled_count = total_settings - disabled_count
        n_all_combos = len(ordered_prompts) * total_settings
        per_combo_cap = max(3, math.ceil(max_gaps / n_all_combos)) if n_all_combos else max_gaps
        effective_max = math.ceil(max_gaps * enabled_count / total_settings) if total_settings else max_gaps
    else:
        # No explicit disabling — fill normally
        per_combo_cap = max(3, math.ceil(max_gaps / n_combos)) if n_combos else max_gaps
        effective_max = max_gaps

    # --- Generate: round-robin across platforms for equal distribution ---
    created: list[ContentDraft] = []
    last_error: Exception | None = None  # track first hard failure for diagnostics
    n_platforms = len(enabled_platforms)
    n_prompts = len(ordered_prompts)
    prompt_idx = 0
    platform_idx = 0  # absolute index, wraps via modulo
    max_attempts = max(n_prompts * n_platforms * 3, effective_max * 3)
    attempts = 0
    # Per-prompt Quora question index — cycles through results so multiple drafts
    # for the same prompt each target a different question.
    quora_question_idx: dict[int, int] = {}
    # Track (prompt_id, platform) combos that have raised a "3 or more drafts" error
    # so we don't waste iterations retrying them.
    exhausted_combos: set[tuple[int, str]] = set()

    # ── Helper: generate a single draft with its own DB session ────────────
    async def _generate_one_draft(
        _brand_id: int,
        _prompt: Prompt,
        _platform: str,
        _quora_url: str | None,
        _quora_title: str | None,
        _quora_snippet: str | None,
        _source: str | None,
    ) -> tuple[str, ContentDraft | str | Exception, int, str]:
        """Returns (status, result_or_error, prompt_id, platform)."""
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            try:
                draft = await generate_gap_draft(
                    db=session,
                    brand_id=_brand_id,
                    prompt_id=_prompt.id,
                    platform=_platform,
                    quora_question_url=_quora_url,
                    quora_question_title=_quora_title,
                    quora_question_snippet=_quora_snippet,
                    source=_source,
                    max_per_combo=per_combo_cap,
                )
                return ("ok", draft, _prompt.id, _platform)
            except ValueError as exc:
                return ("value_error", str(exc), _prompt.id, _platform)
            except Exception as exc:
                return ("error", exc, _prompt.id, _platform)

    BATCH_SIZE = 5

    while len(created) < effective_max and attempts < max_attempts:
        # ── Build a batch of up to BATCH_SIZE tasks ──────────────────────
        batch_tasks: list[tuple] = []  # (coroutine, prompt, platform)

        while len(batch_tasks) < BATCH_SIZE and len(created) + len(batch_tasks) < effective_max and attempts < max_attempts:
            platform = enabled_platforms[platform_idx % n_platforms]
            prompt = ordered_prompts[prompt_idx % n_prompts]

            # Skip exhausted combos (already hit the 3-draft limit or been fully tried)
            if (prompt.id, platform) in exhausted_combos:
                if len(exhausted_combos) >= n_prompts * n_platforms:
                    break  # all combos exhausted — nothing left to try
                platform_idx += 1
                if platform_idx % n_platforms == 0:
                    prompt_idx += 1
                attempts += 1
                continue

            # For Quora, resolve a real question first so the draft is targeted.
            quora_url: str | None = None
            quora_title: str | None = None
            quora_snippet: str | None = None
            if platform == "quora":
                from app.services.quora_search_service import extract_keywords, search_quora_questions
                _questions: list[dict] = []

                # 1. Serper (fresh, cache-deduplicated per 24h)
                try:
                    _keywords = extract_keywords(prompt.text)
                    if _keywords:
                        _questions = await search_quora_questions(
                            _keywords, 5, prompt.id
                        )
                except Exception as _qe:
                    logger.debug(
                        "auto_draft_top_gaps: Serper lookup skipped for prompt %d: %s",
                        prompt.id, _qe,
                    )

                # 2. Fallback: stored gap questions (if Serper returned nothing)
                if not _questions:
                    _gap = best_gap_by_prompt.get(prompt.id)
                    if _gap and _gap.quora_questions:
                        try:
                            _questions = json.loads(_gap.quora_questions)
                        except Exception:
                            pass

                # Pick the next question for this prompt (cycle so each draft is different)
                if _questions:
                    _idx = quora_question_idx.get(prompt.id, 0)
                    _q = _questions[_idx % len(_questions)]
                    quora_question_idx[prompt.id] = _idx + 1
                    quora_url = _q.get("url")
                    quora_title = _q.get("title")
                    quora_snippet = _q.get("snippet")

            batch_tasks.append((
                _generate_one_draft(
                    brand_id, prompt, platform,
                    quora_url, quora_title, quora_snippet, source,
                ),
                prompt, platform,
            ))

            # Advance: after visiting every platform once for this prompt, move to next prompt
            platform_idx += 1
            if platform_idx % n_platforms == 0:
                prompt_idx += 1
            attempts += 1

        if not batch_tasks:
            break  # nothing left to try

        # ── Execute the batch concurrently ───────────────────────────────
        results = await asyncio.gather(*(coro for coro, _, _ in batch_tasks))

        for result_tuple in results:
            result_status, result_value, pid, plat = result_tuple

            if result_status == "ok":
                created.append(result_value)
            elif result_status == "value_error":
                exc_str = result_value.lower()
                if "full" in exc_str or "cap" in exc_str:
                    logger.info(
                        "auto_draft_top_gaps: draft cap reached for brand_id=%d after %d drafts",
                        brand_id, len(created),
                    )
                    return created
                if "or more pending drafts" in exc_str or "drafts already exist" in exc_str:
                    exhausted_combos.add((pid, plat))
                logger.warning(
                    "auto_draft_top_gaps: skipped brand=%d prompt=%d platform=%s: %s",
                    brand_id, pid, plat, result_value,
                )
            else:
                if last_error is None:
                    last_error = result_value
                logger.exception(
                    "auto_draft_top_gaps: failed for brand=%d prompt=%d platform=%s",
                    brand_id, pid, plat,
                )

    logger.info(
        "auto_draft_top_gaps: created %d drafts for brand_id=%d", len(created), brand_id,
    )

    # If nothing was created and we have prompts, surface the root cause
    if not created and ordered_prompts and last_error is not None:
        raise last_error

    return created


def make_cluster_draft(
    *,
    brand_id: int,
    prompt_id: int,
    cluster_id: int,
    platform: str,
    content_text: str,
    **kwargs: object,
) -> "ContentDraft":
    """Construct a ContentDraft for a cluster piece, enforcing cluster_id.

    All new drafts created after the 2026-05-20 cluster redesign must belong
    to a cluster. This helper raises if cluster_id is missing so service-layer
    callers never bypass the invariant. Legacy creation sites
    (generate_gap_draft, generate_opportunity_draft) remain unchanged until
    their flows are migrated.

    Returns an unflushed ContentDraft — caller is responsible for db.add and
    commit.
    """
    if cluster_id is None:
        raise ValueError("All new drafts must belong to a cluster (cluster_id required)")
    return ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        cluster_id=cluster_id,
        platform=platform,
        content_text=content_text,
        source=kwargs.pop("source", "cluster"),
        **kwargs,
    )

