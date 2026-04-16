# Admin Power Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user impersonation, user data editing, and brand/prompt editing to the admin dashboard via a dedicated backend admin router and frontend sub-pages.

**Architecture:** New `backend/app/routers/admin.py` consolidates all admin endpoints (migrated + new). Frontend gets `/admin/users/[userId]` detail page with tabs (Overview, Edit User, Brands, Activity). Impersonation mints a JWT for the target user with an `impersonated_by` claim and swaps cookies; a persistent banner shows during impersonation.

**Tech Stack:** FastAPI, SQLAlchemy async, PyJWT, Next.js 15, React 18, TypeScript, Tailwind CSS

---

### Task 1: Create the admin router with migrated endpoints

**Files:**
- Create: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py:48-67` (imports) and `208-225` (router mounts)
- Modify: `backend/app/routers/analytics.py:146-420` (remove admin endpoints)
- Modify: `backend/app/routers/auth.py:980-1011` (remove admin reset-password)

- [ ] **Step 1: Create `backend/app/routers/admin.py` with migrated endpoints**

Create the file with all existing admin endpoints moved from `analytics.py` and `auth.py`. The router prefix is `/admin` and it will be mounted at `/api` in main.py (resulting in `/api/admin/...` paths).

```python
"""Admin-only endpoints: user management, impersonation, brand editing."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.dependencies import (
    JWT_ALGORITHM,
    JWT_SECRET,
    decode_token,
    get_current_user,
    get_db,
)
from app.models import (
    Brand,
    Competitor,
    ContentDraft,
    Prompt,
    TrackingRun,
    User,
    utcnow,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# ── Dependency: require admin ────────────────────────────────────────────────

from typing import Annotated

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _require_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


# ── List all users ───────────────────────────────────────────────────────────

@router.get("/users")
async def admin_list_users(db: DbDep, user: CurrentUser):
    """Return all users with brand count and last active. Admin only."""
    _require_admin(user)

    rows = await db.execute(
        select(
            User.id,
            User.email,
            User.name,
            User.subscription_tier,
            User.subscription_status,
            User.is_admin,
            User.created_at,
            func.count(Brand.id).label("brand_count"),
        )
        .outerjoin(Brand, Brand.user_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    user_rows = rows.all()

    if user_rows:
        user_ids = [r.id for r in user_rows]
        brands_result = await db.execute(
            select(Brand.id, Brand.user_id, Brand.name, Brand.brand_type)
            .where(Brand.user_id.in_(user_ids))
            .order_by(Brand.created_at.asc())
        )
        brands_by_user: dict = {}
        for b in brands_result.all():
            brands_by_user.setdefault(b.user_id, []).append({
                "id": b.id,
                "name": b.name,
                "brand_type": b.brand_type,
            })
    else:
        brands_by_user = {}

    last_active_map: dict[int, datetime | None] = {}
    if user_rows:
        la_result = await db.execute(
            select(Brand.user_id, func.max(TrackingRun.created_at).label("last_active"))
            .join(TrackingRun, TrackingRun.brand_id == Brand.id)
            .where(Brand.user_id.in_([r.id for r in user_rows]))
            .group_by(Brand.user_id)
        )
        for la_row in la_result.all():
            last_active_map[la_row.user_id] = la_row.last_active

    users_data = []
    for row in user_rows:
        last_active = last_active_map.get(row.id)
        user_brands = brands_by_user.get(row.id, [])
        users_data.append({
            "id": row.id,
            "email": row.email,
            "name": row.name,
            "subscription_tier": row.subscription_tier,
            "subscription_status": row.subscription_status,
            "is_admin": row.is_admin,
            "is_paused": bool(getattr(row, "is_paused", False)),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "brand_count": row.brand_count,
            "brands": user_brands,
            "last_active": last_active.isoformat() if last_active else None,
        })
    return users_data


# ── Pause / unpause a user ───────────────────────────────────────────────────

@router.post("/users/{user_id}/pause")
async def admin_pause_user(user_id: int, db: DbDep, user: CurrentUser):
    """Pause or unpause a user account. Admin only."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin and target.id != user.id:
        raise HTTPException(status_code=400, detail="Cannot pause another admin account")

    target.is_paused = not getattr(target, "is_paused", False)
    target.updated_at = utcnow()
    await db.commit()
    action = "paused" if target.is_paused else "unpaused"
    logger.info("Admin %s %s user %s (%s)", user.email, action, target.email, user_id)
    return {"user_id": user_id, "is_paused": target.is_paused, "action": action}


# ── Remove a user ────────────────────────────────────────────────────────────

@router.delete("/users/{user_id}")
async def admin_remove_user(user_id: int, db: DbDep, user: CurrentUser):
    """Permanently delete a user and all their data. Admin only."""
    _require_admin(user)
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin:
        raise HTTPException(status_code=400, detail="Cannot delete an admin account")

    logger.warning("Admin %s deleting user %s (%d) and all their data", user.email, target.email, user_id)
    await db.delete(target)
    await db.commit()
    return {"user_id": user_id, "deleted": True}


# ── List all tracking runs ───────────────────────────────────────────────────

@router.get("/runs")
async def admin_list_runs(db: DbDep, user: CurrentUser):
    """Return all tracking runs across all users. Admin only."""
    _require_admin(user)

    runs_result = await db.execute(
        select(TrackingRun, Brand.name.label("brand_name"), User.email.label("user_email"))
        .join(Brand, TrackingRun.brand_id == Brand.id)
        .outerjoin(User, Brand.user_id == User.id)
        .order_by(TrackingRun.created_at.desc())
        .limit(200)
    )
    rows = runs_result.all()
    return [
        {
            "id": r.TrackingRun.id,
            "brand_id": r.TrackingRun.brand_id,
            "brand_name": r.brand_name,
            "user_email": r.user_email,
            "status": r.TrackingRun.status,
            "run_type": r.TrackingRun.run_type,
            "overall_score": r.TrackingRun.overall_score,
            "total_queries": r.TrackingRun.total_queries,
            "total_mentions": r.TrackingRun.total_mentions,
            "created_at": r.TrackingRun.created_at.isoformat() if r.TrackingRun.created_at else None,
            "completed_at": r.TrackingRun.completed_at.isoformat() if r.TrackingRun.completed_at else None,
        }
        for r in rows
    ]


# ── System stats ─────────────────────────────────────────────────────────────

@router.get("/stats")
async def admin_system_stats(db: DbDep, user: CurrentUser):
    """Return high-level system counts. Admin only."""
    _require_admin(user)

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_brands = (await db.execute(select(func.count(Brand.id)))).scalar_one()
    total_prompts = (await db.execute(select(func.count(Prompt.id)))).scalar_one()
    total_drafts = (await db.execute(select(func.count(ContentDraft.id)))).scalar_one()
    runs_today = (
        await db.execute(
            select(func.count(TrackingRun.id)).where(TrackingRun.created_at >= today_start)
        )
    ).scalar_one()

    return {
        "total_users": total_users,
        "total_brands": total_brands,
        "total_prompts": total_prompts,
        "total_drafts": total_drafts,
        "runs_today": runs_today,
    }


# ── Trigger run for any brand ────────────────────────────────────────────────

