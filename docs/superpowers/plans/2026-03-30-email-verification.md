# Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6-digit email verification on registration — new users must verify before accessing any app page; Google OAuth users are pre-verified; existing users are grandfathered as verified.

**Architecture:** Backend adds `email_verified` bool to User (server_default=True for existing users), two new endpoints (verify and resend), and a gate in `get_current_user` that blocks unverified users with 403. Frontend adds a `/verify-email` page and a `useEffect` in `AuthContext` that watches user state and redirects unverified users there automatically. The `/auth/me` endpoint uses a separate dependency that skips the verification gate so the frontend can always read user state.

**Tech Stack:** Python 3.9, FastAPI, SQLAlchemy 2.0 async, SQLite, bcrypt, Next.js 15 App Router, TypeScript, React useState/useEffect.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/database.py` | Modify | Add 3 migration entries for new columns |
| `backend/app/models.py` | Modify | Add `email_verified`, `email_verification_code`, `email_verification_expires_at` to User |
| `backend/app/services/email_service.py` | Modify | Add `send_email_verification()` |
| `backend/app/routers/auth.py` | Modify | Generate+email code on register; add verify/resend endpoints; update `user_to_dict`; Google OAuth sets verified=True |
| `backend/app/dependencies.py` | Modify | Add `email_verified` gate to `get_current_user`; add `get_current_user_allow_unverified` |
| `frontend/lib/api.ts` | Modify | Add `email_verified` to `AuthUser`; add `authVerifyEmail` and `authResendVerification` |
| `frontend/contexts/AuthContext.tsx` | Modify | Add `useEffect` that redirects unverified users to `/verify-email` |
| `frontend/components/AppShell.tsx` | Modify | Add `/verify-email` to `NO_SIDEBAR_PATHS` |
| `frontend/app/register/page.tsx` | Modify | Redirect to `/verify-email` instead of `/onboarding` after register |
| `frontend/app/verify-email/page.tsx` | Create | 6-digit code input page matching login/register visual style |

> No testing framework is installed in the frontend. Tasks use manual browser verification instead of automated tests.

---

## Task 1: Backend — User model columns + migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add columns to the User model**

Open `backend/app/models.py`. After the `updated_at` field on line 65, add three new fields to the `User` class:

```python
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='1')
    email_verification_code: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email_verification_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
```

The complete `User` class (all fields) should now be:

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    google_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subscription_tier: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    subscription_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    subscription_trial_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    totp_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='1')
    email_verification_code: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email_verification_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 2: Add migration entries to database.py**

Open `backend/app/database.py`. In `run_migrations()`, append three new entries at the **very end** of the `migrations` list (after the `totp_enabled` ALTER TABLE line):

```python
        # Email verification — gate new accounts until they confirm their address
        "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN email_verification_code TEXT",
        "ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME",
```

`DEFAULT 1` means all existing users are grandfathered as verified. The migration loop already suppresses duplicate-column errors, so it's safe to re-run.

- [ ] **Step 3: Verify migration runs on startup**

Start (or restart) the backend:
```bash
cd /Users/ken/Desktop/Lumidian/backend && uvicorn app.main:app --reload --port 8000
```

Watch startup logs — `run_migrations()` runs at startup. You should see lines like:
```
INFO:app.database:Migration applied: ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1
```

Verify the columns exist in the DB:
```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db ".schema users" | grep email_veri
```

Expected output contains:
```
email_verified INTEGER NOT NULL DEFAULT 1,
email_verification_code TEXT,
email_verification_expires_at DATETIME,
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/models.py backend/app/database.py
git commit -m "feat: add email_verified and verification code columns to users"
```

---

## Task 2: Email function + user_to_dict

**Files:**
- Modify: `backend/app/services/email_service.py`
- Modify: `backend/app/routers/auth.py` (user_to_dict only)

- [ ] **Step 1: Add send_email_verification to email_service.py**

Open `backend/app/services/email_service.py`. Add this function immediately before `send_welcome_email`:

```python
def send_email_verification(email: str, name: Optional[str], code: str) -> None:
    """Sent immediately after a new user registers — 6-digit code to verify email."""
    display = name or email.split("@")[0]

    body = f"""\
Hi {display},

Thanks for creating a Lumidian account.

Your email verification code is:

  {code}

Enter this code on the verification page to access your account.
This code expires in 24 hours.

If you didn't create a Lumidian account, you can safely ignore this email.

— The Lumidian Team
"""
    _send(
        to=email,
        subject="Verify your Lumidian account",
        body=body,
    )
