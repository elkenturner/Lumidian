"""
Dashboard router — rich analytics for the brand overview page.

Routes
------
GET /api/dashboard/{brand_id}/analytics  — full analytics payload

Sentiment is read from query_results.sentiment (populated once per run by
sentiment_service.py). This endpoint never calls the Claude API.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import func as sqlfunc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_brand_for_user
from app.models import CitationSource, Competitor, Prompt, QueryResult, RunModelScore, TrackingRun
from app.services.rvi import _mention_matches
from app.schemas import (
    CitationGap,
    RVIResponse,
    CompetitorStat,
    ConversationItem,
    DashboardAnalytics,
    DomainStat,
    ModelStat,
    PositionData,
    SentimentBreakdown,
    SOVData,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

_LOOKBACK_DAYS = 30
_MAX_RUNS = 50
_MAX_CONVERSATIONS = 80
_MAX_DOMAINS = 10
# Cap raw QueryResult load. With many runs each result row carries a full LLM
# response (~500-2000 chars), so loading all rows is the primary slow path.
# 400 rows is representative for all analytics (sentiment, SOV, position, domains)
# while keeping the payload small.
_MAX_QUERY_ROWS = 400

_MODEL_LABELS: dict[str, str] = {
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
}

def _model_key(model: str) -> str:
    m = model.lower().replace("-", "").replace("_", "").replace(" ", "")
    for k in _MODEL_LABELS:
        if k in m:
            return k
    return model

def _model_label(key: str) -> str:
    return _MODEL_LABELS.get(key, key.title())


# ── Position helper ───────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    """Lowercase and strip all non-alphanumeric characters (mirrors tracking_service)."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _position_score(response_text: str, brand_name: str) -> float | None:
    """
    Return a 1–10 score for where in the response the brand first appears.
    1 = very beginning, 10 = very end.

    Uses exact case-insensitive match first; falls back to a normalized
    (stripped punctuation/spaces) match for brands detected via fuzzy logic.
    Returns None only when response_text is empty.
    """
    if not response_text:
        return None

    text_lower = response_text.lower()

    # 1. Exact case-insensitive match
    idx = text_lower.find(brand_name.lower())

    # 2. Normalized match — handles e.g. "SpotItEarly" when brand is "Spot it Early"
    if idx == -1:
        brand_norm = _normalize(brand_name)
        text_norm = _normalize(response_text)
        if brand_norm:
            norm_idx = text_norm.find(brand_norm)
            if norm_idx != -1:
                # Map normalized index proportionally back to original text length
                idx = int((norm_idx / len(text_norm)) * len(response_text))

    # 3. If still not found, return a midpoint (shouldn't happen when mentioned=True)
    if idx == -1:
        return 5.0

    ratio = idx / len(response_text)
    return round(1.0 + ratio * 9.0, 1)


# ── Domain classification ─────────────────────────────────────────────────────

_DOMAIN_MAP: dict[str, str] = {
    "reddit.com": "UGC", "quora.com": "UGC", "stackoverflow.com": "UGC",
    "stackexchange.com": "UGC", "producthunt.com": "UGC", "news.ycombinator.com": "UGC",
    "wikipedia.org": "Reference", "britannica.com": "Reference",
    "nytimes.com": "Editorial", "wsj.com": "Editorial", "forbes.com": "Editorial",
    "bloomberg.com": "Editorial", "reuters.com": "Editorial", "bbc.com": "Editorial",
    "cnn.com": "Editorial", "theguardian.com": "Editorial", "wired.com": "Editorial",
    "techcrunch.com": "Editorial", "theverge.com": "Editorial", "zdnet.com": "Editorial",
    "arstechnica.com": "Editorial", "businessinsider.com": "Editorial",
    "cnbc.com": "Editorial", "ft.com": "Editorial", "washingtonpost.com": "Editorial",
    "medium.com": "Editorial", "substack.com": "Editorial",
    "cdc.gov": "Institutional", "nih.gov": "Institutional", "fda.gov": "Institutional",
    "who.int": "Institutional", "ncbi.nlm.nih.gov": "Institutional",
}

