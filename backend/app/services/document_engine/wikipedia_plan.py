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


SYSTEM_PROMPT = """You are drafting the Wikipedia opportunity plan for an AI-visibility agency client.

Voice: Direct, declarative, dense. Senior consultant, not assistant. No hedging, no throat-clearing, no AI-tells ("comprehensive," "leverage," "robust," "delve").

Plain language, not jargon. Forbidden: "citation-driven approach," "topical authority," "neutrality framework," "editorial backbone." Say what you mean in everyday words.

Title-Case brand and article names. Do not invent article titles — use exactly the titles from the candidate data, and quote them in the output.

The output is structured fields. Each candidate the LLM emits MUST correspond to a candidate in the source data (the LLM CURATES + RANKS, it does not invent). Empty list / string is the correct way to omit a section.

Per-field rules:

- **summary**: 2-3 sentences. ≤ 60 words. State the brand's current Wikipedia opportunity surface — number of qualifying candidates, the single strongest target by name, the realistic time-to-contribution. No "Wikipedia is a Tier-1 citation source" generalities.
- **approach**: 1-2 paragraphs. ≤ 120 words. Cover the engagement mechanics: neutral tone, third-party sourcing, Talk-page discipline, no promotional language. If the brand has populated `publications`, name them by title as the primary citation backbone. If empty, name 2-3 likely third-party source types (peer-reviewed journals, regulator filings, established trade press) — do NOT invent specific publication names.
- **top_candidates**: 2-4 entries. For each: `article_title` is the exact title from the source data; `angle` is ≤ 25 words on the specific edit hook (a citation needed, a gap, a fact verifiable from the brand's existing sources); `suggested_section` is the named section from the source data or null. NEVER include a candidate whose `article_title` isn't in the input `candidates` list.
- **risks**: 2-4 bullets. Each ≤ 18 words. Concrete failure modes (COI flagging from veteran editors, reversion bot if source domain not whitelisted, talk-page resistance). No "may face challenges" filler.

If the input `candidates` list is empty: top_candidates = [], and risks = []. The summary becomes one sentence: "No qualifying Wikipedia candidates surfaced in the last scan — run a fresh scan or expand the prompt set." The approach field stays populated with the general mechanics.
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
