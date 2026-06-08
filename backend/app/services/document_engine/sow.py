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


SYSTEM_PROMPT = """You are drafting a Statement of Work for an AI visibility agency engagement.
Output contract-style markdown. Use these exact sections in this order:

# Statement of Work

**Client:** {client.name}
**Effective date:** {today}
**Monthly retainer:** ${retainer or "TBD"}

## 1. Engagement Summary
(2-3 sentences describing what the agency will do)

## 2. Scope of Services
(bullet list — Brand visibility tracking, weekly content drafting for Reddit/Quora/Medium, monthly client report, opportunity scanning. Include LinkedIn / X / blog posting as upcoming.)

## 3. Deliverables
(quantified per-month deliverables — e.g., "8 LinkedIn drafts/mo, 4 Medium drafts/mo, 4 Reddit/Quora replies/mo")

## 4. Term
(Monthly renewal, 30-day notice to cancel, no minimum)

## 5. Payment Terms
(Net 30, invoiced on the 1st of each month)

## 6. Termination
(Either party with 30 days written notice)

## 7. Signatures
(Two signature blocks: Agency representative + Client)

Keep professional, plain language. Do not invent terms not specified. If retainer is empty, write "TBD".
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