# Full URLs: https://example.com/path
_URL_RE = re.compile(
    r'https?://(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9\-]*(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,})'
    r'(?:[/\s\)\]\"\'<>,;]|$)',
    re.IGNORECASE,
)
# Bare domains: "wikipedia.org", "www.techcrunch.com", "(reddit.com)"
# Require letter-start + known TLD; excludes "1.0", "[1]", etc.
# Supports compound TLDs (co.uk, gov.au) and single TLDs.
_BARE_DOMAIN_RE = re.compile(
    r'(?:^|[\s\(\[\"\',;:])(?:www\.)?([a-zA-Z][a-zA-Z0-9\-]*\.'
    r'(?:(?:co|gov|org|ac|net)\.(?:uk|au|nz|in|za|kr|jp|id|br)'  # compound TLDs
    r'|com|org|net|io|ai|co|edu|gov|info|tech|app|dev|news|media|blog|tv|health|int|me|us'
    r'|uk|de|fr|jp|au|ca|eu|nz|in|br|mx|kr|cn|se|nl|ch|be|at|pt|es|it|pl|ie|fi|dk|no|sg|hk))'
    r'(?:[/\s\)\]\"\'<>,;.]|$)',
    re.IGNORECASE,
)


def _extract_domains(text: str) -> list[str]:
    """Extract domain names from full URLs and bare domain references."""
    seen: set[str] = set()
    results: list[str] = []
    for m in _URL_RE.finditer(text):
        d = m.group(1).lower()
        if d not in seen:
            seen.add(d)
            results.append(d)
    for m in _BARE_DOMAIN_RE.finditer(text):
        d = m.group(1).lower()
        if d not in seen:
            seen.add(d)
            results.append(d)
    return results


def _classify_domain(domain: str) -> str:
    d = domain.lower()
    if d in _DOMAIN_MAP:
        return _DOMAIN_MAP[d]
    for known, dtype in _DOMAIN_MAP.items():
        if d.endswith("." + known) or d == known:
            return dtype
    if d.endswith(".gov"):
        return "Institutional"
    if d.endswith(".edu"):
        return "Institutional"
    if d.endswith(".org"):
        return "Reference"
    return "Corporate"


_DOMAIN_ALIASES: dict[str, str] = {
    "twitter.com": "x.com",
}

_ACTIONABLE_DOMAIN_MAP: dict[str, str] = {
    "reddit.com": "reddit",
    "quora.com": "quora",
    "medium.com": "medium",
    "wikipedia.org": "wikipedia",
    "linkedin.com": "linkedin",
    "x.com": "x",
}


