# Onboarding Flow Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure onboarding so website context is fetched upfront (blocking), brand creation happens at the end, and AI suggestions use website context.

**Architecture:** New backend endpoint exposes existing Jina service for standalone website fetch. Frontend collects all data in local state, creates brand only on final submission. This eliminates the "brand limit reached" error on Back button and enables AI suggestions to use website context.

**Tech Stack:** Python 3.11 / FastAPI / httpx (backend); Next.js 15 / TypeScript / React (frontend)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/routers/brands.py` | Modify | Add fetch-website-context endpoint, update suggest-prompts-preview |
| `backend/app/schemas.py` | Modify | Add FetchWebsiteContextRequest/Response schemas |
| `frontend/lib/api.ts` | Modify | Add fetchWebsiteContext(), update getSuggestedPromptsPreview() |
| `frontend/app/onboarding/page.tsx` | Modify | Restructure entire flow |

---

## Task 1: Add fetch-website-context endpoint

**Files:**
- Modify: `backend/app/routers/brands.py`
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Add request/response schemas**

In `backend/app/schemas.py`, find the end of the file and add before the final blank line:

```python
class FetchWebsiteContextRequest(BaseModel):
    url: str


class FetchWebsiteContextResponse(BaseModel):
    context: str
```

- [ ] **Step 2: Add the endpoint to brands.py**

In `backend/app/routers/brands.py`, find the imports section at the top. Add this import after the existing ones:

```python
from app.schemas import FetchWebsiteContextRequest, FetchWebsiteContextResponse
```

Then find the `suggest_prompts_preview` function (around line 588) and add this new endpoint BEFORE it:

```python
@router.post("/fetch-website-context", response_model=FetchWebsiteContextResponse)
async def fetch_website_context_endpoint(
    payload: FetchWebsiteContextRequest,
    user: CurrentUser,
):
    """
    Fetch website content via Jina Reader without requiring a brand.
    Used by onboarding wizard to get context before brand creation.
    Rate limited to 5 calls/minute per user.
    """
    from app.services.jina_service import fetch_website_context
    from app.dependencies import check_rate_limit

    check_rate_limit(user.id, limit=5)  # 5 per minute

    try:
        context = await fetch_website_context(payload.url)
        return FetchWebsiteContextResponse(context=context)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid URL: {e}",
        )
    except Exception as e:
        logger.warning("Jina fetch failed for %s: %s", payload.url, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch website content. Please check the URL and try again.",
        )
```

- [ ] **Step 3: Verify endpoint loads**

```bash
cd /Users/ken/Desktop/Lumidian/backend
python3 -c "from app.routers.brands import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/routers/brands.py backend/app/schemas.py
git commit -m "feat: add fetch-website-context endpoint for onboarding"
```

---

## Task 2: Update suggest-prompts-preview to accept website_context

**Files:**
- Modify: `backend/app/routers/brands.py`

- [ ] **Step 1: Update the request schema**

In `backend/app/routers/brands.py`, find the `_SuggestPreviewReq` class (around line 583) and add the new field:

```python
class _SuggestPreviewReq(_BaseModel):
    name: str
    description: str = ""
    website_context: str = ""
```

- [ ] **Step 2: Update the endpoint to use website_context**

In the same file, find the `suggest_prompts_preview` function. Replace the context building block (around lines 598-601):

```python
    context_parts = [f"Brand name: {payload.name.strip()}"]
    if payload.description.strip():
        context_parts.append(f"Company description: {payload.description.strip()}")
    context = "\n".join(context_parts)
```

With:

```python
    context_parts = [f"Brand name: {payload.name.strip()}"]
    if payload.description.strip():
        context_parts.append(f"Company description: {payload.description.strip()}")
    if payload.website_context.strip():
        # Truncate website context to avoid huge prompts
        website_excerpt = payload.website_context.strip()[:3000]
        context_parts.append(f"Website content:\n{website_excerpt}")
    context = "\n".join(context_parts)
