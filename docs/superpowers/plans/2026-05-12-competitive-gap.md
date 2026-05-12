# Competitive Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Competitive Gap" dashboard metric — your visibility minus competitor average, in pp — with toggleable 7d/30d/90d window, sparkline trend, and click-to-expand drawer showing per-competitor breakdown.

**Architecture:** New backend endpoint `GET /api/dashboard/{brand_id}/competitive-gap?window=` aggregates over existing `TrackingRun`/`QueryResult`/`Competitor` data via a new `app/services/competitive_gap.py` service module. No DB changes. New frontend dashboard card + side drawer; Row 1 layout shifts to make room (Visibility Score | Competitive Gap), pushing Best Prompt / Sentiment / SOV to Row 2.

**Tech Stack:** FastAPI 0.115 + SQLAlchemy 2.0 async (backend), Next.js 15 + React 18 + Tailwind + Recharts (frontend), pytest 8 + pytest-asyncio (tests).

**Spec:** `docs/superpowers/specs/2026-05-12-competitive-gap-design.md` — read before starting.

---

## File Structure

**Backend**
- `backend/app/services/competitive_gap.py` (new) — pure aggregation; window resolution, mention matching, per-day bucketing, main `compute_competitive_gap` function.
- `backend/app/schemas.py` (modify) — add `CompetitiveGapTrendPoint`, `CompetitorTrendPoint`, `CompetitorGapStat`, `CompetitiveGapResponse`.
- `backend/app/routers/dashboard.py` (modify) — add `GET /{brand_id}/competitive-gap` endpoint; replace inline `comp_lower in text.lower()` SOV substring check with the shared `_mention_matches` helper from the new service.
- `backend/tests/test_competitive_gap.py` (new) — service-level + endpoint-level tests.

**Frontend**
- `frontend/lib/api.ts` (modify) — add `getCompetitiveGap` + types.
- `frontend/components/dashboard/CompetitiveGapTrendChart.tsx` (new) — Recharts multi-line chart for the drawer.
- `frontend/components/dashboard/CompetitiveGapCard.tsx` (new) — collapsed card on Row 1.
- `frontend/components/dashboard/CompetitiveGapDrawer.tsx` (new) — side drawer with chart + table.
- `frontend/components/dashboard/index.ts` (modify) — export the three new components.
- `frontend/app/dashboard/page.tsx` (modify) — Row 1 layout shift, hoist window/data/drawer state, render card + drawer, fetch on brand change + window change.

**No new dependencies** — Recharts and Radix Dialog already installed.

---

## Task 1: Add Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Inspect the bottom of schemas.py to find a good insertion point**

Run: `tail -40 backend/app/schemas.py`
Note the section pattern (groups of related schemas with comment dividers). Plan to insert near the existing `DashboardAnalytics` block.

- [ ] **Step 2: Add the four schemas**

In `backend/app/schemas.py`, append a new section after the existing `DashboardAnalytics` schema (search for `class DashboardAnalytics`):

```python
# ── Competitive Gap ──────────────────────────────────────────────────────────


class CompetitiveGapTrendPoint(BaseModel):
    """Per-day point on the brand-level (aggregate) trend chart."""
    date: str  # ISO YYYY-MM-DD (UTC day)
    gap_pp: float
    brand_pct: float
    comp_avg_pct: float


class CompetitorTrendPoint(BaseModel):
    """Per-day point on a single competitor's trend (drives the table sparkline)."""
    date: str
    gap_pp: float  # brand_pct − competitor_pct that day


class CompetitorGapStat(BaseModel):
    competitor_id: int
    name: str
    competitor_pct: float        # window-aggregate
    gap_pp: float                # window-aggregate brand_pct − competitor_pct
    delta_pp: float | None       # gap now vs prior window of same length
    trend: list[CompetitorTrendPoint]
    has_data: bool               # false if competitor.created_at > window_end


class CompetitiveGapResponse(BaseModel):
    brand_id: int
    window: str                  # "7d" | "30d" | "90d"
    has_competitors: bool
    has_data: bool               # at least one completed run in current window
    headline_gap_pp: float | None
    headline_delta_pp: float | None
    brand_visibility_pct: float | None
    competitor_avg_pct: float | None
    trend: list[CompetitiveGapTrendPoint]
    competitors: list[CompetitorGapStat]
    sample_count: int
    confidence: str              # "low" | "medium" | "high"
```

- [ ] **Step 3: Verify import compiles**

Run: `cd backend && python -c "from app.schemas import CompetitiveGapResponse, CompetitorGapStat, CompetitorTrendPoint, CompetitiveGapTrendPoint; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(competitive-gap): add Pydantic schemas"
```

---

## Task 2: Service helper — `_resolve_window`

Maps the `"7d" | "30d" | "90d"` string to four UTC datetimes covering the current window and the immediately prior window of the same length.

**Files:**
- Create: `backend/app/services/competitive_gap.py`
- Test: `backend/tests/test_competitive_gap.py`

- [ ] **Step 1: Create the test file with the failing test**

Create `backend/tests/test_competitive_gap.py`:

```python
"""
Tests for the Competitive Gap metric (service + endpoint).
"""
from datetime import UTC, datetime, timedelta

import httpx
import pytest

pytestmark = pytest.mark.asyncio


# ── _resolve_window ──────────────────────────────────────────────────────────

def test_resolve_window_7d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("7d", now=now)

    # Naive UTC datetimes (matches TrackingRun.completed_at storage)
    assert start.tzinfo is None
    assert end.tzinfo is None
    assert end == datetime(2026, 5, 12, 14, 0, 0)
    assert start == end - timedelta(days=7)
    assert prior_end == start
    assert prior_start == start - timedelta(days=7)


def test_resolve_window_30d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("30d", now=now)

    assert (end - start) == timedelta(days=30)
    assert (prior_end - prior_start) == timedelta(days=30)
    assert prior_end == start


def test_resolve_window_90d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("90d", now=now)

    assert (end - start) == timedelta(days=90)


def test_resolve_window_invalid_raises():
    from app.services.competitive_gap import _resolve_window

    with pytest.raises(ValueError):
        _resolve_window("5d")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_competitive_gap.py -v`
Expected: 4 errors with `ModuleNotFoundError: No module named 'app.services.competitive_gap'`.

- [ ] **Step 3: Create the service module with `_resolve_window`**

Create `backend/app/services/competitive_gap.py`:

```python
"""
Competitive Gap metric — pure read-side aggregation over existing
TrackingRun / QueryResult / Competitor rows.

Headline = brand_visibility_pct − mean(competitor_visibility_pct), computed over
the selected window. Trend = the same gap_pp computed per UTC day.

Spec: docs/superpowers/specs/2026-05-12-competitive-gap-design.md
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

WindowLiteral = Literal["7d", "30d", "90d"]

_WINDOW_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}


def _resolve_window(
    window: str,
    now: datetime | None = None,
) -> tuple[datetime, datetime, datetime, datetime]:
    """
    Return (start, end, prior_start, prior_end) as naive UTC datetimes.

    `end` is `now` (default: utcnow). `start` is `end - window`. The prior
    window is the same length immediately before. All TrackingRun.completed_at
    values are naive UTC, so we strip tzinfo for direct comparison.
    """
    if window not in _WINDOW_DAYS:
        raise ValueError(f"Invalid window '{window}'; expected one of {list(_WINDOW_DAYS)}")
    days = _WINDOW_DAYS[window]
    end_aware = now or datetime.now(UTC)
    end = end_aware.astimezone(UTC).replace(tzinfo=None)
    start = end - timedelta(days=days)
    prior_end = start
    prior_start = start - timedelta(days=days)
    return start, end, prior_start, prior_end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_competitive_gap.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/competitive_gap.py backend/tests/test_competitive_gap.py
git commit -m "feat(competitive-gap): _resolve_window helper"
```