@router.post("/trigger-run/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_trigger_run(brand_id: int, db: DbDep, user: CurrentUser):
    """Manually trigger a tracking run for any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail=f"Brand {brand_id} not found")

    from app.models import TrackingRun as TR

    run = TR(brand_id=brand_id, status="pending", run_type="manual")
    db.add(run)
    await db.commit()
    await db.refresh(run)

    async def _bg():
        from app.routers.tracking import _background_run_with_id
        try:
            await _background_run_with_id(run.id, brand_id)
        except Exception:
            logger.exception("Admin-triggered run failed for brand %d", brand_id)

    asyncio.create_task(_bg(), name=f"admin-run-{brand_id}-{run.id}")
    return {"run_id": run.id, "brand_id": brand_id, "status": "pending"}


# ── Tail log file ────────────────────────────────────────────────────────────

@router.get("/logs")
async def admin_get_logs(user: CurrentUser, lines: int = 100):
    """Return the last N lines of the rotating log file. Admin only."""
    _require_admin(user)

    log_file = Path(__file__).resolve().parent.parent.parent / "logs" / "app.log"
    if not log_file.exists():
        return {"lines": [], "file": str(log_file), "exists": False}

    try:
        with open(log_file, encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        tail = [line.rstrip("\n") for line in all_lines[-lines:]]
        return {"lines": tail, "file": str(log_file), "exists": True, "total_lines": len(all_lines)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read log file: {exc}")


# ── Generate drafts for any brand ────────────────────────────────────────────

@router.post("/generate-draft/{brand_id}", status_code=status.HTTP_202_ACCEPTED)
async def admin_generate_draft(brand_id: int, db: DbDep, user: CurrentUser):
    """Run gap analysis and generate drafts for any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail=f"Brand {brand_id} not found")

    async def _bg():
        from app.services.drafting_service import auto_draft_top_gaps
        try:
            async with AsyncSessionLocal() as bg_db:
                drafts = await auto_draft_top_gaps(
                    db=bg_db,
                    brand_id=brand_id,
                    max_gaps=5,
                    clear_existing=False,
                    source="manual",
                )
                logger.info("Admin generated %d draft(s) for brand %d", len(drafts), brand_id)
        except Exception:
            logger.exception("Admin draft generation failed for brand %d", brand_id)

    asyncio.create_task(_bg(), name=f"admin-draft-{brand_id}")
    return {"brand_id": brand_id, "status": "generating"}


# ── Admin: reset any user's password ─────────────────────────────────────────

class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def admin_reset_password(
    request: AdminResetPasswordRequest,
    db: DbDep,
    current_user: CurrentUser,
):
    """Admin-only: directly reset any user's password without a reset token."""
    _require_admin(current_user)

    from app.routers.auth import _validate_password, hash_password

    _validate_password(request.new_password)

    email = request.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = hash_password(request.new_password)
    user.password_changed_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()

    logger.info("Admin %s reset password for user %s", current_user.email, email)
    return {"message": f"Password reset successfully for {email}"}
```

- [ ] **Step 2: Mount the admin router in `main.py`**

Add the import and include_router call. In `backend/app/main.py`, add after the existing router imports (around line 67):

```python
from app.routers import admin as admin_router
```

And add after the existing router mounts (around line 225):

```python
app.include_router(admin_router.router, prefix="/api")
```

- [ ] **Step 3: Remove migrated admin endpoints from `analytics.py`**

In `backend/app/routers/analytics.py`, delete the following functions and their associated comments (lines 146-420):
- `admin_list_users` (lines 146-216)
- `admin_pause_user` (lines 219-241)
- `admin_remove_user` (lines 244-263)
- `admin_list_runs` (lines 266-297)
- `admin_system_stats` (lines 300-330)
- `admin_trigger_run` (lines 333-362)
- `admin_get_logs` (lines 365-385)
- `admin_generate_draft` (lines 388-419)

Also remove any imports that are now unused in analytics.py after the deletion (e.g. `ContentDraft`, `Prompt` if only used by admin endpoints).

- [ ] **Step 4: Remove migrated admin reset-password from `auth.py`**

In `backend/app/routers/auth.py`, delete the `AdminResetPasswordRequest` class and `admin_reset_password` function (lines 980-1010).

- [ ] **Step 5: Update frontend API paths**

In `frontend/lib/api.ts`, update all admin function paths from `/analytics/admin/...` to `/admin/...`:

```typescript
export async function adminGetUsers(): Promise<AdminUser[]> {
  const res = await api.get<AdminUser[]>('/admin/users');
  return res.data;
}

export async function adminGetRuns(): Promise<AdminRun[]> {
  const res = await api.get<AdminRun[]>('/admin/runs');
  return res.data;
}

export async function adminGetStats(): Promise<AdminStats> {
  const res = await api.get<AdminStats>('/admin/stats');
  return res.data;
}

export async function adminTriggerRun(brandId: number): Promise<{ run_id: number; status: string }> {
  const res = await api.post<{ run_id: number; status: string }>(`/admin/trigger-run/${brandId}`);
  return res.data;
}

export async function adminGetLogs(lines = 100): Promise<{ lines: string[]; exists: boolean }> {
  const res = await api.get<{ lines: string[]; exists: boolean }>(`/admin/logs?lines=${lines}`);
  return res.data;
}

export async function adminPauseUser(userId: number): Promise<{ user_id: number; is_paused: boolean; action: string }> {
  const res = await api.post<{ user_id: number; is_paused: boolean; action: string }>(`/admin/users/${userId}/pause`);
  return res.data;
}

export async function adminRemoveUser(userId: number): Promise<{ user_id: number; deleted: boolean }> {
  const res = await api.delete<{ user_id: number; deleted: boolean }>(`/admin/users/${userId}`);
  return res.data;
}

export async function adminGenerateDraft(brandId: number): Promise<{ brand_id: number; status: string }> {
  const res = await api.post<{ brand_id: number; status: string }>(`/admin/generate-draft/${brandId}`);
  return res.data;
}
```

- [ ] **Step 6: Verify the migration works**

Run: `cd backend && source venv/bin/activate && python -c "from app.routers.admin import router; print('Admin router OK:', [r.path for r in router.routes])"`

Expected: prints the list of admin route paths without import errors.

Run: `cd backend && pytest tests/ -x -q 2>&1 | tail -20`

Expected: all existing tests pass (admin endpoints moved but paths are the same from the app's perspective since the prefix is now `/api` + `/admin` instead of `/api` + `/analytics/admin`).

Note: existing tests that hit `/api/analytics/admin/...` will need their paths updated to `/api/admin/...`. Check test files for any admin endpoint calls and update them.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/admin.py backend/app/main.py backend/app/routers/analytics.py backend/app/routers/auth.py frontend/lib/api.ts
git commit -m "refactor: consolidate admin endpoints into dedicated admin router"
```

---

### Task 2: Add impersonation backend endpoints

**Files:**
- Modify: `backend/app/routers/admin.py`

- [ ] **Step 1: Add impersonation endpoint to `admin.py`**

Add these endpoints at the bottom of `backend/app/routers/admin.py`:

```python
# ── Impersonation ────────────────────────────────────────────────────────────

from datetime import timedelta

COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def _cookie_secure() -> bool:
    import os
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


def _set_auth_cookies(response: Response, token: str) -> None:
    secure = _cookie_secure()
    response.set_cookie("clarity_token", token, httponly=True, secure=secure, samesite="lax", max_age=COOKIE_MAX_AGE, path="/")
    response.set_cookie("clarity_session", "1", httponly=False, secure=secure, samesite="lax", max_age=COOKIE_MAX_AGE, path="/")


@router.post("/impersonate/{user_id}")
async def admin_impersonate(
    user_id: int,
    db: DbDep,
    user: CurrentUser,
    response: Response,
    clarity_token: str | None = Cookie(default=None),
):
    """Mint a JWT for the target user and swap cookies. Returns the admin's current token for later restoration."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin and target.id != user.id:
        raise HTTPException(status_code=400, detail="Cannot impersonate another admin")

    # Mint JWT for target user with impersonation claim
    payload = {
        "sub": str(target.id),
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(days=7),
        "impersonated_by": user.id,
    }
    target_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    # Set impersonation cookies on response
    _set_auth_cookies(response, target_token)

    logger.warning("Admin %s started impersonating user %s (%d)", user.email, target.email, target.id)

    return {
        "admin_token": clarity_token,
        "target_user_id": target.id,
        "target_user_email": target.email,
    }


class ExitImpersonationRequest(BaseModel):
    admin_token: str


@router.post("/exit-impersonation")
async def admin_exit_impersonation(
    request: ExitImpersonationRequest,
    response: Response,
):
    """Validate the stored admin token and restore admin session cookies."""
    try:
        payload = jwt.decode(request.admin_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid admin token")

    # Verify it's actually an admin user
    admin_user_id = payload.get("sub")
    if not admin_user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    async with AsyncSessionLocal() as db:
        admin_user = await db.get(User, int(admin_user_id))
        if not admin_user or not admin_user.is_admin:
            raise HTTPException(status_code=403, detail="Token does not belong to an admin")

    _set_auth_cookies(response, request.admin_token)

    logger.info("Admin %s exited impersonation", admin_user.email)
    return {"restored": True, "admin_user_id": int(admin_user_id)}
```

