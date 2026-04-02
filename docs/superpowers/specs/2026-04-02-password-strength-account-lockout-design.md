# Password Strength & Account Lockout — Design Spec

**Date:** 2026-04-02
**Status:** Approved

---

## Overview

Two related security improvements:
1. Enforce strong passwords on all password-setting endpoints
2. Lock accounts for 30 minutes after 5 consecutive failed login attempts, with "use Forgot Password" as the recovery path

---

## Feature 1: Strong Password Enforcement

### Rule

A valid password must:
- Be at least 8 characters
- Contain at least 1 uppercase letter (A–Z)
- Contain at least 1 lowercase letter (a–z)
- Contain at least 1 digit (0–9)
- Contain at least 1 special character (`!@#$%^&*()-_=+[]{}|;:',.<>?/~`)

### Backend

A single helper `validate_password_strength(password: str) -> None` added to `auth.py`. Raises `HTTP 422` with a descriptive message if any rule is violated. Called in:
- `POST /auth/register`
- `POST /auth/reset-password`
- `POST /auth/admin/reset-password`

Replaces the existing `len(password) < 6` checks in all three places.

### Frontend

- **Register page** (`/register`): Live password strength indicator below the password field. Shows which rules are met/unmet as the user types. Submitting with a weak password shows inline error.
- **Reset password page** (`/reset-password`): Same inline rule checklist (no strength meter needed, just rule list).
- Error messages from the backend (422 detail) surface in the existing error display — no new UI pattern needed.

---

## Feature 2: Account Lockout

### Data Model

Two new nullable columns added to the `users` table via migration in `database.py:run_migrations()`:

```sql
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME NULL;
```

Corresponding fields on the `User` ORM model:
- `failed_login_attempts: Mapped[int]` — default 0
- `locked_until: Mapped[Optional[datetime]]` — default None

### Logic in `POST /auth/login`

1. Look up user by email.
2. If user exists and `locked_until` is set and `locked_until > now`:
   - Reject with HTTP 423 (Locked) and message:  
     `"Account locked due to too many failed attempts. Try again after HH:MM UTC, or use Forgot Password to reset."`
3. If user not found or password wrong:
   - If user exists: increment `failed_login_attempts`
   - If `failed_login_attempts >= 5`: set `locked_until = now + 30 minutes`, reset counter to 0
   - Commit and return HTTP 401 `"Invalid email or password"` (don't reveal lockout was triggered on the 5th bad attempt — the *next* attempt will show the locked message)
4. If password correct:
   - Reset `failed_login_attempts = 0`, `locked_until = None`
   - Proceed with 2FA check or session creation as normal

### Error Message Format

When locked, the response is:
```json
{
  "detail": "Account locked due to too many failed attempts. Try again after 14:32 UTC, or use Forgot Password to reset."
}
```

The frontend displays this via its existing error string rendering. No special handling needed.

### 2FA

Lockout applies only at the password verification step. The 2FA challenge (`/auth/2fa/verify`) is unaffected — a valid challenge token already proves the password was correct.

### Admin accounts

No bypass. Admins use Forgot Password or a direct DB reset like any other user.

### Lockout expiry

No background cleanup job needed. The lockout check compares `locked_until` to `now` at login time. Expired locks are effectively auto-cleared on the next successful login (counter reset).

---

## Out of Scope

- Password history / reuse prevention
- Progressive lockout delays
- Admin UI to manually unlock accounts
- Notifications to users when their account is locked

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/models.py` | Add `failed_login_attempts`, `locked_until` to `User` |
| `backend/app/database.py` | Add two `ALTER TABLE` migration steps |
| `backend/app/routers/auth.py` | Add `validate_password_strength()`, update login lockout logic, update all three password-setting endpoints |
| `frontend/app/register/page.tsx` | Add live password strength indicator |
| `frontend/app/reset-password/page.tsx` | Add password rule checklist |
