# Smarter Prompt Suggestions + Pre-History Editing

**Date:** 2026-05-01
**Status:** Draft — pending implementation plan

---

## Problem

Three issues with the current prompt-management flow (`ManagePromptsModal.tsx`, `routers/brands.py`):

1. **AI suggestions drop the question mark.** The Claude system prompt has examples ending in `?` but no explicit rule, and the model returns inconsistent punctuation.
2. **Suggestions are scope-blind.** A regional roaster gets "best coffee roasters in the US" — a query it has near-zero chance of appearing in. Wastes tracking budget on prompts that will always score 0.
3. **No way to fix a typo without deleting.** The only options today are add and delete. Users want to fix a misspelling on a freshly suggested prompt without losing it.

---

## Out of Scope

- **Awareness-floor problem.** Brands too small to surface anywhere in AI answers. That is a content/PR problem, not a prompt-engineering one.
- **Onboarding suggestions** (`/api/brands/suggest-prompts-preview`). Scope-aware suggestions only apply to existing brands where we can persist the inferred scope. Preview keeps the question-mark fix only.
- **Editing prompts that already have tracking history.** Solved by locking the edit affordance once a prompt has any `QueryResult` rows.

---

## Design

### 1. Question-mark fix

Two layers, both cheap:

- **Prompt-level:** add explicit rule to the suggester system prompt — "Every suggestion MUST end with a `?`."
- **Post-process:** after JSON parsing, strip trailing whitespace/punctuation and append `?` if missing. Belt-and-suspenders against an LLM that ignores the rule.

Applies to both `suggest_prompts` and `suggest_prompts_preview`.

### 2. Market-scope-aware suggestions

**New fields on `BrandProfile`:**

| Field | Type | Purpose |
|---|---|---|
| `market_scope` | `String(20)` nullable — one of `local`, `national`, `global`, `niche` | Buckets the kind of queries that make sense |
| `geography` | `String(200)` nullable | Free-text ("Portland, OR", "DACH region", "B2B SaaS for HR teams") |

Migration appended to `database.py:run_migrations()`.

**New endpoint:** `POST /api/brands/{brand_id}/infer-scope`

- Reads brand name, description, website context, competitors
- Calls Claude Haiku with a small prompt that returns JSON: `{"market_scope": "...", "geography": "..."}`
- Does NOT persist — the frontend confirms with the user, then writes via `PUT /profile`
- Returns inferred values (with the scope clamped to one of the four allowed values; defaults to `national` on out-of-range)
- Rate-limited like other Claude calls (5/min)

**Suggestion flow change (`ManagePromptsModal`):**

When user clicks "Suggest prompts with AI":

1. If `brand_profile.market_scope` is set → call `/suggest-prompts` directly.
2. If not set → call `/infer-scope` first, render an editable chip:
   ```
   Detected: Local · Portland, OR    [edit] [confirm & continue]
   ```
   - User can correct either field inline (scope dropdown, geography textbox)
   - On confirm → PATCH the brand profile, then call `/suggest-prompts`
3. Once saved, never asked again for that brand. Editable later from Brand Profile page.

**Suggester change:**

`suggest_prompts` reads `market_scope` + `geography` from BrandProfile and adds to system prompt context:

```
Market scope: local
Geography: Portland, OR

When generating queries, scope them to where this brand actually
competes. For local scope, use the geography in queries
("best X in Portland", "Portland-area X"). Avoid global/national
phrasings that the brand has no realistic chance of appearing in.
```

The five query categories (category, comparison, problem-seeking, clinical, buying) stay — they're orthogonal to scope.

### 3. Editable prompts (pre-history only)

**New endpoint:** `PATCH /api/brands/{brand_id}/prompts/{prompt_id}`

Body: `{ "text": "..." }`

Server checks, in order:

