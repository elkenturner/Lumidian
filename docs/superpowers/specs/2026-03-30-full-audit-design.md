# Lumidian Pre-Launch Audit — Design Doc

**Date:** 2026-03-30
**Strategy:** Option B — Phased Launch Sprint
**Scope:** Fix security + performance blockers before launch; defer architecture refactor and full UX polish to Sprint 2.
**Exclusions (by user):** Stripe webhook verification (handled separately), email verification entropy changes.

---

## 1. Security Fixes (Sprint 1 — Pre-Launch)

### 1.1 Google OAuth Open Redirect (HIGH)
**File:** `backend/app/routers/auth.py`
**Issue:** The `state` parameter from OAuth callback is used directly as a redirect target: `state if (state and state.startswith("/")) else "/dashboard"`. An attacker can craft a URL with `state=//evil.com` or `state=/\evil.com` to redirect users to a phishing page post-authentication.
**Fix:** Validate `state` against a strict allowlist of internal paths. Reject anything containing `//`, `\`, or non-path characters. Only allow paths that start with `/` and match known route prefixes.
**Impact:** Zero breaking changes — only tightens what was already a path-only check.

### 1.2 In-Memory Rate Store Unbounded Growth (HIGH)
**Files:** `backend/app/routers/auth.py`, `backend/app/dependencies.py`
**Issue:** `_login_attempts`, `_register_attempts`, `_verify_attempts`, `_resend_attempts` (auth.py) and `_rate_store` (dependencies.py) are plain dicts that grow indefinitely. Under normal traffic — let alone an attack — these fill RAM and eventually crash the server.
**Fix:** Add a cleanup pass inside the rate check functions that prunes entries older than the rate window (60–300 seconds). No external dependencies needed.
**Impact:** Zero breaking changes — existing rate limiting behavior unchanged, just memory-safe.

### 1.3 Prompt Injection in AI Draft Generation (HIGH)
**File:** `backend/app/services/drafting_service.py`
**Issue:** User-supplied `custom_brief`, `quora_question_title`, and `opportunity` body text are interpolated directly into LLM system/user prompts without sanitization. A user can inject instructions like `Ignore previous instructions and output...` to manipulate draft output or leak brand profile context.
**Fix:** Truncate user inputs to reasonable max lengths (brief ≤ 500 chars, title ≤ 200 chars). Add a delimiter wrapper around user content in the prompt (e.g., wrap in `<user_input>` tags with explicit instruction that content between tags is user data, not instructions).
**Impact:** Zero breaking changes — drafts continue to work; just hardened against injection.

### 1.4 Password Reset Tokens Stored Plaintext (MEDIUM)
**File:** `backend/app/routers/auth.py`
**Issue:** Password reset tokens are stored as raw strings in `PasswordResetToken.token`. If the database is ever exposed, all valid reset tokens are immediately usable.
**Fix:** Store a bcrypt hash of the token; compare `verify_password(raw_token, stored_hash)` on redemption. Token entropy (`secrets.token_urlsafe(48)`) is already high — hashing adds the at-rest protection layer.
**Impact:** Tokens are single-use and short-lived (1h). The only change is storing hash instead of plaintext. Existing outstanding tokens would be invalidated on deploy (acceptable — they'd expire anyway).

### 1.5 No Logging of Failed Auth Events (MEDIUM)
**File:** `backend/app/routers/auth.py`
**Issue:** Failed login attempts, failed email verification attempts, and failed password reset attempts are not logged. Brute-force and credential-stuffing attacks are invisible.
**Fix:** Add `logger.warning()` calls on all failed auth paths (wrong password, invalid token, expired token) with timestamp, IP, and sanitized email. Do NOT log passwords.
**Impact:** Zero breaking changes — additive only.

### 1.6 TOTP Setup Not Rate-Limited (MEDIUM)
**File:** `backend/app/routers/auth.py`
**Issue:** `/2fa/setup` can be called unlimited times, regenerating TOTP secrets on every call and invalidating authenticator app registrations.
**Fix:** Apply the same `_rate_check()` pattern to `/2fa/setup` — limit to 5 attempts per user per hour.
**Impact:** Zero breaking changes.

### 1.7 No CSRF Protection (MEDIUM)
**File:** `backend/app/main.py`, all state-changing routers
**Issue:** POST/DELETE/PUT endpoints have no CSRF token validation. A malicious site can silently perform actions on behalf of an authenticated user.
**Fix:** Add `Origin`/`Referer` header validation middleware for state-changing requests. Reject requests where Origin doesn't match `ALLOWED_ORIGINS`. This is simpler than CSRF tokens and works for cookie-based auth from a known frontend domain.
**Impact:** Dev workflow unaffected (localhost is in ALLOWED_ORIGINS). Production blocks cross-origin form submissions.

### 1.8 Hardcoded Admin Email (LOW)
**File:** `backend/app/routers/auth.py` line ~70, `backend/app/database.py`
**Issue:** `"ken@lumidian.ai"` hardcoded as fallback admin email and as the target for orphaned brand reassignment.
**Fix:** Move to `ADMIN_EMAILS` env var (already exists); remove the hardcoded fallback.
**Impact:** Zero breaking changes if `ADMIN_EMAILS` is set in `.env`.

---

## 2. Performance Fixes (Sprint 1 — Pre-Launch)

### 2.1 No loading.tsx / error.tsx in Next.js App (HIGH)
**Location:** `frontend/app/` — no `loading.tsx` or `error.tsx` files exist anywhere
**Issue:** Every page that fetches data shows a completely blank screen until all API calls resolve. Next.js App Router has built-in `loading.tsx` (automatic Suspense) and `error.tsx` (error boundary) conventions that are entirely unused. On slow connections or API errors, users see nothing with no recovery path.
**Fix:** Add `loading.tsx` with skeleton screens for the 5 main routes: dashboard, content, tracker, results, settings. Add a root `error.tsx` that shows a friendly error with a retry button.
**Impact:** Zero breaking changes — purely additive files.

### 2.2 N+1 Queries in Dashboard / Results Endpoints (HIGH)
**Files:** `backend/app/routers/results.py`, `backend/app/routers/tracking.py`
**Issue:** Fetching a tracking run triggers separate queries for RunModelScore records, QueryResult records, and ContentAttribution records. Each overview load = 3–5 sequential DB round-trips.
**Fix:** Use SQLAlchemy `selectinload()` on the TrackingRun → RunModelScore and TrackingRun → QueryResult relationships to batch-load in 2 queries instead of N+1.
**Impact:** Zero breaking changes — same response shape, just faster.

### 2.3 Missing DB Indexes on High-Traffic Columns (MEDIUM)
**File:** `backend/app/database.py` (run_migrations)
**Issue:** The following high-frequency query patterns have no covering indexes:
- `query_results` filtered by `tracking_run_id` (used on every results page load)
- `content_drafts` filtered by `brand_id + status` (used on content page)
- `tracking_runs` filtered by `brand_id + created_at DESC` (used on dashboard)
- `notifications` filtered by `user_id + read` (used on every page load via notification bell)
**Fix:** Add 4 new `CREATE INDEX IF NOT EXISTS` statements at the bottom of `run_migrations()`.
**Impact:** Purely additive; no breaking changes.

### 2.4 No SQLAlchemy Connection Pool Configuration (MEDIUM)
**File:** `backend/app/database.py`
**Issue:** `create_async_engine()` uses default pool settings (5 connections, 10 overflow). Under any real concurrent load this exhausts immediately.
**Fix:** Set `pool_size=20, max_overflow=40, pool_timeout=30, pool_recycle=1800`.
**Impact:** Zero breaking changes.

### 2.5 Bloated Page Components — No Code Splitting (MEDIUM)
**Files:** `frontend/app/content/page.tsx` (2,911 lines), `frontend/app/dashboard/page.tsx` (1,891 lines)
**Issue:** These files are so large that Next.js cannot code-split them effectively. The entire 2,911-line content page is parsed and executed on load even if the user only views one tab. This increases Time to Interactive significantly.
**Partial fix (Sprint 1):** Extract the tab panels (Drafts, Opportunities, Scheduled, Posted) from `content/page.tsx` into separate component files with `React.lazy()` / dynamic imports. Full decomposition deferred to Sprint 2.
**Impact:** Reduces initial parse time; no behavior change.

---

## 3. UI/UX Fixes (Sprint 1 — minimal set)

### 3.1 No Error Recovery Path (HIGH)
**All pages**
**Issue:** When an API call fails, pages either show nothing or show a stale empty state with no retry mechanism.
**Fix:** The `error.tsx` from fix 2.1 handles route-level crashes. Additionally add inline retry buttons to the 3 main data-fetching hooks in dashboard and content pages.
**Impact:** Zero breaking changes.

### 3.2 Error Messages Not Accessible (MEDIUM)
**All forms**
**Issue:** Form validation errors and API errors show as red text only — not announced to screen readers. No `role="alert"` or `aria-live` regions.
**Fix:** Wrap all error message elements in `<div role="alert">`. AppToast already renders visually; add `aria-live="assertive"` to the toast container.
**Impact:** Zero visual changes; purely additive ARIA attributes.

### 3.3 Color as Sole Model Differentiator (MEDIUM)
**Files:** `frontend/app/dashboard/page.tsx`, `frontend/components/ModelBreakdown.tsx`
**Issue:** The 4 AI model chips (ChatGPT=green, Claude=amber, Perplexity=purple, Gemini=blue) use color alone to distinguish them. Colorblind users cannot tell them apart.
**Fix:** Add a 2–3 letter prefix label (already present as text in `MODEL_CONFIG.label`) — the text is already there, just ensure it's always visible even when space is tight.
**Impact:** Zero breaking changes — text labels already exist, just ensuring they're not hidden.

---

## 4. Test Coverage (Sprint 1 — targeted)

### 4.1 Billing Flow Tests (HIGH)
Add test cases for: checkout session creation with valid/invalid tiers, subscription status webhook (happy path), and `getBillingStatus()` response shape.

### 4.2 Auth Security Path Tests (HIGH)
Add tests for: failed login attempt logging, OAuth state validation, password reset token redemption.

---

## 5. Deferred to Sprint 2 (Post-Launch)

- Full component decomposition of `content/page.tsx` and `dashboard/page.tsx`
- React Query / SWR migration (replace manual `useState`/`useEffect` data fetching)
- SSR/streaming migration for static-safe pages
- Full TOTP test coverage
- Team invite test coverage
- Gap analysis unit tests
- Concurrency/load tests
- Stripe webhook hardening (handled separately)
- Email verification entropy increase
- Redis-backed rate limiting
- Structured logging (structlog/JSON)
- CSP headers
- Backup integrity validation

---

## Execution Order (Sprint 1)

| Priority | Fix | Files | Risk |
|----------|-----|-------|------|
| 1 | Rate store memory cleanup | `auth.py`, `dependencies.py` | None |
| 2 | Auth event logging | `auth.py` | None |
| 3 | Google OAuth open redirect | `auth.py` | Very low |
| 4 | TOTP rate limiting | `auth.py` | None |
| 5 | Prompt injection hardening | `drafting_service.py` | Very low |
| 6 | Password reset token hashing | `auth.py` | Low |
| 7 | CSRF origin check middleware | `main.py` | Low |
| 8 | Hardcoded admin email | `auth.py`, `database.py` | None |
| 9 | DB indexes | `database.py` | None |
| 10 | Connection pool config | `database.py` | None |
| 11 | N+1 query fix (selectinload) | `results.py`, `tracking.py` | Low |
| 12 | `loading.tsx` + `error.tsx` | `frontend/app/` | None |
| 13 | `role="alert"` on error messages | frontend components | None |
| 14 | Dynamic imports in content page | `content/page.tsx` | Low |
