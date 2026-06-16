"""Site plan template — customer-facing site optimization summary."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
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


class SitePlanFixOut(BaseModel):
    title: str
    category: str
    priority: str  # "high"/"medium"/"low"
    why_it_matters: str
    plain_action: str


class SitePlanOutput(BaseModel):
    summary: str
    score_interpretation: str = Field(..., description="One paragraph reading the audit scores")
    top_fixes: list[SitePlanFixOut] = Field(default_factory=list)
    next_30_days: list[str] = Field(default_factory=list)


REQUIRED_FIELDS = (
    "brand.name",
    "audit.overall_score",
)


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


SYSTEM_PROMPT = """You are drafting the site optimization plan for an AI-visibility agency client.

Voice: Direct, declarative, dense. Senior consultant, not assistant. No hedging, no throat-clearing, no AI-tells ("comprehensive," "leverage," "robust," "delve").

Plain language, not jargon. Forbidden: "topical authority," "indexing velocity," "structured data backbone," "render-mode parity." Say what you mean in everyday words. NEVER include code blocks, JSON-LD snippets, robots.txt text, or llms.txt content in any field — those are internal artifacts the agency hand-prepares; the client doc is plain English only.

Title-Case brand and product names.

The output is structured fields. Numbers must be exact from the audit data — don't round scores. Don't invent fixes, pages, or scores not in the data. The LLM curates the top fixes; do not introduce fixes whose `title` isn't in the source `top_fixes` list.

Per-field rules:

- **summary**: 2-3 sentences. ≤ 60 words. State the overall score as `N/100`, the single biggest weak area by category (bot access / content / schema / technical), and the time-to-ship rough estimate. No "Wikipedia is" / "Site audits are" generalities.
- **score_interpretation**: 1 paragraph, ≤ 100 words. Walk through what each sub-score means in plain English using the actual numbers — Bot access (can crawlers reach the content), Content (is it written for AI extraction), Schema (is the structured data correct), Technical (does the site render without JS). Name the weakest area explicitly.
- **top_fixes**: 3-6 entries. Cap to what's truly important. For each: `title` is the exact title from the source data; `category` is the audit category; `priority` is "high" / "medium" / "low" derived from the source's effort/impact balance; `why_it_matters` is ≤ 30 words in plain English (no code, no specs); `plain_action` is ≤ 30 words in imperative-verb form (Add, Replace, Fix, Move, Configure) — no implementation detail, just the action.
- **next_30_days**: 2-4 bullets. Each ≤ 20 words. Imperative-verb start. The plan-of-execution, not the fix list. Examples: "Ship the JSON-LD blocks first week," "Re-run audit at day 14 to verify."

If `audit` is null: summary = "No site audit on file. Run an audit before continuing." All other fields empty.
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
        required_fields=REQUIRED_FIELDS,
        output_schema=SitePlanOutput,
        typst_template="site_plan.typ",
        chart_calls=(),
    )
)