```

- [ ] **Step 2: Add email_verified to user_to_dict in auth.py**

Open `backend/app/routers/auth.py`. Find `user_to_dict` and add `"email_verified"` to the returned dict. The full function:

```python
def user_to_dict(user: User) -> dict:
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "is_admin": user.is_admin,
        "prompt_limit": limit,
        "totp_enabled": bool(user.totp_enabled),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "email_verified": bool(getattr(user, "email_verified", True)),
    }
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/services/email_service.py backend/app/routers/auth.py
git commit -m "feat: add send_email_verification function and email_verified to user_to_dict"
```

---

## Task 3: Registration sends verification code

**Files:**
- Modify: `backend/app/routers/auth.py` (register endpoint only)

- [ ] **Step 1: Update the register endpoint**

Open `backend/app/routers/auth.py`. Replace the full `register` function with this version (sets `email_verified=False`, generates and emails a 6-digit code):

```python
@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, http_req: Request, response: Response, db: DbDep):
    import random
    request = body
    _rate_check(http_req.client.host if http_req.client else "unknown", _register_attempts, _MAX_REGISTER)
    email = request.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if len(request.password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 6 characters")

    verification_code = f"{random.randint(0, 999999):06d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)

    password_hash = hash_password(request.password)
    user = User(
        email=email,
        password_hash=password_hash,
        name=request.name or email.split("@")[0],
        is_admin=(email in _ADMIN_EMAILS),
        email_verified=False,
        email_verification_code=code_hash,
        email_verification_expires_at=code_expires_at,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_token(user.id)
    set_auth_cookies(response, token)

    from app.services.analytics_service import log_event
    await log_event("user_registered", {"plan": user.subscription_tier}, user_id=user.id)

    from app.services.email_service import send_email_verification, send_email_background
    send_email_background(send_email_verification, email=user.email, name=user.name, code=verification_code)

    return user_to_dict(user)
```

Note: `timedelta` is already imported at the top of auth.py (line 22).

- [ ] **Step 2: Verify register returns email_verified: false**

```bash
curl -s -c /tmp/lumidian_test.txt -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "testverify@example.com", "password": "test123", "name": "Test"}' \
  | python3 -m json.tool
```

Expected: response contains `"email_verified": false`

Check backend logs — you should see the console email box with a 6-digit code (if SMTP is configured, it will be sent to the inbox instead). Note the code for the next test.

- [ ] **Step 3: Verify the code was stored hashed in the DB**

```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db \
  "SELECT email, email_verified, email_verification_code IS NOT NULL as has_code, email_verification_expires_at FROM users WHERE email = 'testverify@example.com';"
```

Expected: `testverify@example.com|0|1|<datetime 24h from now>`

- [ ] **Step 4: Clean up test user**

```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db \
  "DELETE FROM users WHERE email = 'testverify@example.com';"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/routers/auth.py
git commit -m "feat: generate and email 6-digit verification code on registration"
```

---

## Task 4: Backend — verification gate + allow-unverified dependency

**Files:**
- Modify: `backend/app/dependencies.py`
- Modify: `backend/app/routers/auth.py` (import + get_me signature only)

- [ ] **Step 1: Add email_verified gate to get_current_user**

Open `backend/app/dependencies.py`. Replace the `get_current_user` function with this version (adds the email_verified check after the is_paused check):

```python
async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: Optional[str] = Cookie(default=None),
) -> User:
    if not clarity_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(clarity_token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if getattr(user, "is_paused", False) and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been paused. Contact support to restore access.",
        )
    if not getattr(user, "email_verified", True) and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        )
    return user