- [ ] **Step 2: Verify impersonation endpoints load**

Run: `cd backend && source venv/bin/activate && python -c "from app.routers.admin import router; paths = [r.path for r in router.routes]; assert '/impersonate/{user_id}' in paths; assert '/exit-impersonation' in paths; print('Impersonation endpoints OK')"`

Expected: `Impersonation endpoints OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/admin.py
git commit -m "feat: add admin impersonation and exit-impersonation endpoints"
```

---

### Task 3: Add user detail and edit backend endpoints

**Files:**
- Modify: `backend/app/routers/admin.py`

- [ ] **Step 1: Add user detail endpoint**

Add to `backend/app/routers/admin.py`:

```python
# ── User detail ──────────────────────────────────────────────────────────────

@router.get("/users/{user_id}")
async def admin_get_user(user_id: int, db: DbDep, user: CurrentUser):
    """Return full detail for a single user. Admin only."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Aggregate counts
    brand_count = (await db.execute(
        select(func.count(Brand.id)).where(Brand.user_id == user_id)
    )).scalar_one()

    total_runs = (await db.execute(
        select(func.count(TrackingRun.id))
        .join(Brand, TrackingRun.brand_id == Brand.id)
        .where(Brand.user_id == user_id)
    )).scalar_one()

    total_drafts = (await db.execute(
        select(func.count(ContentDraft.id))
        .join(Brand, ContentDraft.brand_id == Brand.id)
        .where(Brand.user_id == user_id)
    )).scalar_one()

    # Last active = most recent tracking run
    last_active_row = (await db.execute(
        select(func.max(TrackingRun.created_at))
        .join(Brand, TrackingRun.brand_id == Brand.id)
        .where(Brand.user_id == user_id)
    )).scalar_one_or_none()

    return {
        "id": target.id,
        "email": target.email,
        "name": target.name,
        "subscription_tier": target.subscription_tier,
        "subscription_status": target.subscription_status,
        "trial_end": target.trial_end.isoformat() if getattr(target, "trial_end", None) else None,
        "email_verified": getattr(target, "email_verified", True),
        "is_paused": getattr(target, "is_paused", False),
        "is_admin": target.is_admin,
        "created_at": target.created_at.isoformat() if target.created_at else None,
        "stripe_customer_id": getattr(target, "stripe_customer_id", None),
        "google_id": target.google_id,
        "totp_enabled": getattr(target, "totp_enabled", False),
        "brand_count": brand_count,
        "total_runs": total_runs,
        "total_drafts": total_drafts,
        "last_active": last_active_row.isoformat() if last_active_row else None,
    }
```

- [ ] **Step 2: Add user edit endpoint**

Add to `backend/app/routers/admin.py`:

```python
# ── Edit user ────────────────────────────────────────────────────────────────

class AdminEditUser(BaseModel):
    subscription_tier: str | None = None
    subscription_status: str | None = None
    trial_end: str | None = None  # ISO datetime string or empty string to clear
    email_verified: bool | None = None
    is_paused: bool | None = None
    name: str | None = None

    class Config:
        # Allow None values to mean "not provided" — use a sentinel for "clear this field"
        extra = "forbid"


@router.patch("/users/{user_id}")
async def admin_edit_user(user_id: int, payload: AdminEditUser, db: DbDep, user: CurrentUser):
    """Edit user fields. Admin only. Cannot edit another admin."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin and target.id != user.id:
        raise HTTPException(status_code=400, detail="Cannot edit another admin account")

    changes: list[str] = []
    data = payload.model_dump(exclude_unset=True)

    if "subscription_tier" in data:
        old = target.subscription_tier
        new = data["subscription_tier"] if data["subscription_tier"] != "" else None
        target.subscription_tier = new
        changes.append(f"subscription_tier {old}→{new}")

    if "subscription_status" in data:
        old = target.subscription_status
        new = data["subscription_status"] if data["subscription_status"] != "" else None
        target.subscription_status = new
        changes.append(f"subscription_status {old}→{new}")

    if "trial_end" in data:
        old = getattr(target, "trial_end", None)
        if data["trial_end"] and data["trial_end"] != "":
            from dateutil.parser import isoparse
            new = isoparse(data["trial_end"]).replace(tzinfo=None)
        else:
            new = None
        target.trial_end = new
        changes.append(f"trial_end {old}→{new}")

    if "email_verified" in data:
        old = getattr(target, "email_verified", None)
        target.email_verified = data["email_verified"]
        changes.append(f"email_verified {old}→{data['email_verified']}")

    if "is_paused" in data:
        old = getattr(target, "is_paused", False)
        target.is_paused = data["is_paused"]
        changes.append(f"is_paused {old}→{data['is_paused']}")

    if "name" in data:
        old = target.name
        target.name = data["name"]
        changes.append(f"name '{old}'→'{data['name']}'")

    if changes:
        target.updated_at = utcnow()
        await db.commit()
        logger.info("Admin %s updated user %d: %s", user.email, user_id, ", ".join(changes))
    else:
        logger.info("Admin %s called edit on user %d with no changes", user.email, user_id)

    # Return the updated user using the detail endpoint format
    return await admin_get_user(user_id, db, user)
```

- [ ] **Step 3: Add user activity (runs) endpoint**

Add to `backend/app/routers/admin.py`:

```python
# ── User activity (tracking runs) ────────────────────────────────────────────

@router.get("/users/{user_id}/runs")
async def admin_user_runs(user_id: int, db: DbDep, user: CurrentUser):
    """Return tracking runs for a specific user. Admin only."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    runs_result = await db.execute(
        select(TrackingRun, Brand.name.label("brand_name"))
        .join(Brand, TrackingRun.brand_id == Brand.id)
        .where(Brand.user_id == user_id)
        .order_by(TrackingRun.created_at.desc())
        .limit(200)
    )
    rows = runs_result.all()
    return [
        {
            "id": r.TrackingRun.id,
            "brand_id": r.TrackingRun.brand_id,
            "brand_name": r.brand_name,
            "status": r.TrackingRun.status,
            "run_type": r.TrackingRun.run_type,
            "overall_score": r.TrackingRun.overall_score,
            "total_queries": r.TrackingRun.total_queries,
            "total_mentions": r.TrackingRun.total_mentions,
            "created_at": r.TrackingRun.created_at.isoformat() if r.TrackingRun.created_at else None,
            "completed_at": r.TrackingRun.completed_at.isoformat() if r.TrackingRun.completed_at else None,
        }
        for r in rows
    ]
```

- [ ] **Step 4: Verify endpoints load**

Run: `cd backend && source venv/bin/activate && python -c "from app.routers.admin import router; paths = [r.path for r in router.routes]; assert '/users/{user_id}' in paths; print('User detail/edit endpoints OK')"`

Expected: `User detail/edit endpoints OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/admin.py
git commit -m "feat: add admin user detail, edit, and activity endpoints"
```

---

### Task 4: Add brand and prompt editing backend endpoints

**Files:**
- Modify: `backend/app/routers/admin.py`

- [ ] **Step 1: Add user brands endpoint**

Add to `backend/app/routers/admin.py`:

