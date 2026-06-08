"""Initial brand audit template."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel, Field

from app.models import AgencyClient, Brand, BrandProfile, Competitor, Prompt, TrackingRun
from app.services.document_engine.registry import Template, register


class AuditInitialOutput(BaseModel):
    current_state: str = Field(..., description="2-3 sentence summary of where the brand stands today")
    working: list[str] = Field(default_factory=list, description="Strengths bullets")
    gaps: list[str] = Field(default_factory=list, description="Weakness bullets")
    recommendations: list[str] = Field(default_factory=list, description="3-5 prioritized actions for next 30 days")
    open_questions: list[str] = Field(default_factory=list, description="2-4 questions for the client")


REQUIRED_FIELDS = (
    "brand.name",
    "brand.website_url",
    "brand_profile.company_description",
)


SECTION_MAP: dict[str, str] = {
    "current state": "current_state",
    "what's working": "working",
    "gaps": "gaps",
    "recommendations (next 30 days)": "recommendations",
    "open questions for the client": "questions",
}


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    prompts: list[dict] = []
    competitors: list[dict] = []
    latest_run = None
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        prompts_q = await db.execute(select(Prompt).where(Prompt.brand_id == brand.id).limit(50))
        prompts = [{"id": p.id, "text": p.text} for p in prompts_q.scalars().all()]
        comp_q = await db.execute(select(Competitor).where(Competitor.brand_id == brand.id).limit(20))
        competitors = [{"name": c.name, "website": c.website_url} for c in comp_q.scalars().all()]
        run_q = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        latest_run = run_q.scalar_one_or_none()

    return {
        "client": {"name": client.name, "slug": client.slug, "status": client.status},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "brand_profile": (
            {
                "company_description": profile.company_description,
                "tone_of_voice": profile.tone_of_voice,
                "what_not_to_say": profile.what_not_to_say,
                "approved_language": profile.approved_language,
                "publications": profile.publications,
            }
            if profile
            else None
        ),
        "prompts": prompts,
        "competitors": competitors,
        "latest_run": (
            {
                "overall_score": latest_run.overall_score,
                "total_queries": latest_run.total_queries,
                "total_mentions": latest_run.total_mentions,
                "completed_at": latest_run.completed_at.isoformat() if latest_run.completed_at else None,
            }
            if latest_run
            else None
        ),
        "generated_at": datetime.utcnow().isoformat(),
        "has_data": bool(brand and (profile or prompts or latest_run)),
    }


SYSTEM_PROMPT = """You are a senior consultant writing the initial audit for a B2B SaaS client at an AI visibility agency.
Output professional, dense markdown. No filler. Use these sections:

# Initial Visibility Audit — {client.name}

## Current State
(2-3 sentence summary of where they stand. Cite the visibility score if available.)

## What's Working
(bullet list of strengths from brand profile / existing prompts / any positive scores)

## Gaps
(bullet list of weaknesses: incomplete profile fields, low-coverage prompts, missing competitor analysis, etc.)

## Recommendations (next 30 days)
(3-5 specific, prioritized actions)

## Open Questions for the Client
(2-4 things you'd ask in the kickoff call)

Keep tone direct, no hedging. If a data section is empty, explicitly say "Not yet captured" rather than inventing facts.
"""


register(
    Template(
        kind="audit_initial",
        name="Initial audit",
        description="One-page baseline assessment + recommendations",
        title_factory=lambda c: f"Initial audit — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Client data:\n```json\n{data_json}\n```",
        max_tokens=3000,
        required_fields=REQUIRED_FIELDS,
        output_schema=AuditInitialOutput,
        typst_template="audit_initial.typ",
        chart_calls=(),
    )
)