```

- [ ] **Step 2: Add get_current_user_allow_unverified**

In `backend/app/dependencies.py`, add this new function immediately after `get_current_user`:

```python
async def get_current_user_allow_unverified(
    db: Annotated[AsyncSession, Depends(get_db)],
    clarity_token: Optional[str] = Cookie(default=None),
) -> User:
    """Like get_current_user but does NOT block unverified email addresses.
    Use only for /auth/me and the email verification endpoints themselves."""
    if not clarity_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(clarity_token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if getattr(user, "is_paused", False) and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been paused. Contact support to restore access.",
        )
    return user
```

Also add the type alias near the bottom of `dependencies.py` where `CurrentUser` is defined:

```python
AllowUnverifiedUser = Annotated[User, Depends(get_current_user_allow_unverified)]
```

- [ ] **Step 3: Update /auth/me to use get_current_user_allow_unverified**

Open `backend/app/routers/auth.py`.

**First**, update the import at the top of the file. Find:
```python
from app.dependencies import JWT_SECRET, JWT_ALGORITHM, get_current_user
```

Replace with:
```python
from app.dependencies import JWT_SECRET, JWT_ALGORITHM, get_current_user, get_current_user_allow_unverified
```

**Second**, update the `get_me` endpoint signature. Find:
```python
@router.get("/me")
async def get_me(user: Annotated[User, Depends(get_current_user)], db: DbDep):
```

Replace with:
```python
@router.get("/me")
async def get_me(user: Annotated[User, Depends(get_current_user_allow_unverified)], db: DbDep):
```

The body of `get_me` stays unchanged.

- [ ] **Step 4: Test the gate**

Register a test user (gets email_verified=False) and try to hit a protected endpoint:

```bash
curl -s -c /tmp/lumidian_test.txt -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "testgate@example.com", "password": "test123"}' > /dev/null

# This should return 403 with detail "email_not_verified"
curl -s -b /tmp/lumidian_test.txt http://localhost:8000/api/brands/ | python3 -m json.tool
```

Expected: `{"detail": "email_not_verified"}`

```bash
# But /auth/me should still work (uses allow_unverified)
curl -s -b /tmp/lumidian_test.txt http://localhost:8000/api/auth/me | python3 -m json.tool | grep email_verified
```

Expected: `"email_verified": false`

Clean up:
```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db \
  "DELETE FROM users WHERE email = 'testgate@example.com';"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/dependencies.py backend/app/routers/auth.py
git commit -m "feat: gate unverified users in get_current_user; /auth/me uses allow_unverified variant"
```

---

## Task 5: Backend — verify-email and resend-verification endpoints

**Files:**
- Modify: `backend/app/routers/auth.py`

- [ ] **Step 1: Add the two new endpoints**

Open `backend/app/routers/auth.py`. Add this block after the `reset_password` endpoint (approximately after line 561):

```python
# ── Email verification ────────────────────────────────────────────────────────

class VerifyEmailRequest(BaseModel):
    code: str