---

## Task 3: Service helper — `_mention_matches` (word-boundary fix)

Replaces the substring-match false-positive class (e.g., "Asana" inside "Casana"). Uses word-boundary regex with `re.escape` for special chars, plus the same fuzzy-normalized fallback that brand mention detection uses today.

**Files:**
- Modify: `backend/app/services/competitive_gap.py`
- Modify: `backend/tests/test_competitive_gap.py`

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/test_competitive_gap.py`:

```python
# ── _mention_matches ─────────────────────────────────────────────────────────

def test_mention_matches_exact():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("I love Notion for notes.", "Notion") is True


def test_mention_matches_case_insensitive():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("notion is great", "Notion") is True


def test_mention_matches_word_boundary_no_substring_false_positive():
    """Asana must NOT match inside Casana."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Casana raised a Series A.", "Asana") is False


def test_mention_matches_punctuation_boundary():
    """Trailing punctuation should still count as a match."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Try Asana. It's great.", "Asana") is True


def test_mention_matches_regex_metachars_escaped():
    """Names with regex metacharacters must not blow up."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("We use C++ heavily.", "C++") is True
    assert _mention_matches("See notion.so for docs.", "Notion.so") is True


def test_mention_matches_fuzzy_normalized():
    """When word-boundary fails, fall back to alphanumeric-normalized substring
    (mirrors brand detection in tracking_service)."""
    from app.services.competitive_gap import _mention_matches
    # "SpotItEarly" should match "Spot it Early" via the fuzzy path
    assert _mention_matches("Check out SpotItEarly today.", "Spot it Early") is True


def test_mention_matches_empty_text_returns_false():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("", "Notion") is False
    assert _mention_matches(None, "Notion") is False
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `cd backend && pytest tests/test_competitive_gap.py -k mention -v`
Expected: 7 errors with `ImportError` or `AttributeError` for `_mention_matches`.

- [ ] **Step 3: Add `_mention_matches` to the service module**

Append to `backend/app/services/competitive_gap.py`:

```python
import re


def _normalize(text: str) -> str:
    """Lowercase + strip non-alphanumeric (mirrors tracking_service brand detection)."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _mention_matches(text: str | None, name: str) -> bool:
    """
    True if `name` appears in `text` as a word-bounded match (case-insensitive)
    or via alphanumeric-normalized substring (handles spacing/punctuation
    variants like 'SpotItEarly' for 'Spot it Early').

    `re.escape(name)` guards against names containing regex metacharacters
    (e.g., 'C++', 'Notion.so').
    """
    if not text:
        return False
    pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
    if pattern.search(text):
        return True
    name_norm = _normalize(name)
    return bool(name_norm) and name_norm in _normalize(text)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_competitive_gap.py -k mention -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/competitive_gap.py backend/tests/test_competitive_gap.py
git commit -m "feat(competitive-gap): _mention_matches with word-boundary + fuzzy fallback"
```

---

## Task 4: Service helper — `_per_day_buckets`

Groups `(QueryResult, run_completed_at)` rows by UTC day. The dashboard ingests rows where `error IS NULL`; this helper just shoves them into a `{date: list[row]}` dict.

**Files:**
- Modify: `backend/app/services/competitive_gap.py`
- Modify: `backend/tests/test_competitive_gap.py`

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/test_competitive_gap.py`:

```python
# ── _per_day_buckets ─────────────────────────────────────────────────────────

def test_per_day_buckets_groups_by_utc_date():
    from datetime import date, datetime
    from app.services.competitive_gap import _per_day_buckets

    rows = [
        ("rowA", datetime(2026, 5, 10, 9, 0)),
        ("rowB", datetime(2026, 5, 10, 23, 30)),
        ("rowC", datetime(2026, 5, 11, 8, 0)),
    ]
    out = _per_day_buckets(rows)

    assert set(out.keys()) == {date(2026, 5, 10), date(2026, 5, 11)}
    assert len(out[date(2026, 5, 10)]) == 2
    assert len(out[date(2026, 5, 11)]) == 1


def test_per_day_buckets_empty_input_returns_empty_dict():
    from app.services.competitive_gap import _per_day_buckets
    assert _per_day_buckets([]) == {}
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `cd backend && pytest tests/test_competitive_gap.py -k per_day -v`
Expected: 2 errors — `_per_day_buckets` not defined.

- [ ] **Step 3: Add `_per_day_buckets` to the service module**

Append to `backend/app/services/competitive_gap.py`:

```python
from collections import defaultdict
from datetime import date as Date
from typing import TypeVar

T = TypeVar("T")


def _per_day_buckets(rows: list[tuple[T, datetime]]) -> dict[Date, list[T]]:
    """
    Group `(payload, when)` tuples by `when.date()`. Returned dict maps each
    UTC day (date) to the list of payloads that fell on it.
    """
    buckets: dict[Date, list[T]] = defaultdict(list)
    for payload, when in rows:
        buckets[when.date()].append(payload)
    return dict(buckets)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_competitive_gap.py -k per_day -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/competitive_gap.py backend/tests/test_competitive_gap.py
git commit -m "feat(competitive-gap): _per_day_buckets helper"
```

---

## Task 5: Service main — `compute_competitive_gap`

The orchestrator: load data, compute window-aggregate headline, build per-day trend, build per-competitor stats, return a `CompetitiveGapResponse`. This is the longest task; tests are split into focused happy-path + edge cases.

**Files:**
- Modify: `backend/app/services/competitive_gap.py`
- Modify: `backend/tests/test_competitive_gap.py`

- [ ] **Step 1: Add a seed helper at the top of the test file**

Insert near the top of `backend/tests/test_competitive_gap.py`, after `pytestmark`:

```python
from app.database import AsyncSessionLocal
from app.models import Brand, Competitor, Prompt, QueryResult, TrackingRun, User


async def _seed_brand_with_runs(
    *,
    user_email: str,
    competitors: list[tuple[str, datetime]] | None = None,  # (name, created_at)
    runs: list[dict] | None = None,
    # runs: [{"completed_at": dt, "queries": [{"model": str, "mentioned": bool, "response_text": str}]}, ...]
) -> tuple[int, int]:
    """Seed a brand + competitors + completed tracking runs with query results.

    Returns (user_id, brand_id). All competitors/runs created on the same
    AsyncSession so foreign keys resolve.
    """
    async with AsyncSessionLocal() as db:
        user = User(email=user_email, password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()

        brand = Brand(name="Acme", slug=f"acme-{user.id}", user_id=user.id, tier="basic")
        db.add(brand)
        await db.flush()

        prompt = Prompt(brand_id=brand.id, text="best CRM?")
        db.add(prompt)
        await db.flush()

        for name, created_at in competitors or []:
            db.add(Competitor(
                brand_id=brand.id,
                name=name,
                website_url=f"https://{name.lower()}.com",
                created_at=created_at,
            ))

        for run_spec in runs or []:
            run = TrackingRun(
                brand_id=brand.id,
                status="completed",
                run_type="manual",
                completed_at=run_spec["completed_at"],
                started_at=run_spec["completed_at"],
            )
            db.add(run)
            await db.flush()
            for q in run_spec.get("queries", []):
                db.add(QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=prompt.id,
                    model=q["model"],
                    run_number=1,
                    mentioned=q["mentioned"],
                    response_text=q["response_text"],
                    error=None,
                    created_at=run_spec["completed_at"],
                ))

        await db.commit()
        return user.id, brand.id
