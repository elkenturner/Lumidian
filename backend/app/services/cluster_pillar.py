"""Propose an own-site pillar page for a cluster after tone-gating."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentCluster,
    Prompt,
    WebsiteAudit,
    WebsiteAuditPage,
)
from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

_TONE_GATE_THRESHOLD = 0.6

_TONE_TEMPLATE = """You are a content reviewer evaluating whether a brand-owned page reads as neutral and informative (good for AI engine retrieval) versus marketing-coded (bad — AI engines downweight it).

Evaluate this page for tone.

URL: {url}
TITLE: {title}
EXCERPT: {excerpt}

Output strict JSON only:
{{
  "score": <float 0..1 — 1.0 = perfectly neutral, 0.0 = pure marketing copy>,
  "reasoning": "<1 sentence explaining the score>"
}}

Pages that pass (score >= 0.6) read like a knowledgeable practitioner wrote them — informative, no CTAs, no hard sell. Pages that fail open with the brand name as subject, use marketing register, push the reader to a product page, or contain CTAs."""


@dataclass
class PillarCandidate:
    page_id: int
    url: str
    title: str | None
    tone_score: float
    tone_reasoning: str


def _tokenize(s: str) -> set[str]:
    import re
    return {t for w in (s or "").split() if (t := re.sub(r"[^a-z0-9]", "", w.lower()))}


async def _score_tone(url: str, title: str | None, excerpt: str) -> tuple[float, str]:
    """Run the LLM tone gate. Returns (score, reasoning)."""
    prompt = _TONE_TEMPLATE.format(url=url, title=title or "(no title)", excerpt=excerpt[:1000])
    raw = (await call_claude(prompt=prompt, max_tokens=200, model=CROSS_REF_SUMMARY_MODEL)).strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].lstrip("json").strip() if len(parts) >= 2 else raw
    try:
        data = json.loads(raw)
        return float(data.get("score", 0.0)), str(data.get("reasoning", ""))
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning("Tone gate returned unparseable output: %s (%s)", raw[:120], e)
        return 0.0, "Unparseable tone-gate response."


async def propose_pillar(db: AsyncSession, cluster: ContentCluster) -> PillarCandidate | None:
    """Find and tone-gate an own-site pillar candidate. None if no candidates pass."""
    brand = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    if not brand.website_url:
        return None

    audit = (await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == cluster.brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.id)).limit(1)
    )).scalar_one_or_none()
    if not audit:
        return None

    prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    prompt_tokens = _tokenize(prompt.text)

    pages = (await db.execute(
        select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit.id, WebsiteAuditPage.http_status == 200)
    )).scalars().all()

    # Rank by simple token overlap with prompt text + title (Jaccard on title)
    ranked: list[tuple[float, WebsiteAuditPage]] = []
    for p in pages:
        title_tokens = _tokenize(p.title or "")
        if not title_tokens:
            continue
        overlap = len(prompt_tokens & title_tokens)
        if overlap == 0:
            continue
        denom = len(prompt_tokens | title_tokens) or 1
        ranked.append((overlap / denom, p))

    ranked.sort(reverse=True, key=lambda t: t[0])
    if not ranked:
        return None

    # Tone-gate the top candidate only
    top_page = ranked[0][1]
    excerpt = (top_page.h1_text or top_page.title or "")
    score, reasoning = await _score_tone(top_page.url, top_page.title, excerpt)

    if score < _TONE_GATE_THRESHOLD:
        cluster.pillar_mode = "rejected_tone"
        cluster.pillar_url = top_page.url
        await db.commit()
        return None

    cluster.pillar_mode = "proposed"
    cluster.pillar_url = top_page.url
    await db.commit()

    return PillarCandidate(
        page_id=top_page.id,
        url=top_page.url,
        title=top_page.title,
        tone_score=score,
        tone_reasoning=reasoning,
    )