@router.post("/verify-email", status_code=status.HTTP_200_OK)
async def verify_email(
    body: VerifyEmailRequest,
    current_user: Annotated[User, Depends(get_current_user_allow_unverified)],
    db: DbDep,
):
    """Validate the 6-digit code and mark the user's email as verified."""
    if getattr(current_user, "email_verified", True):
        return {"message": "Email already verified"}

    if not current_user.email_verification_code or not current_user.email_verification_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending verification. Please resend the code.",
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if current_user.email_verification_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code expired. Please request a new one.",
        )

    if not verify_password(body.code.strip(), current_user.email_verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid code. Please try again.",
        )

    current_user.email_verified = True
    current_user.email_verification_code = None
    current_user.email_verification_expires_at = None
    await db.commit()

    return {"message": "Email verified successfully"}


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
async def resend_verification(
    current_user: Annotated[User, Depends(get_current_user_allow_unverified)],
    db: DbDep,
):
    """Generate a fresh 6-digit code and resend the verification email."""
    if getattr(current_user, "email_verified", True):
        return {"message": "Email already verified"}

    import random
    verification_code = f"{random.randint(0, 999999):06d}"
    code_hash = hash_password(verification_code)
    code_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)

    current_user.email_verification_code = code_hash
    current_user.email_verification_expires_at = code_expires_at
    await db.commit()

    from app.services.email_service import send_email_verification, send_email_background
    send_email_background(
        send_email_verification,
        email=current_user.email,
        name=current_user.name,
        code=verification_code,
    )

    return {"message": "Verification email resent"}
```

- [ ] **Step 2: Test verify-email end-to-end**

```bash
# Register — note the 6-digit code from backend logs
curl -s -c /tmp/lumidian_test.txt -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "testverify3@example.com", "password": "test123"}' > /dev/null

# Submit the code (replace 123456 with the code from logs)
curl -s -b /tmp/lumidian_test.txt -X POST http://localhost:8000/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"code": "123456"}' | python3 -m json.tool
```

Expected: `{"message": "Email verified successfully"}`

```bash
# Confirm email_verified is now true
curl -s -b /tmp/lumidian_test.txt http://localhost:8000/api/auth/me \
  | python3 -m json.tool | grep email_verified
```

Expected: `"email_verified": true`

```bash
# Confirm protected endpoints work now
curl -s -b /tmp/lumidian_test.txt http://localhost:8000/api/brands/ | python3 -m json.tool
```

Expected: returns brand list (not a 403).

Clean up:
```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db \
  "DELETE FROM users WHERE email = 'testverify3@example.com';"
```

- [ ] **Step 3: Test resend**

```bash
curl -s -c /tmp/lumidian_test2.txt -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "testresend@example.com", "password": "test123"}' > /dev/null

curl -s -b /tmp/lumidian_test2.txt -X POST http://localhost:8000/api/auth/resend-verification \
  | python3 -m json.tool
```

Expected: `{"message": "Verification email resent"}` and a new code appears in backend logs.

Clean up:
```bash
sqlite3 /Users/ken/Desktop/Lumidian/backend/clarity_ai.db \
  "DELETE FROM users WHERE email = 'testresend@example.com';"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/routers/auth.py
git commit -m "feat: add POST /auth/verify-email and POST /auth/resend-verification endpoints"
```

---

## Task 6: Backend — Google OAuth sets email_verified=True

**Files:**
- Modify: `backend/app/routers/auth.py`

- [ ] **Step 1: Update POST /google for new users**

Open `backend/app/routers/auth.py`. In the `google_auth` function, find the new user creation block:

```python
        else:
            user = User(
                email=email,
                google_id=google_id,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
            )
            db.add(user)
```

Replace with:

```python
        else:
            user = User(
                email=email,
                google_id=google_id,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
                email_verified=True,
            )
            db.add(user)
```

- [ ] **Step 2: Update GET /google/callback for new users**

In the `google_auth_callback` function, find the new user creation block:

```python
        else:
            user = User(
                email=email,
                google_id=google_sub,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
            )
            db.add(user)
