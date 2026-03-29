"""
Team router — invite and manage team members (read-only access to owner's workspace).

Routes
------
POST   /api/team/invite          — invite a user by email (owner only)
GET    /api/team/accept           — accept an invitation via token
GET    /api/team/members          — list all invites/members for the owner
DELETE /api/team/members/{id}     — revoke invite or remove member (owner only)
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_owner_only
from app.models import TeamMember, User
from app.schemas import TeamMemberResponse, InviteTeamMemberRequest

router = APIRouter(prefix="/team", tags=["team"])
logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

INVITE_EXPIRY_HOURS = 48


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Invite ─────────────────────────────────────────────────────────────────────

@router.post("/invite", status_code=status.HTTP_201_CREATED)
async def invite_team_member(request: InviteTeamMemberRequest, db: DbDep, user: CurrentUser):
    """Create an invitation for a team member. Owner only."""
    await require_owner_only(db, user)

    email = request.email.strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="Email is required")

    # Prevent inviting yourself
    if email == user.email.lower():
        raise HTTPException(status_code=400, detail="You cannot invite yourself")

    # Check for an existing non-expired, non-accepted invite for this email under this owner
    existing_result = await db.execute(
        select(TeamMember).where(
            TeamMember.account_owner_id == user.id,
            TeamMember.invited_email == email,
            TeamMember.accepted_at.is_(None),
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        # Re-generate token and extend expiry
        existing.invite_token = secrets.token_urlsafe(32)
        existing.expires_at = _utcnow_naive() + timedelta(hours=INVITE_EXPIRY_HOURS)
        existing.invited_at = _utcnow_naive()
        await db.commit()
        await db.refresh(existing)
        invite_link = f"/team/accept?token={existing.invite_token}"
        return {"id": existing.id, "invite_link": invite_link, "message": "Invitation refreshed"}

    token = secrets.token_urlsafe(32)
    expires_at = _utcnow_naive() + timedelta(hours=INVITE_EXPIRY_HOURS)

    member = TeamMember(
        account_owner_id=user.id,
        invited_email=email,
        role="viewer",
        invite_token=token,
        invited_at=_utcnow_naive(),
        expires_at=expires_at,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    invite_link = f"/team/accept?token={token}"
    full_invite_link = f"{frontend_url}{invite_link}"

    from app.services.email_service import send_team_invite_email, send_email_background
    send_email_background(send_team_invite_email, invited_email=email, invite_link=full_invite_link, inviter_name=user.name)

    return {"id": member.id, "invite_link": invite_link, "message": "Invitation created"}


# ── Accept ─────────────────────────────────────────────────────────────────────

@router.get("/accept")
async def accept_invite(token: str, db: DbDep, user: CurrentUser):
    """Accept an invite token and link the current user to the team."""
    result = await db.execute(
        select(TeamMember).where(TeamMember.invite_token == token)
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Invitation not found")

    now = _utcnow_naive()
    if member.expires_at < now:
        raise HTTPException(status_code=410, detail="This invitation has expired")

    if member.accepted_at is not None:
        raise HTTPException(status_code=409, detail="Invitation already accepted")

    # Verify the logged-in user's email matches (or is the invited email)
    if user.email.lower() != member.invited_email.lower():
        raise HTTPException(
            status_code=403,
            detail=f"This invitation was sent to {member.invited_email}. Please log in with that account.",
        )

    member.user_id = user.id
    member.accepted_at = now
    await db.commit()

    return {"message": "You have joined the team. Redirecting to dashboard.", "account_owner_id": member.account_owner_id}


# ── List members ───────────────────────────────────────────────────────────────

@router.get("/members")
async def list_team_members(db: DbDep, user: CurrentUser):
    """List all invites and accepted members for the current owner."""
    result = await db.execute(
        select(TeamMember).where(TeamMember.account_owner_id == user.id)
        .order_by(TeamMember.invited_at.desc())
    )
    members = result.scalars().all()

    return [
        TeamMemberResponse(
            id=m.id,
            invited_email=m.invited_email,
            user_id=m.user_id,
            role=m.role,
            accepted=m.accepted_at is not None,
            invited_at=m.invited_at,
            accepted_at=m.accepted_at,
        )
        for m in members
    ]


# ── Remove member ──────────────────────────────────────────────────────────────

@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(member_id: int, db: DbDep, user: CurrentUser):
    """Revoke an invite or remove an accepted member. Owner only."""
    await require_owner_only(db, user)

    result = await db.execute(
        select(TeamMember).where(
            TeamMember.id == member_id,
            TeamMember.account_owner_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    await db.delete(member)
    await db.commit()