```

(If `Competitor` has different required fields than shown, adjust to match `app/models.py`. The seed only needs to be valid enough to query.)

- [ ] **Step 2: Add the happy-path failing test**

Append:

```python
# ── compute_competitive_gap (happy path) ─────────────────────────────────────

async def test_compute_happy_path_window_aggregate():
    """Brand at 2/3 (66.7%), one competitor mentioned 1/3 (33.3%) → gap +33.3pp."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    user_id, brand_id = await _seed_brand_with_runs(
        user_email="happy@example.com",
        competitors=[("Notion", today - timedelta(days=30))],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                {"model": "chatgpt", "mentioned": True, "response_text": "Acme is great."},
                {"model": "claude",  "mentioned": True, "response_text": "I'd suggest Acme."},
                {"model": "gemini",  "mentioned": False, "response_text": "Try Notion instead."},
            ],
        }],
    )

    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)

    assert resp.brand_id == brand_id
    assert resp.window == "7d"
    assert resp.has_competitors is True
    assert resp.has_data is True
    assert resp.brand_visibility_pct == pytest.approx(200 / 3, rel=1e-3)
    assert resp.competitor_avg_pct == pytest.approx(100 / 3, rel=1e-3)
    assert resp.headline_gap_pp == pytest.approx(100 / 3, rel=1e-3)  # 66.7 − 33.3
    assert resp.sample_count == 3
    assert resp.confidence == "low"  # <20 → low
    assert len(resp.competitors) == 1
    assert resp.competitors[0].name == "Notion"
    assert resp.competitors[0].competitor_pct == pytest.approx(100 / 3, rel=1e-3)
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && pytest tests/test_competitive_gap.py::test_compute_happy_path_window_aggregate -v`
Expected: ImportError on `compute_competitive_gap`.

- [ ] **Step 4: Implement `compute_competitive_gap`**

Append to `backend/app/services/competitive_gap.py`:

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, Competitor, QueryResult, TrackingRun
from app.schemas import (
    CompetitiveGapResponse,
    CompetitiveGapTrendPoint,
    CompetitorGapStat,
    CompetitorTrendPoint,
)


def _confidence(sample_count: int) -> str:
    if sample_count >= 100:
        return "high"
    if sample_count >= 20:
        return "medium"
    return "low"


def _empty_response(brand_id: int, window: str, has_competitors: bool) -> CompetitiveGapResponse:
    return CompetitiveGapResponse(
        brand_id=brand_id,
        window=window,
        has_competitors=has_competitors,
        has_data=False,
        headline_gap_pp=None,
        headline_delta_pp=None,
        brand_visibility_pct=None,
        competitor_avg_pct=None,
        trend=[],
        competitors=[],
        sample_count=0,
        confidence="low",
    )


async def compute_competitive_gap(
    *,
    brand_id: int,
    window: str,
    db: AsyncSession,
) -> CompetitiveGapResponse:
    """Read-side aggregation. See spec §4c for full algorithm."""
    start, end, prior_start, prior_end = _resolve_window(window)

    # Brand
    brand_row = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = brand_row.scalar_one()

    # Competitors
    comp_rows = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = list(comp_rows.scalars().all())
    has_competitors = len(competitors) > 0

    # Runs covering both windows
    run_rows = await db.execute(
        select(TrackingRun).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status == "completed",
            TrackingRun.completed_at >= prior_start,
            TrackingRun.completed_at <= end,
        )
    )
    runs = list(run_rows.scalars().all())
    if not runs:
        return _empty_response(brand_id, window, has_competitors)

    run_ids = [r.id for r in runs]
    run_completed: dict[int, datetime] = {r.id: r.completed_at for r in runs}

    # Query results (filter errors out — they shouldn't count toward denominator)
    qr_rows = await db.execute(
        select(QueryResult).where(
            QueryResult.tracking_run_id.in_(run_ids),
            QueryResult.error.is_(None),
        )
    )
    query_results = list(qr_rows.scalars().all())
    if not query_results:
        return _empty_response(brand_id, window, has_competitors)

    # Pair each row with its run's completed_at; partition into current/prior windows
    current_rows: list[tuple[QueryResult, datetime]] = []
    prior_rows: list[tuple[QueryResult, datetime]] = []
    for qr in query_results:
        when = run_completed.get(qr.tracking_run_id)
        if when is None:
            continue
        if start <= when <= end:
            current_rows.append((qr, when))
        elif prior_start <= when < prior_end:
            prior_rows.append((qr, when))

    if not current_rows:
        return _empty_response(brand_id, window, has_competitors)

    # ── Window-aggregate (current) ──────────────────────────────────────────
    cur_qrs = [qr for qr, _ in current_rows]
    cur_total = len(cur_qrs)
    brand_pct = sum(1 for qr in cur_qrs if qr.mentioned) / cur_total * 100.0

    def _comp_pct(qrs: list[QueryResult], comp: Competitor) -> float:
        if not qrs:
            return 0.0
        hits = sum(1 for qr in qrs if _mention_matches(qr.response_text, comp.name))
        return hits / len(qrs) * 100.0

    eligible_competitors = [c for c in competitors if c.created_at <= end]
    competitor_pcts = {c.id: _comp_pct(cur_qrs, c) for c in eligible_competitors}
    if eligible_competitors:
        comp_avg_pct = sum(competitor_pcts.values()) / len(eligible_competitors)
        headline_gap_pp = brand_pct - comp_avg_pct
    else:
        comp_avg_pct = 0.0
        headline_gap_pp = None  # no competitors to compare against

    # ── Window-aggregate (prior) for delta ──────────────────────────────────
    headline_delta_pp: float | None = None
    if prior_rows and eligible_competitors:
        prior_qrs = [qr for qr, _ in prior_rows]
        prior_brand_pct = sum(1 for qr in prior_qrs if qr.mentioned) / len(prior_qrs) * 100.0
        prior_eligible = [c for c in eligible_competitors if c.created_at <= prior_end]
        if prior_eligible:
            prior_comp_pcts = [_comp_pct(prior_qrs, c) for c in prior_eligible]
            prior_avg = sum(prior_comp_pcts) / len(prior_eligible)
            prior_gap = prior_brand_pct - prior_avg
            if headline_gap_pp is not None:
                headline_delta_pp = headline_gap_pp - prior_gap

    # ── Per-day trend ───────────────────────────────────────────────────────
    day_buckets = _per_day_buckets(current_rows)
    trend: list[CompetitiveGapTrendPoint] = []
    per_competitor_daily: dict[int, list[CompetitorTrendPoint]] = {c.id: [] for c in competitors}

    for day in sorted(day_buckets.keys()):
        day_qrs = day_buckets[day]
        if not day_qrs:
            continue
        day_total = len(day_qrs)
        day_brand_pct = sum(1 for qr in day_qrs if qr.mentioned) / day_total * 100.0
        day_eligible = [c for c in competitors if c.created_at.date() <= day]
        if day_eligible:
            day_comp_pcts = {c.id: _comp_pct(day_qrs, c) for c in day_eligible}
            day_comp_avg = sum(day_comp_pcts.values()) / len(day_eligible)
            day_gap = day_brand_pct - day_comp_avg
        else:
            day_comp_pcts = {}
            day_comp_avg = 0.0
            day_gap = day_brand_pct  # no eligible competitors that day

        trend.append(CompetitiveGapTrendPoint(
            date=day.isoformat(),
            gap_pp=round(day_gap, 2),
            brand_pct=round(day_brand_pct, 2),
            comp_avg_pct=round(day_comp_avg, 2),
        ))

        for c in competitors:
            if c.id not in day_comp_pcts:
                continue
            per_competitor_daily[c.id].append(CompetitorTrendPoint(
                date=day.isoformat(),
                gap_pp=round(day_brand_pct - day_comp_pcts[c.id], 2),
            ))

    # ── Per-competitor stats ────────────────────────────────────────────────
    comp_stats: list[CompetitorGapStat] = []
    for c in competitors:
        eligible_now = c.created_at <= end
        if not eligible_now:
            comp_stats.append(CompetitorGapStat(
                competitor_id=c.id,
                name=c.name,
                competitor_pct=0.0,
                gap_pp=0.0,
                delta_pp=None,
                trend=[],
                has_data=False,
            ))
            continue
        c_pct = competitor_pcts.get(c.id, 0.0)
        c_gap = brand_pct - c_pct
        # Per-competitor delta: same window-aggregate trick
        c_delta: float | None = None
        if prior_rows and c.created_at <= prior_end:
            prior_qrs = [qr for qr, _ in prior_rows]
            prior_brand_pct = sum(1 for qr in prior_qrs if qr.mentioned) / len(prior_qrs) * 100.0 if prior_qrs else 0.0
            prior_c_pct = _comp_pct(prior_qrs, c)
            c_delta = c_gap - (prior_brand_pct - prior_c_pct)
        comp_stats.append(CompetitorGapStat(
            competitor_id=c.id,
            name=c.name,
            competitor_pct=round(c_pct, 2),
            gap_pp=round(c_gap, 2),
            delta_pp=round(c_delta, 2) if c_delta is not None else None,
            trend=per_competitor_daily.get(c.id, []),
            has_data=True,
        ))

    return CompetitiveGapResponse(
        brand_id=brand_id,
        window=window,
        has_competitors=has_competitors,
        has_data=True,
        headline_gap_pp=round(headline_gap_pp, 2) if headline_gap_pp is not None else None,
        headline_delta_pp=round(headline_delta_pp, 2) if headline_delta_pp is not None else None,
        brand_visibility_pct=round(brand_pct, 2),
        competitor_avg_pct=round(comp_avg_pct, 2) if eligible_competitors else None,
        trend=trend,
        competitors=comp_stats,
        sample_count=cur_total,
        confidence=_confidence(cur_total),
    )
```

- [ ] **Step 5: Run happy-path test to verify it passes**

Run: `cd backend && pytest tests/test_competitive_gap.py::test_compute_happy_path_window_aggregate -v`
Expected: PASS.

- [ ] **Step 6: Add edge-case tests**

Append to `backend/tests/test_competitive_gap.py`:

```python
# ── compute_competitive_gap (edges) ──────────────────────────────────────────

async def test_compute_no_competitors_returns_has_competitors_false():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    _, brand_id = await _seed_brand_with_runs(
        user_email="nocomp@example.com",
        competitors=[],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"model": "chatgpt", "mentioned": True, "response_text": "Acme!"}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert resp.has_competitors is False
    assert resp.headline_gap_pp is None
    assert resp.competitor_avg_pct is None
    assert resp.competitors == []


async def test_compute_no_runs_returns_has_data_false():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    _, brand_id = await _seed_brand_with_runs(
        user_email="noruns@example.com",
        competitors=[("Notion", today - timedelta(days=30))],
        runs=[],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert resp.has_competitors is True
    assert resp.has_data is False
    assert resp.headline_gap_pp is None


async def test_compute_recently_added_competitor_marked_no_data():
    """Competitor created today is excluded from prior-window aggregate;
    appears in the response with has_data=False if also after window_end."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    # Competitor created in the FUTURE relative to window end → has_data False
    _, brand_id = await _seed_brand_with_runs(
        user_email="recentcomp@example.com",
        competitors=[("FutureCo", today + timedelta(days=1))],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"model": "chatgpt", "mentioned": True, "response_text": "Acme is great."}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert len(resp.competitors) == 1
    assert resp.competitors[0].has_data is False
    # Headline gap is None — no eligible competitors in the window
    assert resp.headline_gap_pp is None


