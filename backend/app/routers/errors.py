"""
Client error router — receives frontend crash reports.

Routes
------
POST /api/errors/client  — log a frontend error boundary catch
"""
from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix="/errors", tags=["errors"])
logger = logging.getLogger(__name__)


from pydantic import field_validator


class ClientErrorReport(BaseModel):
    message: str
    stack: str | None = None
    component_stack: str | None = None
    url: str | None = None
    user_agent: str | None = None

    @field_validator("message", "stack", "component_stack", "url", "user_agent", mode="before")
    @classmethod
    def truncate_fields(cls, v):
        if isinstance(v, str) and len(v) > 10_000:
            return v[:10_000] + "...[truncated]"
        return v


@router.post("/client", response_class=Response)
async def log_client_error(report: ClientErrorReport) -> Response:
    """Log a frontend error boundary report to the server log."""
    logger.error(
        "CLIENT ERROR — %s\nURL: %s\nUser-Agent: %s\nStack:\n%s\nComponent stack:\n%s",
        report.message,
        report.url or "unknown",
        report.user_agent or "unknown",
        report.stack or "(none)",
        report.component_stack or "(none)",
    )
    return Response(status_code=204)
