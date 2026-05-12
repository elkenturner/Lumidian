"""Centralized helper for emitting client activity events.

Callers invoke emit_event() inside their existing DB transaction; the helper
adds the row to the session but does NOT commit. The caller's commit makes
the state mutation and the event row atomic.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientActivityEvent


# Event type constants — keep in sync with frontend activity-icons.tsx
EVENT_NOTE = "note"
EVENT_CLIENT_CREATED = "client_created"
EVENT_CLIENT_STATUS_CHANGED = "client_status_changed"
EVENT_DRAFT_SENT_TO_CLIENT = "draft_sent_to_client"
EVENT_DRAFT_MARKED_POSTED = "draft_marked_posted"
EVENT_REVIEW_LINK_GENERATED = "review_link_generated"
EVENT_REVIEW_LINK_ROTATED = "review_link_rotated"
EVENT_CLIENT_APPROVED = "client_approved"
EVENT_CLIENT_CHANGES_REQUESTED = "client_changes_requested"
EVENT_CLIENT_REJECTED = "client_rejected"
EVENT_TASK_CREATED = "task_created"
EVENT_TASK_ASSIGNED = "task_assigned"
EVENT_TASK_COMPLETED = "task_completed"


def _encode_payload(payload: dict[str, Any] | None) -> str | None:
    if payload is None:
        return None
    return json.dumps(payload, separators=(",", ":"), default=str)


async def emit_event(
    db: AsyncSession,
    *,
    agency_client_id: int,
    event_type: str,
    body: str,
    actor_user_id: int | None = None,
    payload: dict[str, Any] | None = None,
    related_draft_id: int | None = None,
) -> ClientActivityEvent:
    """Insert an event row. Caller is responsible for commit()."""
    event = ClientActivityEvent(
        agency_client_id=agency_client_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        body=body,
        payload=_encode_payload(payload),
        related_draft_id=related_draft_id,
    )
    db.add(event)
    return event
