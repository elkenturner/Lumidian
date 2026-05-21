"""HTML→PDF renderer for site audits."""
from __future__ import annotations

import base64
import json
import logging
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    Prompt,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
)
from app.services.site_audit.platform_install_tips import (
    platform_display_name,
    platform_tip,
)
from app.services.site_audit.recommendations import (
    _RECS,
    _RECS_META,
    _RENDER_REC,
)

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"


# Reverse map: rec title → check_id, used to look up impl_steps + artifact_type
# at render time (these aren't persisted on the rec row).
def _build_title_to_check_id() -> dict[str, str]:
    out: dict[str, str] = {cid: meta["title"] for cid, meta in _RECS.items()}
    inverted = {title: cid for cid, title in out.items()}
    # _RENDER_REC isn't keyed in _RECS; its check_id is "js_rendered_page"
    inverted[_RENDER_REC["title"]] = "js_rendered_page"
    # LLM rewrites use a fixed title — map to answer_first_failed
    inverted["Rewrite this page's first section"] = "answer_first_failed"
    return inverted


_TITLE_TO_CHECK_ID = _build_title_to_check_id()


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


def _url_path(url: str | None) -> str:
    if not url:
        return ""
    try:
        path = urlparse(url).path or "/"
        return path if path else "/"
    except Exception:  # noqa: BLE001
        return url


def _impl_steps_for(title: str) -> list[str]:
    cid = _TITLE_TO_CHECK_ID.get(title)
    if not cid:
        return []
    meta = _RECS_META.get(cid, {})
    return list(meta.get("impl_steps") or [])


def _aggregate_lift(per_page_lift: float | None, n: int) -> float:
    """Diminishing-returns lift sum — matches the frontend FixGroup math."""
    if not per_page_lift:
        return 0.0
    return float(per_page_lift) * math.log(max(n, 1) + 1)


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

    # Only show pending recs in the PDF — applied/dismissed are out of scope
    recs = [r for r in recs if (r.status or "pending") == "pending"]

    pages_result = await db.execute(
        select(WebsiteAuditPage)
        .where(WebsiteAuditPage.audit_id == audit_id)
        .order_by(WebsiteAuditPage.page_score.asc().nulls_first())
        .limit(10)
    )
    worst_pages: list[WebsiteAuditPage] = list(pages_result.scalars().all())

    # Prompts for linked_prompt_ids surfacing
    prompts_result = await db.execute(
        select(Prompt).where(Prompt.brand_id == audit.brand_id)
    )
    prompts_by_id: dict[int, str] = {p.id: p.text for p in prompts_result.scalars().all()}

    return {
        "audit": audit,
        "brand": brand,
        "recs": recs,
        "worst_pages": worst_pages,
        "prompts_by_id": prompts_by_id,
    }


def _group_recs(
    recs: list[WebsiteAuditRecommendation],
    prompts_by_id: dict[int, str],
    cms_platform: str | None,
) -> list[dict[str, Any]]:
    """Group recs by title; each group: representative rec + affected pages.

    Returns a list sorted by representative priority_score desc.
    """
    by_title: dict[str, list[WebsiteAuditRecommendation]] = {}
    for r in recs:
        by_title.setdefault(r.title, []).append(r)

    groups: list[dict[str, Any]] = []
    for title, members in by_title.items():
        lead = max(members, key=lambda r: r.priority_score or 0)
        affected_urls = [r.target_url for r in members if r.target_url]
        per_page_lift = lead.expected_lift_pp
        aggregate_lift = _aggregate_lift(per_page_lift, len(members))
        # Union of linked prompt ids across all members
        prompt_ids: set[int] = set()
        for r in members:
            if r.linked_prompt_ids:
                try:
                    ids = json.loads(r.linked_prompt_ids)
                    if isinstance(ids, list):
                        prompt_ids.update(int(i) for i in ids if isinstance(i, int))
                except (json.JSONDecodeError, TypeError):
                    pass
        linked_prompts = [
            prompts_by_id[i] for i in prompt_ids if i in prompts_by_id
        ]
        # Pick the first member with a drafted artifact (if any)
        drafted = next((r for r in members if r.artifact), None)
        impl_steps = _impl_steps_for(title)
        platform = platform_tip(cms_platform, lead.artifact_type)
        groups.append({
            "title": title,
            "body_html": _md_to_html(lead.body),
            "priority": lead.priority or "low",
            "category": lead.category,
            "effort": lead.effort,
            "artifact_type": lead.artifact_type,
            "per_page_lift": per_page_lift,
            "aggregate_lift": aggregate_lift,
            "n_pages": len(members),
            "page_urls": [_url_path(u) for u in affected_urls[:5]],
            "more_pages": max(0, len(affected_urls) - 5),
            "is_site_wide": not affected_urls,
            "linked_prompts": linked_prompts[:3],
            "more_prompts": max(0, len(linked_prompts) - 3),
            "impl_steps": impl_steps,
            "platform_tip": platform,
            "artifact": drafted.artifact if drafted else None,
            "artifact_target_url": drafted.target_url if drafted else None,
            "priority_score": lead.priority_score or 0,
        })

    groups.sort(key=lambda g: -g["priority_score"])
    return groups


def _render_html(bundle: dict[str, Any]) -> str:
    audit: WebsiteAudit = bundle["audit"]
    brand: Brand | None = bundle["brand"]
    recs: list[WebsiteAuditRecommendation] = bundle["recs"]
    worst_pages: list[WebsiteAuditPage] = bundle["worst_pages"]
    prompts_by_id: dict[int, str] = bundle["prompts_by_id"]
    cms_platform: str | None = getattr(audit, "cms_platform", None)

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

    # Group recs by title — eliminates the "30 identical cards" problem
    groups = _group_recs(recs, prompts_by_id, cms_platform)
    top_groups = groups[:5]
    remaining_groups = groups[5:20]  # cap detailed list at top 15 unique fixes
    total_unique = len(groups)
    truncated = max(0, total_unique - 20)

    # Page numbering: 1=cover, 2=summary, 3..3+N=top, then detailed, then pages, then appendix
    next_page = 3 + max(1, len(top_groups))
    detailed_page_no = next_page if remaining_groups else None
    if remaining_groups:
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
        site_host=urlparse(brand.website_url).host if brand and brand.website_url else site_label,
        audit_date=audit_date,
        started_label=started_label,
        completed_label=completed_label,
        overall_grade=overall_letter,
        overall_grade_class=overall_class,
        scorecards=scorecards,
        top_groups=top_groups,
        remaining_groups=remaining_groups,
        total_unique=total_unique,
        truncated=truncated,
        worst_pages=[
            {
                "url": p.url,
                "page_type": p.page_type,
                "page_score": p.page_score,
            }
            for p in worst_pages
        ],
        detailed_page_no=detailed_page_no,
        pages_page_no=pages_page_no,
        appendix_page_no=appendix_page_no,
        cms_platform=cms_platform,
        cms_platform_display=platform_display_name(cms_platform),
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
