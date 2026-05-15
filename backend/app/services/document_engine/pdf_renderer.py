"""HTML→PDF renderer for agency_weekly_report client documents."""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"

_SECTION_MAP = {
    "executive summary": "executive_summary",
    "visibility this week": "visibility",
    "per-prompt scorecard": "prompts",
    "competitor delta": "competitors",
    "content shipped": "content",
    "impact of posted content": "impact",
    "top gaps to close": "gaps",
    "next week": "next_week",
}


def _parse_markdown_sections(body: str | None) -> dict[str, str]:
    """Split markdown by ## headings, return {section_key: html}."""
    if not body:
        return {}
    parts = re.split(r"^##\s+", body, flags=re.MULTILINE)
    out: dict[str, str] = {}
    for part in parts[1:]:
        lines = part.splitlines()
        if not lines:
            continue
        heading = lines[0].strip().lower()
        body_md = "\n".join(lines[1:]).strip()
        key = _SECTION_MAP.get(heading)
        if key is None:
            continue
        out[key] = _md.markdown(body_md, extensions=["extra"])
    return out


def _logo_data_uri() -> str | None:
    try:
        if not _LOGO_PATH.exists():
            logger.warning("Logo not found at %s — rendering text wordmark fallback", _LOGO_PATH)
            return None
        data = _LOGO_PATH.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:image/png;base64,{b64}"
    except Exception as e:
        logger.warning("Failed to embed logo: %s", e)
        return None


async def _resolve_data(db: AsyncSession, document: ClientDocument) -> dict[str, Any]:
    if document.data_snapshot:
        try:
            return json.loads(document.data_snapshot)
        except json.JSONDecodeError:
            logger.warning("data_snapshot for document %d is not valid JSON; refetching", document.id)

    from app.services.document_engine import get_template
    template = get_template(document.kind)
    if template is None:
        raise ValueError(f"Unknown template kind: {document.kind}")
    client = await db.get(AgencyClient, document.agency_client_id)
    if client is None:
        raise ValueError(f"AgencyClient {document.agency_client_id} not found")
    return await template.fetch_data(db, client)


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


def _render_html(document: ClientDocument, data: dict[str, Any], sections: dict[str, str]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template("weekly_report.html.j2")
    return template.render(
        document=document,
        data=data,
        sections=sections,
        logo_data_uri=_logo_data_uri(),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
    )


async def render_pdf(db: AsyncSession, document: ClientDocument) -> bytes:
    data = await _resolve_data(db, document)
    sections = _parse_markdown_sections(document.body_markdown or "")
    html = _render_html(document, data, sections)
    return await _playwright_pdf(html)
