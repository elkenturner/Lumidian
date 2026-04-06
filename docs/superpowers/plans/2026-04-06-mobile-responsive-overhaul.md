# Mobile-Native Responsive Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend feel mobile-native on phones (< 768px) across landing, auth, dashboard, and reports pages — without affecting desktop.

**Architecture:** All changes gated behind `< 768px` media queries or Tailwind mobile-first classes (default = mobile, `md:` = desktop). Shared `useIsMobile` hook extracted from AppShell for JS-gated logic. New `usePullToRefresh` custom hook for gesture support. No new dependencies.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS, existing CSS custom properties.

**Note:** This project has no frontend tests. Each task includes visual verification steps instead of unit tests. Verify in browser DevTools mobile viewport (375x812 iPhone, 390x844 iPhone 14) after each change.

---

### Task 1: Create feature branch and shared mobile hooks

**Files:**
- Create: `frontend/hooks/useIsMobile.ts`
- Create: `frontend/hooks/usePullToRefresh.ts`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feature/mobile-responsive
```

- [ ] **Step 2: Create useIsMobile hook**

Create `frontend/hooks/useIsMobile.ts`:

```typescript
'use client';

import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}
```

- [ ] **Step 3: Create usePullToRefresh hook**

Create `frontend/hooks/usePullToRefresh.ts`:

```typescript
'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 120,
  disabled = false,
}: PullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const pulling = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || refreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [disabled, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || disabled || refreshing) return;
    currentY.current = e.touches[0].clientY;
    const diff = Math.max(0, currentY.current - startY.current);
    const dampened = Math.min(diff * 0.5, maxPull);
    setPullDistance(dampened);
    if (dampened > 0) e.preventDefault();
  }, [disabled, refreshing, maxPull]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(threshold * 0.5);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, refreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { containerRef, pullDistance, refreshing };
}
```

- [ ] **Step 4: Verify hooks compile**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors related to the new hook files.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useIsMobile.ts frontend/hooks/usePullToRefresh.ts
git commit -m "feat: add useIsMobile and usePullToRefresh hooks for mobile support"
```

---

### Task 2: Mobile CSS utilities

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add mobile CSS utilities at the end of globals.css**

Append after the closing `}` of the last `@keyframes slideInRight` block (after line 436):

```css
/* ── Mobile responsive utilities ──────────────────────────────────────────── */

/* Reduce card padding on mobile */
@media (max-width: 767px) {
  .card {
    padding: 16px;
  }
  .card-elevated {
    padding: 16px;
  }
}

/* Touch-friendly tap targets */
@media (max-width: 767px) {
  .touch-target {
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .touch-target-lg {
    min-height: 48px;
    display: flex;
    align-items: center;
  }
}

/* Horizontal scroll hints — fade on right edge */
.scroll-hint-right {
  position: relative;
}
.scroll-hint-right::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 40px;
  background: linear-gradient(to right, transparent, var(--bg-base));
  pointer-events: none;
  z-index: 1;
}

/* Snap scroll container */
.snap-scroll-x {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.snap-scroll-x::-webkit-scrollbar {
  display: none;
}
.snap-scroll-x > * {
  scroll-snap-align: start;
  flex-shrink: 0;
}

/* Pull-to-refresh indicator */
.pull-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.2s ease;
}
.pull-indicator svg {
  transition: transform 0.2s ease;
}

/* Safe area support */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }
}

/* Mobile input zoom prevention */
@media (max-width: 767px) {
  .mobile-input {
    font-size: 16px !important;
  }
}
```

