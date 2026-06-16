"""Kickoff checklist template — what's filled in vs what the client still owes."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile, Prompt
from app.services.document_engine.registry import Template, register


class KickoffChecklistItem(BaseModel):
    label: str
    done: bool = False
    owner: str | None = None


class KickoffChecklistOutput(BaseModel):
    pre_kickoff: list[KickoffChecklistItem] = Field(default_factory=list)
    in_meeting: list[KickoffChecklistItem] = Field(default_factory=list)
    post_kickoff: list[KickoffChecklistItem] = Field(default_factory=list)


REQUIRED_FIELDS = ("brand.name",)


SECTION_MAP: dict[str, str] = {
    "what we have": "have",
    "what the client still owes": "owes",
    "suggested first call": "first_call",
}


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    prompt_count = 0
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        c_q = await db.execute(select(func.count(Prompt.id)).where(Prompt.brand_id == brand.id))
        prompt_count = c_q.scalar_one() or 0

    return {
        "client": {
            "name": client.name,
            "primary_contact_name": bool(client.primary_contact_name),
            "primary_contact_email": bool(client.primary_contact_email),
        },
        "brand": (
            {"name": brand.name, "website_url": bool(brand.website_url)} if brand else None
        ),
        "brand_profile": (
            {
                "company_description": bool(profile.company_description),
                "tone_of_voice": bool(profile.tone_of_voice),
                "what_not_to_say": bool(profile.what_not_to_say),
                "approved_language": bool(profile.approved_language),
                "publications": bool(profile.publications),
            }
            if profile else None
        ),
        "prompt_count": prompt_count,
    }


SYSTEM_PROMPT = """You are writing a kickoff checklist for an agency client onboarding.

Voice: Direct, declarative. No hedging, no throat-clearing, no AI-tells ("comprehensive," "robust," "leverage").

Plain language, not field names. The source data has machine field names like `approved_language`, `what_not_to_say`, `publications`. NEVER mention these in the output — use human language ("preferred phrases", "things to avoid", "press the brand has earned").

Title-Case the brand name even when source data is lowercase.

The output is structured fields. The renderer emits check marks based on each item's `done` flag. Empty lists are correct when there's nothing to list — do NOT pad with filler items.

Per-field rules:

- **pre_kickoff**: 4-7 items. Each `label` ≤ 12 words. Item is `done: true` when the corresponding brand data is populated; `done: false` when it's missing. Cover, in order: brand website URL, company description, tone of voice, preferred phrases, things to avoid, press/publications, competitor URLs filled in.
- **in_meeting**: 3-5 items. Each `label` ≤ 12 words. All `done: false`. Cover the talking points for the actual call: confirm primary buyer persona, confirm priority offering/service, confirm publications/press the client owns, confirm content cadence the client can sustain.
- **post_kickoff**: 3-5 items. Each `label` ≤ 12 words. All `done: false`. Cover the agency-side deliverables: send recap email, lock initial prompt set, lock content calendar, schedule first weekly check-in.

Owner field: leave null unless the data explicitly assigns one.
"""


register(
    Template(
        kind="kickoff_checklist",
        name="Kickoff checklist",
        description="Onboarding checklist showing what's filled in vs what the client owes",
        title_factory=lambda c: f"Kickoff checklist — {c.name}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Client onboarding state:\n```json\n{data_json}\n```",
        max_tokens=1500,
        required_fields=REQUIRED_FIELDS,
        output_schema=KickoffChecklistOutput,
        typst_template="kickoff_checklist.typ",
        chart_calls=(),
    )
)