def _normalize_domain(domain: str) -> str:
    """Collapse domain variants to a canonical form before aggregation.

    twitter.com → x.com.
    *.wikipedia.org → wikipedia.org (any language subdomain).
    """
    d = domain.lower()
    if d in _DOMAIN_ALIASES:
        return _DOMAIN_ALIASES[d]
    if d.endswith(".wikipedia.org"):
        return "wikipedia.org"
    return d


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.get("/{brand_id}/analytics", response_model=DashboardAnalytics)
async def get_analytics(brand_id: int, db: DbDep, user: CurrentUser):
    # 1. Brand
    brand = await get_brand_for_user(brand_id, db, user)

    # 2. Competitors
    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()

    # 3. Recent completed runs (last 30 days, max 50)
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=_LOOKBACK_DAYS)
    runs_result = await db.execute(
        select(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
            TrackingRun.completed_at >= cutoff,
        )
        .order_by(TrackingRun.completed_at.desc())
        .limit(_MAX_RUNS)
    )
    runs = runs_result.scalars().all()

    _empty_sov = SOVData(
        percentage=100.0 if not competitors else 0.0,
        brand_mentions=0,
        total_mentions=0,
        has_competitors=len(competitors) > 0,
    )

    if not runs:
        return DashboardAnalytics(
            brand_id=brand.id,
            brand_name=brand.name,
            sov=_empty_sov,
            sentiment=SentimentBreakdown(
                positive_pct=0.0, neutral_pct=0.0, negative_pct=0.0, has_data=False
            ),
            position=PositionData(score=None, label="N/A", sample_count=0),
            top_domains=[],
            recent_conversations=[],
            competitor_comparison=[],
            model_breakdown=[],
            citation_gaps=[],
            total_responses_analyzed=0,
            score_confidence="low",
            active_models=0,
        )

    run_ids = [r.id for r in runs]

    # 4a. Model breakdown from pre-computed RunModelScore — accurate totals
    # without any row cap, since RunModelScore stores one row per model per run.
    model_agg_result = await db.execute(
        select(
            RunModelScore.model,
            sqlfunc.sum(RunModelScore.total_queries).label("total_queries"),
            sqlfunc.sum(RunModelScore.total_mentions).label("total_mentions"),
        )
        .where(RunModelScore.tracking_run_id.in_(run_ids))
        .group_by(RunModelScore.model)
    )
    model_agg: dict[str, dict[str, int]] = {}
    for r in model_agg_result.all():
        key = _model_key(r.model)
        model_agg[key] = {"total": int(r.total_queries), "mentions": int(r.total_mentions)}
    total_analyzed = sum(v["total"] for v in model_agg.values())

    # 4b. Load query results for text-heavy analysis (SOV competitors,
    # position, domains, conversations, citation gaps).
    # - Filter errors so placeholder rows don't inflate denominators
    # - Sample evenly per model so the row cap doesn't bias toward
    #   whichever model's queries completed last
    per_model_limit = max(_MAX_QUERY_ROWS // len(_MODEL_LABELS), 1)
    rows: list[tuple] = []
    for model_name in _MODEL_LABELS:
        model_qr = await db.execute(
            select(QueryResult, Prompt.text.label("prompt_text"))
            .join(Prompt, QueryResult.prompt_id == Prompt.id)
            .where(
                QueryResult.tracking_run_id.in_(run_ids),
                QueryResult.error.is_(None),
                QueryResult.model == model_name,
            )
            .order_by(QueryResult.created_at.desc())
            .limit(per_model_limit)
        )
        rows.extend(model_qr.all())

    total = len(rows)

    # 5. SOV
    brand_mentions = sum(1 for qr, _ in rows if qr.mentioned)
    comp_counts: dict[str, int] = {}
    for comp in competitors:
        comp_counts[comp.name] = sum(
            1 for qr, _ in rows
            if _mention_matches(qr.response_text, comp.name)
        )
    total_mentions = brand_mentions + sum(comp_counts.values())
    sov_pct = (brand_mentions / total_mentions * 100.0) if total_mentions > 0 else (100.0 if not competitors else 0.0)
    sov = SOVData(
        percentage=round(sov_pct, 1),
        brand_mentions=brand_mentions,
        total_mentions=total_mentions,
        has_competitors=len(competitors) > 0,
    )

    # 6. Sentiment — exact SQL aggregate over the WHOLE window, not the capped
    # row sample above. Sentiment is a stored label (set by sentiment_service
    # at run time), so no response text is needed and the aggregate is cheap.
    # Computing it from the capped rows made "last 30 days" silently mean
    # "last ~1.3 runs" for large brands (e.g. "100% positive · 3 mentions"
    # when the real window held 13 mentions).
    sentiment_counts: dict[str, int] = {"positive": 0, "neutral": 0, "negative": 0}
    unclassified_mentions = 0
    sent_agg = await db.execute(
        select(QueryResult.sentiment, sqlfunc.count())
        .where(
            QueryResult.tracking_run_id.in_(run_ids),
            QueryResult.mentioned.is_(True),
            QueryResult.error.is_(None),
        )
        .group_by(QueryResult.sentiment)
    )
    for label, count in sent_agg.all():
        if label in sentiment_counts:
            sentiment_counts[label] += int(count)
        else:
            # Mentioned but never classified (classifier failed/skipped) — the
            # UI must not read this as "no mentions to analyze".
            unclassified_mentions += int(count)

    sent_total = sum(sentiment_counts.values())
    if sent_total > 0:
        pos_pct = sentiment_counts["positive"] / sent_total * 100
        neu_pct = sentiment_counts["neutral"] / sent_total * 100
        neg_pct = sentiment_counts["negative"] / sent_total * 100
        has_data = True
    else:
        pos_pct = neu_pct = neg_pct = 0.0
        has_data = False
    sentiment = SentimentBreakdown(
        positive_pct=round(pos_pct, 1),
        neutral_pct=round(neu_pct, 1),
        negative_pct=round(neg_pct, 1),
        has_data=has_data,
        unclassified_mentions=unclassified_mentions,
        classified_mentions=sent_total,
        positive_count=sentiment_counts["positive"],
        neutral_count=sentiment_counts["neutral"],
        negative_count=sentiment_counts["negative"],
    )

    # 7. Average position
    position_scores = [
        s for qr, _ in rows
        if qr.mentioned and qr.response_text
        for s in [_position_score(qr.response_text, brand.name)]
        if s is not None
    ]
    _MIN_POSITION_SAMPLES = 3  # need at least 3 data points for meaningful position
    if len(position_scores) >= _MIN_POSITION_SAMPLES:
        avg_pos = sum(position_scores) / len(position_scores)
        pos_label = "Early" if avg_pos <= 3.5 else "Middle" if avg_pos <= 6.5 else "Late"
        position = PositionData(
            score=round(avg_pos, 1),
            label=pos_label,
            sample_count=len(position_scores),
        )
    else:
        position = PositionData(score=None, label="N/A", sample_count=len(position_scores))

    # 8. Top domains — primary source is the citation_sources table (real
    # structured citations across all tracked prompts, matching the card
    # title). Falls back to regex extraction from the window's response text
    # for brands whose runs predate citation extraction.
    citation_domain_rows = (await db.execute(
        select(CitationSource.domain, sqlfunc.count(CitationSource.id).label("cnt"))
        .where(CitationSource.brand_id == brand_id)
        .group_by(CitationSource.domain)
        .order_by(sqlfunc.count(CitationSource.id).desc())
        .limit(_MAX_DOMAINS)
    )).all()

    if citation_domain_rows:
        citation_total = (await db.execute(
            select(sqlfunc.count(CitationSource.id))
            .where(CitationSource.brand_id == brand_id)
        )).scalar() or 0
        domain_stats = [
            DomainStat(
                domain=dom,
                count=cnt,
                pct=round(cnt / citation_total * 100, 1) if citation_total > 0 else 0.0,
                domain_type=_classify_domain(dom),
            )
            for dom, cnt in citation_domain_rows
        ]
    else:
        domain_counts: dict[str, int] = defaultdict(int)
        for qr, _ in rows:
            if qr.response_text:
                for domain in _extract_domains(qr.response_text):
                    domain_counts[domain] += 1
        top_domains_raw = sorted(domain_counts.items(), key=lambda x: x[1], reverse=True)[:_MAX_DOMAINS]
        domain_stats = [
            DomainStat(
                domain=dom,
                count=cnt,
                pct=round(cnt / total * 100, 1) if total > 0 else 0.0,
                domain_type=_classify_domain(dom),
            )
            for dom, cnt in top_domains_raw
        ]

    # 9. Recent conversations — deduplicated by (prompt_id, model).
    # Sort mentioned results first so the dedup keeps the mentioned row
    # when multiple run_numbers exist for the same (prompt, model) pair.
    sorted_for_conv = sorted(
        rows,
        key=lambda r: (bool(r[0].mentioned), r[0].created_at or datetime.min),
        reverse=True,
    )
    seen_keys: set[tuple[int, str]] = set()
    unique_conv_rows: list[tuple[QueryResult, str]] = []
    for qr, prompt_text in sorted_for_conv:
        key = (qr.prompt_id, qr.model)
        if key not in seen_keys:
            seen_keys.add(key)
            unique_conv_rows.append((qr, prompt_text))
        if len(unique_conv_rows) >= _MAX_CONVERSATIONS:
            break

    conversations = [
        ConversationItem(
            id=qr.id,
            prompt_text=prompt_text,
            model=qr.model,
            mentioned=qr.mentioned,
            response_preview=(qr.response_text or "")[:150],
            response_text=qr.response_text,
            created_at=qr.created_at.isoformat() if qr.created_at else "",
        )
        for qr, prompt_text in unique_conv_rows
    ]

    # 10. Competitor comparison (mention_rate as 0-1 ratio)
    brand_rate = brand_mentions / total if total > 0 else 0.0
    competitor_comparison = [
        CompetitorStat(
            name=brand.name,
            mention_count=brand_mentions,
            mention_rate=round(brand_rate, 4),
            is_primary=True,
        )
    ] + [
        CompetitorStat(
            name=comp.name,
            mention_count=comp_counts[comp.name],
            mention_rate=round(comp_counts[comp.name] / total, 4) if total > 0 else 0.0,
            is_primary=False,
        )
        for comp in competitors
    ]

    # 11. Model breakdown from pre-computed RunModelScore — uses accurate
    # totals across all runs without any row-cap sampling bias.
    model_breakdown = sorted(
        [
            ModelStat(
                model=key,
                label=_model_label(key),
                mention_count=data["mentions"],
                total=data["total"],
                mention_rate=round(data["mentions"] / data["total"], 4) if data["total"] else 0.0,
            )
            for key, data in model_agg.items()
        ],
        key=lambda s: s.mention_rate,
        reverse=True,
    )

    # 12. Citation gaps — domains frequently cited in responses that DON'T mention the brand
    domain_with: dict[str, int] = defaultdict(int)
    domain_total_counts: dict[str, int] = defaultdict(int)
    for qr, _ in rows:
        if not qr.response_text:
            continue
        domains_in_response = _extract_domains(qr.response_text)
        seen_normalized: set[str] = set()
        for raw in domains_in_response:
            normalized = _normalize_domain(raw)
            # de-dupe within a single response so two variants (e.g.,
            # twitter.com + x.com in the same answer) only count once.
            if normalized in seen_normalized:
                continue
            seen_normalized.add(normalized)
            domain_total_counts[normalized] += 1
            if qr.mentioned:
                domain_with[normalized] += 1

    _MIN_CITATIONS = 2  # ignore domains that appear only once
    citation_gaps = sorted(
        [
            CitationGap(
                domain=dom,
                domain_type=_classify_domain(dom),
                cited_total=cnt,
                cited_with_brand=domain_with.get(dom, 0),
                gap_score=round(1.0 - (domain_with.get(dom, 0) / cnt), 4),
                platform=_ACTIONABLE_DOMAIN_MAP[dom],
            )
            for dom, cnt in domain_total_counts.items()
            if cnt >= _MIN_CITATIONS
            and dom in _ACTIONABLE_DOMAIN_MAP
            and domain_with.get(dom, 0) < cnt  # exclude full coverage
        ],
        key=lambda g: (
            g.cited_total - g.cited_with_brand,        # missed mentions, DESC
            1 if g.cited_with_brand > 0 else 0,        # partial presence tiebreaker, DESC
        ),
        reverse=True,
    )[:6]

    final_total = total_analyzed if total_analyzed > 0 else total
    if final_total >= 100:
        score_confidence = "high"
    elif final_total >= 20:
        score_confidence = "medium"
    else:
        score_confidence = "low"
    active_model_count = len([m for m in model_agg.values() if m["total"] > 0])

    return DashboardAnalytics(
        brand_id=brand.id,
        brand_name=brand.name,
        sov=sov,
        sentiment=sentiment,
        position=position,
        top_domains=domain_stats,
        recent_conversations=conversations,
        competitor_comparison=competitor_comparison,
        model_breakdown=model_breakdown,
        citation_gaps=citation_gaps,
        total_responses_analyzed=final_total,
        score_confidence=score_confidence,
        active_models=active_model_count,
    )


@router.get("/{brand_id}/rvi", response_model=RVIResponse)
async def get_rvi(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    window: Literal["7d", "30d", "90d"] = "7d",
) -> RVIResponse:
    """Relative Visibility Index: brand visibility ÷ peer-pool average, over
    contested prompts. Drives the dashboard's RVI card + drawer.
    Spec: docs/superpowers/specs/2026-07-05-rvi-design.md
    """
    await get_brand_for_user(brand_id, db, user)  # 404 on miss, matches existing dashboard endpoints
    from app.services.rvi import compute_rvi
    return await compute_rvi(brand_id=brand_id, window=window, db=db)