- [ ] **Step 2: Verify CSS compiles**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: add mobile CSS utilities (card padding, touch targets, snap scroll, pull-to-refresh)"
```

---

### Task 3: Viewport meta and safe area insets

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Add viewport-fit=cover to layout**

In `frontend/app/layout.tsx`, add a `viewport` export after the `metadata` export (after line 53). In Next.js 15, the viewport is a separate export:

```typescript
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: add viewport-fit=cover for safe area support on notched phones"
```

---

### Task 4: App Shell — bottom nav and banners

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Add Building2 to lucide imports**

In `frontend/components/AppShell.tsx`, change the import on line 6:

Old:
```typescript
import { LayoutDashboard, LineChart, PenLine, Settings } from 'lucide-react';
```

New:
```typescript
import { LayoutDashboard, LineChart, PenLine, Settings, Building2, ChevronUp } from 'lucide-react';
```

- [ ] **Step 2: Update MOBILE_NAV to 5 tabs**

In `frontend/components/AppShell.tsx`, replace the `MOBILE_NAV` constant (lines 20-25):

Old:
```typescript
const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Settings',  href: '/settings',  icon: Settings },
];
```

New:
```typescript
const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Brands',    href: '/settings',  icon: Building2 },
  { label: 'Reports',   href: '/reports',   icon: LineChart },
  { label: 'Content',   href: '/content',   icon: PenLine },
  { label: 'Settings',  href: '/account',   icon: Settings },
];
```

- [ ] **Step 3: Update bottom margin for taller nav**

In `frontend/components/AppShell.tsx`, change the main element's marginBottom (line 139):

Old:
```typescript
          marginBottom: isMobile ? 56 : 0,
```

New:
```typescript
          marginBottom: isMobile ? 72 : 0,
```

- [ ] **Step 4: Replace bottom nav JSX with mobile-native version**

In `frontend/components/AppShell.tsx`, replace the mobile bottom nav block (lines 221-262):

Old:
```jsx
      {/* Mobile bottom navigation */}
      {isMobile && (
        <nav
          aria-label="Main navigation"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            height: 56,
            background: 'rgba(8,12,20,0.95)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '0 8px',
          }}
        >
          {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  flex: 1,
                  padding: '6px 0',
                  color: isActive ? 'var(--accent-light)' : 'var(--text-faint)',
                  textDecoration: 'none',
                  fontSize: 10,
                  fontWeight: 500,
                }}
              >
                <Icon size={20} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      )}
