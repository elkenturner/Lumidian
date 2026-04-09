# E2E Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 20 issues identified in the production E2E audit — pricing discrepancies, LLM leak, dashboard state bug, broken logos, Gemini timeouts, and 15 more UX/polish issues.

**Architecture:** All fixes are isolated edits to existing files — no new files needed. Frontend fixes are in Next.js React components; backend fixes are in FastAPI services/routers. Each task is independent and can be worked in any order.

**Tech Stack:** Next.js 15 / React 18 / TypeScript / Tailwind CSS (frontend), Python 3.11 / FastAPI / SQLAlchemy (backend)

---

### Task 1: Fix Pricing Discrepancies (Landing Page vs Billing Page)

**Files:**
- Modify: `frontend/app/page.tsx:205-222` (COMPARISON_FEATURES array)

The billing page (`frontend/app/settings/billing/page.tsx:10-35`) is the source of truth. The landing page `COMPARISON_FEATURES` array has wrong values. Align landing page to match billing.

- [ ] **Step 1: Fix the COMPARISON_FEATURES array**

In `frontend/app/page.tsx`, replace lines 205-222:

```typescript
const COMPARISON_FEATURES = [
  { label: 'Standard brands', free: '0', starter: '1', pro: '2' },
  { label: 'Pitch decks', free: '1', starter: '1', pro: '3' },
  { label: 'Prompts per brand', free: '10', starter: '25', pro: '100' },
  { label: 'Manual runs per day', free: '1', starter: '3', pro: 'Unlimited' },
  { label: 'AI models monitored', free: '4', starter: '4', pro: '4' },
  { label: 'Daily tracking', free: true, starter: true, pro: true },
  { label: 'Visibility score & report', free: true, starter: true, pro: true },
  { label: 'Content Hub & drafting', free: false, starter: true, pro: true },
  { label: 'Custom draft requests', free: '—', starter: '10/week', pro: '25/week' },
  { label: 'Gap analysis', free: false, starter: true, pro: true },
  { label: 'Brand profile & voice', free: false, starter: true, pro: true },
  { label: 'Reddit scanner', free: false, starter: true, pro: true },
  { label: 'Trend charts', free: false, starter: true, pro: true },
  { label: 'Email alerts', free: false, starter: true, pro: true },
  { label: 'Team members', free: '—', starter: '1', pro: '3' },
  { label: 'Support', free: 'Community', starter: 'Email', pro: 'Priority' },
];
```

Changes from current:
- `Standard brands`: starter `'2'` → `'1'`, pro `'2'` stays
- `Manual runs per day`: starter `'Unlimited'` → `'3'`, pro stays `'Unlimited'`
- `Team members`: starter `'2'` → `'1'`, pro `'Unlimited'` → `'3'`

- [ ] **Step 2: Verify visually**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "fix: align landing page pricing table with actual billing tier limits"
```

---

### Task 2: Fix LLM Refusal Text Leaking to Users

**Files:**
- Modify: `backend/app/routers/brand_profile.py:209-224` (AI fill prompt)
- Modify: `frontend/app/onboarding/page.tsx:60-62` (description handling)

Two-part fix: (a) improve the backend prompt to never refuse, (b) add frontend guard to filter obvious refusal patterns.

- [ ] **Step 1: Update the AI fill prompt to prevent refusals**

In `backend/app/routers/brand_profile.py`, replace the prompt string at lines 209-224:

```python
    prompt = f"""You are a brand analyst. Based on the website content below, extract structured brand profile information for the brand "{brand.name}".

IMPORTANT: Always generate a description based on the website content provided, even if the brand name doesn't exactly match the website. Use the website content to describe what the company does.

Website content:
---
{context[:8000]}
---

Return a JSON object with exactly these keys (use null for anything you cannot determine):
{{
  "company_description": "2-3 sentence description of what the company does based on the website content, its products/services, and what makes it unique",
  "target_audience": "1-2 sentence description of who the primary customers/users are",
  "tone_of_voice": "1-2 sentence description of the brand's communication style and personality",
  "key_stats": ["list", "of", "up to 5 specific facts, numbers, or claims found on the site"]
}}

Return ONLY the JSON object, no markdown, no explanation. Never refuse or explain why you cannot generate a description — always produce your best answer from the content."""
```

- [ ] **Step 2: Add frontend guard for LLM refusal patterns in onboarding**

In `frontend/app/onboarding/page.tsx`, after line 62 where `setCompanyDescription` is called, add a filter:

Replace:
```typescript
      if (result.description) setCompanyDescription(result.description);
