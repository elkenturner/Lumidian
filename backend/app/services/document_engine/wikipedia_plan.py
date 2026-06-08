"""Wikipedia plan template — surfaces scan + candidate data for a client deliverable."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    BrandProfile,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.document_engine.registry import Template, register


class WikiCandidateOut(BaseModel):
    article_title: str
    angle: str = Field(..., description="One-sentence on how we contribute legitimately")
    suggested_section: str | None = None


class WikipediaPlanOutput(BaseModel):
    summary: str = Field(..., description="2-3 sentences on the brand's Wikipedia opportunity overall")
    approach: str = Field(..., description="2-3 paragraphs on the engagement approach (publication strategy)")
    top_candidates: list[WikiCandidateOut] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)


REQUIRED_FIELDS = (
    "brand.name",
    "candidates",          # require at least one candidate from the scan
)


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()

    scan_payload: dict | None = None
    candidates_payload: list[dict] = []
    publications: list[dict] = []

    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        if profile and profile.publications:
            try:
                parsed = json.loads(profile.publications)
                if isinstance(parsed, list):
                    publications = parsed
            except Exception:
                publications = []

        scan_q = await db.execute(
            select(WikipediaScan)
            .where(WikipediaScan.brand_id == brand.id, WikipediaScan.status == "completed")
            .order_by(WikipediaScan.completed_at.desc())
            .limit(1)
        )
        scan = scan_q.scalar_one_or_none()
        if scan is not None:
            scan_payload = {
                "prompts_searched": scan.prompts_searched,
                "total_candidates_found": scan.total_candidates_found,
                "candidates_persisted": scan.candidates_persisted,
                "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
            }
            cands_q = await db.execute(
                select(WikipediaCandidate)
                .where(
                    WikipediaCandidate.brand_id == brand.id,
                    WikipediaCandidate.status.in_(("new", "drafted")),
                )
                .order_by(WikipediaCandidate.legitimacy_score.desc())
                .limit(10)
            )
            for c in cands_q.scalars().all():
                candidates_payload.append({
                    "title": c.article_title,
                    "url": c.article_url,
                    "legitimacy_score": c.legitimacy_score,
                    "legitimacy_reasoning": c.legitimacy_reasoning,
                    "suggested_section": c.suggested_section,
                    "status": c.status,
                })

    return {
        "client": {"name": client.name},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "publications": publications,
        "scan": scan_payload,
        "candidates": candidates_payload,
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a Wikipedia visibility plan for an agency client. Output professional markdown.

Use these sections in this order:

# Wikipedia plan for {client.name}

## Why Wikipedia matters for AI visibility
Write ~120 words on how Wikipedia is a Tier-1 citation source for ChatGPT, Perplexity, and Gemini. Factual, no fluff.

## Scan results
If `scan` is null: say "We haven't run a Wikipedia scan yet for this brand. Once we do, this plan will list the specific articles we'll target." and stop here.
If `scan` is present: list prompts_searched, total_candidates_found, candidates_persisted, and completed_at.

## Recommended targets
For each candidate in `candidates`, render a sub-section: title, URL, legitimacy score + reasoning, suggested section, current status.
If candidates is empty, say "No qualifying candidates surfaced — see open questions below."

## Approach
Two paragraphs on the neutral-tone, citation-driven editing approach.
If `publications` is non-empty, mention the publication titles by name as the citation backbone.
If `publications` is empty, say "We'll cite from authoritative third-party sources (industry publications, peer-reviewed coverage, established news outlets)."

## Timeline
If a target month is known from the brief, mention it. Otherwise: "We'll work through the candidate list over the next 30 days."

Stay factual. Do not invent statistics or article titles not present in the data. Numbers must be exact.
"""


register(
    Template(
        kind="wikipedia_plan",
        name="Wikipedia plan",
        description="Customer-facing Wikipedia targeting plan with scan results and candidate articles.",
        title_factory=lambda c: f"Wikipedia plan — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Plan data:\n```json\n{data_json}\n```",
        max_tokens=4000,
        required_fields=REQUIRED_FIELDS,
        output_schema=WikipediaPlanOutput,
        typst_template="wikipedia_plan.typ",
        chart_calls=(),
    )
)
