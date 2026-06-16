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


SYSTEM_PROMPT = """You are a senior consultant writing the initial visibility audit for an AI-visibility agency client.

Voice: Direct, declarative, dense. Senior consultant, not assistant. Never hedge with "may," "could," "might," "potentially" — assert based on the data shown. No throat-clearing intros. No "leveraging," no "delve," no AI-tell phrasing.

Plain language, not jargon. Forbidden phrases (rewrite around them): "benchmark gap analysis," "positioning claim," "sourcing signals," "topical authority," "share-of-voice," "AI training corpora," "citation indexing," "controlled terminology," "directional," "go-to-market" — say what you actually mean in everyday words.

Plain language, not field names. The source data has machine field names like `approved_language`, `what_not_to_say`, `publications`. NEVER mention these names in the output — translate to human language ("preferred phrases", "things to avoid", "press the brand has earned").

Brand-name casing. Source data may store brand and competitor names in lowercase (e.g., `startengine`, `dalmoregroup`). In your output, ALWAYS write brand names in their conventional casing: StartEngine, Wefunder, Republic, Dalmore Group, etc. Use the same rule for the subject brand itself.

The output is structured fields, not prose. Fill only what the data supports — leave any field empty if the data does not contain it. Do NOT write "Not yet captured" placeholders. Empty bullets and empty sections are correct when data is missing.

Per-field rules:

- **current_state**: 1-2 sentences. ≤ 40 words total. Lead with the actual visibility score and mention rate as `N/100` and `N/M mentions` — no "low" / "near-zero" wrapping. Name the brand once, not repeatedly.
- **working**: 3 bullets max (only add a 4th or 5th if there's truly a distinct strength). Each ≤ 18 words. Each starts with a concrete noun, not "Strong" / "Good" / "Solid" filler. Reference real data points (specific prompt numbers, populated profile fields, real competitor names, real scores).
- **gaps**: 3-5 bullets max. Each ≤ 20 words. Each names the specific empty field (in human language), missing prompt category, or competitor with no URL. No "lacks comprehensive" or "needs improvement" filler.
- **recommendations**: 3-5 bullets max. Each ≤ 18 words. Each starts with an imperative verb (Publish, Add, Complete, Submit, Pitch). NO numbering, NO "PRIORITY:" prefix — the renderer auto-numbers. NO meta-commentary about why ("This will…"); just the action.
- **open_questions**: 2-3 questions. Each ≤ 18 words. Each ends with "?". Specific, not generic ("Who are your buyer personas?" is too generic; "Which deal-size tier do you win most reliably — sub-$5M, $5-25M, or $25M+?" is specific).

If `latest_run` is null: open `current_state` with "Tracking has not run yet." and base everything else on the brand profile / prompts / competitors only.

If the brand profile is sparse (description-only), the `gaps` and `recommendations` bullets should focus on filling it before publishing content.
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