```

Replace with:

```python
        else:
            user = User(
                email=email,
                google_id=google_sub,
                name=name,
                is_admin=(email in _ADMIN_EMAILS),
                email_verified=True,
            )
            db.add(user)
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add backend/app/routers/auth.py
git commit -m "feat: set email_verified=True for new Google OAuth users"
```

---

## Task 7: Frontend — AuthUser interface + API functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add email_verified to AuthUser interface**

Open `frontend/lib/api.ts`. Find the `AuthUser` interface (around line 763). Replace:

```typescript
export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'starter' | 'pro' | null;
  subscription_status: string | null;
  is_admin: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  team_owner_email?: string | null;
}
```

With:

```typescript
export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'starter' | 'pro' | null;
  subscription_status: string | null;
  is_admin: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  email_verified: boolean;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  team_owner_email?: string | null;
}
```

- [ ] **Step 2: Add authVerifyEmail and authResendVerification functions**

In `frontend/lib/api.ts`, find `authLogout` (around line 797). Add these two functions immediately after `authLogout`:

```typescript
export async function authVerifyEmail(code: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/verify-email', { code });
  return res.data;
}

export async function authResendVerification(): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/resend-verification');
  return res.data;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/lib/api.ts
git commit -m "feat: add email_verified to AuthUser, add authVerifyEmail and authResendVerification"
```

---

## Task 8: Frontend — AuthContext redirect + AppShell + register page

**Files:**
- Modify: `frontend/contexts/AuthContext.tsx`
- Modify: `frontend/components/AppShell.tsx`
- Modify: `frontend/app/register/page.tsx`

- [ ] **Step 1: Add email_verified redirect useEffect to AuthContext**

Open `frontend/contexts/AuthContext.tsx`. After the existing `useEffect` that calls `refresh()`, add a second `useEffect`:

```typescript
  // Redirect unverified users to /verify-email; send already-verified users away from it
  useEffect(() => {
    if (loading || user === null) return;
    if (!user.email_verified && pathname !== '/verify-email') {
      router.push('/verify-email');
    } else if (user.email_verified && pathname === '/verify-email') {
      router.push('/dashboard');
    }
  }, [loading, user, pathname, router]);
```

The two `useEffect` calls in `AuthProvider` should look like:

```typescript
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // Redirect unverified users to /verify-email; send already-verified users away from it
  useEffect(() => {
    if (loading || user === null) return;
    if (!user.email_verified && pathname !== '/verify-email') {
      router.push('/verify-email');
    } else if (user.email_verified && pathname === '/verify-email') {
      router.push('/dashboard');
    }
  }, [loading, user, pathname, router]);
```

No other changes to `AuthContext.tsx`.

- [ ] **Step 2: Add /verify-email to NO_SIDEBAR_PATHS in AppShell**

Open `frontend/components/AppShell.tsx`. Find:

```typescript
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password'];
```

Replace with:

```typescript
const NO_SIDEBAR_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/verify-email'];
```

- [ ] **Step 3: Update register page redirect**

Open `frontend/app/register/page.tsx`. Find:

```typescript
      await register(email, password, name);
      router.push('/onboarding');
