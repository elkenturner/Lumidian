"""Site plan template — customer-facing site optimization summary."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
)
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()

    audit_payload: dict | None = None
    top_fixes: list[dict] = []
    llms_txt_status: dict | None = None
    robots_txt_snippet: str | None = None

    if brand is not None:
        audit_q = await db.execute(
            select(WebsiteAudit)
            .where(WebsiteAudit.brand_id == brand.id, WebsiteAudit.status == "completed")
            .order_by(WebsiteAudit.completed_at.desc())
            .limit(1)
        )
        audit = audit_q.scalar_one_or_none()
        if audit is not None:
            audit_payload = {
                "overall_score": audit.overall_score,
                "bot_access_score": audit.bot_access_score,
                "content_score": audit.content_score,
                "schema_score": audit.schema_score,
                "technical_score": audit.technical_score,
                "render_mode": audit.render_mode,
                "completed_at": audit.completed_at.isoformat() if audit.completed_at else None,
            }
            llms_txt_status = {
                "present": audit.llms_txt_present,
                "valid": audit.llms_txt_valid,
            }
            robots_txt_snippet = (audit.robots_txt_raw or "")[:1000] or None

            recs_q = await db.execute(
                select(WebsiteAuditRecommendation)
                .where(WebsiteAuditRecommendation.audit_id == audit.id)
                .order_by(WebsiteAuditRecommendation.priority_score.desc())
                .limit(10)
            )
            for r in recs_q.scalars().all():
                page_url: str | None = None
                if r.page_id is not None:
                    p = await db.execute(
                        select(WebsiteAuditPage.url).where(WebsiteAuditPage.id == r.page_id)
                    )
                    page_url = p.scalar_one_or_none()
                top_fixes.append({
                    "title": r.title,
                    "category": r.category,
                    "effort": r.effort,
                    "expected_impact": r.expected_impact,
                    "body": r.body,
                    "page_url": page_url,
                })

    return {
        "client": {"name": client.name},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "audit": audit_payload,
        "llms_txt_status": llms_txt_status,
        "robots_txt_snippet": robots_txt_snippet,
        "top_fixes": top_fixes,
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a site optimization plan for an agency client. Output professional markdown.

Use these sections in this order:

# Site optimization plan for {client.name}

## Where we stand today
If `audit` is null: say "We haven't run a site audit yet for this brand. Once we do, this plan will list the specific fixes we'll ship." and stop here.
If `audit` is present: a 2-sentence overview citing overall_score (out of 100), then a markdown table with rows for Bot access / Content / Schema / Technical scores plus the audited date and render_mode.

## Top fixes (priority order)
For each fix in `top_fixes`, render: title (as h3), category, effort, expected impact, affected page (page_url or "Site-wide"), and the body. NEVER include code blocks. NEVER include paste-ready JSON-LD, robots.txt, or llms.txt content — those are internal-only artifacts. Plain English only.

## llms.txt status
One sentence based on `llms_txt_status.present` and `llms_txt_status.valid`.

## AI bot access
If `robots_txt_snippet` is present, say "Current robots.txt allows / blocks the following bots: ..." in plain English (do not paste the snippet).
If null, say "robots.txt was not retrievable during audit."

## Timeline
Targeting completion within 30 days unless data says otherwise.

Stay factual. Do not invent recommendations or pages. Numbers must be exact.
"""


register(
    Template(
        kind="site_plan",
        name="Site plan",
        description="Customer-facing site optimization plan from latest audit.",
        title_factory=lambda c: f"Site plan — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Site plan data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
