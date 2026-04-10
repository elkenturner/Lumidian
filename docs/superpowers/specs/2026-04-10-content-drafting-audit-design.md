# Content Drafting & Opportunities Audit — Design Spec

**Date:** 2026-04-10
**Scope:** Fix LinkedIn/X draft generation, stale opportunity filtering, opportunity balance, DraftAttribution table rename

---

## Problem Summary

An audit of the content drafting system uncovered four issues:

1. **LinkedIn/X drafts silently never generate** — `BrandContentSettings` stores base platform names (`"linkedin"`, `"x"`), but `auto_draft_top_gaps` filters against `CONTENT_PLATFORMS` which contains variant names (`"linkedin_article"`, `"x_thread"`). The mapping function `resolve_platform_key()` exists but is never called, so LinkedIn/X are always dropped, falling back to `["reddit", "quora"]`.

2. **Stale opportunities persist indefinitely** — `list_opportunities` has no age filter. Scanners prune 14-day-old rows during rescans, but between scans, months-old opportunities remain visible. Quora is especially affected.

3. **Opportunity sort doesn't factor recency** — pure `relevance_score DESC` ordering means an 80-day-old high-relevance Quora question outranks a 2-day-old relevant Reddit thread.

4. **DraftAttribution/ContentAttribution naming collision** — `DraftAttribution` maps to table `"content_attributions"` (plural) while `ContentAttribution` maps to `"content_attribution"` (singular). Different tables, different schemas, confusingly similar names. `DraftAttribution` is also missing from the test truncation list.

---

## Fix 1: LinkedIn/X Draft Generation

**File:** `backend/app/services/drafting_service.py` (~line 978)

**Root cause:** `resolve_platform_key()` is imported at line 58 but never called in the `auto_draft_top_gaps` function. Base names from `BrandContentSettings` (`"linkedin"`, `"x"`) fail the `in CONTENT_PLATFORMS` check because that list contains variant names (`"linkedin_article"`, `"linkedin_post"`, `"x_thread"`, `"x_post"`).

**Change:** Apply `resolve_platform_key()` when building the enabled platforms list:

```python
# Before (broken):
enabled_platforms = [
    s.platform for s in enabled_settings
    if s.platform in CONTENT_PLATFORMS
]

# After (fixed):
enabled_platforms = [
    resolve_platform_key(s.platform) for s in enabled_settings
    if resolve_platform_key(s.platform) in CONTENT_PLATFORMS
]
```

This maps `"linkedin"` -> `"linkedin_article"` and `"x"` -> `"x_thread"` before the membership check.

**Risk:** Low. `resolve_platform_key()` is a pure lookup with passthrough default. All other platforms (`"reddit"`, `"quora"`, `"medium"`, `"wikipedia"`) pass through unchanged.

---

## Fix 2: Stale Opportunity Filtering + Recency-Blended Sort

**File:** `backend/app/routers/opportunities.py` (~line 69-81)

### 2a. Hard 90-day cutoff on listing query

Add a `WHERE` clause filtering out opportunities older than 90 days, using `posted_at` with `created_at` as fallback:

```python
from datetime import UTC, datetime, timedelta
from sqlalchemy import func

cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=90)
stmt = stmt.where(
    func.coalesce(ContentOpportunity.posted_at, ContentOpportunity.created_at) >= cutoff
)
```

### 2b. Recency-blended sort (Python-side)

Replace pure `relevance_score DESC` SQL ordering with a Python-side blended sort after fetching. The dataset is small (max 200 rows per brand) and we already do Python-side interleaving.

```python
def _blended_score(opp):
    rel = opp.relevance_score or 0
    posted = opp.posted_at or opp.created_at
    now = datetime.now(UTC).replace(tzinfo=None)
    age_days = (now - posted).days if posted else 90
    if age_days <= 7:
        recency = 100
    elif age_days <= 30:
        recency = 70
    elif age_days <= 60:
        recency = 40
    else:
        recency = 20
    return rel * 0.7 + recency * 0.3
```

**Weight rationale:** 70% relevance / 30% recency keeps highly relevant older content visible while giving a meaningful boost to fresh opportunities. A 2-day-old thread with relevance 60 scores `60*0.7 + 100*0.3 = 72`, beating an 80-day-old thread with relevance 80 that scores `80*0.7 + 20*0.3 = 62`.

**Scanner prune window (14 days) stays unchanged** — scanners handle aggressive cleanup during rescans. The 90-day listing filter is a safety net for the gap between scans.

---

## Fix 3: Improved Intra-Platform Sorting for Balance

**File:** `backend/app/routers/opportunities.py` (same function)

**No additional code change required.** The recency-blended sort from Fix 2 applies to `all_opps` before the round-robin interleaving groups by platform. Each platform bucket inherits the blended order, so the freshest/best items from each platform appear first in the interleaved output.

The existing round-robin mechanism (cycle 1 per platform) is solid for the typical 2-4 platform case. The blended sort ensures each platform contributes its strongest items first.

---

## Fix 4: Rename DraftAttribution Table

**Files:**
- `backend/app/models.py` (~line 495)
- `backend/app/database.py` (new migration at bottom)
- `backend/tests/conftest.py` (~line 72)

### 4a. Model change

```python
# Before:
class DraftAttribution(Base):
    __tablename__ = "content_attributions"

# After:
class DraftAttribution(Base):
    __tablename__ = "draft_attributions"
```

### 4b. Migration

Add to the bottom of `run_migrations()` in `database.py`:

```sql
ALTER TABLE content_attributions RENAME TO draft_attributions
```

Wrapped in the existing try/except pattern to handle fresh installs where the old table name never existed.

### 4c. Test cleanup

Add `"draft_attributions"` to the truncation list in `tests/conftest.py`:

```python
for table in [
    "prompt_run_scores", "content_events",
    "analytics_events", "content_attribution", "draft_attributions",
    "content_posts", ...
]
```

`"content_attribution"` (singular, the `ContentAttribution` table) remains in the list unchanged.

### Safety verification

- All code references use ORM class names (`DraftAttribution`, `ContentAttribution`), not raw table strings.
- `ContentAttribution` → `"content_attribution"` (singular) is completely untouched.
- The `back_populates="content_attributions"` on `ContentPost` and `TrackingRun` models are relationship attribute names, not table names — unaffected.
- Brand deletion cascades through FK `ondelete="CASCADE"` on `DraftAttribution.brand_id` and `DraftAttribution.draft_id`.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `backend/app/services/drafting_service.py` | Wire in `resolve_platform_key()` for enabled platforms |
| `backend/app/routers/opportunities.py` | Add 90-day cutoff, recency-blended sort helper, apply before interleaving |
| `backend/app/models.py` | Rename `DraftAttribution.__tablename__` to `"draft_attributions"` |
| `backend/app/database.py` | Add `ALTER TABLE` migration for the rename |
| `backend/tests/conftest.py` | Add `"draft_attributions"` to truncation list |

---

## Out of Scope

- Scanner prune windows (14 days for Reddit/Quora) — working correctly
- Frontend changes — no UI modifications needed; all fixes are backend
- `ContentAttribution` model — untouched, different table, different purpose
- Gap score component exposure in API — noted but not part of this fix