```

Replace with:

```typescript
      await register(email, password, name);
      router.push('/verify-email');
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/contexts/AuthContext.tsx frontend/components/AppShell.tsx frontend/app/register/page.tsx
git commit -m "feat: redirect unverified users to /verify-email; add to no-sidebar paths"
```

---

## Task 9: Frontend — create /verify-email page

**Files:**
- Create: `frontend/app/verify-email/page.tsx`

- [ ] **Step 1: Create the page**

Create `frontend/app/verify-email/page.tsx` with this exact content:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { useAuth } from '@/contexts/AuthContext';
import { authVerifyEmail, authResendVerification } from '@/lib/api';

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

export default function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    document.title = 'Verify Your Email — Lumidian';
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authVerifyEmail(trimmed);
      await refresh();
      // AuthContext useEffect redirects to /dashboard once email_verified=true
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError('');
    setResent(false);
    try {
      await authResendVerification();
      setResent(true);
    } catch {
      setError('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  }

  // Render nothing while user state is resolving (AuthContext redirects if needed)
  if (!user) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 10,
    padding: '12px 16px',
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '0.3em',
    color: '#0F0F12',
    outline: 'none',
    boxSizing: 'border-box',
    textAlign: 'center',
    fontFamily: 'var(--font-fira-code), monospace',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={{
      position: 'relative',
      minHeight: '100vh',
      backgroundColor: '#F8F7F4',
      color: '#0F0F12',
      fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Background gradient orbs — same as login/register */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20vh', left: '-15vw', width: '70vw', height: '70vw', maxWidth: 900, maxHeight: 900, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(147,197,253,0.38) 0%, rgba(147,197,253,0.08) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '-10vh', right: '-10vw', width: '60vw', height: '60vw', maxWidth: 800, maxHeight: 800, borderRadius: '50%', background: 'radial-gradient(circle at 60% 40%, rgba(196,181,253,0.32) 0%, rgba(196,181,253,0.06) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '35vh', left: '25vw', width: '55vw', height: '55vw', maxWidth: 750, maxHeight: 750, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(167,243,208,0.22) 0%, rgba(167,243,208,0.04) 55%, transparent 72%)', filter: 'blur(70px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', backgroundSize: '200px 200px', opacity: 0.04, mixBlendMode: 'multiply' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 36 }}>
          <LumidianLogo size={40} withWordmark variant="light" />
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 20,
          padding: '36px 32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F0F12', margin: '0 0 4px', letterSpacing: '-0.03em' }}>
            Check your email
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>
            We sent a 6-digit code to{' '}
            <strong style={{ color: '#374151' }}>{user.email}</strong>.
            Enter it below to verify your account.
          </p>

          {error && (
            <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
            </div>
          )}

          {resent && (
            <div style={{ background: 'rgba(209,250,229,0.8)', border: '1px solid rgba(110,231,183,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#065f46', margin: 0 }}>A new code has been sent to your email.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
                Verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: '#0F0F12',
                border: 'none',
                borderRadius: 100,
                padding: '11px 20px',
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                cursor: (loading || code.length !== 6) ? 'not-allowed' : 'pointer',
                opacity: (loading || code.length !== 6) ? 0.6 : 1,
                transition: 'background 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 8px rgba(15,15,18,0.15)',
                fontFamily: 'inherit',
              }}
            >
              {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {loading ? 'Verifying…' : 'Verify email'}
            </button>
          </form>

          <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 20, marginBottom: 0 }}>
            Didn&apos;t receive a code?{' '}
            <button
              onClick={handleResend}
              disabled={resending}
              style={{
                background: 'none',
                border: 'none',
                color: '#6366f1',
                fontWeight: 500,
                cursor: resending ? 'not-allowed' : 'pointer',
                fontSize: 13,
                padding: 0,
                fontFamily: 'inherit',
                opacity: resending ? 0.6 : 1,
              }}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Full end-to-end browser test**

With both dev servers running (backend :8000, frontend :3002):

1. Open a fresh private/incognito window → `http://localhost:3002/register`
2. Register a new account
3. Expected: page redirects to `/verify-email`
4. Page shows the registered email and a code input field
5. Check backend console logs for the 6-digit code
6. Type the code into the input (digits only, strips non-numeric automatically)
7. Click "Verify email"
8. Expected: redirect to `/dashboard`
9. Reload — stays on `/dashboard`, NOT redirected back to `/verify-email`

Test redirect guard:
1. Register a second test account (gets unverified cookie)
2. In address bar, manually navigate to `/dashboard`
3. Expected: immediately redirected back to `/verify-email`
4. Try `/reports`, `/content` — all redirect back to `/verify-email`

Test resend:
1. Click "Resend code" on the verify page
2. Expected: green "A new code has been sent" banner appears
3. New code appears in backend logs (old code no longer valid)
4. Enter new code → verify successfully

Test already-verified redirect:
1. While logged in with a verified account, navigate to `http://localhost:3002/verify-email`
2. Expected: immediately redirected to `/dashboard`

- [ ] **Step 3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/app/verify-email/page.tsx
git commit -m "feat: add /verify-email page with 6-digit code input and resend flow"
```
