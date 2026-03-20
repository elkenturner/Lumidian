"""
Client error router — receives frontend crash reports.

Routes
------
POST /api/errors/client  — log a frontend error boundary catch
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix="/errors", tags=["errors"])
logger = logging.getLogger(__name__)


class ClientErrorReport(BaseModel):
    message: str
    stack: Optional[str] = None
    component_stack: Optional[str] = None
    url: Optional[str] = None
    user_agent: Optional[str] = None


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