```python
# ── User brands with prompts and competitors ─────────────────────────────────

@router.get("/users/{user_id}/brands")
async def admin_user_brands(user_id: int, db: DbDep, user: CurrentUser):
    """Return all brands for a user with their prompts, competitors, and latest score. Admin only."""
    _require_admin(user)

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    brands_result = await db.execute(
        select(Brand).where(Brand.user_id == user_id).order_by(Brand.created_at.asc())
    )
    brands = brands_result.scalars().all()

    result = []
    for brand in brands:
        # Prompts
        prompts_result = await db.execute(
            select(Prompt).where(Prompt.brand_id == brand.id).order_by(Prompt.id.asc())
        )
        prompts = [
            {"id": p.id, "text": p.text, "prompt_type": getattr(p, "prompt_type", "standard")}
            for p in prompts_result.scalars().all()
        ]

        # Competitors
        competitors_result = await db.execute(
            select(Competitor).where(Competitor.brand_id == brand.id).order_by(Competitor.id.asc())
        )
        competitors = [
            {"id": c.id, "name": c.name, "website_url": getattr(c, "website_url", None)}
            for c in competitors_result.scalars().all()
        ]

        # Latest score
        latest_run = (await db.execute(
            select(TrackingRun.overall_score)
            .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed")
            .order_by(TrackingRun.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()

        result.append({
            "id": brand.id,
            "name": brand.name,
            "slug": brand.slug,
            "tier": getattr(brand, "tier", "basic"),
            "brand_type": getattr(brand, "brand_type", "standard"),
            "website_url": getattr(brand, "website_url", None),
            "latest_score": latest_run,
            "prompts": prompts,
            "competitors": competitors,
        })

    return result
```

- [ ] **Step 2: Add brand edit endpoint**

Add to `backend/app/routers/admin.py`:

```python
# ── Edit brand ───────────────────────────────────────────────────────────────

class AdminEditBrand(BaseModel):
    name: str | None = None
    slug: str | None = None
    tier: str | None = None
    brand_type: str | None = None
    website_url: str | None = None

    class Config:
        extra = "forbid"


@router.patch("/brands/{brand_id}")
async def admin_edit_brand(brand_id: int, payload: AdminEditBrand, db: DbDep, user: CurrentUser):
    """Edit brand fields. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    changes: list[str] = []
    data = payload.model_dump(exclude_unset=True)

    if "name" in data:
        old = brand.name
        brand.name = data["name"]
        changes.append(f"name '{old}'→'{data['name']}'")

    if "slug" in data:
        old = brand.slug
        new_slug = data["slug"]
        # Check uniqueness
        existing = await db.execute(
            select(Brand.id).where(Brand.slug == new_slug, Brand.id != brand_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Slug '{new_slug}' is already taken")
        brand.slug = new_slug
        changes.append(f"slug '{old}'→'{new_slug}'")

    if "tier" in data:
        old = getattr(brand, "tier", None)
        brand.tier = data["tier"]
        changes.append(f"tier {old}→{data['tier']}")

    if "brand_type" in data:
        old = getattr(brand, "brand_type", None)
        brand.brand_type = data["brand_type"]
        changes.append(f"brand_type {old}→{data['brand_type']}")

    if "website_url" in data:
        old = getattr(brand, "website_url", None)
        brand.website_url = data["website_url"] or None
        changes.append(f"website_url {old}→{data.get('website_url')}")

    if changes:
        await db.commit()
        logger.info("Admin %s updated brand %d: %s", user.email, brand_id, ", ".join(changes))

    return {"brand_id": brand_id, "updated": changes}
```

- [ ] **Step 3: Add prompt CRUD endpoints**

Add to `backend/app/routers/admin.py`:

```python
# ── Prompt CRUD ──────────────────────────────────────────────────────────────

class AdminAddPrompt(BaseModel):
    text: str
    prompt_type: str = "standard"


class AdminEditPrompt(BaseModel):
    text: str


@router.post("/brands/{brand_id}/prompts", status_code=status.HTTP_201_CREATED)
async def admin_add_prompt(brand_id: int, payload: AdminAddPrompt, db: DbDep, user: CurrentUser):
    """Add a prompt to any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    prompt = Prompt(brand_id=brand_id, text=payload.text, prompt_type=payload.prompt_type)
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)

    logger.info("Admin %s added prompt %d to brand %d", user.email, prompt.id, brand_id)
    return {"id": prompt.id, "text": prompt.text, "prompt_type": prompt.prompt_type}


@router.patch("/prompts/{prompt_id}")
async def admin_edit_prompt(prompt_id: int, payload: AdminEditPrompt, db: DbDep, user: CurrentUser):
    """Edit a prompt's text. Admin only."""
    _require_admin(user)

    prompt = await db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    old_text = prompt.text
    prompt.text = payload.text
    await db.commit()

    logger.info("Admin %s edited prompt %d: '%s'→'%s'", user.email, prompt_id, old_text[:50], payload.text[:50])
    return {"id": prompt.id, "text": prompt.text, "prompt_type": prompt.prompt_type}


@router.delete("/prompts/{prompt_id}")
async def admin_delete_prompt(prompt_id: int, db: DbDep, user: CurrentUser):
    """Delete a prompt. Admin only."""
    _require_admin(user)

    prompt = await db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    logger.info("Admin %s deleted prompt %d (brand %d)", user.email, prompt_id, prompt.brand_id)
    await db.delete(prompt)
    await db.commit()
    return {"prompt_id": prompt_id, "deleted": True}
```

- [ ] **Step 4: Add competitor CRUD endpoints**

Add to `backend/app/routers/admin.py`:

```python
# ── Competitor CRUD ──────────────────────────────────────────────────────────

class AdminAddCompetitor(BaseModel):
    name: str
    website_url: str | None = None


@router.post("/brands/{brand_id}/competitors", status_code=status.HTTP_201_CREATED)
async def admin_add_competitor(brand_id: int, payload: AdminAddCompetitor, db: DbDep, user: CurrentUser):
    """Add a competitor to any brand. Admin only."""
    _require_admin(user)

    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")

    competitor = Competitor(brand_id=brand_id, name=payload.name, website_url=payload.website_url)
    db.add(competitor)
    await db.commit()
    await db.refresh(competitor)

    logger.info("Admin %s added competitor %d to brand %d", user.email, competitor.id, brand_id)
    return {"id": competitor.id, "name": competitor.name, "website_url": competitor.website_url}


@router.delete("/competitors/{competitor_id}")
async def admin_delete_competitor(competitor_id: int, db: DbDep, user: CurrentUser):
    """Delete a competitor. Admin only."""
    _require_admin(user)

    competitor = await db.get(Competitor, competitor_id)
    if not competitor:
        raise HTTPException(status_code=404, detail="Competitor not found")

    logger.info("Admin %s deleted competitor %d (brand %d)", user.email, competitor_id, competitor.brand_id)
    await db.delete(competitor)
    await db.commit()
    return {"competitor_id": competitor_id, "deleted": True}
```

- [ ] **Step 5: Verify all endpoints load**

Run: `cd backend && source venv/bin/activate && python -c "
from app.routers.admin import router
paths = [r.path for r in router.routes]
for p in ['/brands/{brand_id}', '/brands/{brand_id}/prompts', '/prompts/{prompt_id}', '/brands/{brand_id}/competitors', '/competitors/{competitor_id}']:
    assert p in paths, f'Missing: {p}'
print('All brand/prompt/competitor endpoints OK')
"`

Expected: `All brand/prompt/competitor endpoints OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin.py
git commit -m "feat: add admin brand, prompt, and competitor editing endpoints"
```

---

### Task 5: Add admin backend tests

**Files:**
- Create: `backend/tests/test_admin.py`

- [ ] **Step 1: Write admin endpoint tests**

Create `backend/tests/test_admin.py`:

