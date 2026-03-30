# Design: robots.txt + Cookie Consent Banner
**Date:** 2026-03-30
**Status:** Approved

## Scope

Two small production-readiness additions:
1. `robots.txt` — tell crawlers what to index
2. Cookie consent banner — slim bottom bar, GDPR/CCPA informational notice

Out of scope: Sentry, PostHog, sitemap.xml (deferred).
Admin route guards confirmed already implemented correctly — no action needed.

---

## 1. robots.txt

**File:** `frontend/public/robots.txt`

Block all authenticated/app routes. Allow only public marketing/auth pages.

```
User-agent: *
Disallow: /dashboard
Disallow: /admin
Disallow: /account
Disallow: /settings
Disallow: /team
Disallow: /onboarding
Disallow: /brands
Disallow: /tracker
Disallow: /results
Disallow: /content
Disallow: /reports
Disallow: /api/

Allow: /
Allow: /login
Allow: /register
Allow: /forgot-password
Allow: /privacy
Allow: /terms
```

---

## 2. Cookie Consent Banner

### Component
`frontend/components/CookieConsent.tsx` — Next.js client component (`"use client"`).

### Placement
Added to `frontend/app/layout.tsx` inside `<AuthProvider>`, renders on every page.

### Behavior
- On mount: check `localStorage` for key `cookie_consent`
- If absent: show banner
- If present (`"accepted"` or `"declined"`): stay hidden forever
- Accept button: writes `"accepted"` to localStorage, hides banner
- Decline button: writes `"declined"` to localStorage, hides banner
- No analytics gating (no analytics installed yet — purely informational)

### Visual
- Fixed position, bottom of viewport, full width
- Background: `#0a0a0f` (matches app dark theme) with `border-top: 1px solid #1e293b`
- Text: *"We use cookies to keep you signed in and the app running."*
- Two buttons: `Accept` (filled, brand style) and `Decline` (ghost)
- Padding: consistent with app spacing

### State
- `useState<boolean>` for visibility
- `useEffect` for localStorage read on mount
- No external dependencies, no context

---

## Files Changed

| File | Action |
|------|--------|
| `frontend/public/robots.txt` | Create |
| `frontend/components/CookieConsent.tsx` | Create |
| `frontend/app/layout.tsx` | Edit — add `<CookieConsent />` |
