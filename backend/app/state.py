"""
Shared in-memory state for background task tracking.

These sets record which brand IDs are currently being processed by
background workers. Updated by content.py (drafting), tracking_service.py
(onboarding pipeline), and scheduler.py (weekly opp sweeps).

Single-process assumption: this module lives in one uvicorn worker.
Do not use in multi-worker deployments without a shared store (e.g. Redis).
"""

generating_brands: set[int] = set()
"""Brand IDs currently generating content drafts."""

scanning_brands: set[int] = set()
"""Brand IDs currently being scanned for live opportunities."""


import asyncio

prospect_audit_cancel_events: dict[int, asyncio.Event] = {}
"""Map of audit_id -> Event. Set by the /cancel endpoint, consumed by the runner.
Single-process: this lives in one uvicorn worker. Cancel intent also persists
to ProspectAudit.cancel_requested so a process restart still observes it."""