```

- [ ] **Step 3: Verify endpoint loads**

```bash
cd /Users/ken/Desktop/Lumidian/backend
python3 -c "from app.routers.brands import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add backend/app/routers/brands.py
git commit -m "feat: add website_context param to suggest-prompts-preview"
```

---

## Task 3: Add fetchWebsiteContext to frontend API client

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add the new function**

In `frontend/lib/api.ts`, find the `refreshWebsiteContext` function (around line 260) and add the new function BEFORE it:

```typescript
export async function fetchWebsiteContext(url: string): Promise<{ context: string }> {
  const res = await api.post<{ context: string }>('/brands/fetch-website-context', { url });
  return res.data;
}
```

- [ ] **Step 2: Update getSuggestedPromptsPreview signature**

In the same file, find the `getSuggestedPromptsPreview` function (around line 586). Replace it entirely:

```typescript
export async function getSuggestedPromptsPreview(
  name: string,
  description?: string,
  websiteContext?: string,
): Promise<string[]> {
  const res = await api.post<string[]>('/brands/suggest-prompts-preview', {
    name,
    description: description ?? '',
    website_context: websiteContext ?? '',
  });
  return res.data;
}
```

- [ ] **Step 3: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -10
```

Expected: Build succeeds (may show some type errors in onboarding page which we'll fix in next task)

- [ ] **Step 4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/lib/api.ts
git commit -m "feat: add fetchWebsiteContext and update getSuggestedPromptsPreview"
```

---

## Task 4: Restructure onboarding page

**Files:**
- Modify: `frontend/app/onboarding/page.tsx`

- [ ] **Step 1: Update imports**

In `frontend/app/onboarding/page.tsx`, update the imports (lines 7-17). Replace:

```typescript
import {
  getBrands,
  getBrandProfile,
  getSuggestedPromptsPreview,
  createBrand,
  updateBrandProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
  Brand,
} from '@/lib/api';
```

With:

```typescript
import {
  getBrands,
  getSuggestedPromptsPreview,
  createBrand,
  updateBrandProfile,
  fetchWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
} from '@/lib/api';
```

- [ ] **Step 2: Update state declarations**

Find the state declarations (around lines 30-41). Replace:

```typescript
  // Step 1: brand name + website
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [createdBrandId, setCreatedBrandId] = useState<number | null>(null);

  // Step 2: prompts
  const [prompts, setPrompts] = useState<string[]>(['']);
  const [suggestingPrompts, setSuggestingPrompts] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  // Step 3: profile basics
  const [companyDescription, setCompanyDescription] = useState('');
```

With:

```typescript
  // Step 1: brand name + website
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteContext, setWebsiteContext] = useState('');
  const [fetching, setFetching] = useState(false);

  // Step 2: prompts
  const [prompts, setPrompts] = useState<string[]>(['']);
  const [suggestingPrompts, setSuggestingPrompts] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  // Step 3: profile basics
  const [companyDescription, setCompanyDescription] = useState('');
```

- [ ] **Step 3: Replace handleStep1 function**

Find the `handleStep1` function (around lines 53-81). Replace it entirely:

```typescript
  async function handleStep1() {
    if (!brandName.trim() || !websiteUrl.trim()) return;
    setFetching(true);
    setError('');
    try {
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      if (!normalisedUrl) {
        setError('Please enter a valid website URL.');
        return;
      }
      const result = await fetchWebsiteContext(normalisedUrl);
      setWebsiteContext(result.context);
      setStep(2);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to fetch website. Please check the URL and try again.');
    } finally {
      setFetching(false);
    }
  }