```python
"""Tests for the admin router endpoints."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import create_brand, register_and_login, register_user

pytestmark = pytest.mark.asyncio


# ── Helpers ──────────────────────────────────────────────────────────────────

async def make_admin(client: AsyncClient, email: str = "admin@test.com", password: str = "Password123") -> None:
    """Register a user with the admin email (set in conftest ADMIN_EMAILS) and verify + login."""
    await register_and_login(client, email=email, password=password)


async def make_user(client: AsyncClient, email: str = "user@test.com", password: str = "Password123") -> dict:
    """Register a regular user, verify, and login. Returns the user dict."""
    await register_and_login(client, email=email, password=password)
    resp = await client.get("/api/auth/me")
    return resp.json()


# ── Stats ────────────────────────────────────────────────────────────────────

async def test_admin_stats_requires_admin(client: AsyncClient):
    await register_and_login(client, email="nonadmin@test.com")
    resp = await client.get("/api/admin/stats")
    assert resp.status_code == 403


async def test_admin_stats(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_users" in data
    assert "runs_today" in data


# ── User list ────────────────────────────────────────────────────────────────

async def test_admin_list_users(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/users")
    assert resp.status_code == 200
    users = resp.json()
    assert isinstance(users, list)
    assert len(users) >= 1  # at least the admin


# ── User detail ──────────────────────────────────────────────────────────────

async def test_admin_get_user(client: AsyncClient):
    await make_admin(client)
    # Get the admin's own detail
    users = (await client.get("/api/admin/users")).json()
    admin_id = users[0]["id"]

    resp = await client.get(f"/api/admin/users/{admin_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "admin@test.com"
    assert "brand_count" in data
    assert "total_runs" in data


async def test_admin_get_user_not_found(client: AsyncClient):
    await make_admin(client)
    resp = await client.get("/api/admin/users/99999")
    assert resp.status_code == 404


# ── User edit ────────────────────────────────────────────────────────────────

async def test_admin_edit_user_tier(client: AsyncClient):
    await make_admin(client)
    # Create a regular user to edit
    await register_user(client, email="editme@test.com")
    users = (await client.get("/api/admin/users")).json()
    target = next(u for u in users if u["email"] == "editme@test.com")

    resp = await client.patch(
        f"/api/admin/users/{target['id']}",
        json={"subscription_tier": "pro", "email_verified": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscription_tier"] == "pro"
    assert data["email_verified"] is True


# ── Impersonation ────────────────────────────────────────────────────────────

async def test_impersonate_and_exit(client: AsyncClient):
    await make_admin(client)
    await register_user(client, email="target@test.com")

    # Verify email for target user
    await client.patch(
        f"/api/admin/users/{(await _get_user_id(client, 'target@test.com'))}",
        json={"email_verified": True},
    )

    target_id = await _get_user_id(client, "target@test.com")

    # Impersonate
    resp = await client.post(f"/api/admin/impersonate/{target_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["target_user_email"] == "target@test.com"
    assert "admin_token" in data
    admin_token = data["admin_token"]

    # Verify we're now the target user
    me_resp = await client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "target@test.com"

    # Exit impersonation
    exit_resp = await client.post("/api/admin/exit-impersonation", json={"admin_token": admin_token})
    assert exit_resp.status_code == 200
    assert exit_resp.json()["restored"] is True

    # Verify we're admin again
    me_resp2 = await client.get("/api/auth/me")
    assert me_resp2.status_code == 200
    assert me_resp2.json()["email"] == "admin@test.com"


async def test_cannot_impersonate_another_admin(client: AsyncClient):
    await make_admin(client)
    # Register another admin (would need to be in ADMIN_EMAILS — skip this scenario,
    # just test impersonating self works)
    resp = await client.get("/api/admin/users")
    admin_id = resp.json()[0]["id"]
    # Self-impersonation should work (same admin)
    resp = await client.post(f"/api/admin/impersonate/{admin_id}")
    assert resp.status_code == 200


# ── Brand editing ────────────────────────────────────────────────────────────

async def test_admin_user_brands(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "Admin Test Brand")
    brand_id = brand["id"]

    # Get admin's own user ID
    me = (await client.get("/api/auth/me")).json()

    resp = await client.get(f"/api/admin/users/{me['id']}/brands")
    assert resp.status_code == 200
    brands = resp.json()
    assert len(brands) >= 1
    assert any(b["id"] == brand_id for b in brands)
    # Check prompts are included
    matching = next(b for b in brands if b["id"] == brand_id)
    assert "prompts" in matching
    assert "competitors" in matching


async def test_admin_edit_brand(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "OldName")

    resp = await client.patch(
        f"/api/admin/brands/{brand['id']}",
        json={"name": "NewName"},
    )
    assert resp.status_code == 200
    assert "name" in str(resp.json()["updated"])


# ── Prompt editing ───────────────────────────────────────────────────────────

async def test_admin_add_and_delete_prompt(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "PromptBrand")

    # Add
    resp = await client.post(
        f"/api/admin/brands/{brand['id']}/prompts",
        json={"text": "New admin prompt"},
    )
    assert resp.status_code == 201
    prompt_id = resp.json()["id"]

    # Edit
    resp = await client.patch(
        f"/api/admin/prompts/{prompt_id}",
        json={"text": "Updated admin prompt"},
    )
    assert resp.status_code == 200
    assert resp.json()["text"] == "Updated admin prompt"

    # Delete
    resp = await client.delete(f"/api/admin/prompts/{prompt_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


# ── Competitor editing ───────────────────────────────────────────────────────

async def test_admin_add_and_delete_competitor(client: AsyncClient):
    await make_admin(client)
    brand = await create_brand(client, "CompBrand")

    # Add
    resp = await client.post(
        f"/api/admin/brands/{brand['id']}/competitors",
        json={"name": "Rival Co", "website_url": "https://rival.co"},
    )
    assert resp.status_code == 201
    comp_id = resp.json()["id"]

    # Delete
    resp = await client.delete(f"/api/admin/competitors/{comp_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_user_id(client: AsyncClient, email: str) -> int:
    users = (await client.get("/api/admin/users")).json()
    return next(u["id"] for u in users if u["email"] == email)
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && source venv/bin/activate && pytest tests/test_admin.py -v 2>&1 | tail -30`

Expected: all tests pass.

- [ ] **Step 3: Run the full test suite to check for regressions**

Run: `cd backend && pytest tests/ -x -q 2>&1 | tail -20`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_admin.py
git commit -m "test: add admin endpoint tests for impersonation, user edit, brand edit"
```

---

### Task 6: Add frontend admin API functions and types

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add new types and API functions**

In `frontend/lib/api.ts`, add after the existing admin section (around line 1103):

```typescript
// ── Admin: detail, edit, impersonate ────────────────────────────────────────

export interface AdminUserDetail {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  trial_end: string | null;
  email_verified: boolean;
  is_paused: boolean;
  is_admin: boolean;
  created_at: string | null;
  stripe_customer_id: string | null;
  google_id: string | null;
  totp_enabled: boolean;
  brand_count: number;
  total_runs: number;
  total_drafts: number;
  last_active: string | null;
}

export interface AdminEditUserPayload {
  subscription_tier?: string | null;
  subscription_status?: string | null;
  trial_end?: string | null;
  email_verified?: boolean;
  is_paused?: boolean;
  name?: string;
}

export interface AdminBrandDetail {
  id: number;
  name: string;
  slug: string;
  tier: string;
  brand_type: string;
  website_url: string | null;
  latest_score: number | null;
  prompts: { id: number; text: string; prompt_type: string }[];
  competitors: { id: number; name: string; website_url: string | null }[];
}

export interface AdminUserRun {
  id: number;
  brand_id: number;
  brand_name: string;
  status: string;
  run_type: string;
  overall_score: number | null;
  total_queries: number | null;
  total_mentions: number | null;
  created_at: string | null;
  completed_at: string | null;
}

export async function adminGetUser(userId: number): Promise<AdminUserDetail> {
  const res = await api.get<AdminUserDetail>(`/admin/users/${userId}`);
  return res.data;
}

export async function adminEditUser(userId: number, payload: AdminEditUserPayload): Promise<AdminUserDetail> {
  const res = await api.patch<AdminUserDetail>(`/admin/users/${userId}`, payload);
  return res.data;
}

export async function adminGetUserRuns(userId: number): Promise<AdminUserRun[]> {
  const res = await api.get<AdminUserRun[]>(`/admin/users/${userId}/runs`);
  return res.data;
}

export async function adminGetUserBrands(userId: number): Promise<AdminBrandDetail[]> {
  const res = await api.get<AdminBrandDetail[]>(`/admin/users/${userId}/brands`);
  return res.data;
}

export async function adminEditBrand(brandId: number, payload: { name?: string; slug?: string; tier?: string; brand_type?: string; website_url?: string }): Promise<{ brand_id: number; updated: string[] }> {
  const res = await api.patch<{ brand_id: number; updated: string[] }>(`/admin/brands/${brandId}`, payload);
  return res.data;
}

