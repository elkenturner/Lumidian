"""Prospect audit orchestrator — drives the state machine end-to-end.

Never raises. Failures are caught at the outer boundary and persisted to
ProspectAudit.error_message + status='failed'. Cancellation observed via
state.prospect_audit_cancel_events and ProspectAudit.cancel_requested.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit
from app.services.competitive_gap import _mention_matches
from app.services.jina_service import fetch_website_context
from app.services.prospect_audit.competitor_detect import DetectedCompetitor, detect_competitors
from app.services.prospect_audit.logo_fetch import fetch_prospect_logo
from app.services.prospect_audit.pdf_render import render_prospect_pdf
from app.services.prospect_audit.prompt_gen import generate_prompts
from app.services.prospect_audit.query_runner import run_queries_for_audit
from app.services.prospect_audit.recommendations import (
    AuditSummaryForRecs,
    PromptInsight,
    draft_recommendations,
)
from app.services.prospect_audit.scoring import (
    CompetitorRecord,
    PromptScore,
    QueryRecord,
    aggregate_audit,
    score_prompt,
)
from app.state import prospect_audit_cancel_events

logger = logging.getLogger(__name__)

PROSPECT_AUDIT_PDF_DIR = Path(os.getenv("PROSPECT_AUDIT_PDF_DIR", "data/prospect_audits"))

_MODELS = ["chatgpt", "perplexity", "gemini"]
_RUNS_PER = 3
_MAX_QUERY_ERROR_RATIO = 0.40   # >40% query errors → hard fail


async def _scrape_homepage(website_url: str) -> str:
    """Best-effort homepage scrape via Jina. Returns empty string on failure."""
    try:
        text = await fetch_website_context(website_url)
        return (text or "")[:8000]
    except Exception as exc:
        logger.info("scrape_homepage failed for %s: %s", website_url, exc)
        return ""


async def run_audit(audit_id: int) -> None:
    """Walk the state machine end-to-end. Never raises."""
    cancel_event = asyncio.Event()
    prospect_audit_cancel_events[audit_id] = cancel_event
    try:
        await _run_audit_inner(audit_id, cancel_event)
    except Exception as exc:
        logger.exception("prospect audit %d crashed unexpectedly", audit_id)
        await _persist_status(audit_id, status="failed", error_message=f"Unexpected error: {exc!s}", completed_at=datetime.utcnow())
    finally:
        prospect_audit_cancel_events.pop(audit_id, None)


async def _run_audit_inner(audit_id: int, cancel_event: asyncio.Event) -> None:
    audit = await _load(audit_id)
    if audit is None:
        logger.warning("prospect audit %d not found", audit_id)
        return

    # Pre-check cancel flag from DB (process restart case)
    if audit.cancel_requested:
        cancel_event.set()

    await _persist_status(audit_id, status="scraping", started_at=datetime.utcnow())

    # Step 1: scrape + logo (concurrent)
    try:
        excerpt, logo_data_uri = await asyncio.gather(
            _scrape_homepage(audit.website_url),
            fetch_prospect_logo(audit.website_url, audit.business_name),
        )
    except asyncio.CancelledError:
        return await _mark_canceled(audit_id)

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    # Step 2: prompts + competitors (need prompts first to compute is_subject for competitors)
    await _persist_status(audit_id, status="generating_prompts")
    try:
        prompts = await generate_prompts(
            business_name=audit.business_name,
            website_url=audit.website_url,
            homepage_excerpt=excerpt,
            location=audit.location if audit.is_local else None,
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"Failed to generate audit prompts: {exc!s}", completed_at=datetime.utcnow())

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    await _persist_status(audit_id, status="detecting_competitors")
    try:
        competitors = await detect_competitors(
            business_name=audit.business_name,
            website_url=audit.website_url,
            homepage_excerpt=excerpt,
            prompts=prompts,
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"Could not identify peer brands: {exc!s}", completed_at=datetime.utcnow())

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    # Step 3: run 90 queries
    await _persist_status(audit_id, status="running_queries", status_message=f"queries: 0/{len(prompts) * len(_MODELS) * _RUNS_PER}")

    async def on_progress(msg: str) -> None:
        await _persist_status(audit_id, status_message=msg)

    try:
        query_results = await run_queries_for_audit(
            prompts=prompts,
            models=_MODELS,
            runs_per=_RUNS_PER,
            brand_name=audit.business_name,
            on_progress=on_progress,
            cancel_event=cancel_event,
        )
    except asyncio.CancelledError:
        return await _mark_canceled(audit_id)

    error_count = sum(1 for r in query_results if r["error"] is not None)
    if query_results and error_count / len(query_results) > _MAX_QUERY_ERROR_RATIO:
        return await _persist_status(audit_id, status="failed", error_message=f"Too many query failures ({error_count}/{len(query_results)}).", completed_at=datetime.utcnow())

    # Detect competitor mentions for every result (in-memory only)
    comp_records = [CompetitorRecord(id=i + 1, is_subject=c.is_subject) for i, c in enumerate(competitors)]
    # Build {prompt_index: {comp_id: [bool aligned with queries for that prompt]}}
    per_prompt_queries: dict[int, list[dict]] = {}
    for r in query_results:
        per_prompt_queries.setdefault(r["prompt_index"], []).append(r)

    # Step 4: score
    await _persist_status(audit_id, status="scoring")
    prompt_scores: list[PromptScore] = []
    for pi, prompt_text in enumerate(prompts):
        prompt_results = per_prompt_queries.get(pi, [])
        q_records = [
            QueryRecord(
                model=r["model"],
                run=r["run"],
                response_text=r["response_text"],
                mentioned=r["mentioned"],
                error=r["error"],
            )
            for r in prompt_results
        ]
        comp_mentions: dict[int, list[bool]] = {}
        for i, comp in enumerate(competitors, start=1):
            comp_mentions[i] = [
                _mention_matches(r["response_text"], comp.name) if r["error"] is None else False
                for r in prompt_results
            ]
        score = score_prompt(q_records, comp_mentions, comp_records)
        # Re-tag with the actual prompt_index (score_prompt returns 0 by default)
        prompt_scores.append(PromptScore(
            prompt_index=pi,
            own_visibility_pct=score.own_visibility_pct,
            peer_avg_visibility_pct=score.peer_avg_visibility_pct,
            rvi=score.rvi,
            rvi_band=score.rvi_band,
        ))

    total_queries = sum(1 for r in query_results if r["error"] is None)
    mention_count = sum(1 for r in query_results if r["error"] is None and r["mentioned"])
    overall_vis, agg_rvi, rvi_band = aggregate_audit(prompt_scores, total_queries, mention_count)

    # Step 5: recommendations (non-fatal)
    await _persist_status(audit_id, status="drafting_recs")

    # Pick the 3 prompts where the prospect most needs action.
    # Tier 1 — real losses: own < peer_avg, sorted by widest gap first.
    # Tier 2 — untapped territory: both own AND peer_avg are 0 (no one is winning yet,
    #          the prospect can define the category). Sorted by prompt order (arbitrary).
    # Tier 3 — even/winning prompts get skipped unless we need padding. No "action needed."
    def _action_priority(p: PromptScore) -> tuple[int, float, int]:
        gap = p.own_visibility_pct - p.peer_avg_visibility_pct
        if gap < 0:
            # Real loss — surface first, widest gap before smaller gaps.
            return (1, gap, p.prompt_index)
        if p.own_visibility_pct == 0 and p.peer_avg_visibility_pct == 0:
            # Untapped territory — surface second.
            return (2, 0, p.prompt_index)
        # Even or winning — last priority. Negative gap so wins-by-most sort last.
        return (3, -gap, p.prompt_index)

    worst_three = sorted(prompt_scores, key=_action_priority)[:3]

    def _top_comp_for(prompt_index: int) -> tuple[str | None, float | None]:
        prompt_results = per_prompt_queries.get(prompt_index, [])
        best_name: str | None = None
        best_pct: float = -1.0
        non_error = [r for r in prompt_results if r["error"] is None]
        if not non_error:
            return None, None
        for comp in competitors:
            if comp.is_subject:
                continue
            hits = sum(1 for r in non_error if _mention_matches(r["response_text"], comp.name))
            pct = (hits / len(non_error)) * 100.0
            if pct > best_pct:
                best_pct = pct
                best_name = comp.name
        if best_name is None or best_pct <= 0.0:
            return None, None
        return best_name, round(best_pct, 1)

    insights: list[PromptInsight] = []
    for ps in worst_three:
        top_name, top_pct = _top_comp_for(ps.prompt_index)
        insights.append(PromptInsight(
            prompt_text=prompts[ps.prompt_index],
            own_visibility_pct=ps.own_visibility_pct,
            peer_avg_visibility_pct=ps.peer_avg_visibility_pct,
            rvi=ps.rvi,
            top_competitor_name=top_name,
            top_competitor_visibility_pct=top_pct,
        ))

    peer_avg_overall = sum(p.peer_avg_visibility_pct for p in prompt_scores) / max(len(prompt_scores), 1)
    summary = AuditSummaryForRecs(
        business_name=audit.business_name,
        location=audit.location if audit.is_local else None,
        overall_visibility_pct=overall_vis,
        peer_avg_visibility_pct=round(peer_avg_overall, 2),
        aggregate_rvi=agg_rvi,
        rvi_band=rvi_band,
        worst_prompts=insights,
    )
    recommendations_md = await draft_recommendations(summary)

    # Step 6: render PDF
    await _persist_status(audit_id, status="rendering_pdf")
    try:
        pdf_bytes = await render_prospect_pdf(
            audit=audit,
            prompts=prompts,
            prompt_scores=prompt_scores,
            competitors=competitors,
            summary=summary,
            recommendations_md=recommendations_md,
            logo_data_uri=logo_data_uri,
            per_prompt_top_competitor={p.prompt_index: _top_comp_for(p.prompt_index) for p in worst_three},
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"PDF render failed: {exc!s}", completed_at=datetime.utcnow())

    PROSPECT_AUDIT_PDF_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = PROSPECT_AUDIT_PDF_DIR / f"{audit_id}.pdf"
    pdf_path.write_bytes(pdf_bytes)

    # Step 7: persist final state
    await _persist_status(
        audit_id,
        status="completed",
        completed_at=datetime.utcnow(),
        overall_visibility_pct=overall_vis,
        aggregate_rvi=agg_rvi,
        rvi_band=rvi_band,
        pdf_path=str(pdf_path),
        status_message=None,
    )


async def _load(audit_id: int) -> ProspectAudit | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        return result.scalar_one_or_none()


async def _persist_status(audit_id: int, **fields) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        a = result.scalar_one_or_none()
        if a is None:
            return
        for k, v in fields.items():
            setattr(a, k, v)
        await db.commit()


async def _mark_canceled(audit_id: int) -> None:
    await _persist_status(audit_id, status="canceled", completed_at=datetime.utcnow())
