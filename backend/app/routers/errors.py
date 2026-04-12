"""
Client error router — receives frontend crash reports.

Routes
------
POST /api/errors/client  — log a frontend error boundary catch
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(prefix="/errors", tags=["errors"])
logger = logging.getLogger(__name__)

# IP-based rate limiting for unauthenticated error endpoint
_ERROR_RATE_WINDOW = 60.0  # 1-minute sliding window
_ERROR_MAX_PER_IP = 10     # max 10 reports per minute per IP
_error_rate_store: dict[str, list[float]] = defaultdict(list)


def _check_error_rate(ip: str) -> None:
    """Raise HTTP 429 if IP exceeds error report rate limit."""
    now = time.monotonic()
    cutoff = now - _ERROR_RATE_WINDOW
    _error_rate_store[ip] = [t for t in _error_rate_store[ip] if t > cutoff]
    if len(_error_rate_store[ip]) >= _ERROR_MAX_PER_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many error reports — please try again later.",
        )
    _error_rate_store[ip].append(now)

    # Prune stale IPs periodically
    for k in list(_error_rate_store):
        _error_rate_store[k] = [t for t in _error_rate_store[k] if t > cutoff]
        if not _error_rate_store[k]:
            del _error_rate_store[k]


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


def _get_client_ip(request: Request) -> str:
    """Extract real client IP from X-Forwarded-For header (set by Railway/Fastly proxy)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/client", response_class=Response)
async def log_client_error(report: ClientErrorReport, request: Request) -> Response:
    """Log a frontend error boundary report to the server log."""
    _check_error_rate(_get_client_ip(request))
    logger.error(
        "CLIENT ERROR — %s\nURL: %s\nUser-Agent: %s\nStack:\n%s\nComponent stack:\n%s",
        report.message,
        report.url or "unknown",
        report.user_agent or "unknown",
        report.stack or "(none)",
        report.component_stack or "(none)",
    )
    return Response(status_code=204)
