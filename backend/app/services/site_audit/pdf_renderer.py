"""HTML→PDF renderer for site audits."""
from __future__ import annotations

import base64
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
)

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"


def _score_to_letter(score: float | int | None) -> tuple[str, str]:
    """Return (letter, css_class) for a 0-100 score.  Class is good|ok|bad."""
    if score is None:
        return ("—", "")
    if score >= 90:
        return ("A", "good")
    if score >= 80:
        return ("B", "good")
    if score >= 70:
        return ("C", "ok")
    if score >= 60:
        return ("D", "ok")
    return ("F", "bad")


def _logo_data_uri() -> str | None:
    try:
        if not _LOGO_PATH.exists():
            logger.warning("Logo not found at %s", _LOGO_PATH)
            return None
        data = _LOGO_PATH.read_bytes()
        return f"data:image/png;base64,{base64.b64encode(data).decode('ascii')}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to embed logo: %s", exc)
        return None


def _md_to_html(text: str | None) -> str:
    if not text:
        return ""
    return _md.markdown(text, extensions=["extra"])


async def _load_audit_bundle(db: AsyncSession, audit_id: int) -> dict[str, Any]:
    audit = await db.get(WebsiteAudit, audit_id)
    if audit is None:
        raise ValueError(f"Audit {audit_id} not found")
    brand = await db.get(Brand, audit.brand_id)

    recs_result = await db.execute(
        select(WebsiteAuditRecommendation).where(
            WebsiteAuditRecommendation.audit_id == audit_id
        )
    )
    recs: list[WebsiteAuditRecommendation] = list(recs_result.scalars().all())

    # Sort by priority_score desc (None → 0), then by priority enum rank
    _priority_rank = {"high": 3, "medium": 2, "low": 1}
    recs.sort(
        key=lambda r: (
            -(r.priority_score or 0.0),
            -_priority_rank.get(r.priority or "low", 0),
        )
    )

    pages_result = await db.execute(
        select(WebsiteAuditPage)
        .where(WebsiteAuditPage.audit_id == audit_id)
        .order_by(WebsiteAuditPage.page_score.asc().nulls_first())
        .limit(10)
    )
    worst_pages: list[WebsiteAuditPage] = list(pages_result.scalars().all())

    return {
        "audit": audit,
        "brand": brand,
        "recs": recs,
        "worst_pages": worst_pages,
    }


def _render_html(bundle: dict[str, Any]) -> str:
    audit: WebsiteAudit = bundle["audit"]
    brand: Brand | None = bundle["brand"]
    recs: list[WebsiteAuditRecommendation] = bundle["recs"]
    worst_pages: list[WebsiteAuditPage] = bundle["worst_pages"]

    # Determine readable site label
    if brand and brand.website_url:
        site_label = brand.website_url
    elif brand:
        site_label = brand.name
    else:
        site_label = f"Audit #{audit.id}"

    ref_dt: datetime = audit.completed_at or audit.started_at
    audit_date = ref_dt.strftime("%B %d, %Y")
    started_label = audit.started_at.strftime("%B %d, %Y %H:%M UTC")
    completed_label = (
        audit.completed_at.strftime("%B %d, %Y %H:%M UTC")
        if audit.completed_at
        else "in progress"
    )

    overall_letter, overall_class = _score_to_letter(audit.overall_score)

    scorecards = []
    for label, score in (
        ("Bot access", audit.bot_access_score),
        ("Content", audit.content_score),
        ("Schema", audit.schema_score),
        ("Technical", audit.technical_score),
    ):
        letter, klass = _score_to_letter(score)
        scorecards.append(
            {
                "label": label,
                "grade": letter,
                "grade_class": klass,
                "num": round(score) if score is not None else "—",
            }
        )

    def _rec_to_dict(r: WebsiteAuditRecommendation) -> dict[str, Any]:
        return {
            "id": r.id,
            "priority": r.priority,
            "category": r.category,
            "title": r.title,
            "body_html": _md_to_html(r.body),
            "effort": r.effort,
            "expected_impact": r.expected_impact,
            "expected_lift_pp": r.expected_lift_pp,
            "target_url": r.target_url,
            "artifact": r.artifact,
            "artifact_type": r.artifact_type,
        }

    top_recs = [_rec_to_dict(r) for r in recs[:5]]

    # Group remaining recs by category
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in recs[5:]:
        grouped.setdefault(r.category, []).append(_rec_to_dict(r))
    grouped_remaining = [
        {"category": cat, "recs": items}
        for cat, items in sorted(grouped.items())
    ]

    # Top 3 artifacts (from all recs ordered by priority — highest first)
    artifacts: list[dict[str, Any]] = []
    for r in recs:
        if r.artifact:
            artifacts.append(
                {
                    "title": r.title,
                    "target_url": r.target_url,
                    "artifact": r.artifact,
                }
            )
        if len(artifacts) >= 3:
            break

    # Page numbering: 1=cover, 2=scorecard, 3=top-priorities
    next_page = 4
    if grouped_remaining:
        next_page += 1
    artifacts_page_no = next_page if artifacts else None
    if artifacts:
        next_page += 1
    pages_page_no = next_page if worst_pages else None
    if worst_pages:
        next_page += 1
    appendix_page_no = next_page

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template("audit_report.html.j2")
    return template.render(
        audit=audit,
        site_label=site_label,
        audit_date=audit_date,
        started_label=started_label,
        completed_label=completed_label,
        overall_grade=overall_letter,
        overall_grade_class=overall_class,
        scorecards=scorecards,
        top_recs=top_recs,
        grouped_remaining=grouped_remaining,
        artifacts=artifacts,
        artifacts_page_no=artifacts_page_no,
        worst_pages=[
            {
                "url": p.url,
                "page_type": p.page_type,
                "page_score": p.page_score,
            }
            for p in worst_pages
        ],
        pages_page_no=pages_page_no,
        appendix_page_no=appendix_page_no,
        cms_platform=getattr(audit, "cms_platform", None),
        logo_data_uri=_logo_data_uri(),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
    )


async def _playwright_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            return await page.pdf(
                format="Letter",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
        finally:
            await browser.close()


async def render_audit_pdf(db: AsyncSession, audit_id: int) -> bytes:
    """Load audit data, render HTML, and return PDF bytes."""
    bundle = await _load_audit_bundle(db, audit_id)
    html = _render_html(bundle)
    return await _playwright_pdf(html)
