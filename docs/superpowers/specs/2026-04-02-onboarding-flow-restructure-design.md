# Onboarding Flow Restructure Design

**Date:** 2026-04-02  
**Status:** Approved  
**Goal:** Fix onboarding so website context is fetched before AI features need it, and brand creation happens at the end (not Step 1), eliminating the "brand limit reached" error on Back button.

---

## Problem Statement

Two issues with current onboarding flow:

1. **AI prompt suggestions fail** — Website context is fetched fire-and-forget after brand creation, but AI suggestions only use brand name. For brands like "Vans" the AI can't generate relevant prompts without knowing it's a shoe company.

2. **"Brand limit reached" on Back button** — Brand is created in Step 1. When user clicks Back from Step 2 and tries to Continue again, it attempts to create another brand, hitting the pitch brand limit.

---

## Solution Overview

Restructure onboarding so:
- Website context is fetched **upfront** (blocking) in Step 1
- Brand is created **at the end** (Step 3), not Step 1
- All data flows through local state, enabling free Back/Next navigation

---

## New Flow

### Step 1: Brand & Website

**Fields:**
- Brand name (required)
- Website URL (required)

**Button:** "Fetch & Continue" (disabled until both fields filled)

**Behavior:**
1. User enters brand name and website URL
2. Clicks "Fetch & Continue"
3. Spinner shows while calling new `/api/brands/fetch-website-context` endpoint
4. On success: store `websiteContext` in local state, advance to Step 2
5. On failure: show error, stay on Step 1, user can retry

### Step 2: Prompts

**Unchanged UI** — prompt inputs + "Generate with AI" button

**Changes:**
- AI suggestions now receive `websiteContext` from local state
- No brand exists yet — prompts stored in local state only
- Back button: just sets `step = 1`, no API calls

### Step 3: Profile

**Unchanged UI** — company description textarea

**Changes:**
- No brand exists yet — description stored in local state
- Can pre-fill description from `websiteContext` if available
- Back button: just sets `step = 2`, no API calls

### Final Submission ("Go to Dashboard")

1. Create brand via `POST /api/brands` with:
   - `name`, `website_url`, `prompts[]`
2. Update brand profile via `PATCH /api/brand_profile/{brand_id}` with:
   - `company_description`
   - `internal_brand_context` (the fetched website context)
3. Trigger tracking run via `POST /api/tracking/run/{brand_id}`
4. Redirect to `/dashboard?newBrand=true&brandId={id}`

---

## Backend Changes

### New Endpoint: `POST /api/brands/fetch-website-context`

Fetches website content via Jina without requiring a brand to exist.

**Request:**
```json
{
  "url": "https://vans.com"
}
```

**Response:**
```json
{
  "context": "# Vans\n\nVans is an American manufacturer of skateboarding shoes..."
}
```

**Implementation:**
- Reuse existing `jina_service.py` logic
- Rate limit: 5 calls/minute per user
- Timeout: 30 seconds
- Auth: requires logged-in user

### Updated Endpoint: `POST /api/brands/suggest-prompts-preview`

Add optional `website_context` parameter.

**Current request:**
```json
{
  "name": "Vans",
  "description": ""
}
```

**New request:**
```json
{
  "name": "Vans",
  "description": "",
  "website_context": "# Vans\n\nVans is an American manufacturer..."
}
```

**Backend change:** Include `website_context` in the Claude prompt for better suggestions.

---

## Frontend Changes

### Local State Structure

```typescript
// Step 1 data
const [brandName, setBrandName] = useState('');
const [websiteUrl, setWebsiteUrl] = useState('');
const [websiteContext, setWebsiteContext] = useState(''); // NEW

// Step 2 data  
const [prompts, setPrompts] = useState<string[]>(['']);

// Step 3 data
const [companyDescription, setCompanyDescription] = useState('');

// No more createdBrandId until final submission
```

### Step 1 Handler (Revised)

```typescript
async function handleStep1() {
  if (!brandName.trim() || !websiteUrl.trim()) return;
  setFetching(true);
  setError('');
  try {
    const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
    const result = await fetchWebsiteContext(normalisedUrl);
    setWebsiteContext(result.context);
    setStep(2);
  } catch (err) {
    setError('Failed to fetch website. Please check the URL and try again.');
  } finally {
    setFetching(false);
  }
}
```

### AI Suggestions Handler (Revised)

```typescript
async function handleSuggestPrompts() {
  setSuggestingPrompts(true);
  try {
    const suggestions = await getSuggestedPromptsPreview(
      brandName.trim(),
      '',  // description
      websiteContext  // NEW - pass the fetched context
    );
    setPrompts(suggestions.slice(0, 10));
  } catch {
    setSuggestError('Could not generate suggestions. Try again.');
  } finally {
    setSuggestingPrompts(false);
  }
}
```

### Final Submission Handler (Revised)

```typescript
async function handleStep3() {
  setSaving(true);
  setError('');
  try {
    // 1. Create brand with prompts
    const validPrompts = prompts.filter(p => p.trim());
    const brand = await createBrand({
      name: brandName.trim(),
      tier: 'basic',
      brand_type: 'pitch',
      prompts: validPrompts,
      website_url: normaliseWebsiteUrl(websiteUrl),
    });

    // 2. Update profile with description + website context
    await updateBrandProfile(brand.id, {
      company_description: companyDescription || undefined,
      internal_brand_context: websiteContext || undefined,
    });

    // 3. Trigger tracking run
    await triggerRun(brand.id);

    // 4. Redirect
    router.push(`/dashboard?newBrand=true&brandId=${brand.id}`);
  } catch (err) {
    setError(err?.response?.data?.detail || 'Failed to create brand');
  } finally {
    setSaving(false);
  }
}
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No website URL entered | "Fetch & Continue" button disabled |
| Jina fetch fails | Show error, stay on Step 1, user can retry |
| Jina fetch times out (30s) | Show timeout error, stay on Step 1 |
| AI suggestions fail | Show error, user adds prompts manually |
| Brand creation fails at end | Show error on Step 3, stay on page |

---

## API Client Additions

```typescript
// New function in lib/api.ts
export async function fetchWebsiteContext(url: string): Promise<{ context: string }> {
  const res = await api.post('/brands/fetch-website-context', { url });
  return res.data;
}

// Updated function signature
export async function getSuggestedPromptsPreview(
  name: string,
  description?: string,
  websiteContext?: string,  // NEW
): Promise<string[]> {
  const res = await api.post<string[]>('/brands/suggest-prompts-preview', {
    name,
    description: description ?? '',
    website_context: websiteContext ?? '',  // NEW
  });
  return res.data;
}
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/app/routers/brands.py` | Add `POST /fetch-website-context` endpoint |
| `backend/app/routers/brands.py` | Update `suggest-prompts-preview` to accept `website_context` |
| `frontend/lib/api.ts` | Add `fetchWebsiteContext()` function |
| `frontend/lib/api.ts` | Update `getSuggestedPromptsPreview()` signature |
| `frontend/app/onboarding/page.tsx` | Restructure entire flow per this spec |