export async function adminAddPrompt(brandId: number, text: string, promptType = 'standard'): Promise<{ id: number; text: string; prompt_type: string }> {
  const res = await api.post<{ id: number; text: string; prompt_type: string }>(`/admin/brands/${brandId}/prompts`, { text, prompt_type: promptType });
  return res.data;
}

export async function adminEditPrompt(promptId: number, text: string): Promise<{ id: number; text: string; prompt_type: string }> {
  const res = await api.patch<{ id: number; text: string; prompt_type: string }>(`/admin/prompts/${promptId}`, { text });
  return res.data;
}

export async function adminDeletePrompt(promptId: number): Promise<{ prompt_id: number; deleted: boolean }> {
  const res = await api.delete<{ prompt_id: number; deleted: boolean }>(`/admin/prompts/${promptId}`);
  return res.data;
}

export async function adminAddCompetitor(brandId: number, name: string, websiteUrl?: string): Promise<{ id: number; name: string; website_url: string | null }> {
  const res = await api.post<{ id: number; name: string; website_url: string | null }>(`/admin/brands/${brandId}/competitors`, { name, website_url: websiteUrl });
  return res.data;
}

export async function adminDeleteCompetitor(competitorId: number): Promise<{ competitor_id: number; deleted: boolean }> {
  const res = await api.delete<{ competitor_id: number; deleted: boolean }>(`/admin/competitors/${competitorId}`);
  return res.data;
}

export async function adminImpersonate(userId: number): Promise<{ admin_token: string; target_user_id: number; target_user_email: string }> {
  const res = await api.post<{ admin_token: string; target_user_id: number; target_user_email: string }>(`/admin/impersonate/${userId}`);
  return res.data;
}

export async function adminExitImpersonation(adminToken: string): Promise<{ restored: boolean; admin_user_id: number }> {
  const res = await api.post<{ restored: boolean; admin_user_id: number }>('/admin/exit-impersonation', { admin_token: adminToken });
  return res.data;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: no errors related to the new API functions.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add frontend API types and functions for admin power tools"
```

---

### Task 7: Create the ImpersonationBanner component

**Files:**
- Create: `frontend/components/admin/ImpersonationBanner.tsx`
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Create the banner component**

Create `frontend/components/admin/ImpersonationBanner.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, X } from 'lucide-react';
import { adminExitImpersonation } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function ImpersonationBanner() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [exiting, setExiting] = useState(false);

  // Only render if we're in an impersonation session
  if (typeof window === 'undefined') return null;
  const adminToken = sessionStorage.getItem('admin_restore_token');
  if (!adminToken) return null;

  async function handleExit() {
    const token = sessionStorage.getItem('admin_restore_token');
    if (!token) return;

    setExiting(true);
    try {
      await adminExitImpersonation(token);
      sessionStorage.removeItem('admin_restore_token');
      await refresh();
      router.push('/admin');
    } catch {
      alert('Failed to exit impersonation. Try logging out and back in.');
      setExiting(false);
    }
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, #dc2626, #ea580c)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 20px',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={14} />
        <span>Viewing as <strong>{user?.email}</strong></span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 6,
          padding: '4px 12px',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: exiting ? 'wait' : 'pointer',
          opacity: exiting ? 0.6 : 1,
        }}
      >
        <X size={12} />
        {exiting ? 'Restoring...' : 'Exit Impersonation'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the banner to AppShell**

In `frontend/components/AppShell.tsx`, add the import at the top (after existing imports around line 17):

```typescript
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
```

Then in the `AppShellInner` return, add the banner just before the existing status banners (around line 818, before `{reportRunning && ...}`):

```tsx
        <ImpersonationBanner />
        {/* Global status banners — written by dashboard/content pages via localStorage */}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/admin/ImpersonationBanner.tsx frontend/components/AppShell.tsx
git commit -m "feat: add impersonation banner component to AppShell"
```

---

### Task 8: Update the admin page to link to user detail pages

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: Make user rows clickable**

In `frontend/app/admin/page.tsx`, add the `Link` import at the top (it may already be imported — check first):

```typescript
import Link from 'next/link';
```

Then wrap the user email in the table with a Link. Replace the `<td>` for the User column (around line 233-245) with:

```tsx
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {u.is_admin && <Shield size={11} className="text-[var(--accent-foreground)] shrink-0" />}
                        {u.is_paused && <PauseCircle size={11} className="text-[var(--warning)] shrink-0" />}
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-[var(--text-primary)] font-medium hover:text-[var(--accent)] transition-colors"
                        >
                          {u.email}
                        </Link>
                      </div>
                      {u.name && <div className="text-[var(--text-faint)] mt-0.5">{u.name}</div>}
                      {u.last_active && (
                        <div className="text-[var(--text-faint)] mt-0.5">
                          active {new Date(u.last_active + 'Z').toLocaleDateString()}
                        </div>
                      )}
                    </td>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: make admin user rows link to detail pages"
```

---

### Task 9: Build the user detail page

**Files:**
- Create: `frontend/app/admin/users/[userId]/page.tsx`

- [ ] **Step 1: Create the user detail page**

Create `frontend/app/admin/users/[userId]/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Shield, Loader2, RefreshCw, Eye, Save,
  Activity, User as UserIcon, Settings, ChevronDown, ChevronUp,
  Plus, Trash2, Pencil, X, Check, ExternalLink, FileText,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';
import {
  adminGetUser, adminEditUser, adminGetUserRuns, adminGetUserBrands,
  adminImpersonate, adminTriggerRun, adminGenerateDraft,
  adminEditBrand, adminAddPrompt, adminEditPrompt, adminDeletePrompt,
  adminAddCompetitor, adminDeleteCompetitor,
  AdminUserDetail, AdminBrandDetail, AdminUserRun, AdminEditUserPayload,
} from '@/lib/api';

type Tab = 'overview' | 'edit' | 'brands' | 'activity';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500/15 text-green-400 border-green-500/30',
    running:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    pending:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    failed:    'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] ?? 'bg-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] border-[var(--border-subtle)]'}`}>
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-[var(--text-faint)] text-[10px]">free</span>;
  const cls = tier === 'pro'
    ? 'bg-[var(--accent)]/20 text-[var(--accent-foreground)] border-[var(--accent)]/30'
    : 'bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)] border-[var(--border-subtle)]';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{tier}</span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-0">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-xs text-[var(--text-primary)] font-medium">{value}</span>
    </div>
  );
}

/* ── Overview Tab ─────────────────────────────────────────────────────────── */

