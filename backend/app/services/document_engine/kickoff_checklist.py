"""Kickoff checklist template — what's filled in vs what the client still owes."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile, Prompt
from app.services.document_engine.registry import Template, register


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
Output a markdown document with this structure:

# Kickoff Checklist — {client.name}

## What we have
(`- [x]` lines for each item that's already filled in)

## What the client still owes
(`- [ ]` lines for each missing piece, with a short explanation of why we need it)

## Suggested first call
(3-4 bullet points to walk through with the client)

Items to check (each becomes either a `[x]` or `[ ]` line based on the data):
- Primary contact name
- Primary contact email
- Brand website URL
- Brand profile: company description
- Brand profile: tone of voice
- Brand profile: what not to say
- Brand profile: approved language
- Brand profile: publications
- At least 10 tracked prompts (currently {prompt_count})

Keep brief and actionable.
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
    )
)