```

- [ ] **Step 4: Replace handleStep2 function**

Find the `handleStep2` function (around lines 83-113). Replace it entirely:

```typescript
  async function handleStep2() {
    setSaving(true);
    setError('');
    try {
      // Pre-fill description from website context if available and not already set
      if (websiteContext && !companyDescription) {
        const firstLine = websiteContext
          .split(/\n+/)
          .map((l) => l.trim())
          .find((l) => l.length > 20 && !l.startsWith('#') && !l.startsWith('http') && !l.startsWith('['));
        if (firstLine) setCompanyDescription(firstLine.slice(0, 300));
      }
      setStep(3);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 5: Replace handleStep3 function**

Find the `handleStep3` function (around lines 115-139). Replace it entirely:

```typescript
  async function handleStep3() {
    setSaving(true);
    setError('');
    try {
      // 1. Create brand with prompts
      const validPrompts = prompts.filter((p) => p.trim());
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      const brand = await createBrand({
        name: brandName.trim(),
        tier: 'basic',
        brand_type: 'pitch',
        prompts: validPrompts.length > 0 ? validPrompts : [],
        website_url: normalisedUrl ?? undefined,
      });

      // 2. Update profile with description + website context
      try {
        await updateBrandProfile(brand.id, {
          company_description: companyDescription || undefined,
          internal_brand_context: websiteContext || undefined,
        });
      } catch {
        // Profile update is non-fatal
        console.warn('[Onboarding] Profile update failed (non-fatal)');
      }

      // 3. Trigger tracking run
      try {
        const runResult = await triggerRun(brand.id);
        console.info('[Onboarding] Auto-run triggered — brand_id=%d run_id=%d', brand.id, runResult.run_id);
      } catch (err) {
        console.warn('[Onboarding] Auto-run failed (non-fatal):', err);
      }

      // 4. Redirect
      router.push(`/dashboard?newBrand=true&brandId=${brand.id}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to create brand');
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 6: Replace handleSuggestPrompts function**

Find the `handleSuggestPrompts` function (around lines 141-153). Replace it entirely:

```typescript
  async function handleSuggestPrompts() {
    if (!brandName.trim()) return;
    setSuggestingPrompts(true);
    setSuggestError('');
    try {
      const suggestions = await getSuggestedPromptsPreview(
        brandName.trim(),
        '',
        websiteContext,
      );
      setPrompts(suggestions.slice(0, 10));
    } catch {
      setSuggestError('Could not generate suggestions. Try again.');
    } finally {
      setSuggestingPrompts(false);
    }
  }
```

- [ ] **Step 7: Update Step 1 button text**

Find the Continue button in Step 1 (around line 248-252). Replace:

```typescript
              <button
                onClick={handleStep1}
                disabled={saving || !brandName.trim() || !websiteUrl.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors shadow-[0_0_20px_rgba(99,102,241,0.25)]"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue
              </button>
```

With:

```typescript
              <button
                onClick={handleStep1}
                disabled={fetching || !brandName.trim() || !websiteUrl.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors shadow-[0_0_20px_rgba(99,102,241,0.25)]"
              >
                {fetching ? <Loader2 size={14} className="animate-spin" /> : null}
                {fetching ? 'Fetching website...' : 'Fetch & Continue'}
              </button>
```

- [ ] **Step 8: Verify frontend builds**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run build 2>&1 | tail -15
```

Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
cd /Users/ken/Desktop/Lumidian
git add frontend/app/onboarding/page.tsx
git commit -m "feat: restructure onboarding - fetch website first, create brand at end"
```

---

## Task 5: Manual Testing

- [ ] **Step 1: Start backend**

```bash
cd /Users/ken/Desktop/Lumidian/backend
python3 -m uvicorn app.main:app --reload --port 3001
```

- [ ] **Step 2: Start frontend**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npm run dev
```

- [ ] **Step 3: Test the flow**

1. Go to `/onboarding` (clear any existing brands first if needed)
2. Enter brand name: "Vans"
3. Enter website: "vans.com"
4. Click "Fetch & Continue" — should show spinner, then advance to Step 2
5. Click "Generate with AI" — should generate relevant skateboarding/shoe prompts
6. Click "Back" — should go to Step 1 without error
7. Click "Fetch & Continue" again — should work (no brand limit error)
8. Complete the flow — brand should be created at the end

- [ ] **Step 4: Verify no brand limit error**

On Step 2, click Back multiple times and Continue again — should never see "brand limit reached" error.

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add `POST /fetch-website-context` endpoint |
| 2 | Update `suggest-prompts-preview` to accept `website_context` |
| 3 | Add `fetchWebsiteContext()` to frontend API, update `getSuggestedPromptsPreview()` |
| 4 | Restructure onboarding page: fetch first, create brand at end |
| 5 | Manual testing |