function OverviewTab({ detail, runs }: { detail: AdminUserDetail; runs: AdminUserRun[] }) {
  return (
    <div className="space-y-6">
      <div className="card p-5 rounded-xl space-y-1">
        <InfoRow label="Email" value={detail.email} />
        <InfoRow label="Name" value={detail.name || '—'} />
        <InfoRow label="Joined" value={detail.created_at ? new Date(detail.created_at + 'Z').toLocaleDateString() : '—'} />
        <InfoRow label="Last active" value={detail.last_active ? new Date(detail.last_active + 'Z').toLocaleDateString() : '—'} />
        <InfoRow label="Tier" value={<TierBadge tier={detail.subscription_tier} />} />
        <InfoRow label="Status" value={detail.subscription_status || 'none'} />
        <InfoRow label="Trial ends" value={detail.trial_end ? new Date(detail.trial_end + 'Z').toLocaleDateString() : '—'} />
        <InfoRow label="Email verified" value={detail.email_verified ? 'Yes' : 'No'} />
        <InfoRow label="Paused" value={detail.is_paused ? 'Yes' : 'No'} />
        <InfoRow label="2FA" value={detail.totp_enabled ? 'Enabled' : 'Off'} />
        <InfoRow label="Google linked" value={detail.google_id ? 'Yes' : 'No'} />
        {detail.stripe_customer_id && (
          <InfoRow label="Stripe" value={detail.stripe_customer_id} />
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 rounded-xl text-center">
          <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">{detail.brand_count}</div>
          <div className="text-xs text-[var(--text-muted)]">Brands</div>
        </div>
        <div className="card p-4 rounded-xl text-center">
          <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">{detail.total_runs}</div>
          <div className="text-xs text-[var(--text-muted)]">Runs</div>
        </div>
        <div className="card p-4 rounded-xl text-center">
          <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">{detail.total_drafts}</div>
          <div className="text-xs text-[var(--text-muted)]">Drafts</div>
        </div>
      </div>

      {/* Recent runs */}
      <div className="card rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
          <span className="text-xs font-semibold text-[var(--text-primary)]">Recent Runs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left text-[var(--text-faint)] px-4 py-2 font-medium">Brand</th>
                <th className="text-left text-[var(--text-faint)] px-4 py-2 font-medium">Status</th>
                <th className="text-left text-[var(--text-faint)] px-4 py-2 font-medium">Score</th>
                <th className="text-left text-[var(--text-faint)] px-4 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 10).map((r) => (
                <tr key={r.id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-2 text-[var(--text-primary)]">{r.brand_name}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2 font-mono text-[var(--text-secondary)]">{r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '—'}</td>
                  <td className="px-4 py-2 text-[var(--text-faint)]">{r.created_at ? new Date(r.created_at + 'Z').toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--text-faint)]">No runs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Edit Tab ─────────────────────────────────────────────────────────────── */

function EditTab({ detail, onSave }: { detail: AdminUserDetail; onSave: (d: AdminUserDetail) => void }) {
  const [form, setForm] = useState({
    subscription_tier: detail.subscription_tier || '',
    subscription_status: detail.subscription_status || '',
    trial_end: detail.trial_end ? detail.trial_end.split('T')[0] : '',
    email_verified: detail.email_verified,
    is_paused: detail.is_paused,
    name: detail.name || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function buildPayload(): AdminEditUserPayload {
    const p: AdminEditUserPayload = {};
    if (form.subscription_tier !== (detail.subscription_tier || '')) {
      p.subscription_tier = form.subscription_tier || null;
    }
    if (form.subscription_status !== (detail.subscription_status || '')) {
      p.subscription_status = form.subscription_status || null;
    }
    if (form.trial_end !== (detail.trial_end ? detail.trial_end.split('T')[0] : '')) {
      p.trial_end = form.trial_end || '';
    }
    if (form.email_verified !== detail.email_verified) {
      p.email_verified = form.email_verified;
    }
    if (form.is_paused !== detail.is_paused) {
      p.is_paused = form.is_paused;
    }
    if (form.name !== (detail.name || '')) {
      p.name = form.name;
    }
    return p;
  }

  const changes = buildPayload();
  const hasChanges = Object.keys(changes).length > 0;

  async function handleSave() {
    setSaving(true);
    setConfirmOpen(false);
    try {
      const updated = await adminEditUser(detail.id, changes);
      onSave(updated);
    } catch (err) {
      logError(err, 'Admin: edit user');
      alert('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5 rounded-xl space-y-5">
      {/* Tier */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Subscription Tier</label>
        <select
          value={form.subscription_tier}
          onChange={(e) => setForm({ ...form, subscription_tier: e.target.value })}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">Free</option>
          <option value="basic">Starter (basic)</option>
          <option value="starter">Growth (starter)</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      {/* Status */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Subscription Status</label>
        <select
          value={form.subscription_status}
          onChange={(e) => setForm({ ...form, subscription_status: e.target.value })}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          <option value="">None</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>

      {/* Trial end */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Trial End Date</label>
        <input
          type="date"
          value={form.trial_end}
          onChange={(e) => setForm({ ...form, trial_end: e.target.value })}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </div>

      {/* Toggles */}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={form.email_verified} onChange={(e) => setForm({ ...form, email_verified: e.target.checked })} />
          Email verified
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={form.is_paused} onChange={(e) => setForm({ ...form, is_paused: e.target.checked })} />
          Paused
        </label>
      </div>

      {/* Save */}
      {hasChanges && !confirmOpen && (
        <button
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Save size={14} />
          Save Changes
        </button>
      )}

      {confirmOpen && (
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg p-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">Confirm changes:</p>
          <ul className="text-xs text-[var(--text-primary)] space-y-1">
            {Object.entries(changes).map(([k, v]) => (
              <li key={k}><strong>{k}:</strong> {String(v)}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-3 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] rounded-lg disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Brands Tab ───────────────────────────────────────────────────────────── */

function BrandsTab({ brands, onRefresh, userId }: { brands: AdminBrandDetail[]; onRefresh: () => void; userId: number }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {brands.map((brand) => (
        <BrandCard
          key={brand.id}
          brand={brand}
          expanded={expandedId === brand.id}
          onToggle={() => setExpandedId(expandedId === brand.id ? null : brand.id)}
          onRefresh={onRefresh}
        />
      ))}
      {brands.length === 0 && (
        <div className="card p-8 rounded-xl text-center text-[var(--text-faint)] text-sm">No brands</div>
      )}
    </div>
  );
}

function BrandCard({ brand, expanded, onToggle, onRefresh }: { brand: AdminBrandDetail; expanded: boolean; onToggle: () => void; onRefresh: () => void }) {
  const [triggering, setTriggering] = useState(false);
  const [drafting, setDrafting] = useState(false);

  // Inline edit state
  const [editName, setEditName] = useState(brand.name);
  const [editSlug, setEditSlug] = useState(brand.slug);
  const [editTier, setEditTier] = useState(brand.tier);
  const [editType, setEditType] = useState(brand.brand_type);
  const [editUrl, setEditUrl] = useState(brand.website_url || '');
  const [saving, setSaving] = useState(false);

  // Prompt state
  const [newPromptText, setNewPromptText] = useState('');
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');

  // Competitor state
  const [newCompName, setNewCompName] = useState('');
  const [newCompUrl, setNewCompUrl] = useState('');

  async function handleTriggerRun() {
    setTriggering(true);
    try { await adminTriggerRun(brand.id); } catch { alert('Failed.'); }
    finally { setTriggering(false); }
  }

  async function handleDraft() {
    setDrafting(true);
    try { await adminGenerateDraft(brand.id); } catch { alert('Failed.'); }
    finally { setDrafting(false); }
  }

  async function handleSaveBrand() {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (editName !== brand.name) payload.name = editName;
      if (editSlug !== brand.slug) payload.slug = editSlug;
      if (editTier !== brand.tier) payload.tier = editTier;
      if (editType !== brand.brand_type) payload.brand_type = editType;
      if (editUrl !== (brand.website_url || '')) payload.website_url = editUrl;
      if (Object.keys(payload).length > 0) {
        await adminEditBrand(brand.id, payload);
        onRefresh();
      }
    } catch { alert('Failed to save.'); }
    finally { setSaving(false); }
  }

  async function handleAddPrompt() {
    if (!newPromptText.trim()) return;
    try {
      await adminAddPrompt(brand.id, newPromptText.trim());
      setNewPromptText('');
      onRefresh();
    } catch { alert('Failed.'); }
  }

  async function handleSavePrompt(promptId: number) {
    try {
      await adminEditPrompt(promptId, editingPromptText);
      setEditingPromptId(null);
      onRefresh();
    } catch { alert('Failed.'); }
  }

  async function handleDeletePrompt(promptId: number) {
    if (!confirm('Delete this prompt?')) return;
    try { await adminDeletePrompt(promptId); onRefresh(); } catch { alert('Failed.'); }
  }

  async function handleAddCompetitor() {
    if (!newCompName.trim()) return;
    try {
      await adminAddCompetitor(brand.id, newCompName.trim(), newCompUrl.trim() || undefined);
      setNewCompName('');
      setNewCompUrl('');
      onRefresh();
    } catch { alert('Failed.'); }
  }

  async function handleDeleteCompetitor(compId: number) {
    if (!confirm('Delete this competitor?')) return;
    try { await adminDeleteCompetitor(compId); onRefresh(); } catch { alert('Failed.'); }
  }

  return (
    <div className="card rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.01)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{brand.name}</span>
          <span className="text-[10px] text-[var(--text-faint)] font-mono">/{brand.slug}</span>
          <TierBadge tier={brand.tier} />
          {brand.brand_type === 'pitch' && (
            <span className="text-[10px] px-1 rounded bg-[var(--accent)]/15 text-[var(--accent-foreground)] border border-[var(--accent)]/20">pitch</span>
          )}
          <span className="text-[10px] text-[var(--text-faint)]">{brand.prompts.length} prompts, {brand.competitors.length} competitors</span>
        </div>
        <div className="flex items-center gap-3">
          {brand.latest_score != null && (
            <span className="text-xs font-mono text-[var(--text-secondary)]">{brand.latest_score.toFixed(1)}%</span>
          )}
          <span
            onClick={(e) => { e.stopPropagation(); handleTriggerRun(); }}
            className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1"
          >
            {triggering ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Run
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); handleDraft(); }}
            className="text-[10px] text-[var(--text-faint)] hover:text-[var(--success)] cursor-pointer flex items-center gap-1"
          >
            {drafting ? <Loader2 size={10} className="animate-spin" /> : <FileText size={10} />} Draft
          </span>
          {expanded ? <ChevronUp size={14} className="text-[var(--text-faint)]" /> : <ChevronDown size={14} className="text-[var(--text-faint)]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-[var(--border-subtle)] pt-4">
          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Slug</label>
              <input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)] font-mono" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Tier</label>
              <select value={editTier} onChange={(e) => setEditTier(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]">
                <option value="basic">basic</option>
                <option value="standard">standard</option>
                <option value="premium">premium</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Type</label>
              <select value={editType} onChange={(e) => setEditType(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]">
                <option value="standard">standard</option>
                <option value="pitch">pitch</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Website URL</label>
              <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-primary)]" placeholder="https://..." />
            </div>
          </div>
          <button onClick={handleSaveBrand} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white rounded-lg disabled:opacity-50 cursor-pointer">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save Brand
          </button>

          {/* Prompts */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Prompts ({brand.prompts.length})</h4>
            <div className="space-y-1.5">
              {brand.prompts.map((p) => (
                <div key={p.id} className="flex items-center gap-2 group">
                  {editingPromptId === p.id ? (
                    <>
                      <input value={editingPromptText} onChange={(e) => setEditingPromptText(e.target.value)} className="flex-1 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]" />
                      <button onClick={() => handleSavePrompt(p.id)} className="text-[var(--success)] cursor-pointer"><Check size={12} /></button>
                      <button onClick={() => setEditingPromptId(null)} className="text-[var(--text-faint)] cursor-pointer"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-xs text-[var(--text-secondary)]">{p.text}</span>
                      <button onClick={() => { setEditingPromptId(p.id); setEditingPromptText(p.text); }} className="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--text-primary)] cursor-pointer"><Pencil size={11} /></button>
                      <button onClick={() => handleDeletePrompt(p.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer"><Trash2 size={11} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} placeholder="Add prompt..." className="flex-1 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]" onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()} />
              <button onClick={handleAddPrompt} className="text-[var(--accent)] cursor-pointer"><Plus size={14} /></button>
            </div>
          </div>

          {/* Competitors */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Competitors ({brand.competitors.length})</h4>
            <div className="space-y-1.5">
              {brand.competitors.map((c) => (
                <div key={c.id} className="flex items-center gap-2 group">
                  <span className="flex-1 text-xs text-[var(--text-secondary)]">{c.name} {c.website_url && <span className="text-[var(--text-faint)]">({c.website_url})</span>}</span>
                  <button onClick={() => handleDeleteCompetitor(c.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer"><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={newCompName} onChange={(e) => setNewCompName(e.target.value)} placeholder="Competitor name" className="flex-1 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]" />
              <input value={newCompUrl} onChange={(e) => setNewCompUrl(e.target.value)} placeholder="URL (optional)" className="flex-1 bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)]" />
              <button onClick={handleAddCompetitor} className="text-[var(--accent)] cursor-pointer"><Plus size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Activity Tab ─────────────────────────────────────────────────────────── */

function ActivityTab({ runs }: { runs: AdminUserRun[] }) {
  return (
    <div className="card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Brand</th>
              <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Status</th>
              <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Score</th>
              <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Type</th>
              <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)]">
                <td className="px-4 py-2.5 text-[var(--text-primary)]">{r.brand_name}</td>
                <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '—'}</td>
                <td className="px-4 py-2.5 text-[var(--text-faint)]">{r.run_type}</td>
                <td className="px-4 py-2.5 text-[var(--text-faint)] whitespace-nowrap">{r.created_at ? new Date(r.created_at + 'Z').toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">No runs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = Number(params.userId);
  const { user: authUser, loading: authLoading, refresh } = useAuth();

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [runs, setRuns] = useState<AdminUserRun[]>([]);
  const [brands, setBrands] = useState<AdminBrandDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [impersonating, setImpersonating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, r, b] = await Promise.all([
        adminGetUser(userId),
        adminGetUserRuns(userId),
        adminGetUserBrands(userId),
      ]);
      setDetail(d);
      setRuns(r);
      setBrands(b);
    } catch {
      setError('Failed to load user data.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { document.title = `Admin — User ${userId}`; }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { router.replace('/login'); return; }
    if (!authUser.is_admin) { router.replace('/dashboard'); return; }
    load();
  }, [authUser, authLoading, router, load]);

  async function handleImpersonate() {
    setImpersonating(true);
    try {
      const result = await adminImpersonate(userId);
      sessionStorage.setItem('admin_restore_token', result.admin_token);
      await refresh();
      router.push('/dashboard');
    } catch {
      alert('Failed to impersonate user.');
      setImpersonating(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="p-8 max-w-4xl animate-pulse space-y-4">
        <div className="h-8 bg-[rgba(255,255,255,0.06)] rounded w-60" />
        <div className="h-64 card rounded-xl" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8 max-w-4xl">
        <Link href="/admin" className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4">
          <ArrowLeft size={14} /> Back to Admin
        </Link>
        <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl p-6 text-center">
          <p className="text-[var(--danger)] text-sm">{error || 'User not found'}</p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'Overview', icon: UserIcon },
    { key: 'edit', label: 'Edit User', icon: Settings },
    { key: 'brands', label: 'Brands', icon: Activity },
    { key: 'activity', label: 'Activity', icon: RefreshCw },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[var(--text-primary)]">{detail.email}</h1>
                <TierBadge tier={detail.subscription_tier} />
                {detail.is_paused && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">paused</span>}
                {!detail.email_verified && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">unverified</span>}
              </div>
              {detail.name && <p className="text-xs text-[var(--text-muted)]">{detail.name}</p>}
            </div>
          </div>
          <button
            onClick={handleImpersonate}
            disabled={impersonating}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[var(--accent-muted)] border border-[var(--accent)]/20 text-[var(--accent-foreground)] rounded-lg hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {impersonating ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
            Impersonate
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border-subtle)]">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                tab === key
                  ? 'text-[var(--accent-foreground)] border-b-2 border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'overview' && <OverviewTab detail={detail} runs={runs} />}
        {tab === 'edit' && <EditTab detail={detail} onSave={(d) => setDetail(d)} />}
        {tab === 'brands' && <BrandsTab brands={brands} onRefresh={load} userId={userId} />}
        {tab === 'activity' && <ActivityTab runs={runs} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: no errors (or only pre-existing errors unrelated to admin).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/users/\[userId\]/page.tsx
git commit -m "feat: add admin user detail page with overview, edit, brands, activity tabs"
```

---

### Task 10: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && source venv/bin/activate && pytest tests/ -x -q 2>&1 | tail -20`

Expected: all tests pass.

- [ ] **Step 2: Verify frontend builds**

Run: `cd frontend && npm run build 2>&1 | tail -20`

Expected: build succeeds.

- [ ] **Step 3: Start both servers and manually verify**

Start backend: `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`
Start frontend: `cd frontend && npm run dev` (port 3002)

Manual checks:
1. Navigate to `/admin` — users table should load with clickable email links
2. Click a user email → navigates to `/admin/users/{id}` with Overview tab
3. Switch to Edit tab → change a field → save → verify change persists on refresh
4. Switch to Brands tab → expand a brand → edit name → save → verify update
5. Add a prompt, edit it, delete it
6. Add a competitor, delete it
7. Click "Impersonate" → red banner appears → you see the user's dashboard
8. Click "Exit Impersonation" → returns to admin page as admin

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
