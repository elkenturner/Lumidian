"""Render the prospect audit Jinja2 template to PDF bytes via Playwright Chromium.

Reuses the same `async_playwright` pattern as `services/site_audit/pdf_renderer.py`.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.models import ProspectAudit
from app.services.prospect_audit.competitor_detect import DetectedCompetitor
from app.services.prospect_audit.recommendations import AuditSummaryForRecs
from app.services.prospect_audit.scoring import PromptScore

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=select_autoescape(["html", "j2"]))


def _sort_key(p: PromptScore) -> tuple[int, float]:
    """Sort worst-first: invisible/losing prompts before even/winning/dominant."""
    band_order = {"invisible": 0, "losing": 1, "even": 2, "winning": 3, "dominant": 4}
    return (band_order.get(p.rvi_band, 5), p.rvi if p.rvi is not None else 99.0)


async def render_prospect_pdf(
    *,
    audit: ProspectAudit,
    prompts: list[str],
    prompt_scores: list[PromptScore],
    competitors: list[DetectedCompetitor],
    summary: AuditSummaryForRecs,
    recommendations_md: str | None,
    logo_data_uri: str | None,
    per_prompt_top_competitor: dict[int, tuple[str | None, float | None]],
) -> bytes:
    """Render the audit HTML template and return PDF bytes."""
    template = _env.get_template("prospect_audit.html.j2")

    sorted_scores = sorted(prompt_scores, key=_sort_key)
    worst_three = sorted_scores[:3]

    winner_blocks = []
    for ps in worst_three:
        top_name, top_pct = per_prompt_top_competitor.get(ps.prompt_index, (None, None))
        winner_blocks.append({
            "prompt_text": prompts[ps.prompt_index],
            "own_visibility_pct": ps.own_visibility_pct,
            "peer_avg_visibility_pct": ps.peer_avg_visibility_pct,
            "top_competitor_name": top_name,
            "top_competitor_visibility_pct": top_pct,
        })

    peer_names = [c.name for c in competitors if not c.is_subject][:3]
    if not peer_names:
        peer_names_joined = "your peer group"
    elif len(peer_names) == 1:
        peer_names_joined = peer_names[0]
    elif len(peer_names) == 2:
        peer_names_joined = f"{peer_names[0]} and {peer_names[1]}"
    else:
        peer_names_joined = ", ".join(peer_names[:-1]) + f", and {peer_names[-1]}"

    recommendations_html = _md.markdown(recommendations_md) if recommendations_md else None

    cta_url = os.getenv("PROSPECT_AUDIT_CTA_URL", "https://lumidian.io")
    cta_email = os.getenv("PROSPECT_AUDIT_CTA_EMAIL") or os.getenv("SUPPORT_EMAIL") or ""

    html = template.render(
        business_name=audit.business_name,
        location=audit.location if audit.is_local else None,
        logo_data_uri=logo_data_uri,
        audit_month=datetime.utcnow().strftime("%B %Y"),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
        rvi_band=summary.rvi_band,
        aggregate_rvi=summary.aggregate_rvi,
        overall_visibility_pct=summary.overall_visibility_pct,
        peer_avg_overall=summary.peer_avg_visibility_pct,
        peer_names_joined=peer_names_joined,
        prompts=prompts,
        sorted_prompt_scores=sorted_scores,
        winner_blocks=winner_blocks,
        recommendations_html=recommendations_html,
        cta_url=cta_url,
        cta_email=cta_email,
    )

    return await _playwright_pdf(html)


async def _playwright_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            await page.emulate_media(media="print")
            return await page.pdf(
                format="Letter",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
        finally:
            await browser.close()
