"""HTML→PDF renderer for agency client documents.

Dispatches by ClientDocument.kind to the matching Jinja2 template under
templates/, parses the markdown body via each template module's SECTION_MAP,
and renders to PDF via Playwright.
"""
from __future__ import annotations

import base64
import importlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.document_engine.markdown_sections import parse_sections

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"

_KIND_TO_TEMPLATE: dict[str, str] = {
    "agency_weekly_report": "weekly_report.html.j2",
    "monthly_report": "monthly_report.html.j2",
    "sow": "sow.html.j2",
    "audit_initial": "audit_initial.html.j2",
    "kickoff_checklist": "kickoff_checklist.html.j2",
}

_KIND_TO_MODULE: dict[str, str] = {
    "agency_weekly_report": "app.services.document_engine.agency_weekly_report",
    "monthly_report": "app.services.document_engine.monthly_report",
    "sow": "app.services.document_engine.sow",
    "audit_initial": "app.services.document_engine.audit_initial",
    "kickoff_checklist": "app.services.document_engine.kickoff_checklist",
}


def _template_filename(kind: str) -> str:
    if kind not in _KIND_TO_TEMPLATE:
        raise ValueError(f"No PDF template registered for document kind: {kind}")
    return _KIND_TO_TEMPLATE[kind]


def _section_map_for(kind: str) -> dict[str, str]:
    module_name = _KIND_TO_MODULE[kind]
    module = importlib.import_module(module_name)
    return getattr(module, "SECTION_MAP", {})


def _logo_data_uri() -> str | None:
    try:
        if not _LOGO_PATH.exists():
            logger.warning("Logo not found at %s — rendering text wordmark fallback", _LOGO_PATH)
            return None
        return f"data:image/png;base64,{base64.b64encode(_LOGO_PATH.read_bytes()).decode('ascii')}"
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


def render_html(document: ClientDocument, data: dict[str, Any]) -> str:
    """Render the document HTML — used by both the PDF endpoint and the
    public review page's in-browser viewer."""
    section_map = _section_map_for(document.kind)
    sections = parse_sections(document.body_markdown or "", section_map)
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template(_template_filename(document.kind))
    return template.render(
        document=document,
        data=data,
        sections=sections,
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


async def render_pdf(db: AsyncSession, document: ClientDocument) -> bytes:
    data = await _resolve_data(db, document)
    html = render_html(document, data)
    return await _playwright_pdf(html)
