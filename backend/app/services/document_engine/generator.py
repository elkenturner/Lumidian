"""Document generation — fetch data, call LLM, persist, emit event."""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.agency_activity import EVENT_DOCUMENT_GENERATED, emit_event
from app.services.document_engine.registry import Template
from app.services.drafting.client import call_claude


async def generate_document(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> ClientDocument:
    """Fetch data → call LLM → persist + emit activity event → return the new row."""
    data = await template.fetch_data(db, client)
    data_json = json.dumps(data, default=str, indent=2)
    user_prompt = template.user_prompt_template.format(data_json=data_json)
    full_prompt = f"{template.system_prompt}\n\n{user_prompt}"

    body_markdown = await call_claude(
        full_prompt,
        max_tokens=template.max_tokens,
        model="claude-sonnet-4-6",
    )

    doc = ClientDocument(
        agency_client_id=client.id,
        kind=template.kind,
        title=template.title_factory(client),
        body_markdown=body_markdown,
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await db.flush()
    await emit_event(
        db,
        agency_client_id=client.id,
        event_type=EVENT_DOCUMENT_GENERATED,
        body=f"Generated {template.name}",
        actor_user_id=actor_user_id,
        payload={"document_id": doc.id, "kind": template.kind},
    )
    await db.commit()
    await db.refresh(doc)
    return doc