```

New:
```jsx
      {/* Mobile bottom navigation */}
      {isMobile && (
        <nav
          aria-label="Main navigation"
          className="safe-bottom"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: 'rgba(8,12,20,0.97)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-around',
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  flex: 1,
                  padding: '8px 0',
                  color: isActive ? 'var(--accent-light)' : 'var(--text-faint)',
                  textDecoration: 'none',
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 500,
                  position: 'relative',
                  minHeight: 48,
                }}
              >
                {isActive && (
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 20,
                    height: 2,
                    borderRadius: 1,
                    background: 'var(--accent-light)',
                  }} />
                )}
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.75} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      )}
```

- [ ] **Step 5: Condense status banners on mobile**

In `frontend/components/AppShell.tsx`, replace the `reportRunning` banner block (lines 145-187). Wrap the existing banner content with mobile condensing. Replace the three banner blocks (reportRunning, draftsGenerating, scanning) with a version that uses compact single-line on mobile:

Find the reportRunning banner (starts with `{reportRunning && (`). Replace its `padding` style from `'8px 28px'` to:

```
padding: isMobile ? '6px 12px' : '8px 28px',
```

And change `fontSize: 12` spans to add conditional sizing. For all three banners, update the padding the same way:

For the `reportRunning` banner, change:
```typescript
            padding: '8px 28px',
```
to:
```typescript
            padding: isMobile ? '6px 12px' : '8px 28px',
```

For the `draftsGenerating` banner, change:
```typescript
            padding: '8px 28px',
```
to:
```typescript
            padding: isMobile ? '6px 12px' : '8px 28px',
```

For the `scanning` banner, change:
```typescript
            padding: '8px 28px',
```
to:
```typescript
            padding: isMobile ? '6px 12px' : '8px 28px',
```

Also hide the model scores pills on mobile by wrapping the modelScores block. Find:
```typescript
            {modelScores.length > 0 && (
```
Add `!isMobile &&` before the condition:
```typescript
            {!isMobile && modelScores.length > 0 && (
```

- [ ] **Step 6: Verify in mobile viewport**

Open browser DevTools, set viewport to 375x812 (iPhone). Navigate to `/dashboard`. Verify:
- Bottom nav shows 5 tabs with accent dot indicator on active
- Bottom nav has comfortable spacing, no cramped text
- Status banners (if visible) are compact single-line

- [ ] **Step 7: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat: upgrade mobile bottom nav to 5 tabs, condense status banners"
```

---

### Task 5: Landing page mobile optimization

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Mobile menu — increase tap targets**

In `frontend/app/page.tsx`, find the mobile menu links (lines 314-327). Replace:

```jsx
          <div className="md:hidden py-4 border-t border-[rgba(51,65,85,0.5)]">
            <nav className="flex flex-col gap-4">
              <a href="#features" className="text-sm font-medium text-[#94a3b8] hover:text-white">Features</a>
              <a href="#pricing" className="text-sm font-medium text-[#94a3b8] hover:text-white">Pricing</a>
              <a href="#faq" className="text-sm font-medium text-[#94a3b8] hover:text-white">FAQ</a>
              <div className="flex flex-col gap-2 pt-4 border-t border-[rgba(51,65,85,0.5)]">
                <Link href="/login" className="text-sm font-medium text-white text-center py-2 rounded-full border border-[rgba(255,255,255,0.2)]">
                  Log in
                </Link>
                <Link href="/register" className="text-sm font-semibold text-white text-center py-2.5 rounded-full bg-[#6366f1]">
                  Get Started
                </Link>
              </div>
            </nav>
          </div>
```

With:

```jsx
          <div className="md:hidden py-4 border-t border-[rgba(51,65,85,0.5)]">
            <nav className="flex flex-col gap-1">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[#94a3b8] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">Features</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[#94a3b8] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">Pricing</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-[#94a3b8] hover:text-white py-3 px-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">FAQ</a>
              <div className="flex flex-col gap-3 pt-4 mt-2 border-t border-[rgba(51,65,85,0.5)]">
                <Link href="/login" className="text-base font-medium text-white text-center py-3 rounded-full border border-[rgba(255,255,255,0.2)]">
                  Log in
                </Link>
                <Link href="/register" className="text-base font-semibold text-white text-center py-3.5 rounded-full bg-[#6366f1]">
                  Get Started
                </Link>
              </div>
            </nav>
          </div>
```

- [ ] **Step 2: Hero section — hide mockup on small mobile**

In `frontend/app/page.tsx`, find the `DashboardMockup` wrapper in `HeroSection` (line 397-399):

```jsx
        <ScaleIn delay={400} className="mt-16">
          <DashboardMockup />
        </ScaleIn>
```

Replace with:

```jsx
        <ScaleIn delay={400} className="mt-16 hidden sm:block">
          <DashboardMockup />
        </ScaleIn>
```

- [ ] **Step 3: Features grid — reduce padding on mobile**

In `frontend/app/page.tsx`, find the feature card div (line 464):

```jsx
                <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-7 h-full transition-all duration-200 hover:-translate-y-1 hover:border-[rgba(71,85,105,0.5)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
```

Replace with:

```jsx
                <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-5 md:p-7 h-full transition-all duration-200 hover:-translate-y-1 hover:border-[rgba(71,85,105,0.5)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
```

- [ ] **Step 4: Pricing table — sticky first column on mobile**

In `frontend/app/page.tsx`, find the pricing table header row (line 736-744). Replace the entire `<table>` block:

Find:
```jsx
            <table className="w-full border-collapse">
```

Replace with:
```jsx
            <table className="w-full border-collapse" style={{ minWidth: 500 }}>
```

Then find the Feature `<th>` (line 738):
```jsx
                  <th className="text-left text-sm font-semibold text-[#f8fafc] p-4 rounded-tl-xl">Feature</th>
```

Replace with:
```jsx
                  <th className="text-left text-sm font-semibold text-[#f8fafc] p-3 md:p-4 rounded-tl-xl sticky left-0 bg-[#1e293b] z-10">Feature</th>
```

Also update the feature label `<td>` (line 751):
```jsx
                    <td className="text-sm text-[#f8fafc] p-4">{row.label}</td>
```

Replace with:
```jsx
                    <td className="text-sm text-[#f8fafc] p-3 md:p-4 sticky left-0 z-10" style={{ background: i % 2 === 0 ? '#0f172a' : '#020617' }}>{row.label}</td>
```

- [ ] **Step 5: Stats row — 2x2 on mobile**

In `frontend/app/page.tsx`, find the footer grid (line 887):

```jsx
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
```

This is already `grid-cols-2` on mobile — no change needed. Verify it looks good.

- [ ] **Step 6: FAQ — increase tap target**

In `frontend/app/page.tsx`, find the FAQ button (line 797-798):

```jsx
        <button
          onClick={onToggle}
          className="w-full py-5 flex items-center justify-between text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded"
```

Replace with:

```jsx
        <button
          onClick={onToggle}
          className="w-full py-5 md:py-5 flex items-center justify-between text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded min-h-[48px]"
```

- [ ] **Step 7: Verify in mobile viewport**

Open DevTools at 375x812. Navigate to `/`. Verify:
- Mobile menu has large tap targets
- Hero hides the dashboard mockup on small screens
- Feature cards have comfortable padding
- Pricing table scrolls horizontally with sticky feature labels
- FAQ questions have comfortable tap areas

- [ ] **Step 8: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: optimize landing page for mobile (menu, hero, features, pricing table)"
```

---

### Task 6: Auth pages mobile optimization

**Files:**
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/register/page.tsx`
- Modify: `frontend/app/forgot-password/page.tsx`
- Modify: `frontend/app/reset-password/page.tsx`
- Modify: `frontend/app/verify-email/page.tsx`

All 5 auth pages share the same pattern: `p-6` outer padding, `max-w-[420px]` card, `p-8` inner padding, `py-2.5` inputs, `gap-3.5` form spacing. The changes are identical across all pages.

- [ ] **Step 1: Login page — mobile-friendly inputs and buttons**

In `frontend/app/login/page.tsx`:

Change outer container padding (line 85):
```jsx
    <div className="relative min-h-screen bg-[#020617] text-[#f8fafc] flex items-center justify-center p-6 overflow-hidden">
```
To:
```jsx
    <div className="relative min-h-screen bg-[#020617] text-[#f8fafc] flex items-center justify-center p-4 md:p-6 overflow-hidden">
```

Change logo size (line 97):
```jsx
          <LumidianLogo size={40} withWordmark variant="dark" />
```
To:
```jsx
          <LumidianLogo size={32} withWordmark variant="dark" />
```

Change card padding (line 155):
```jsx
          <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-8">
```
To:
```jsx
          <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-6 md:p-8">
```

Change form gap (line 165):
```jsx
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
```
To:
```jsx
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
```

Change email input (line 174):
```jsx
                  className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-2.5 text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```
To:
```jsx
                  className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```

Change password input (line 186):
```jsx
                    className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-2.5 pr-10 text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```
To:
```jsx
                    className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-3 md:py-2.5 pr-10 text-base md:text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```

Change submit button — find the submit button `className` that has `py-2.5`:
```jsx
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-2.5 px-5 transition-colors"
```
To:
```jsx
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 md:py-2.5 px-5 transition-colors min-h-[48px]"
```

Also change the 2FA card padding (line 102):
```jsx
          <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-8">
```
To:
```jsx
          <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-6 md:p-8">
```

And the 2FA form gap (line 117):
```jsx
            <form onSubmit={handleTotpSubmit} className="flex flex-col gap-3.5">
```
To:
```jsx
            <form onSubmit={handleTotpSubmit} className="flex flex-col gap-4">
```

And the 2FA code input (line 130):
```jsx
                  className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-2.5 text-2xl text-center font-mono text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```
To:
```jsx
                  className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-3 text-3xl md:text-2xl text-center font-mono tracking-[0.3em] text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
```

And 2FA submit button:
```jsx
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-2.5 px-5 transition-colors"
```
To:
```jsx
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 md:py-2.5 px-5 transition-colors min-h-[48px]"
```

- [ ] **Step 2: Register page — same pattern**

In `frontend/app/register/page.tsx`, apply the same changes:

Outer padding (line 57): `p-6` → `p-4 md:p-6`

Logo (line 69): `size={40}` → `size={32}`

Card padding (line 73): `p-8` → `p-6 md:p-8`

Form gap: `gap-3.5` → `gap-4`

All input `className` attributes: `py-2.5` → `py-3 md:py-2.5` and `text-sm` → `text-base md:text-sm`

Submit button: `py-2.5` → `py-3 md:py-2.5` and add `min-h-[48px]`

- [ ] **Step 3: Forgot password page — same pattern**

In `frontend/app/forgot-password/page.tsx`:

Outer padding (line 42): `p-6` → `p-4 md:p-6`

Logo (line 53): `size={40}` → `size={32}`

Card padding (line 58): `p-8` → `p-6 md:p-8`

Form gap (line 87): `gap-3.5` → `gap-4`

Input: add `py-3 md:py-2.5` and `text-base md:text-sm`

Submit button: add `py-3 md:py-2.5` and `min-h-[48px]`

- [ ] **Step 4: Reset password page — same pattern**

In `frontend/app/reset-password/page.tsx`:

Outer padding (line 63): `p-6` → `p-4 md:p-6`

Logo (line 74): `size={40}` → `size={32}`

Card padding (line 79): `p-8` → `p-6 md:p-8`

All inputs: `py-2.5` → `py-3 md:py-2.5` and `text-sm` → `text-base md:text-sm`

Submit button: `py-2.5` → `py-3 md:py-2.5` and add `min-h-[48px]`

- [ ] **Step 5: Verify email page — same pattern**

In `frontend/app/verify-email/page.tsx`:

Outer padding (line 60): `p-6` → `p-4 md:p-6`

Logo (line 71): `size={40}` → `size={32}`

Card padding (line 76): `p-8` → `p-6 md:p-8`

Verification code input (line 110): change `text-2xl` to `text-3xl md:text-2xl` and add `tracking-[0.3em]`

Submit button: add `py-3 md:py-2.5` and `min-h-[48px]`

- [ ] **Step 6: Verify in mobile viewport**

Open DevTools at 375x812. Navigate to `/login`, `/register`, `/forgot-password`, `/verify-email`. Verify:
- Cards have comfortable padding, no cramped edges
- Inputs are tall enough for thumb tapping (48px)
- Text is 16px (no iOS zoom on focus)
- Buttons are full-width and 48px tall
- 2FA code input is large with generous spacing

- [ ] **Step 7: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/register/page.tsx frontend/app/forgot-password/page.tsx frontend/app/reset-password/page.tsx frontend/app/verify-email/page.tsx
git commit -m "feat: optimize auth pages for mobile (48px inputs, 16px font, full-width buttons)"
```

---

### Task 7: Dashboard mobile layout

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Add useIsMobile import**

At the top of `frontend/app/dashboard/page.tsx`, add after the existing imports (after line 77):

```typescript
import { useIsMobile } from '@/hooks/useIsMobile';
```

Then inside the `DashboardPage` component, after `const { user } = useAuth();` (after line 406), add:

```typescript
  const isMobile = useIsMobile();
```

- [ ] **Step 2: Header — stack action buttons on mobile**

Find the header actions area (lines 925-982). Replace:

```jsx
        <div className="flex items-center gap-2 sm:gap-3">
```

With:

```jsx
        <div className={`flex ${isMobile ? 'flex-col w-full' : 'items-center'} gap-2 sm:gap-3`}>
```

Then wrap the Prompts + Refresh buttons in a row and make Run Report full-width. Find the `<button` for Prompts (line 926-932) and the Refresh button next to it. Wrap them:

Replace lines 926-940 (the Prompts button, Refresh button, and the flex-col div containing Run Report):

```jsx
          <button
            onClick={() => setPromptModalOpen(true)}
            disabled={!selectedBrandId}
            className="flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 text-xs transition-all duration-150"
          >
            <MessageSquare size={14} />
            Prompts
          </button>
          <button
            onClick={() => selectedBrandId && loadData(selectedBrandId)}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-all duration-150"
          >
            <RefreshCw size={14} />
          </button>
          <div className="flex flex-col items-end gap-1">
```

With:

```jsx
          <div className={`flex ${isMobile ? 'w-full' : ''} items-center gap-2`}>
            <button
              onClick={() => setPromptModalOpen(true)}
              disabled={!selectedBrandId}
              className={`flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 text-xs transition-all duration-150 ${isMobile ? 'flex-1 justify-center min-h-[44px]' : ''}`}
            >
              <MessageSquare size={14} />
              Prompts
            </button>
            <button
              onClick={() => selectedBrandId && loadData(selectedBrandId)}
              aria-label="Refresh dashboard"
              className={`flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-all duration-150 ${isMobile ? 'min-h-[44px]' : ''}`}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className={`flex flex-col ${isMobile ? 'w-full' : 'items-end'} gap-1`}>
```

Then update the Run Report button to be full-width on mobile. Find its className (line 946-950) and add `${isMobile ? 'w-full justify-center' : ''}` to the className string.

- [ ] **Step 3: Quick stats — horizontal scroll on mobile**

Find the quick stats grid (line 1081):

```jsx
                <div className="grid grid-cols-3 gap-3 mb-4">
```

Replace with:

```jsx
                <div className={isMobile ? 'snap-scroll-x gap-3 mb-4 -mx-4 px-4' : 'grid grid-cols-3 gap-3 mb-4'}>
```

Then for each stat card inside, add a min-width on mobile. Find the stat card div (line 1089):

```jsx
                      className="bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-xl px-4 py-4 flex items-center gap-3"
```

Replace with:

```jsx
                      className={`bg-[var(--accent-muted)] border border-[var(--accent-border)] rounded-xl px-4 py-4 flex items-center gap-3 ${isMobile ? 'min-w-[160px]' : ''}`}
```

- [ ] **Step 4: Visibility score — reduce font size on mobile**

Find the score text (line 1124):

```jsx
                          <p className="text-6xl font-bold text-[var(--text-primary)] mt-1 leading-none">
```

Replace with:

```jsx
                          <p className="text-5xl md:text-6xl font-bold text-[var(--text-primary)] mt-1 leading-none">
```

- [ ] **Step 5: Live/Index sub-scores — fix mobile layout**

Find the 108px left padding on the model names line (line 1183):

```jsx
                          <p className="text-[9px] text-[var(--text-faint)] pl-[108px] truncate">{models}</p>
```

Replace with:

```jsx
                          <p className="text-[9px] text-[var(--text-faint)] pl-[88px] md:pl-[108px] truncate">{models}</p>
```

And the label width (line 1172):

```jsx
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="text-[11px] font-medium text-[var(--text-muted)] truncate">{label}</span>
                            </div>
```

The wrapping div is `w-24` — change to responsive:

Find:
```jsx
                            <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
```

Replace with:
```jsx
                            <div className="flex items-center gap-1.5 w-20 md:w-24 flex-shrink-0">
```

- [ ] **Step 6: Right column — stack on mobile**

Find the main 2-column grid (line 1111):

```jsx
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
```

This is already `grid-cols-1` on mobile — good. But the inner right column has `grid-cols-2` for Best Prompt + Sentiment (line 1204):

```jsx
                  <div className="grid grid-cols-2 gap-3">
```

Replace with:

```jsx
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
```

- [ ] **Step 7: Row 2 — Avg Position + Top Domains stack on mobile**

Find (line 1302):

```jsx
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
```

This is already `grid-cols-1` on mobile — good. But the donut chart needs width adjustment. Find the donut container (around the `DonutDomains` component, line 1339):

```jsx
                <div className="lg:col-span-2 card p-5 flex flex-col">
```

This already spans full width on mobile. The donut inside uses `width: 110, height: 110` which is fine.

- [ ] **Step 8: Competitor grid — single column on mobile**

Find (line 1274):

```jsx
                        <div className={`grid gap-3 ${count <= 2 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
```

Replace with:

```jsx
                        <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : count <= 2 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
```

- [ ] **Step 9: Conversations — mobile-friendly badges**

Find the conversation badges area (lines 1464-1471):

```jsx
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <Badge style={{ backgroundColor: mc.bg, color: mc.text, borderColor: 'transparent' }}>
                                  {label}
                                </Badge>
                                <Badge variant={conv.mentioned ? "success" : "secondary"}>
                                  {conv.mentioned ? 'Mentioned' : 'Not mentioned'}
                                </Badge>
                                <ChevronDown
```

Replace with:

```jsx
                              <div className={`flex items-center gap-1.5 flex-shrink-0 ${isMobile ? 'flex-wrap' : ''}`}>
                                <Badge style={{ backgroundColor: mc.bg, color: mc.text, borderColor: 'transparent' }}>
                                  {label}
                                </Badge>
                                {!isMobile && (
                                  <Badge variant={conv.mentioned ? "success" : "secondary"}>
                                    {conv.mentioned ? 'Mentioned' : 'Not mentioned'}
                                  </Badge>
                                )}
                                <ChevronDown
```

- [ ] **Step 10: Verify in mobile viewport**

Open DevTools at 375x812. Navigate to `/dashboard`. Verify:
- Header stacks actions below brand name
- Run Report button is full-width
- Quick stats scroll horizontally with snap
- Score is readable (not overflowing)
- Best Prompt and Sentiment stack vertically
- Competitor bars are single column
- Conversations don't overflow

- [ ] **Step 11: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat: mobile-native dashboard layout (snap-scroll stats, stacked cards, touch-friendly)"
```

---

### Task 8: Reports page mobile layout

**Files:**
- Modify: `frontend/app/reports/page.tsx`

- [ ] **Step 1: Add useIsMobile import**

At the top of `frontend/app/reports/page.tsx`, add after existing imports:

```typescript
import { useIsMobile } from '@/hooks/useIsMobile';
```

Then inside the component function, add after the brand context hooks:

```typescript
  const isMobile = useIsMobile();
```

- [ ] **Step 2: Header — stack export buttons on mobile**

Find the header actions (lines 289-339). Replace:

```jsx
        <div className="flex items-center gap-3">
```

With:

```jsx
        <div className={`flex ${isMobile ? 'flex-col w-full' : 'items-center'} gap-2 md:gap-3`}>
```

Then for the PDF/CSV button row, wrap them in a full-width container on mobile. Find the button group `<div className="flex items-center gap-1">` (line 301) and add:

```jsx
        <div className={`flex items-center gap-1 ${isMobile ? 'w-full' : ''}`}>
```

Make each export button flex-1 on mobile by adding `${isMobile ? 'flex-1 justify-center min-h-[44px]' : ''}` to their className strings.

- [ ] **Step 3: Score breakdown — single column on mobile**

Find (line 436):

```jsx
                <div className="grid grid-cols-2 gap-4">
```

Replace with:

```jsx
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
```

- [ ] **Step 4: Search and sort controls — stack on mobile**

Find the search/sort wrapper (line 398):

```jsx
            <div className="flex flex-wrap items-center gap-2 mb-3">
```

Replace with:

```jsx
            <div className={`flex ${isMobile ? 'flex-col' : 'flex-wrap items-center'} gap-2 mb-3`}>
```

- [ ] **Step 5: Add scroll hint to response tables**

Find any `overflow-x-auto` wrapper in the reports page. If the page uses tables with horizontal scroll, wrap them with the `scroll-hint-right` class:

```jsx
              <div className="overflow-x-auto scroll-hint-right">
```

- [ ] **Step 6: Verify in mobile viewport**

Open DevTools at 375x812. Navigate to `/reports`. Verify:
- Export buttons stack or fill width properly
- Score breakdown is single column
- Search/sort controls stack vertically
- Tables have scroll hint gradient

- [ ] **Step 7: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "feat: mobile-optimized reports page (stacked controls, scroll hints, responsive grids)"
```

---

### Task 9: Pull-to-refresh on dashboard

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Import the hook**

In `frontend/app/dashboard/page.tsx`, add to imports:

```typescript
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
```

And add `Loader2` to the lucide import if not already present (it is — at line 17).

- [ ] **Step 2: Wire up the hook**

Inside `DashboardPage`, after the `isMobile` line, add:

```typescript
  const handlePullRefresh = useCallback(async () => {
    if (selectedBrandId) await loadData(selectedBrandId);
  }, [selectedBrandId, loadData]);

  const { containerRef: pullRef, pullDistance, refreshing: pullRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    disabled: !isMobile || !selectedBrandId,
  });
```

- [ ] **Step 3: Wrap the page content with the pull container**

Find the outermost `<div>` of the return statement (line 817):

```jsx
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl">
```

Replace with:

```jsx
    <div ref={isMobile ? pullRef : undefined} className="px-4 sm:px-8 py-6 sm:py-8 max-w-7xl" style={isMobile ? { overflowY: 'auto', minHeight: '100vh' } : undefined}>
      {/* Pull-to-refresh indicator */}
      {isMobile && (pullDistance > 0 || pullRefreshing) && (
        <div
          className="pull-indicator -mx-4 mb-2"
          style={{ height: pullDistance > 0 ? pullDistance : 40 }}
        >
          <Loader2
            size={18}
            className={pullRefreshing ? 'animate-spin' : ''}
            style={{
              color: 'var(--accent)',
              transform: `rotate(${pullDistance * 3}deg)`,
              opacity: Math.min(pullDistance / 60, 1),
            }}
          />
        </div>
      )}
```

Then the closing `</div>` at the very end of the component return remains unchanged.

- [ ] **Step 4: Verify pull-to-refresh**

Open DevTools at 375x812, enable touch simulation. Navigate to `/dashboard`. Pull down from the top of the page. Verify:
- Spinner appears and rotates as you pull
- Releasing above threshold triggers a data refresh
- Spinner animates during refresh, disappears when done

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat: add pull-to-refresh gesture on dashboard (mobile only)"
```

---

### Task 10: Final verification and cleanup

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit --pretty 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint 2>&1 | tail -10
```

Expected: No new lint errors.

- [ ] **Step 4: Desktop regression check**

Open browser at full desktop width (1440px). Navigate through:
- `/` (landing page)
- `/login`
- `/dashboard`
- `/reports`

Verify everything looks identical to before the changes.

- [ ] **Step 5: Mobile verification checklist**

Set viewport to 375x812 (iPhone SE / 13 mini). Navigate through each page:

| Page | Check |
|------|-------|
| `/` | Hero readable, mockup hidden, menu has large targets, pricing scrolls with sticky labels |
| `/login` | Inputs 48px, 16px font, full-width button, card not cramped |
| `/register` | Same as login |
| `/forgot-password` | Same as login |
| `/verify-email` | Large code input with letter spacing |
| `/dashboard` | Stats scroll, score readable, cards stacked, pull-to-refresh works |
| `/reports` | Controls stacked, grids single-column, scroll hints on tables |
| Bottom nav | 5 tabs visible, active indicator dot, comfortable tap targets |
| Status banners | Compact on mobile, no overflow |

- [ ] **Step 6: Test at 390x844 (iPhone 14)**

Repeat the above checklist at 390x844 viewport.

- [ ] **Step 7: Commit any final fixes**

If any issues found, fix and commit:

```bash
git add -A
git commit -m "fix: mobile responsive polish from verification pass"
```