```

With:
```typescript
      if (result.description) {
        const refusalPatterns = /^(I cannot|I can't|I'm unable|I am unable|I don't have|Sorry,|Unfortunately,)/i;
        if (!refusalPatterns.test(result.description.trim())) {
          setCompanyDescription(result.description);
        }
      }
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/brand_profile.py frontend/app/onboarding/page.tsx
git commit -m "fix: prevent LLM refusal text from leaking into brand profile descriptions"
```

---

### Task 3: Fix Dashboard State During Active Run on Page Reload

**Files:**
- Modify: `frontend/app/dashboard/page.tsx:1063` (empty state condition)

The issue: on page reload, `overview?.latest_run` can be `null` before the overview API response arrives, briefly showing the "No data yet" empty state even when a run is active. The condition needs to also account for loading states.

- [ ] **Step 1: Fix the empty state guard**

In `frontend/app/dashboard/page.tsx`, replace line 1063:

```typescript
          {!loadingBrands && !loadingAnalytics && !isRunning && selectedBrandId && trends.length === 0 && overview?.latest_run == null && (
```

With:

```typescript
          {!loadingBrands && !loadingAnalytics && !isRunning && selectedBrandId && trends.length === 0 && overview !== null && overview?.latest_run == null && (
```

Adding `overview !== null` ensures we don't show the empty state while the overview API is still loading (overview starts as null before the fetch completes).

- [ ] **Step 2: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "fix: don't show empty state while dashboard data is still loading"
```

---

### Task 4: Replace Clearbit Logo Service with Google Favicons

**Files:**
- Modify: `frontend/components/BrandAvatar.tsx:40-58` (logo URL logic)

Clearbit's logo API (`logo.clearbit.com`) is defunct. Replace the cascade to skip Clearbit entirely and go straight to Google Favicons.

- [ ] **Step 1: Remove Clearbit, use Google Favicons as primary**

In `frontend/components/BrandAvatar.tsx`, replace lines 40-58:

```typescript
type ImgState = 'favicon' | 'initial';

export default function BrandAvatar({
  name,
  websiteUrl,
  size = 24,
  className = '',
  style,
  textClassName = '',
  textStyle,
}: BrandAvatarProps) {
  const domain = getDomain(websiteUrl);
  const [imgState, setImgState] = useState<ImgState>(domain ? 'favicon' : 'initial');

  const logoUrl = domain && imgState === 'favicon'
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.min(size * 2, 128)}`
    : null;
```

Then update the `onError` handler at line 74-77:

Replace:
```typescript
            onError={(e) => {
              e.nativeEvent.stopImmediatePropagation();
              setImgState((s) => s === 'clearbit' ? 'google' : 'initial');
            }}
```

With:
```typescript
            onError={(e) => {
              e.nativeEvent.stopImmediatePropagation();
              setImgState('initial');
            }}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/BrandAvatar.tsx
git commit -m "fix: replace defunct Clearbit logo service with Google Favicons"
```

---

### Task 5: Reduce Gemini Timeout and Retries

**Files:**
- Modify: `backend/app/services/llm_service.py:275` (timeout value)
- Modify: `backend/app/services/llm_service.py:335` (max_attempts default)

30s timeout × 3 retries = 90s per prompt worst case. Reduce to 20s × 2 retries = 40s max.

- [ ] **Step 1: Reduce Gemini timeout to 20s**

In `backend/app/services/llm_service.py`, replace line 275:

```python
            timeout=30.0,  # 30s timeout to avoid hanging
```

With:

```python
            timeout=20.0,  # 20s timeout — reduce from 30s to limit cascade delays
```

- [ ] **Step 2: Reduce default retries from 3 to 2**

In `backend/app/services/llm_service.py`, replace line 335:

```python
async def _with_retry(handler, prompt: str, brand_name: str, model_key: str, max_attempts: int = 3, model_version: str = "") -> dict:
```

With:

```python
async def _with_retry(handler, prompt: str, brand_name: str, model_key: str, max_attempts: int = 2, model_version: str = "") -> dict:
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/llm_service.py
git commit -m "fix: reduce Gemini timeout (30s→20s) and retries (3→2) to prevent cascade delays"
```

---

### Task 6: Add Skip Option to Onboarding Website Fetch

**Files:**
- Modify: `frontend/app/onboarding/page.tsx:50-70` (handleStep1 logic)
- Modify: `frontend/app/onboarding/page.tsx:~240` (Step 1 UI buttons)

When the fetch fails, show a "Skip" button that proceeds to step 2 without website context.

- [ ] **Step 1: Add skip handler and modify error state**

In `frontend/app/onboarding/page.tsx`, after the `handleStep1` function (after line 70), add:

```typescript
  function handleSkipFetch() {
    setError('');
    setStep(2);
  }
```

- [ ] **Step 2: Add Skip button to the UI when there's an error**

In `frontend/app/onboarding/page.tsx`, find the "Fetch & Continue" button (around line 240). After the button, add a conditional skip link when there's an error:

Replace the existing button-only section with:

```tsx
        <button
          onClick={handleStep1}
          disabled={!brandName.trim() || !websiteUrl.trim() || fetching}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg py-3 text-sm font-semibold transition-colors"
        >
          {fetching ? (
            <><Loader2 size={14} className="inline animate-spin mr-2" />Fetching website...</>
          ) : 'Fetch & Continue'}
        </button>
        {error && (
          <button
            onClick={handleSkipFetch}
            className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] py-2 transition-colors"
          >
            Skip — continue without website data
          </button>
        )}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/onboarding/page.tsx
git commit -m "fix: add skip option when onboarding website fetch fails"
```

---

### Task 7: Fix Sidebar "Brands" Label and Link

**Files:**
- Modify: `frontend/components/Sidebar.tsx:115` (nav item)

The sidebar item labeled "Brands" links to `/settings`. Since `settings` is the brand configuration page, rename the label to "Settings" (matching the page title) and use the Settings icon it already has.

- [ ] **Step 1: Rename the nav label**

In `frontend/components/Sidebar.tsx`, replace line 115:

```typescript
    { label: 'Brands',      href: '/settings',  icon: Settings },
```

With:

```typescript
    { label: 'Settings',    href: '/settings',  icon: Settings },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/Sidebar.tsx
git commit -m "fix: rename sidebar 'Brands' to 'Settings' to match page title"
```

---

### Task 8: Remove Dead case-study-eligible API Call

**Files:**
- Modify: `frontend/app/reports/page.tsx:194` (remove call)
- Modify: `frontend/lib/api.ts:1082-1084` (remove function)

The frontend calls `/reports/{brandId}/case-study-eligible` which doesn't exist in the backend, generating a 404.

- [ ] **Step 1: Remove the API call from reports page**

In `frontend/app/reports/page.tsx`, find line 194:

```typescript
      getCaseStudyEligibility(brandId).then(setCaseStudyEligibility).catch(() => {});
```

Delete this line entirely.

Also remove the import at line 25:
```typescript
  getCaseStudyEligibility,
```

And remove the state variable for it — search for `setCaseStudyEligibility` and `caseStudyEligibility` and remove the `useState` declaration and any UI that references it.

- [ ] **Step 2: Remove the dead API function**

In `frontend/lib/api.ts`, delete lines 1082-1084:

```typescript
export async function getCaseStudyEligibility(brandId: number): Promise<CaseStudyEligibility> {
  const res = await api.get<CaseStudyEligibility>(`/reports/${brandId}/case-study-eligible`);
  return res.data;
}
```

Also find and remove the `CaseStudyEligibility` type definition if it exists.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds. No TypeScript errors about missing references.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/reports/page.tsx frontend/lib/api.ts
git commit -m "fix: remove dead case-study-eligible API call that 404s"
```

---

### Task 9: Add 2FA Setup to Account Page

**Files:**
- Modify: `frontend/app/account/page.tsx` (security section)

The backend already supports TOTP 2FA. Add a button/section to enable it. Check what API endpoints exist first.

- [ ] **Step 1: Check existing 2FA backend endpoints**

Run: `grep -n "totp\|2fa\|two.factor" backend/app/routers/auth.py`

Identify the enable-2fa and verify-2fa endpoints.

- [ ] **Step 2: Add 2FA toggle UI to Account page security section**

In `frontend/app/account/page.tsx`, find the security section (around line 155-192) where "Email verification enabled" is shown. After the "Change password" button, add:

```tsx
              {!user?.totp_enabled ? (
                <button
                  onClick={() => router.push('/account/security')}
                  className="flex items-center gap-2 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  <Shield size={13} />
                  Enable two-factor authentication
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                  <CheckCircle2 size={13} />
                  Two-factor authentication enabled
                </div>
              )}
```

Note: If there's no `/account/security` page, the 2FA setup flow may need a modal instead. Check existing patterns in the codebase and adapt.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/account/page.tsx
git commit -m "feat: add 2FA status and setup link to account security section"
```

---

### Task 10: Add Name Editing to Account Page

**Files:**
- Modify: `frontend/app/account/page.tsx` (profile section)

- [ ] **Step 1: Check if a name update API endpoint exists**

Run: `grep -n "name\|profile\|update_user" backend/app/routers/auth.py backend/app/routers/accounts.py 2>/dev/null | head -20`

- [ ] **Step 2: Add inline name editing**

In `frontend/app/account/page.tsx`, find where the user name is displayed (the `QA Test User` text). Wrap it in an editable field pattern:

```tsx
const [editingName, setEditingName] = useState(false);
const [nameValue, setNameValue] = useState(user?.name || '');

// In the render, replace static name display with:
{editingName ? (
  <div className="flex items-center gap-2">
    <input
      value={nameValue}
      onChange={(e) => setNameValue(e.target.value)}
      className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
      autoFocus
    />
    <button onClick={handleSaveName} className="text-xs text-[var(--accent)]">Save</button>
    <button onClick={() => setEditingName(false)} className="text-xs text-[var(--text-muted)]">Cancel</button>
  </div>
) : (
  <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
    {user?.name}
    <button onClick={() => { setNameValue(user?.name || ''); setEditingName(true); }} className="text-[var(--text-faint)] hover:text-[var(--text-muted)]">
      <Pencil size={12} />
    </button>
  </p>
)}
```

Note: Adapt this based on whether a name-update API exists. If it doesn't, add a simple PATCH endpoint on the backend.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/account/page.tsx
git commit -m "feat: add inline name editing to account page"
```

---

### Task 11: Fix Reports "Not Yet Tracked" Text During Active Run

**Files:**
- Modify: `frontend/app/reports/page.tsx:666-669` (untracked prompt text)

- [ ] **Step 1: Make the text context-aware**

In `frontend/app/reports/page.tsx`, replace lines 664-669. The component needs access to whether a run is currently in progress. Find the `isRunning` or `latestRunStatus` variable in the component, then update:

```tsx
                {untrackedPrompts.map((p) => (
                  <div key={`untracked-${p.id}`} className="px-5 py-4">
                    <div className="flex items-start gap-3 mb-2">
                      <p className="text-sm text-[var(--text-muted)] leading-snug font-medium flex-1">{p.text}</p>
                      <Badge variant="secondary" className="flex-shrink-0">
                        {runInProgress ? 'Tracking now...' : 'Not yet tracked'}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-faint)]">
                      {runInProgress ? 'Currently being queried across AI models.' : 'Will be included in your next report run.'}
                    </p>
                  </div>
                ))}
```

Where `runInProgress` is derived from the latest run status. Check how the reports page gets run status and use that boolean.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "fix: show 'Tracking now...' for prompts when a run is in progress"
```

---

### Task 12: Fix Platform Name Capitalization in Content Hub

**Files:**
- Modify: `frontend/app/content/page.tsx:880` (DRAFT_PLATFORMS constant)

- [ ] **Step 1: Add a display name map**

The platform keys need to stay lowercase (they're used as API identifiers), but the display names should be capitalized. Find where platform names are rendered in the toggle UI (around lines 2081-2149) and add a display name map:

In `frontend/app/content/page.tsx`, near the `DRAFT_PLATFORMS` constant at line 880, add:

```typescript
const PLATFORM_DISPLAY: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
  linkedin: 'LinkedIn',
  x: 'X',
};
```

Then find every place where platform names are displayed in the UI and replace raw platform strings with `PLATFORM_DISPLAY[platform] || platform`.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "fix: capitalize platform names consistently in Content Hub"
```

---

### Task 13: Fix Content Hub Draft Counter for Free Tier

**Files:**
- Modify: `frontend/app/content/page.tsx` (draft/scheduled counters)

- [ ] **Step 1: Find the counter display**

Search for `0/20` or the draft limit display in the content page. The counters should reflect the user's actual tier limit instead of hardcoded 20. Check if the counter value comes from an API response or is hardcoded.

Run: `grep -n "0/20\|draftLimit\|draft_limit\|/20" frontend/app/content/page.tsx`

- [ ] **Step 2: Make counters tier-aware**

If hardcoded, replace with tier-specific values from the user's subscription data or API response. The free tier should show the auto-generated draft limit, not 20.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/content/page.tsx
git commit -m "fix: show tier-appropriate draft limits in Content Hub counters"
```

---

### Task 14: Fix Landing Page Dashboard Preview (0% values)

**Files:**
- Modify: `frontend/app/page.tsx:551-554` (DashboardMockup animated values)

- [ ] **Step 1: Change the animated target values**

In `frontend/app/page.tsx`, replace lines 552-554:

```typescript
  const { ref: scoreRef, value: scoreVal } = useCountUp(67, 1600);
  const { ref: liveRef, value: liveVal } = useCountUp(66, 1400);
  const { ref: indexRef, value: indexVal } = useCountUp(67, 1400);
```

With:

```typescript
  const { ref: scoreRef, value: scoreVal } = useCountUp(67, 1600);
  const { ref: liveRef, value: liveVal } = useCountUp(72, 1400);
  const { ref: indexRef, value: indexVal } = useCountUp(61, 1400);
```

This makes Live Search (72%) and AI Index (61%) show non-zero demo values that differ from each other, looking realistic.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "fix: show realistic non-zero values in landing page dashboard preview"
```

---

### Task 15: Fix Prompts Modal Generic Placeholder

**Files:**
- Modify: `frontend/components/ManagePromptsModal.tsx:139` (placeholder text)

- [ ] **Step 1: Make the placeholder use the brand name**

The modal receives the brand name as a prop (or can access it from context). Update the placeholder to be dynamic.

In `frontend/components/ManagePromptsModal.tsx`, replace line 139:

```typescript
              placeholder="e.g. What is the best tool for early cancer detection?"
```

With:

```typescript
              placeholder={`e.g. What is the best ${brandName || 'product'} alternative?`}
```

Ensure `brandName` is available — check the component's props and add it if needed.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ManagePromptsModal.tsx
git commit -m "fix: use brand-relevant placeholder in prompts modal"
```

---

### Task 16: Add Back-to-Dashboard Link in Onboarding

**Files:**
- Modify: `frontend/app/onboarding/page.tsx` (bottom of step 1 UI)

- [ ] **Step 1: Add escape hatch link**

In `frontend/app/onboarding/page.tsx`, after the "Fetch & Continue" button in Step 1 (and after the skip button from Task 6), add:

```tsx
        <Link
          href="/dashboard"
          className="text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors mt-2 inline-block"
        >
          ← Back to dashboard
        </Link>
```

Add `import Link from 'next/link'` at the top if not already imported.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/onboarding/page.tsx
git commit -m "fix: add back-to-dashboard link in onboarding wizard"
```

---

### Task 17: Improve Login 403 Error Handling for Unverified Users

**Files:**
- Modify: `backend/app/routers/auth.py` (login endpoint)

- [ ] **Step 1: Find the login endpoint's unverified user handling**

Run: `grep -n "email_verified\|403\|verify" backend/app/routers/auth.py | head -20`

Check if the login endpoint returns a 403 for unverified users. If so, change it to return a 200 with `needs_verification: true` (like the register endpoint does) instead of a 403. The frontend already handles the redirect to `/verify-email`.

- [ ] **Step 2: Update the response**

If the login returns 403 for unverified users, change it to return a redirect/needs_verification response instead, so the browser console doesn't log it as an error.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/auth.py
git commit -m "fix: return needs_verification instead of 403 for unverified login"
```

---

### Task 18: Fix Landing Page Empty Space

**Files:**
- Modify: `frontend/app/page.tsx` (section padding/margins)

- [ ] **Step 1: Audit section spacing**

The full-page screenshot showed excessive dark space. Check each section's `py-*` (padding) and `mb-*` (margin) classes. The sections use `py-24` which adds 96px top+bottom padding. Reduce to `py-16` or `py-20` for sections that feel too spacious:

Search for `py-24` in the landing page and reduce where appropriate to `py-16`.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "fix: reduce excessive section spacing on landing page"
```

---

### Task 19: Fix Cookie Consent Banner Overlap

**Files:**
- Modify: the cookie consent component (search for "cookie" or "consent" in frontend)

- [ ] **Step 1: Find the cookie consent component**

Run: `grep -rn "cookie\|consent" frontend/components/ frontend/app/ --include="*.tsx" | grep -i consent | head -10`

- [ ] **Step 2: Adjust positioning**

Ensure the cookie banner uses `fixed bottom-0` with a `z-50` or higher z-index and doesn't overlap the main CTA buttons. Add a `mb-` or `pb-` spacer to the main content when the banner is visible.

- [ ] **Step 3: Commit**

```bash
git add <cookie-consent-file>
git commit -m "fix: prevent cookie consent banner from overlapping page CTAs"
```

---

### Task 20: Fix /team Route Redirect

**Files:**
- Modify: `frontend/app/team/page.tsx` or the redirect configuration

- [ ] **Step 1: Check current /team page implementation**

Run: `cat frontend/app/team/page.tsx 2>/dev/null || echo "no direct page"`

If `/team` exists as a page that redirects, verify the redirect is clean. If it's a Next.js redirect in middleware, ensure it's a 307 temporary redirect. This is low priority — the current behavior works, just ensure it's intentional.

- [ ] **Step 2: Commit if changes needed**

```bash
git add frontend/app/team/page.tsx
git commit -m "fix: clean up /team route redirect to /settings?tab=team"
```
