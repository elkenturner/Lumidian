"""Kickoff checklist template — what's filled in vs what the client still owes."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile, Competitor, Prompt
from app.services.document_engine.registry import Template, register


class KickoffChecklistItem(BaseModel):
    label: str
    done: bool = False
    owner: str | None = None


class KickoffChecklistOutput(BaseModel):
    """LLM-generated portion. `pre_kickoff` is computed deterministically in
    Python (see `_compute_pre_kickoff`) and is NOT requested from the model.
    """
    in_meeting: list[KickoffChecklistItem] = Field(default_factory=list)
    post_kickoff: list[KickoffChecklistItem] = Field(default_factory=list)


REQUIRED_FIELDS = ("brand.name",)


def _is_populated(value: Any) -> bool:
    """True if a brand-profile field has real content.

    Treat empty string, None, '[]', '{}', and JSON arrays/objects that parse
    to empty as 'not populated'. This is the fix for the kickoff hallucination
    where bool('[]') returned True and items got marked done.
    """
    if value is None:
        return False
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return False
        if s in ("[]", "{}", "null"):
            return False
        try:
            parsed = json.loads(s)
            if parsed in (None, [], {}, ""):
                return False
            return True
        except (ValueError, TypeError):
            return True
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return bool(value)


def _compute_pre_kickoff(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the pre-kickoff checklist from data presence — never the LLM.

    Returns a list of {label, done, owner} dicts in canonical order.
    """
    brand = data.get("brand") or {}
    profile = data.get("brand_profile") or {}
    items = [
        ("Brand website URL on file",         bool(brand.get("website_url"))),
        ("Company description on file",       _is_populated(profile.get("company_description"))),
        ("Tone of voice documented",          _is_populated(profile.get("tone_of_voice"))),
        ("Preferred phrases captured",        _is_populated(profile.get("approved_language"))),
        ("Things to avoid documented",        _is_populated(profile.get("what_not_to_say"))),
        ("Press and earned media logged",     _is_populated(profile.get("publications"))),
        ("At least one tracked prompt",       (data.get("prompt_count") or 0) > 0),
        ("At least one competitor with URL",  bool(data.get("competitor_with_url_count"))),
    ]
    return [{"label": label, "done": done, "owner": None} for label, done in items]


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    prompt_count = 0
    competitor_with_url_count = 0
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        c_q = await db.execute(select(func.count(Prompt.id)).where(Prompt.brand_id == brand.id))
        prompt_count = c_q.scalar_one() or 0
        cw_q = await db.execute(
            select(func.count(Competitor.id))
            .where(Competitor.brand_id == brand.id, Competitor.website_url.isnot(None))
        )
        competitor_with_url_count = cw_q.scalar_one() or 0

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
                "company_description": profile.company_description,
                "tone_of_voice": profile.tone_of_voice,
                "what_not_to_say": profile.what_not_to_say,
                "approved_language": profile.approved_language,
                "publications": profile.publications,
            }
            if profile else None
        ),
        "prompt_count": prompt_count,
        "competitor_with_url_count": competitor_with_url_count,
    }


SYSTEM_PROMPT = """You are writing two sections of a kickoff checklist for an agency client onboarding: the in-meeting talking points and the post-kickoff agency follow-ups.

Voice: Direct, declarative. No hedging, no throat-clearing, no AI-tells ("comprehensive," "robust," "leverage").

Title-Case the brand name in any item that references it.

Per-field rules:

- **in_meeting**: 3-5 items. Each `label` ≤ 14 words. `done` always false. Talking points for the actual call: confirm primary buyer persona, confirm priority offering or service, confirm press/publications the client owns, confirm content cadence the client can sustain. Anchor each item to the specific brand when the brand context informs the question.
- **post_kickoff**: 3-5 items. Each `label` ≤ 14 words. `done` always false. Agency-side deliverables: send recap email, lock initial prompt set, lock first content calendar, schedule first weekly check-in.

Owner field: always null.
"""


def post_process(typst_input: dict[str, Any]) -> dict[str, Any]:
    """Inject the deterministically-computed pre_kickoff list into typst_input."""
    typst_input["pre_kickoff_items"] = _compute_pre_kickoff(typst_input)
    return typst_input


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
        post_process=post_process,
    )
)
