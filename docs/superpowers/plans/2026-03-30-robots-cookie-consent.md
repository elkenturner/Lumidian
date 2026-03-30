# robots.txt + Cookie Consent Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `robots.txt` to block private routes from crawlers, and a slim bottom-bar cookie consent banner that remembers the user's choice in localStorage.

**Architecture:** Two independent additions — a static file drop and a new React client component wired into the root layout. No backend changes. No new dependencies.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, React `useState`/`useEffect`, `localStorage`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/public/robots.txt` | Create | Tell crawlers what to index |
| `frontend/components/CookieConsent.tsx` | Create | Self-contained consent banner component |
| `frontend/app/layout.tsx` | Modify | Mount `<CookieConsent />` in root layout |

> No testing framework is installed in the frontend (`package.json` has no jest or @testing-library). Tasks use manual browser verification instead of automated tests.

---

## Task 1: Create robots.txt

**Files:**
- Create: `frontend/public/robots.txt`

- [ ] **Step 1: Create the public directory if it doesn't exist and write robots.txt**

Create `frontend/public/robots.txt` with this exact content:

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
Disallow: /reset-password
```

> **Implementation note:** `Allow:` directives were intentionally omitted during implementation — anything not explicitly disallowed is crawlable by default, so they are redundant. `/reset-password` was added to prevent password-reset token URLs from being indexed.

- [ ] **Step 2: Verify it's served by Next.js**

Start the dev server if not already running:
```bash
cd frontend && npm run dev
```

Visit `http://localhost:3002/robots.txt` in a browser. Expected: the file contents render as plain text.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/robots.txt
git commit -m "feat: add robots.txt to block private routes from crawlers"
```

---

## Task 2: Create CookieConsent component

**Files:**
- Create: `frontend/components/CookieConsent.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/CookieConsent.tsx` with this exact content:

```tsx
'use client';

import { useState, useEffect } from 'react';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie_consent');
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookie_consent', 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem('cookie_consent', 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 border-t border-[#1e293b] bg-[#0a0a0f] px-6 py-4">
      <p className="text-sm text-[#94a3b8]">
        We use cookies to keep you signed in and the app running.{' '}
        <a href="/privacy" className="underline hover:text-[#e2e8f0] transition-colors">
          Privacy Policy
        </a>
      </p>
      <div className="flex shrink-0 gap-3">
        <button
          onClick={handleDecline}
          className="rounded-md border border-[#1e293b] px-4 py-1.5 text-sm text-[#94a3b8] transition-colors hover:border-[#334155] hover:text-[#e2e8f0]"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="rounded-md bg-[#6366f1] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#4f46e5]"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
```

**Why these values:**
- `bg-[#0a0a0f]` — matches `body` background in `layout.tsx`
- `border-[#1e293b]` — dark border used throughout the app (e.g. AppToast)
- `text-[#94a3b8]` — secondary text color used in AppToast info style
- `bg-[#6366f1]` / `hover:bg-[#4f46e5]` — indigo-500/600, the brand accent color from AppToast
- `z-50` — sits above all content without conflicting with modals (Radix dialogs use z-50 by convention but are portaled to body; cookie bar renders below modals in practice)

- [ ] **Step 2: Commit**

```bash
git add frontend/components/CookieConsent.tsx
git commit -m "feat: add CookieConsent bottom bar component"
```

---

## Task 3: Wire CookieConsent into root layout

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Add the import and component to layout.tsx**

Open `frontend/app/layout.tsx`. Make two changes:

**Add import** (after the existing imports, before the font declarations):
```tsx
import CookieConsent from '@/components/CookieConsent';
```

**Add component** inside `<body>`, after `<AppShell>`:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${firaCode.variable}`}>
      <body className="bg-[#0a0a0f] text-[#e2e8f0] antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
```

Note: `<CookieConsent />` goes **outside** `<AuthProvider>` — it doesn't need auth context and renders on all pages including the login/register pages where auth context would be unauthenticated.

- [ ] **Step 2: Verify in browser**

With dev server running, open a fresh private/incognito window and visit `http://localhost:3002`. Expected:
- Bottom bar appears with the cookie message, a "Decline" ghost button, and an "Accept" indigo button
- Banner sits above page content without covering important UI

- [ ] **Step 3: Test accept flow**

Click "Accept". Expected:
- Banner disappears immediately
- Reload the page — banner does NOT reappear
- Open DevTools → Application → Local Storage → `http://localhost:3002`
- Key `cookie_consent` should have value `"accepted"`

- [ ] **Step 4: Test decline flow**

Open a new incognito window. Click "Decline". Expected:
- Banner disappears
- `cookie_consent` = `"declined"` in LocalStorage
- Banner does not reappear on refresh

- [ ] **Step 5: Test persistence across pages**

Clear localStorage (DevTools → Application → Local Storage → right-click → Clear). Reload.
- Banner appears
- Click Accept
- Navigate to `/login`, `/privacy`, or any other page
- Banner should NOT reappear (localStorage persists across navigation)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: mount CookieConsent banner in root layout"
```
