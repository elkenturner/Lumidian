# Citation Gaps Redesign — "Sources You're Missing From"

**Date:** 2026-04-23
**Status:** Design complete, pending review

## Problem

The Citation Gaps widget on the dashboard (dashboard row 4, below Top Cited Domains) is not pulling its weight.

1. **Visually noisy** — each row shows three overlapping signals (a `0/8` fraction, a `100% gap` percentage, and a fill bar whose direction is inverted), all saying the same thing.
2. **Not actionable** — the user reads "you're absent from techcrunch.com" and has no path from insight to action.
3. **Redundant with Top Cited Domains** — both widgets answer "which domains appear in responses?" from different angles, so the dashboard repeats itself.

The underlying data (which domains AI cites in responses that don't mention your brand) is genuinely valuable, but the current presentation buries that value.

## Goal

Reframe the widget from "here are domains where you're absent" into "here's what you can do this week". Display only domains the user can realistically target, ranked by impact, with one clear next action per row.

## Design

### Widget

Replace the existing `CitationGaps` component with a new card titled **"Sources you're missing from"**. Stays at the same dashboard row 4 position.

Layout is a vertical list of up to 6 rows (bounded by the 6 supported draft platforms). Each row contains:

| Column | Content |
|--------|---------|
| Rank | `1`–`6`, muted tabular digits |
| Domain | `reddit.com`, `medium.com`, etc. — primary text |
| Type chip | "UGC", "Editorial", "Reference" — color-coded by domain type |
| Stat | `cited 8× · you in 0` — plain-English, color on the presence number (red = absent, amber = partial, no color on "cited N×") |
| CTA | One button, action-matched to domain (see below) |

### Data filter: actionable platforms only

The action list shows **only** domains that map to one of the 6 supported drafting platforms:

| Platform | Domains that map to it |
|----------|-------------------------|
| reddit | `reddit.com` |
| quora | `quora.com` |
| medium | `medium.com` |
| wikipedia | `wikipedia.org` (matches any subdomain like `en.wikipedia.org`) |
| linkedin | `linkedin.com` |
| x | `x.com`, `twitter.com` (normalized to a single `x.com` entry) |

Any domain not in this set is excluded from the action list. The Top Cited Domains donut above continues to show the full landscape — discovery lives there, action lives here.

### Ranking formula

Sort by **missed mentions** descending:

```
missed_mentions = cited_total − cited_with_brand
```

(This is the mathematical simplification of the `cited_total × gap_score` we discussed — `gap_score = 1 − cited_with_brand/cited_total`, so `cited_total × gap_score = cited_total − cited_with_brand`.)

Plain-English tooltip: *"Ranked by how many times AI cited this source without mentioning your brand."*

**Tiebreaker:** when two domains tie on missed mentions, rank domains with partial presence (`cited_with_brand > 0`) above domains with zero presence. Rationale: partial presence means the brand is already surfacing sometimes on that platform — those are warmer leads closer to winning.

**Exclusion:** rows where `cited_with_brand == cited_total` (full coverage — no gap) are omitted entirely.

### Domain normalization

Before computing the action list, the backend normalizes variant hostnames so a single platform produces a single row:

- `twitter.com` → `x.com`
- `en.wikipedia.org`, `fr.wikipedia.org`, etc. → `wikipedia.org`

Normalization happens server-side at aggregation time, after `_extract_domains()` but before the `domain_total_counts` accumulator fills.

### CTA behavior

Each row renders one CTA. Clicking navigates to:

```
/content/{brandId}?platform={platform}
```

This reuses the existing `/content/[brandId]` redirect route, which already sets `clarity_active_brand_id` in localStorage and forwards to `/content`. Two small changes make the platform param flow through:

1. `/content/[brandId]/page.tsx` — when forwarding to `/content`, preserve any `?platform=` query param: `router.replace('/content?platform=' + encodeURIComponent(platform))` if present, else `router.replace('/content')` (current behavior).
2. `/content/page.tsx` — add `useSearchParams()` on mount. If `searchParams.get('platform')` returns a supported platform slug, call `setDraftPlatformFilter(platform)` so the drafts tab opens with that platform pre-selected. No-op if param is absent.

CTA copy per domain type:

| Domain | Button label | Styling |
|--------|--------------|---------|
| reddit.com | Draft for Reddit | Primary (accent) |
| quora.com | Draft for Quora | Primary |
| medium.com | Draft for Medium | Primary |
| linkedin.com | Draft for LinkedIn | Primary |
| x.com | Draft for X | Primary |
| wikipedia.org | Edit Wikipedia | Secondary/grey |

Wikipedia gets the grey variant because it's a distinct workflow mentally ("edit an existing article" vs "draft a new post") — visually distinguishing it prevents misread of what the click does.

### Empty state

Three render states for the card:

| Condition | Render |
|-----------|--------|
| `total_responses_analyzed === 0` | Card does not render (no tracked data — nothing to say) |
| `total_responses_analyzed > 0 && citation_gaps.length === 0` | Card renders in empty state |
| `citation_gaps.length > 0` | Card renders with action list |

The empty-state copy:

```
✓  No actionable gaps this run
   AI didn't cite any draftable sources (Reddit, Quora, Medium, Wikipedia,
   LinkedIn, X) in prompts where your brand was absent. Check Top Cited
   Domains above for the broader source landscape.
```

**Dashboard page guard change:** the existing `analytics && analytics.citation_gaps && analytics.citation_gaps.length > 0` guard around the card needs to become `analytics && analytics.total_responses_analyzed > 0`, so the empty state can render when data exists but nothing is actionable.

### Accessibility

Presence stats must not rely on color alone. The red/amber color coding is paired with text that conveys the same signal:

- `you in 0` (red) — zero is semantically absence
- `you in 2` (amber, when `cited_with_brand > 0 && cited_with_brand < cited_total`) — partial
- `you in 5` (no color, when full) — never shown in this list per the exclusion rule

## Architecture

### Backend changes

**File:** `backend/app/routers/dashboard.py`

1. Add a `_ACTIONABLE_DOMAIN_MAP: dict[str, str]` constant mapping domain → platform slug:
   ```python
   _ACTIONABLE_DOMAIN_MAP = {
       "reddit.com": "reddit",
       "quora.com": "quora",
       "medium.com": "medium",
       "wikipedia.org": "wikipedia",
       "linkedin.com": "linkedin",
       "x.com": "x",
   }
   ```
2. Add a `_normalize_domain(domain: str) -> str` helper that:
   - Maps `twitter.com` → `x.com`
   - Strips Wikipedia subdomain prefixes (`*.wikipedia.org` → `wikipedia.org`)
3. Extend `CitationGap` schema with an optional `platform: str | None` field. Populated when the domain maps to an actionable platform, `None` otherwise. (Keeping it optional keeps the schema backwards-compatible with any API consumer that just wants the raw gap data.)
4. In the citation gap computation (dashboard.py:420-447), normalize each extracted domain via `_normalize_domain` before keying into `domain_total_counts` and `domain_with`.
5. Filter `citation_gaps` output to include only domains present in `_ACTIONABLE_DOMAIN_MAP`. Preserve the existing `_MIN_CITATIONS = 2` threshold — a single citation isn't a pattern — and additionally exclude rows where `cited_with_brand == cited_total` (full coverage = no gap).
6. Change the sort key from `(gap_score, cited_total)` to:
   ```python
   key=lambda g: (
       g.cited_total - g.cited_with_brand,        # missed mentions, DESC
       1 if g.cited_with_brand > 0 else 0,        # partial presence tiebreaker, DESC
   )
   ```
   Slice to `[:6]` (was `[:10]`).

**File:** `backend/app/schemas.py`

Add `platform: str | None = None` to `CitationGap`.

### Frontend changes

**File:** `frontend/components/dashboard/CitationGaps.tsx`

Full rewrite. New component renders the grid layout described in the Design section. Accepts `CitationGap[]` and `brandId: number` (new prop, needed for CTA links).

**File:** `frontend/lib/api.ts`

Extend `CitationGap` interface with `platform?: string`.

**File:** `frontend/app/dashboard/page.tsx`

- Rename the row 4 section heading from "Citation Gaps" to "Sources you're missing from".
- Update the HelpTooltip copy to: *"Draftable sources AI cites for your prompts — ranked by how many times they were cited without mentioning your brand."*
- Pass `brandId` prop to the new `CitationGaps` component.

**File:** `frontend/app/content/page.tsx`

- Add `useSearchParams()` near the top of the component.
- On mount, if `searchParams.get('platform')` returns a supported platform, call `setDraftPlatformFilter(platform)` so the drafts tab opens with that platform pre-selected.

**File:** `frontend/app/content/[brandId]/page.tsx`

- Extend the redirect to forward `?platform=` if present: `router.replace('/content?platform=' + encodeURIComponent(platform))` when the query param is set.

### Domain normalization — implementation detail

`_normalize_domain` runs on the output of `_extract_domains` (which already lowercases and strips `www.`). The normalization map is simple enough to be a dict + one regex:

```python
_DOMAIN_ALIASES = {"twitter.com": "x.com"}

def _normalize_domain(domain: str) -> str:
    if domain in _DOMAIN_ALIASES:
        return _DOMAIN_ALIASES[domain]
    if domain.endswith(".wikipedia.org"):
        return "wikipedia.org"
    return domain
```

## Testing

### Backend unit tests (new file: `backend/tests/test_dashboard_citation_gaps.py`)

1. **Ranking by missed mentions:** fixture with reddit (cited 8, user in 0), medium (cited 5, user in 2), linkedin (cited 3, user in 0). Assert order: reddit (8 missed), medium (3 missed, partial) — wait, linkedin also 3 missed but zero presence. Assert medium ranks above linkedin (tiebreaker).
2. **Actionable filter:** fixture where AI response cites `techcrunch.com`, `nytimes.com`, `reddit.com`. Assert only reddit.com appears in `citation_gaps`.
3. **twitter.com normalization:** fixture where responses cite both `twitter.com` (3×) and `x.com` (2×). Assert single `x.com` row with `cited_total=5`.
4. **Wikipedia subdomain normalization:** fixture citing `en.wikipedia.org` and `fr.wikipedia.org`. Assert single `wikipedia.org` row.
5. **Full-coverage exclusion:** fixture where brand is in 5/5 reddit citations. Assert reddit is NOT in citation_gaps.
6. **Empty list:** fixture with only non-actionable domain citations. Assert `citation_gaps == []`.
7. **Platform field populated:** assert every returned gap has `platform` set and matches `_ACTIONABLE_DOMAIN_MAP[domain]`.

### Manual verification

1. Load dashboard with a real brand that has tracked runs. Confirm:
   - Card title reads "Sources you're missing from"
   - Max 6 rows, sorted by missed mentions
   - Each row has correct CTA text and color (Wikipedia is grey)
   - CTA click navigates to `/content?platform=reddit` and lands with Reddit tab active
2. Confirm the empty state renders when a brand has only non-actionable citations (e.g., all news domains).
3. Confirm Top Cited Domains donut is unchanged.
4. Load on mobile width — verify rows don't break layout disastrously (polish to follow).

## Scope

**In scope:**
- Replacing the Citation Gaps widget with "Sources you're missing from"
- Backend filter + ranking change
- CTA navigation to the content hub with platform pre-selected
- Domain normalization for twitter.com and wikipedia subdomains
- Empty state
- Accessibility pairing of color + text

**Out of scope (deliberate deferrals):**
- Content type suggestions ("write a listicle vs. how-to") — the drafting pipeline picks format internally; adding a user-facing choice is a v2 refinement
- "See non-draftable sources" drill-down modal — YAGNI, Top Cited Domains donut already serves this purpose
- Mobile stacking polish — flag for future work; current grid will cramp on narrow screens but won't break
- Extending the actionable platform list (Substack, Stack Overflow, Product Hunt, dev.to, Hacker News) — requires adding drafting pipeline support first
- Attribution feedback ("posting here worked last time") — interesting v2; requires joining `DraftAttribution` data by platform
- Changing the underlying "top 10 domain extraction" logic in `_extract_domains` — out of scope for this change

## Rollout

Single PR. No migration required (no schema changes to stored data — `CitationGap` is computed fresh per dashboard request). Feature ships atomically when the PR merges.