async def test_compute_per_day_trend_groups_multiple_runs_same_day():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today_morning = datetime.utcnow().replace(hour=8, minute=0, second=0, microsecond=0)
    today_evening = today_morning.replace(hour=20)
    _, brand_id = await _seed_brand_with_runs(
        user_email="multiday@example.com",
        competitors=[("Notion", today_morning - timedelta(days=30))],
        runs=[
            {"completed_at": today_morning, "queries": [
                {"model": "chatgpt", "mentioned": True, "response_text": "Acme."},
            ]},
            {"completed_at": today_evening, "queries": [
                {"model": "chatgpt", "mentioned": False, "response_text": "Notion."},
            ]},
        ],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    # Both runs same UTC day → 1 trend point
    assert len(resp.trend) == 1


def test_confidence_thresholds():
    from app.services.competitive_gap import _confidence
    assert _confidence(0) == "low"
    assert _confidence(19) == "low"
    assert _confidence(20) == "medium"
    assert _confidence(99) == "medium"
    assert _confidence(100) == "high"
    assert _confidence(500) == "high"
```

- [ ] **Step 7: Run full test file to verify all pass**

Run: `cd backend && pytest tests/test_competitive_gap.py -v`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/competitive_gap.py backend/tests/test_competitive_gap.py
git commit -m "feat(competitive-gap): compute_competitive_gap orchestrator + edges"
```

---

## Task 6: Apply word-boundary fix to existing SOV path

The current `dashboard.py` analytics endpoint computes competitor mention counts via `comp_lower in qr.response_text.lower()`. Replace with the new `_mention_matches` helper so SOV stops false-positive-ing on substrings.

**Files:**
- Modify: `backend/app/routers/dashboard.py:308-315`

- [ ] **Step 1: Verify the current SOV substring code is at the expected location**

Run: `cd backend && grep -n "comp_lower in qr.response_text.lower" app/routers/dashboard.py`
Expected: one hit, around line 312.

- [ ] **Step 2: Replace the substring match with the helper**

In `backend/app/routers/dashboard.py`, change:

```python
    # 5. SOV
    brand_mentions = sum(1 for qr, _ in rows if qr.mentioned)
    comp_counts: dict[str, int] = {}
    for comp in competitors:
        comp_lower = comp.name.lower()
        comp_counts[comp.name] = sum(
            1 for qr, _ in rows
            if qr.response_text and comp_lower in qr.response_text.lower()
        )
```

to:

```python
    # 5. SOV
    from app.services.competitive_gap import _mention_matches
    brand_mentions = sum(1 for qr, _ in rows if qr.mentioned)
    comp_counts: dict[str, int] = {}
    for comp in competitors:
        comp_counts[comp.name] = sum(
            1 for qr, _ in rows
            if _mention_matches(qr.response_text, comp.name)
        )
```

(Move the `from app.services.competitive_gap import _mention_matches` to the top-of-file imports if you prefer; an in-function import is also fine since it avoids import-cycle risk.)

- [ ] **Step 3: Re-run the dashboard analytics test suite to ensure nothing broke**

Run: `cd backend && pytest tests/ -k dashboard -v`
Expected: all dashboard tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/dashboard.py
git commit -m "fix(dashboard): SOV competitor counting uses word-boundary match"
```

---

## Task 7: Add the GET endpoint + endpoint tests

**Files:**
- Modify: `backend/app/routers/dashboard.py`
- Modify: `backend/tests/test_competitive_gap.py`

- [ ] **Step 1: Append failing endpoint tests**

Append to `backend/tests/test_competitive_gap.py`:

```python
# ── Endpoint: GET /api/dashboard/{brand_id}/competitive-gap ─────────────────

from tests.conftest import register_and_login, create_brand


async def test_endpoint_unauthenticated_returns_401(client: httpx.AsyncClient):
    resp = await client.get("/api/dashboard/1/competitive-gap")
    assert resp.status_code == 401


async def test_endpoint_wrong_owner_returns_404(client: httpx.AsyncClient):
    # User A creates brand
    await register_and_login(client, email="owner@example.com")
    a_brand = await create_brand(client, name="A Brand")
    a_brand_id = a_brand["id"]
    # User B tries to read it
    await register_and_login(client, email="other@example.com")
    resp = await client.get(f"/api/dashboard/{a_brand_id}/competitive-gap")
    # get_brand_for_user raises 404 on wrong-owner (matches existing dashboard endpoints)
    assert resp.status_code == 404


async def test_endpoint_default_window_is_7d(client: httpx.AsyncClient):
    await register_and_login(client, email="defwin@example.com")
    brand = await create_brand(client, name="Defwin Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap")
    assert resp.status_code == 200
    assert resp.json()["window"] == "7d"


async def test_endpoint_invalid_window_returns_422(client: httpx.AsyncClient):
    await register_and_login(client, email="badwin@example.com")
    brand = await create_brand(client, name="Badwin Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap?window=5d")
    assert resp.status_code == 422


async def test_endpoint_each_window_value(client: httpx.AsyncClient):
    await register_and_login(client, email="allwin@example.com")
    brand = await create_brand(client, name="Allwin Brand")
    for w in ("7d", "30d", "90d"):
        resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap?window={w}")
        assert resp.status_code == 200
        assert resp.json()["window"] == w


async def test_endpoint_no_competitors_returns_empty_shape(client: httpx.AsyncClient):
    await register_and_login(client, email="empty@example.com")
    brand = await create_brand(client, name="Empty Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap")
    body = resp.json()
    assert resp.status_code == 200
    assert body["has_competitors"] is False
    assert body["has_data"] is False
    assert body["headline_gap_pp"] is None
    assert body["competitors"] == []
```

- [ ] **Step 2: Run new endpoint tests to verify they fail**

Run: `cd backend && pytest tests/test_competitive_gap.py -k endpoint -v`
Expected: most fail with 404 (endpoint not registered).

- [ ] **Step 3: Add the endpoint to `dashboard.py`**

In `backend/app/routers/dashboard.py`, add this new endpoint AFTER the existing `get_analytics` route (anywhere below it is fine):

```python
from typing import Literal as _LiteralAlias  # alias to avoid clobbering existing names

from app.schemas import CompetitiveGapResponse


@router.get("/{brand_id}/competitive-gap", response_model=CompetitiveGapResponse)
async def get_competitive_gap(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    window: _LiteralAlias["7d", "30d", "90d"] = "7d",
) -> CompetitiveGapResponse:
    """
    Return the brand's competitive gap (visibility delta vs competitor average)
    over the requested window. Drives the dashboard's Competitive Gap card +
    drawer. See spec docs/superpowers/specs/2026-05-12-competitive-gap-design.md.
    """
    # Ownership check (raises 404 on miss — matches existing dashboard endpoints)
    await get_brand_for_user(brand_id, db, user)

    from app.services.competitive_gap import compute_competitive_gap
    return await compute_competitive_gap(brand_id=brand_id, window=window, db=db)
```

(If `get_brand_for_user` is already imported at the top of `dashboard.py`, skip the duplicate import. Verify the existing import line covers it.)

- [ ] **Step 4: Run all competitive-gap tests**

Run: `cd backend && pytest tests/test_competitive_gap.py -v`
Expected: all green.

- [ ] **Step 5: Run the full backend test suite to ensure no regressions**

Run: `cd backend && pytest tests/ -x --tb=short`
Expected: all tests pass. If a flaky test trips, re-run once before investigating.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/dashboard.py backend/tests/test_competitive_gap.py
git commit -m "feat(competitive-gap): GET /api/dashboard/{brand_id}/competitive-gap"
```

---

## Task 8: Frontend API client + types

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Inspect where existing dashboard API methods live**

Run: `cd frontend && grep -n "getDashboardAnalytics\|DashboardAnalytics" lib/api.ts | head -10`
Note the surrounding section so the new types/method match style.

- [ ] **Step 2: Add types and the API method**

In `frontend/lib/api.ts`, add these types near the existing `DashboardAnalytics` type:

```typescript
export type CompetitiveGapWindow = '7d' | '30d' | '90d';

export interface CompetitiveGapTrendPoint {
  date: string;
  gap_pp: number;
  brand_pct: number;
  comp_avg_pct: number;
}

export interface CompetitorTrendPoint {
  date: string;
  gap_pp: number;
}

export interface CompetitorGapStat {
  competitor_id: number;
  name: string;
  competitor_pct: number;
  gap_pp: number;
  delta_pp: number | null;
  trend: CompetitorTrendPoint[];
  has_data: boolean;
}

export interface CompetitiveGapResponse {
  brand_id: number;
  window: CompetitiveGapWindow;
  has_competitors: boolean;
  has_data: boolean;
  headline_gap_pp: number | null;
  headline_delta_pp: number | null;
  brand_visibility_pct: number | null;
  competitor_avg_pct: number | null;
  trend: CompetitiveGapTrendPoint[];
  competitors: CompetitorGapStat[];
  sample_count: number;
  confidence: 'low' | 'medium' | 'high';
}
```

Then add the API method near `getDashboardAnalytics`:

```typescript
export async function getCompetitiveGap(
  brandId: number,
  window: CompetitiveGapWindow = '7d',
): Promise<CompetitiveGapResponse> {
  const res = await api.get<CompetitiveGapResponse>(
    `/dashboard/${brandId}/competitive-gap`,
    { params: { window } },
  );
  return res.data;
}
```

(`api` is the existing Axios instance — confirm by inspecting one of the nearby methods like `getDashboardAnalytics`.)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npm run lint`
Expected: no new errors. (Warnings unrelated to this work are fine.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(competitive-gap): frontend API client + types"
```

---

## Task 9: `CompetitiveGapTrendChart` component

The Recharts multi-line chart used inside the drawer. Factored out so it stays small and isolated.

**Files:**
- Create: `frontend/components/dashboard/CompetitiveGapTrendChart.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/dashboard/CompetitiveGapTrendChart.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CompetitiveGapResponse } from '@/lib/api';

const COMPETITOR_COLORS = [
  '#7c8aaa', '#8a7ca5', '#7ca58a', '#a5917c',
  '#7c9ba5', '#a57c8a', '#9a9a7c', '#7c88a5',
];

interface Props {
  data: CompetitiveGapResponse;
}

/**
 * Combined visibility chart: brand line bold (accent), each competitor's line
 * dashed in a muted color. Click a legend entry to toggle that line on/off.
 */
export function CompetitiveGapTrendChart({ data }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Build chart-ready rows: { date, you, [competitorName]: pct }
  // Brand pct comes from the brand-level trend; per-competitor pcts are
  // derived as `brand_pct - comp.trend.gap_pp` for each (date, competitor) pair.
  const competitorTrendByDate = new Map<string, Record<string, number>>();
  for (const comp of data.competitors) {
    if (!comp.has_data) continue;
    for (const point of comp.trend) {
      const row = competitorTrendByDate.get(point.date) ?? {};
      // recover competitor pct: brand_pct - gap_pp on that day
      const brandPctOnDay = data.trend.find((t) => t.date === point.date)?.brand_pct;
      if (brandPctOnDay === undefined) continue;
      row[comp.name] = brandPctOnDay - point.gap_pp;
      competitorTrendByDate.set(point.date, row);
    }
  }

  const chartData = data.trend.map((t) => ({
    date: t.date,
    you: t.brand_pct,
    ...(competitorTrendByDate.get(t.date) ?? {}),
  }));

  if (chartData.length < 2) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-[var(--text-faint)]">
        Trend appears once you have at least 2 days of data.
      </div>
    );
  }

  const toggle = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="w-full" style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} />
          <YAxis
            unit="%"
            tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              fontSize: 11,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            onClick={(e) => toggle(String(e.dataKey))}
          />
          {!hidden.has('you') && (
            <Line
              type="monotone"
              dataKey="you"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              name="You"
            />
          )}
          {data.competitors.map((c, i) => {
            if (!c.has_data || hidden.has(c.name)) return null;
            return (
              <Line
                key={c.competitor_id}
                type="monotone"
                dataKey={c.name}
                stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
                strokeDasharray="4 3"
                strokeWidth={1}
                dot={false}
                name={c.name}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npm run lint -- --max-warnings=0 components/dashboard/CompetitiveGapTrendChart.tsx`
Expected: no errors specific to this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/dashboard/CompetitiveGapTrendChart.tsx
git commit -m "feat(competitive-gap): trend chart component"
```

---

## Task 10: `CompetitiveGapCard` component (collapsed)

**Files:**
- Create: `frontend/components/dashboard/CompetitiveGapCard.tsx`

- [ ] **Step 1: Inspect the existing VisibilityChart card for styling reference**

Run: `cd frontend && head -80 components/dashboard/VisibilityChart.tsx`
Note the `card` class, header pattern, sparkline use, sub-text styling. Match it.

- [ ] **Step 2: Create the component**

Create `frontend/components/dashboard/CompetitiveGapCard.tsx`:

```tsx
'use client';

import { ResponsiveContainer, Line, LineChart, ReferenceLine } from 'recharts';
import { ArrowRight, Users } from 'lucide-react';
import type { CompetitiveGapResponse, CompetitiveGapWindow } from '@/lib/api';
import { HelpTooltip } from './HelpTooltip';

interface Props {
  data: CompetitiveGapResponse | null;
  loading: boolean;
  window: CompetitiveGapWindow;
  onWindowChange: (w: CompetitiveGapWindow) => void;
  onExpand: () => void;
  onAddCompetitorsClick: () => void;
}

const WINDOWS: CompetitiveGapWindow[] = ['7d', '30d', '90d'];

function formatGap(pp: number | null): string {
  if (pp === null) return '—';
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)}pp`;
}

function gapColor(pp: number | null): string {
  if (pp === null || pp === 0) return 'var(--text-faint)';
  return pp > 0 ? 'var(--success)' : 'var(--danger)';
}

function slopeColor(trend: { gap_pp: number }[]): string {
  if (trend.length < 2) return 'var(--text-faint)';
  const slope = trend[trend.length - 1].gap_pp - trend[0].gap_pp;
  return slope >= 0 ? 'var(--success)' : 'var(--danger)';
}

export function CompetitiveGapCard({
  data, loading, window, onWindowChange, onExpand, onAddCompetitorsClick,
}: Props) {
  // ── Loading
  if (loading) {
    return (
      <div className="card p-5 flex flex-col gap-3">
        <div className="h-4 w-32 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
        <div className="h-10 w-24 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
        <div className="h-12 w-full bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
      </div>
    );
  }

  // ── No competitors
  if (data && !data.has_competitors) {
    return (
      <div className="card p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
            Competitive Gap
            <HelpTooltip text="How far ahead or behind you are vs the average competitor — and whether the gap is closing." />
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 mt-2">
          <p className="text-xs text-[var(--text-faint)]">
            Add competitors to see your AI-visibility gap.
          </p>
          <button
            onClick={onAddCompetitorsClick}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[rgba(255,255,255,0.06)] hover:bg-[var(--accent-muted)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Users size={12} />
            Add competitors
          </button>
        </div>
      </div>
    );
  }

  const oneCompetitor = data && data.competitors.length === 1 ? data.competitors[0] : null;
  const subLabel = oneCompetitor ? `vs ${oneCompetitor.name}` : 'vs competitor avg';

  // ── No data yet
  if (data && !data.has_data) {
    return (
      <div className="card p-5 flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">—</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          {data.has_competitors
            ? 'Run a report to see your competitive position.'
            : 'No data in this window — try 30d or 90d.'}
        </p>
      </div>
    );
  }

  // ── Window has no data (has competitors + has_data was false handled above)
  if (data && data.trend.length === 0) {
    return (
      <div className="card p-5 flex flex-col">
        <CardHeader window={window} onWindowChange={onWindowChange} />
        <p className="text-3xl font-bold text-[var(--text-primary)] mt-2">—</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">
          No runs in this window — try 30d or 90d.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const headlineGap = data.headline_gap_pp;
  const delta = data.headline_delta_pp;
  const sparkData = data.trend;
  const showSparkline = sparkData.length >= 2;
  const topThree = [...data.competitors]
    .filter((c) => c.has_data)
    .sort((a, b) => Math.abs(b.gap_pp) - Math.abs(a.gap_pp))
    .slice(0, 3);
  const remaining = data.competitors.filter((c) => c.has_data).length - topThree.length;

  return (
    <button
      type="button"
      onClick={onExpand}
      className="card p-5 flex flex-col text-left hover:border-[var(--accent-border)] transition-colors group relative"
    >
      <ArrowRight
        size={14}
        className="absolute top-4 right-4 text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors"
        aria-hidden="true"
      />
      <CardHeader
        window={window}
        onWindowChange={(w) => { onWindowChange(w); /* don't expand */ }}
      />

      <div className="mt-2">
        <p
          className="text-3xl font-bold tabular-nums"
          style={{ color: gapColor(headlineGap) }}
        >
          {formatGap(headlineGap)}
        </p>
        <p className="text-xs text-[var(--text-faint)] mt-1">{subLabel}</p>
      </div>

      {showSparkline && (
        <div className="mt-3" style={{ height: 36 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" />
              <Line
                type="monotone"
                dataKey="gap_pp"
                stroke={slopeColor(sparkData)}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {delta !== null && delta !== undefined && (
        <p className="text-xs text-[var(--text-muted)] mt-2 tabular-nums">
          <span style={{ color: gapColor(delta) }}>
            {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}{delta.toFixed(1)}pp
          </span>{' '}
          vs prior {window}
        </p>
      )}

      {topThree.length > 0 && (
        <p className="text-[10px] text-[var(--text-faint)] mt-2">
          {topThree.map((c, i) => (
            <span key={c.competitor_id}>
              {i > 0 && <span className="mx-1">·</span>}
              <span className="text-[var(--text-muted)]">{c.name} </span>
              <span style={{ color: gapColor(c.gap_pp) }} className="tabular-nums">
                {formatGap(c.gap_pp)}
              </span>
            </span>
          ))}
          {remaining > 0 && <span className="ml-1">…and {remaining} more</span>}
        </p>
      )}
    </button>
  );
}

function CardHeader({
  window, onWindowChange,
}: { window: CompetitiveGapWindow; onWindowChange: (w: CompetitiveGapWindow) => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-[var(--text-secondary)] flex items-center">
        Competitive Gap
        <HelpTooltip text="How far ahead or behind you are vs the average competitor — and whether the gap is closing." />
      </p>
      <div className="flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={(e) => { e.stopPropagation(); onWindowChange(w); }}
            className={`px-2 py-0.5 rounded text-[10px] tabular-nums transition-colors ${
              w === window
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npm run lint -- --max-warnings=0 components/dashboard/CompetitiveGapCard.tsx`
Expected: no errors specific to this file.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboard/CompetitiveGapCard.tsx
git commit -m "feat(competitive-gap): collapsed dashboard card"
```

---

## Task 11: `CompetitiveGapDrawer` component (expanded)

**Files:**
- Create: `frontend/components/dashboard/CompetitiveGapDrawer.tsx`

- [ ] **Step 1: Inspect the existing CompetitorModal for the dialog pattern**

Run: `cd frontend && head -80 components/CompetitorModal.tsx`
Note how it uses Radix `Dialog` (or whatever the project uses). Match that.

- [ ] **Step 2: Create the component**

Create `frontend/components/dashboard/CompetitiveGapDrawer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveContainer, Line, LineChart, ReferenceLine } from 'recharts';
import type { CompetitiveGapResponse, CompetitiveGapWindow, CompetitorGapStat } from '@/lib/api';
import { CompetitiveGapTrendChart } from './CompetitiveGapTrendChart';
import { AskCoachButton } from '@/components/coach/AskCoachButton';

interface Props {
  open: boolean;
  onClose: () => void;
  brandId: number | null;
  brandName: string;
  data: CompetitiveGapResponse | null;
  window: CompetitiveGapWindow;
  onWindowChange: (w: CompetitiveGapWindow) => void;
}

const WINDOWS: CompetitiveGapWindow[] = ['7d', '30d', '90d'];

type SortKey = 'gap_pp' | 'name' | 'competitor_pct';

function formatPp(pp: number | null): string {
  if (pp === null) return '—';
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)}pp`;
}

