"""
Drafting Service — Phase 2 dynamic drafting engine.

Improvements over content_service.py:
- Pulls the full BrandProfile as context (description, key stats, tone, approved language)
- Reads stored LLM responses for the target prompt to understand the current narrative
- Generates platform-appropriate content that addresses the *specific* gap
- Enforces strict editorial style rules
- Calculates an estimated visibility impact score for each draft
- Supports opportunity-based drafting (reply to a specific Reddit/Quora thread)

Public API
----------
generate_gap_draft(db, brand_id, prompt_id, platform) -> ContentDraft
generate_opportunity_draft(db, opportunity_id)         -> ContentDraft
auto_draft_top_gaps(db, brand_id, max_gaps=3)         -> list[ContentDraft]
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    ContentGap,
    ContentDraft,
    ContentOpportunity,
    Prompt,
    QueryResult,
    TrackingRun,
    BrandContentSettings,
    utcnow as _utcnow,
)
from app.services.drafting import (
    PLATFORM_SPECS, ALL_PLATFORMS, CONTENT_PLATFORMS, PLATFORM_MAX_TOKENS,
    classify_subreddit, build_subreddit_strategy,
    build_prompt, build_wikipedia_prompt, WIKIPEDIA_SYSTEM_PROMPT,
    call_claude,
    remove_hedging, clean_wiki_text, parse_wikipedia_draft,
    extract_title_and_body, estimate_visibility_impact,
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
    website_url: Optional[str] = None,
) -> str:
    """Build a <ref> citation from publications, website URL, or {{citation needed}}."""
    from app.services.drafting.prompts import _build_citation_ref as _impl
    return _impl(publications, brand_name, website_url)


# ── Brand profile loader ──────────────────────────────────────────────────────

def _extract_publications(profile: "BrandProfile") -> list[dict]:
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
    profile: Optional[BrandProfile] = result.scalar_one_or_none()

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


async def _load_publications(db: AsyncSession, brand_id: int) -> list[dict]:
    """Load publications list directly from BrandProfile."""
    result = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile: Optional[BrandProfile] = result.scalar_one_or_none()
    return _extract_publications(profile) if profile else []


DRAFT_CAP = 20


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
    from sqlalchemy import Float, cast

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
            f"\nResponses that do NOT mention the brand — these show what narrative is missing:"
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


# ── Draft creation helpers ────────────────────────────────────────────────────

async def _store_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: Optional[int],
    platform: str,
    title: Optional[str],
    content_body: str,
    brief: str,
    visibility_pct: float,
    estimated_impact: float,
    opportunity_id: Optional[int] = None,
    guidelines_override: Optional[str] = None,
    source: Optional[str] = None,
) -> ContentDraft:
    spec = PLATFORM_SPECS.get(platform, {})
    guidelines_applied = guidelines_override if guidelines_override is not None else json.dumps(spec.get("rules", []))

    # Final atomic recount immediately before INSERT — catches concurrent requests
    # that both passed the earlier cap check before either committed.
    final_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.status == "draft",
        )
    )
    if final_count_result.scalar_one() >= DRAFT_CAP:
        raise ValueError(
            f"Draft queue is full ({DRAFT_CAP}/{DRAFT_CAP}). "
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
        source=source,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    logger.info(
        "Draft created: id=%d brand=%d platform=%s prompt=%s impact=%.1f%%",
        draft.id, brand_id, platform, prompt_id, estimated_impact,
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


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_gap_draft(
    db: AsyncSession,
    brand_id: int,
    prompt_id: int,
    platform: str,
    custom_brief: Optional[str] = None,
    quora_question_url: Optional[str] = None,
    quora_question_title: Optional[str] = None,
    quora_question_snippet: Optional[str] = None,
    source: Optional[str] = None,
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

    # Check draft cap before generating
    current_draft_count = await _count_drafts_by_status(db, brand_id, "draft")
    if current_draft_count >= DRAFT_CAP:
        raise ValueError(
            f"Draft queue is full ({DRAFT_CAP}/{DRAFT_CAP}). "
            f"Approve or dismiss existing drafts before generating new ones."
        )

    # Check for repetition: if 3+ active (non-posted) drafts already exist for this
    # prompt/platform, skip.  Posted drafts are fetched for deduplication context below
    # but should not block new generation — the user already acted on them.
    existing_drafts = await _get_existing_drafts_for_prompt(db, brand_id, prompt_id, platform)
    active_draft_count = sum(1 for d in existing_drafts if d.status in ("draft", "approved"))
    if active_draft_count >= 3:
        raise ValueError(
            f"3 or more drafts already exist for this prompt on {platform}. "
            f"Approve or dismiss existing drafts before generating another."
        )

    profile_context = await _load_profile_context(db, brand_id)
    response_analysis = await _analyze_responses_for_prompt(db, brand_id, prompt_id)
    visibility_pct = await _get_prompt_visibility(db, prompt_id)
    estimated_impact = await _estimate_impact(db, brand_id, prompt_id, platform)

    # Build context about existing drafts so Claude takes a different angle
    existing_drafts_context: Optional[str] = None
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

    # Determine suggested subreddit for Reddit drafts
    suggested_subreddit: Optional[str] = None
    if platform == "reddit":
        from app.services.reddit_scanner_service import get_relevant_subreddits
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
        subs = get_relevant_subreddits(
            desc, [p.text for p in all_prompts], limit=3,
            extra_profile_text=" ".join(extra_parts)
        )
        if subs:
            suggested_subreddit = subs[0]

    # For restricted subreddits, brand name must NOT appear — skip mention retry
    _reddit_strategy: Optional[str] = None
    if platform == "reddit" and suggested_subreddit:
        _reddit_strategy = classify_subreddit(suggested_subreddit)

    spec = PLATFORM_SPECS[platform]

    # For Quora targeted drafts, build context from the question.
    # Serper snippet is the primary source — Quora blocks all Jina requests with a
    # CAPTCHA/bot-check page, so attempting Jina for quora.com is a guaranteed 4–5s
    # wasted round-trip. Skip it and use the snippet directly.
    # Jina is retained for any other URL that may be passed as quora_question_url.
    effective_opportunity_context = _sanitize_user_input(custom_brief) if custom_brief else None
    if platform == "quora" and quora_question_url and quora_question_title:
        _quora_page_content: Optional[str] = None
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

    claude_prompt = build_prompt(
        brand_name=brand.name,
        platform=platform,
        prompt_text=prompt.text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        opportunity_context=effective_opportunity_context,
        existing_drafts_context=existing_drafts_context,
    )

    raw_text = await call_claude(claude_prompt, max_tokens=PLATFORM_MAX_TOKENS.get(platform, 2500))
    raw_text = remove_hedging(raw_text)

    # Quality check: brand name must appear in the content.
    # Skip retry for restricted subreddits — the prompt intentionally omits the brand.
    if brand.name.lower() not in raw_text.lower() and _reddit_strategy != "restricted":
        _retry_prompt = (
            claude_prompt
            + f"\n\n⚠ QUALITY REQUIREMENT: Your previous output did not mention '{brand.name}'."
            f" You MUST include '{brand.name}' naturally at least once in the content body."
        )
        _retry_raw = await call_claude(_retry_prompt, max_tokens=PLATFORM_MAX_TOKENS.get(platform, 2500))
        _retry_raw = remove_hedging(_retry_raw)
        if brand.name.lower() in _retry_raw.lower():
            raw_text = _retry_raw
        else:
            logger.warning(
                "generate_gap_draft: brand '%s' not mentioned after retry — "
                "brand_id=%d platform=%s prompt_id=%d",
                brand.name, brand_id, platform, prompt_id,
            )
            raw_text = (
                f"[Brand not mentioned — review or regenerate this draft]\n\n" + raw_text
            )

    title, body = extract_title_and_body(raw_text, platform)

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
        )
    elif platform == "quora":
        brief = (
            f'Find a relevant question on Quora about "{prompt.text}" '
            f"and post this answer there."
        )
    elif platform == "reddit" and suggested_subreddit:
        brief = f"r/{suggested_subreddit} — {prompt.text}"
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
    )


async def generate_opportunity_draft(
    db: AsyncSession,
    opportunity_id: int,
) -> ContentDraft:
    """
    Draft a reply to a specific Reddit/Quora opportunity thread.
    The reply is short-form (reddit_reply format) and targets the thread directly.
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

    # Enforce DRAFT_CAP — opportunity drafts count toward the same queue
    draft_count_result = await db.execute(
        select(sqlfunc.count(ContentDraft.id)).where(
            ContentDraft.brand_id == opp.brand_id,
            ContentDraft.status == "draft",
        )
    )
    draft_count = draft_count_result.scalar_one()
    if draft_count >= DRAFT_CAP:
        raise ValueError(
            f"Draft queue is full ({DRAFT_CAP}/{DRAFT_CAP}). "
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

    # Select platform spec and token budget based on actual opportunity platform.
    # Reddit opportunities use the short reddit_reply format (20-80 words).
    # Quora and other platforms use their own full spec.
    platform_key = "reddit_reply" if opp.platform == "reddit" else opp.platform
    spec = PLATFORM_SPECS.get(platform_key, PLATFORM_SPECS["reddit_reply"])
    max_tokens = PLATFORM_MAX_TOKENS.get(platform_key, 600)

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

    claude_prompt = build_prompt(
        brand_name=brand.name,
        platform=platform_key,
        prompt_text=prompt_text or opp.thread_title or "brand visibility",
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        opportunity_context=opportunity_context,
    )

    # Use haiku for short reddit replies — cheaper and fast enough for 20-80 word content
    _opp_model = (
        "claude-haiku-4-5-20251001" if platform_key == "reddit_reply"
        else "claude-sonnet-4-6"
    )
    raw_text = await call_claude(claude_prompt, max_tokens=max_tokens, model=_opp_model)
    raw_text = remove_hedging(raw_text)

    # Quality check: brand name must appear.
    # Skip for restricted subreddits — the prompt intentionally avoids direct brand mentions.
    if brand.name.lower() not in raw_text.lower() and promo_strategy != "restricted":
        _retry_prompt = (
            claude_prompt
            + f"\n\n⚠ QUALITY REQUIREMENT: Your previous output did not mention '{brand.name}'."
            f" You MUST include '{brand.name}' naturally at least once in the content."
        )
        _retry_raw = await call_claude(_retry_prompt, max_tokens=max_tokens, model=_opp_model)
        _retry_raw = remove_hedging(_retry_raw)
        if brand.name.lower() in _retry_raw.lower():
            raw_text = _retry_raw
        else:
            logger.warning(
                "generate_opportunity_draft: brand '%s' not mentioned after retry — opp_id=%d",
                brand.name, opportunity_id,
            )
            raw_text = f"[Brand not mentioned — review or regenerate this draft]\n\n" + raw_text

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
    source: Optional[str] = None,
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
        s.platform for s in enabled_settings
        if s.platform in CONTENT_PLATFORMS
    ]
    if not enabled_platforms:
        enabled_platforms = ["reddit", "quora"]

    # --- Generate: round-robin across platforms for equal distribution ---
    # Cycles through all (prompt, platform) combinations repeatedly until
    # max_gaps drafts are created or DRAFT_CAP is hit. This means 3 prompts ×
    # 4 platforms = 12 unique combos, but we keep cycling to reach 20.
    created: list[ContentDraft] = []
    last_error: Optional[Exception] = None  # track first hard failure for diagnostics
    n_platforms = len(enabled_platforms)
    n_prompts = len(ordered_prompts)
    prompt_idx = 0
    platform_idx = 0  # absolute index, wraps via modulo
    # Safety limit: stop after trying each (prompt, platform) combo 3× — prevents
    # infinite loops when every attempt raises a non-cap exception.
    max_attempts = n_prompts * n_platforms * 3
    attempts = 0
    # Per-prompt Quora question index — cycles through results so multiple drafts
    # for the same prompt each target a different question.
    quora_question_idx: dict[int, int] = {}
    # Track (prompt_id, platform) combos that have raised a "3 or more drafts" error
    # so we don't waste iterations retrying them.
    exhausted_combos: set[tuple[int, str]] = set()

    while len(created) < max_gaps and attempts < max_attempts:
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
        # Always query Serper for fresh results (24h in-process cache prevents
        # duplicate API calls within a day). Fall back to stored gap questions
        # only if Serper fails or returns nothing.
        quora_url: Optional[str] = None
        quora_title: Optional[str] = None
        quora_snippet: Optional[str] = None
        if platform == "quora":
            from app.services.quora_search_service import extract_keywords, search_quora_questions
            _questions: list[dict] = []

            # 1. Serper (fresh, cache-deduplicated per 24h)
            try:
                _keywords = extract_keywords(prompt.text)
                if _keywords:
                    _questions = await asyncio.to_thread(
                        search_quora_questions, _keywords, 5, prompt.id
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

        try:
            draft = await generate_gap_draft(
                db=db,
                brand_id=brand_id,
                prompt_id=prompt.id,
                platform=platform,
                quora_question_url=quora_url,
                quora_question_title=quora_title,
                quora_question_snippet=quora_snippet,
                source=source,
            )
            created.append(draft)
        except ValueError as exc:
            exc_str = str(exc).lower()
            if "full" in exc_str or "cap" in exc_str:
                logger.info(
                    "auto_draft_top_gaps: draft cap reached for brand_id=%d after %d drafts",
                    brand_id, len(created),
                )
                return created
            if "3 or more" in exc_str or "drafts already exist" in exc_str:
                exhausted_combos.add((prompt.id, platform))
            logger.warning(
                "auto_draft_top_gaps: skipped brand=%d prompt=%d platform=%s: %s",
                brand_id, prompt.id, platform, exc,
            )
        except Exception as exc:
            if last_error is None:
                last_error = exc
            logger.exception(
                "auto_draft_top_gaps: failed for brand=%d prompt=%d platform=%s",
                brand_id, prompt.id, platform,
            )

        # Advance: after visiting every platform once for this prompt, move to next prompt
        platform_idx += 1
        if platform_idx % n_platforms == 0:
            prompt_idx += 1
        attempts += 1

    logger.info(
        "auto_draft_top_gaps: created %d drafts for brand_id=%d", len(created), brand_id,
    )

    # If nothing was created and we have prompts, surface the root cause
    if not created and ordered_prompts and last_error is not None:
        raise last_error

    return created