1. Brand belongs to user (existing pattern).
2. No `TrackingRun` with `status='running'` for this brand → else 409 (existing pattern, mirrors add/delete).
3. **No `QueryResult` rows reference this prompt** → else 409 with `detail: "Prompt is locked — has tracking history. Delete and re-add to change wording."`
4. Validate text (non-empty, length ≤ existing prompt limit, no duplicate against other prompts on this brand).
5. Update `Prompt.text`, commit, return updated `PromptResponse`.

**`PromptResponse` gains a field:** `has_history: bool`

Computed in the brand-load query (cheap: a single `SELECT DISTINCT prompt_id FROM query_results WHERE prompt_id IN (...)` after loading prompts). Used by the UI to decide whether to render the pencil icon.

**UI change (`ManagePromptsModal`):**

Each prompt row gets a pencil icon, but only when `!p.has_history && !locked`:

```
[ prompt text ............... ]  ✏️  🗑️
```

Click pencil → row swaps to inline editable input + Save / Cancel. On Save → PATCH, optimistic update, error rollback with toast.

If the row has history, no pencil. Tooltip on the trash button: "Delete to remove tracking history."

---

## Data flow

```
User clicks "Suggest prompts with AI"
        │
        ▼
Frontend: GET brand profile in state
        │
        ▼
   market_scope set?
        │
   ┌────┴────┐
   no        yes
   │          │
   ▼          ▼
POST       POST /suggest-prompts
/infer-    (system prompt now includes scope/geo)
scope         │
   │          ▼
   ▼      [12-15 prompts, all end in "?"]
[scope chip] ─ user confirms ─► PUT /brand_profile ─► POST /suggest-prompts
```

```
User clicks pencil on a prompt
        │
        ▼
Inline input replaces text
        │
        ▼
PATCH /api/brands/{id}/prompts/{pid} {text}
        │
   ┌────┴────────────┐
   200               409 (has history / running / duplicate)
   │                  │
   ▼                  ▼
update local      toast error, restore original
```

---

## Files touched

**Backend**
- `app/models.py` — add `market_scope`, `geography` to `BrandProfile`
- `app/database.py` — migration for the two new columns
- `app/schemas.py` — extend `BrandProfileResponse` / `BrandProfileUpdate`; extend `PromptResponse` with `has_history`; new `PromptUpdate`, `InferScopeResponse`
- `app/routers/brands.py`
  - `suggest_prompts`: read scope, add scope rule to system prompt, enforce trailing `?`
  - `suggest_prompts_preview`: enforce trailing `?` only
  - `POST /{brand_id}/infer-scope` (new)
  - `PATCH /{brand_id}/prompts/{prompt_id}` (new)
  - Brand load: attach `has_history` to each prompt
- `app/routers/brand_profile.py` — accept/return new fields

**Frontend**
- `lib/api.ts` — `inferBrandScope`, `updatePrompt`; extend `Prompt` type with `has_history`; extend `BrandProfile` type
- `components/ManagePromptsModal.tsx`
  - Pencil icon + inline edit for `!has_history` prompts
  - Pre-suggest scope-confirmation step
- `app/settings/page.tsx` (Brand Profile tab) — surface market scope + geography fields so user can change them later

**Tests**
- `tests/test_brands.py` — new tests for PATCH (success, 409 on history, 409 during run, duplicate rejection, ownership), infer-scope, and that suggestion responses all end in `?`

---

## Risks / open questions

- **Inference accuracy.** Claude may misclassify scope on thin website content. Mitigated by user-edit-before-confirm. Worst case: user picks scope manually.
- **Has-history query cost.** N+1 risk if done naively per prompt. Use a single `SELECT DISTINCT prompt_id ... WHERE prompt_id IN (...)` query in the brand load. With < 100 prompts per brand this is fine; check the EXPLAIN plan if it shows up in slow logs.
- **Backfill.** Existing brands all have `market_scope = NULL`. They get the inference flow on their next Suggest click. No batch backfill needed.