function ppColor(pp: number | null): string {
  if (pp === null || pp === 0) return 'var(--text-faint)';
  return pp > 0 ? 'var(--success)' : 'var(--danger)';
}

export function CompetitiveGapDrawer({
  open, onClose, brandId, brandName, data, window, onWindowChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('gap_pp');
  const [sortDesc, setSortDesc] = useState(true);

  if (!data || brandId === null) return null;

  const sortedComps: CompetitorGapStat[] = [...data.competitors].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'competitor_pct') cmp = a.competitor_pct - b.competitor_pct;
    else cmp = Math.abs(a.gap_pp) - Math.abs(b.gap_pp);
    return sortDesc ? -cmp : cmp;
  });

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc(!sortDesc);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span>Competitive Gap — {brandName}</span>
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onWindowChange(w)}
                  className={`px-2 py-0.5 rounded text-[10px] tabular-nums transition-colors ${
                    w === window
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </DialogTitle>
        </DialogHeader>

        {data.confidence === 'low' && data.has_data && (
          <div className="bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] rounded-lg px-3 py-2 text-xs text-[var(--warning)]">
            Based on {data.sample_count} queries — results stabilize after more runs.
          </div>
        )}

        {/* Headline strip */}
        <div className="flex items-baseline gap-4">
          <p className="text-3xl font-bold tabular-nums" style={{ color: ppColor(data.headline_gap_pp) }}>
            {formatPp(data.headline_gap_pp)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Your visibility {data.brand_visibility_pct?.toFixed(1) ?? '—'}%
            {' · '}
            Competitor average {data.competitor_avg_pct?.toFixed(1) ?? '—'}%
          </p>
          {data.headline_delta_pp !== null && (
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              <span style={{ color: ppColor(data.headline_delta_pp) }}>
                {data.headline_delta_pp > 0 ? '↑ +' : data.headline_delta_pp < 0 ? '↓ ' : ''}
                {data.headline_delta_pp.toFixed(1)}pp
              </span>{' '}
              vs prior {window}
            </p>
          )}
        </div>

        {/* Combined chart */}
        <div className="mt-2">
          <CompetitiveGapTrendChart data={data} />
        </div>

        {/* Per-competitor table */}
        <div className="mt-4">
          <table className="w-full text-xs">
            <thead className="text-[var(--text-faint)] uppercase text-[10px]">
              <tr>
                <th className="text-left py-2 cursor-pointer" onClick={() => toggleSort('name')}>Competitor</th>
                <th className="text-right py-2">You</th>
                <th className="text-right py-2 cursor-pointer" onClick={() => toggleSort('competitor_pct')}>Them</th>
                <th className="text-right py-2 cursor-pointer" onClick={() => toggleSort('gap_pp')}>Gap</th>
                <th className="text-right py-2">Δ</th>
                <th className="text-right py-2">Trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedComps.map((c) => {
                if (!c.has_data) {
                  return (
                    <tr key={c.competitor_id} className="border-t border-[rgba(255,255,255,0.04)]">
                      <td className="py-2 text-[var(--text-secondary)]">{c.name}</td>
                      <td colSpan={5} className="py-2 text-[var(--text-faint)] text-right">
                        Added recently — needs more data
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={c.competitor_id} className="border-t border-[rgba(255,255,255,0.04)]">
                    <td className="py-2 text-[var(--text-secondary)]">
                      {c.name}
                      {c.gap_pp < 0 && (
                        <AskCoachButton
                          brandId={brandId}
                          question={`Why is ${c.name} outperforming us in AI visibility over the last ${window}?`}
                          className="ml-2 text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] underline underline-offset-2"
                        >
                          Why are they ahead?
                        </AskCoachButton>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {data.brand_visibility_pct?.toFixed(1) ?? '—'}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {c.competitor_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold" style={{ color: ppColor(c.gap_pp) }}>
                      {formatPp(c.gap_pp)}
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: ppColor(c.delta_pp) }}>
                      {c.delta_pp !== null ? formatPp(c.delta_pp) : '—'}
                    </td>
                    <td className="py-2" style={{ width: 80, height: 24 }}>
                      {c.trend.length >= 2 ? (
                        <ResponsiveContainer width="100%" height={24}>
                          <LineChart data={c.trend}>
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                            <Line type="monotone" dataKey="gap_pp" stroke={ppColor(c.gap_pp)} strokeWidth={1} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <span className="text-[var(--text-faint)] text-right block">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npm run lint -- --max-warnings=0 components/dashboard/CompetitiveGapDrawer.tsx`
Expected: no errors specific to this file. (If `Dialog` import path differs, fix it to match the project's actual UI module.)

- [ ] **Step 4: Export the new components from the dashboard index**

In `frontend/components/dashboard/index.ts`, add:

```typescript
export { CompetitiveGapCard } from './CompetitiveGapCard';
export { CompetitiveGapDrawer } from './CompetitiveGapDrawer';
export { CompetitiveGapTrendChart } from './CompetitiveGapTrendChart';
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboard/CompetitiveGapDrawer.tsx frontend/components/dashboard/index.ts
git commit -m "feat(competitive-gap): expanded drawer + dashboard exports"
```

---

## Task 12: Wire into the dashboard page

The visible result. Row 1 changes from `Visibility | (right column)` to `Visibility | Competitive Gap`, and the previous right column moves to a new Row 2.

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Add state + data fetching for the new metric**

In `frontend/app/dashboard/page.tsx`:

(a) Add to the imports near the existing `getDashboardAnalytics` import:

```typescript
import {
  // ...existing,
  getCompetitiveGap,
  CompetitiveGapResponse,
  CompetitiveGapWindow,
} from '@/lib/api';
import { CompetitiveGapCard, CompetitiveGapDrawer } from '@/components/dashboard';
```

(b) Add state hooks alongside the other dashboard state (near `analytics` / `loadingAnalytics`):

```typescript
const [competitiveGap, setCompetitiveGap] = useState<CompetitiveGapResponse | null>(null);
const [gapWindow, setGapWindow] = useState<CompetitiveGapWindow>('7d');
const [gapLoading, setGapLoading] = useState(false);
const [gapDrawerOpen, setGapDrawerOpen] = useState(false);
```

(c) Inside the `loadData` callback, add a parallel fetch:

```typescript
const gapPromise = getCompetitiveGap(brandId, gapWindow).catch((err) => {
  logError(err, 'Dashboard: fetch competitive gap');
  return null;
});

// Update the existing Promise.all to include `gapPromise`:
const [ov, tr, an, runs, detail, bp, comps, resps, gap] = await Promise.all([
  // ...existing promises, add at the end:
  gapPromise,
]);

// After the abort guard:
setCompetitiveGap(gap);
```

(d) Add a separate effect that re-fetches just the competitive gap when the window changes (so toggling 7d/30d/90d doesn't reload everything):

```typescript
useEffect(() => {
  if (!selectedBrandId) return;
  setGapLoading(true);
  getCompetitiveGap(selectedBrandId, gapWindow)
    .then((res) => setCompetitiveGap(res))
    .catch((err) => logError(err, 'Dashboard: refetch competitive gap'))
    .finally(() => setGapLoading(false));
}, [selectedBrandId, gapWindow]);
```

- [ ] **Step 2: Restructure Row 1 + insert Row 2**

In `frontend/app/dashboard/page.tsx`, find the existing Row 1 grid:

```tsx
{/* Row 1: visibility (left) + prompt/sentiment/sov (right) */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
  {/* Visibility score + sparkline */}
  <VisibilityChart ... />

  {/* Right column: Best Prompt + Sentiment on top, SOV below */}
  <div className="flex flex-col gap-3">
    {/* ...existing right-column markup... */}
  </div>
</div>
```

Replace it with:

```tsx
{/* Row 1: Visibility Score | Competitive Gap */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
  <VisibilityChart
    score={score}
    scoreDelta={scoreDelta}
    sinceLastRun={sinceLastRun}
    sparkData={sparkData}
    nextReportHours={nextReportHours}
    loadingAnalytics={loadingAnalytics}
    scoreConfidence={analytics?.score_confidence}
    activeModels={analytics?.active_models}
    brandId={selectedBrandId ?? undefined}
  />
  <CompetitiveGapCard
    data={competitiveGap}
    loading={gapLoading || loadingAnalytics}
    window={gapWindow}
    onWindowChange={setGapWindow}
    onExpand={() => setGapDrawerOpen(true)}
    onAddCompetitorsClick={() => setCompetitorModalOpen(true)}
  />
</div>

{/* Row 2: Best Prompt + Sentiment | SOV (was the right column of old Row 1) */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <BestPromptCard responses={responses} loading={loadingAnalytics} />
    {/* Sentiment card — copy the JSX from the old right column */}
    {/* ...existing Sentiment markup... */}
  </div>
  <div className="card p-5">
    {/* SOV — copy the JSX from the old right column */}
    {/* ...existing SOV markup... */}
  </div>
</div>
```

(Concretely: cut the existing Sentiment card JSX and SOV card JSX out of the old right column and paste them into the new Row 2 layout. Don't recreate them from scratch — preserve all existing logic, including `setCompetitorModalOpen`, `analytics?.competitor_comparison`, etc.)

- [ ] **Step 3: Render the drawer at the bottom of the JSX (alongside other modals)**

Near the existing modal renders (`promptModalOpen && ...` and `competitorModalOpen && ...`), add:

```tsx
<CompetitiveGapDrawer
  open={gapDrawerOpen}
  onClose={() => setGapDrawerOpen(false)}
  brandId={selectedBrandId}
  brandName={selectedBrand?.name ?? ''}
  data={competitiveGap}
  window={gapWindow}
  onWindowChange={setGapWindow}
/>
```

- [ ] **Step 4: Type-check the page**

Run: `cd frontend && npm run lint`
Expected: no new errors. Fix any TypeScript issues that surface.

- [ ] **Step 5: Build to be sure**

Run: `cd frontend && npm run build`
Expected: build succeeds. (If it fails on unrelated lint warnings being errors, scope the fix to imports/types in this PR.)

- [ ] **Step 6: Manual smoke-test in the browser**

Per memory: backend runs on port 3001 and frontend on port 3002.

1. Start backend: `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`
2. Start frontend: `cd frontend && npm run dev` (binds to 3002 per project convention).
3. Open http://localhost:3002/dashboard.
4. Verify: Row 1 shows Visibility Score (left) + Competitive Gap (right). Row 2 shows Best Prompt + Sentiment + SOV. Toggling 7d/30d/90d on the card refetches without reloading anything else. Clicking the card opens the drawer with the chart + table. Closing the drawer keeps the card state.
5. Test no-competitors brand → card shows "Add competitors" CTA.
6. Test brand with no completed runs → card shows `—` with appropriate sub-text.

State explicitly in the commit message which states you tested and which are still untested.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(competitive-gap): wire card + drawer into dashboard

Row 1 is now Visibility Score | Competitive Gap. Best Prompt /
Sentiment / SOV move to Row 2. Window toggle (7d/30d/90d) re-fetches
the gap data without reloading the rest of the dashboard."
```

---

## Self-Review Checklist (run before declaring done)

After all 12 tasks, verify:

- [ ] `cd backend && pytest tests/ -x` — full suite green.
- [ ] `cd backend && pytest tests/test_competitive_gap.py -v` — every test in this PR green.
- [ ] `cd frontend && npm run lint` — no new errors.
- [ ] `cd frontend && npm run build` — production build succeeds.
- [ ] Dashboard manual check (Step 6 of Task 12) — at least the happy path was clicked through in a real browser.
- [ ] Spec coverage:
  - Section 3a (formula) → Task 5 happy-path test asserts the math.
  - Section 3b (per-day vs window-aggregate) → Task 5 (orchestrator) + Task 5 multi-runs-same-day test.
  - Section 3c (confidence) → Task 5 thresholds test.
  - Section 3d (word-boundary mention) → Task 3 + Task 6 (existing SOV path).
  - Section 4 (endpoint + schema) → Tasks 1, 7.
  - Section 5 (card + drawer + layout shift) → Tasks 9, 10, 11, 12.
  - Section 6 case 1 (single competitor copy) → Card sub-label adapts in Task 10.
  - Section 6 case 2 (recently-added competitor) → Task 5 test + drawer "Added recently" row in Task 11.
  - Section 6 case 3-9 (other edges) → empty/loading states in Tasks 10, 11.
  - Section 7 (no tier gating) → endpoint has no tier check (Task 7).
  - Section 8 (out of scope) → none of those features are in any task.
  - Section 9 (tests) → Tasks 2-7 cover every listed test.
  - Section 11 (files summary) → matches the File Structure section above.

If anything is missing, write the missing task before declaring done.
