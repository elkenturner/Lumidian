"""
Support router — in-app contact form.

Routes
------
POST /api/support/contact  — submit a support message (authenticated users only)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, field_validator

from app.dependencies import CurrentUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["support"])


class SupportRequest(BaseModel):
    subject: str
    message: str

    @field_validator("subject")
    @classmethod
    def subject_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Subject is required")
        if len(v) > 200:
            raise ValueError("Subject must be 200 characters or fewer")
        return v

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message is required")
        if len(v) > 5000:
            raise ValueError("Message must be 5,000 characters or fewer")
        return v


@router.post("/contact", response_class=Response)
async def submit_support_request(
    request: SupportRequest,
    user: CurrentUser,
) -> Response:
    """Send a support message on behalf of the authenticated user."""
    try:
        from app.services.email_service import send_support_request_email
        send_support_request_email(
            from_name=user.name,
            from_email=user.email,
            subject=request.subject,
            message=request.message,
        )
    except Exception as exc:
        logger.error(
            "Failed to send support email from %s: %s", user.email, exc
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send your message. Please try again or email support directly.",
        )
    return Response(status_code=204)
