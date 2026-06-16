"""Statement of Work template."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile
from app.services.document_engine.registry import Template, register


class SowOutput(BaseModel):
    sow_number: str = Field(..., description="Unique SOW reference number, e.g., SOW-2026-0042")
    preamble: str = Field(..., description="1-2 paragraphs setting up the engagement")
    scope: str = Field(..., description="1-2 paragraphs on the scope of work")
    deliverables: list[str] = Field(default_factory=list, description="Specific deliverables, each ≤ 30 words")
    exclusions: list[str] = Field(default_factory=list, description="What is explicitly out of scope")
    timeline: str = Field(..., description="One paragraph on timeline / duration")
    fees: str = Field(..., description="One paragraph on fees / payment terms")


REQUIRED_FIELDS = ("brand.name",)


SECTION_MAP: dict[str, str] = {
    "1. engagement summary": "engagement_summary",
    "2. scope of services": "scope",
    "3. deliverables": "deliverables",
    "4. term": "term",
    "5. payment terms": "payment",
    "6. termination": "termination",
    "7. signatures": "signatures",
}


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
    return {
        "client": {
            "name": client.name,
            "primary_contact_name": client.primary_contact_name,
            "primary_contact_email": client.primary_contact_email,
            "retainer_amount_usd": client.retainer_amount_usd,
            "retainer_started_at": client.retainer_started_at.isoformat() if client.retainer_started_at else None,
        },
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "brand_profile": (
            {"company_description": profile.company_description, "tone_of_voice": profile.tone_of_voice}
            if profile else None
        ),
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a Statement of Work for an AI-visibility agency engagement between Lumidian (the agency) and the client.

Voice: Plain contract English. Direct, specific, unambiguous. No hedging, no marketing language, no AI-tells ("leverage," "robust," "comprehensive"). No "We are excited to…" preambles.

Title-Case the client name even when source data is lowercase.

The output is structured fields, rendered into a formatted SOW. Do not invent dollar amounts, deliverable counts, or terms not present in the source data — if a number is missing, omit it from the language and let the agency fill it in by hand.

Per-field rules:

- **sow_number**: A reference id in the form `SOW-{YYYY}-{NNNN}` using today's year and a 4-digit sequence based on the client's slug hash. If you cannot generate a stable id, use `SOW-{YYYY}-DRAFT`.
- **preamble**: 1 paragraph, ≤ 60 words. State the parties (Lumidian and {Client Name}), the engagement type ("AI-visibility services"), and the effective date. No marketing language.
- **scope**: 1-2 paragraphs, ≤ 100 words. State what the agency will do in plain prose — tracking, content production for AI-visibility channels, monthly reporting, opportunity scanning. Reference the specific channels (Reddit, Quora, Medium, LinkedIn) only if relevant. No quantities here (those belong in deliverables).
- **deliverables**: 4-7 bullets. Each ≤ 20 words. Quantified per-month amounts ("8 LinkedIn drafts/month"). Sorted by client value. Imperative-verb start ("Produce," "Deliver," "Run").
- **exclusions**: 3-5 bullets. Each ≤ 20 words. Name specific work that is OUT of scope (paid ads, direct outreach to publishers, web development, posting to client-controlled accounts on behalf of the client). Plain language.
- **timeline**: 1 paragraph, ≤ 50 words. Monthly renewal, 30-day notice to terminate, no minimum term. State the start date.
- **fees**: 1 paragraph, ≤ 50 words. Net-30, invoiced on the 1st of each month. If the retainer amount is provided, state it as `$N,NNN/month`; otherwise use `[retainer amount]` as a fill-in placeholder for Lumidian to complete by hand.
"""


register(
    Template(
        kind="sow",
        name="Statement of Work",
        description="Contract-style SOW for new engagements",
        title_factory=lambda c: f"SOW — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Engagement data:\n```json\n{data_json}\n```",
        max_tokens=4000,
        required_fields=REQUIRED_FIELDS,
        output_schema=SowOutput,
        typst_template="sow.typ",
        chart_calls=(),
    )
)
