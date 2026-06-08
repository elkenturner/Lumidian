"""Document generation — fetch data, validate, call LLM, render PDF, persist, emit event."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.agency_activity import EVENT_DOCUMENT_GENERATED, emit_event
from app.services.document_engine.preflight import check_required
from app.services.document_engine.registry import Template
from app.services.document_engine.structured_output import request_structured_output
from app.services.document_engine.typst_renderer import render_pdf as typst_render_pdf


_TEMPLATES_DIR = Path(__file__).parent / "templates"


async def generate_pdf(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> tuple[bytes, ClientDocument]:
    """NEW typst path: preflight → fetch → LLM JSON → charts → typst render → persist.

    Returns (pdf_bytes, ClientDocument).
    """
    if template.typst_template is None or template.output_schema is None:
        raise ValueError(f"Template {template.kind!r} is not migrated to Typst yet")

    data = await template.fetch_data(db, client)
    check_required(list(template.required_fields), data)

    output = await request_structured_output(
        system_prompt=template.system_prompt,
        user_prompt=template.user_prompt_template.format(data_json=json.dumps(data, default=str, indent=2)),
        schema=template.output_schema,
        max_tokens=template.max_tokens,
    )

    charts: dict[str, str] = {}
    for chart_fn in template.chart_calls:
        svg_bytes = await chart_fn(db, client, data)
        charts[chart_fn.__name__] = svg_bytes.decode("utf-8")

    generated_by = await _resolve_user_name(db, actor_user_id)
    typst_input = {
        **data,
        "output": output.model_dump(),
        "charts": charts,
        "generated_at": _format_date_now(),
        "generated_by": generated_by,
    }
    pdf_bytes = typst_render_pdf(
        template_path=_TEMPLATES_DIR / template.typst_template,
        data=typst_input,
    )

    doc = ClientDocument(
        agency_client_id=client.id,
        kind=template.kind,
        title=template.title_factory(client),
        body_markdown="",  # No markdown for typst-rendered kinds
        data_snapshot=json.dumps(typst_input, default=str),
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await db.flush()
    await emit_event(db, agency_client_id=client.id,
                     event_type=EVENT_DOCUMENT_GENERATED,
                     body=f"Generated {template.name}",
                     actor_user_id=actor_user_id,
                     payload={"document_id": doc.id, "kind": template.kind})
    await db.commit()
    await db.refresh(doc)
    return pdf_bytes, doc


def _format_date_now() -> str:
    from datetime import datetime
    return datetime.utcnow().strftime("%b %d, %Y")


async def _resolve_user_name(db, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    from app.models import User
    user = await db.get(User, user_id)
    return user.name if user else None
