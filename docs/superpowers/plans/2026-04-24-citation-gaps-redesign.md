# Citation Gaps Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's "Citation Gaps" widget with "Sources you're missing from" — an actionable, draftable-platforms-only list with one CTA per row that routes into the content hub with the platform pre-selected.

**Architecture:** Backend filters/normalizes domains to the 6 supported drafting platforms and ranks by missed mentions. Frontend rewrites the component to a clean grid with a single CTA per row that navigates via the existing `/content/[brandId]` redirect (extended to forward `?platform=`).

**Tech Stack:** FastAPI / SQLAlchemy async / pytest (backend); Next.js 15 / React 18 / TypeScript / Tailwind (frontend).

**Spec:** `docs/superpowers/specs/2026-04-23-citation-gaps-redesign-design.md`

---

## File Structure

**Modified:**
- `backend/app/routers/dashboard.py` — add `_ACTIONABLE_DOMAIN_MAP` constant + `_normalize_domain` helper; change `citation_gaps` computation (filter, sort, slice).
- `backend/app/schemas.py` — add optional `platform: str | None` to `CitationGap`.
- `frontend/lib/api.ts` — add optional `platform?: string` to the `CitationGap` interface.
- `frontend/components/dashboard/CitationGaps.tsx` — full rewrite with new layout and CTA wiring.
- `frontend/app/dashboard/page.tsx` — rename heading, update tooltip, change render guard, pass `brandId` prop.
- `frontend/app/content/page.tsx` — read `?platform=` via `useSearchParams()` and pre-select on mount.
- `frontend/app/content/[brandId]/page.tsx` — preserve `?platform=` query param when redirecting to `/content`.

**Created:**
- `backend/tests/test_dashboard_citation_gaps.py` — 7 fixture tests covering normalization, filter, ranking, exclusion, empty case, platform field.

---

## Task 1: Backend — Test scaffold

Create the test file and shared fixture for building TrackingRun + QueryResult records with chosen `response_text` and `mentioned` values. Subsequent tasks add tests on top of this.

**Files:**
- Create: `backend/tests/test_dashboard_citation_gaps.py`

- [ ] **Step 1: Inspect an existing test that exercises the dashboard endpoint**

Run: `grep -nl "/api/dashboard" backend/tests/`
Read whichever test it surfaces (likely `test_dashboard.py` or similar) to copy the auth + brand + run setup pattern. Helpers `register_and_login()` and `create_brand()` are in `tests/conftest.py`.

- [ ] **Step 2: Create the test file with a shared fixture**

Write `backend/tests/test_dashboard_citation_gaps.py`:

```python
"""Tests for the citation_gaps section of GET /api/dashboard."""
from __future__ import annotations

import httpx
import pytest

from app.database import AsyncSessionLocal
from app.models import Brand, Prompt, QueryResult, TrackingRun


async def _seed_run(brand_id: int, rows: list[dict]) -> int:
    """Insert a TrackingRun + QueryResult rows for a brand.

    Each row dict supports: response_text, mentioned (default False),
    model (default "perplexity"), prompt_id.
    Returns the run_id.
    """
    async with AsyncSessionLocal() as db:
        prompt_q = await db.execute(
            __import__("sqlalchemy").select(Prompt).where(Prompt.brand_id == brand_id)
        )
        prompt = prompt_q.scalars().first()
        if prompt is None:
            prompt = Prompt(brand_id=brand_id, text="seed prompt", prompt_type="standard")
            db.add(prompt)
            await db.commit()
            await db.refresh(prompt)

        run = TrackingRun(
            brand_id=brand_id,
            status="completed",
            run_type="manual",
            total_queries=len(rows),
            total_mentions=sum(1 for r in rows if r.get("mentioned")),
            overall_score=0.0,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        for r in rows:
            db.add(
                QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=r.get("prompt_id", prompt.id),
                    model=r.get("model", "perplexity"),
                    run_number=1,
                    response_text=r["response_text"],
                    mentioned=r.get("mentioned", False),
                )
            )
        await db.commit()
        return run.id


async def _setup_brand(client: httpx.AsyncClient) -> tuple[int, str]:
    """Register, login, create a brand. Returns (brand_id, auth_cookie_value)."""
    from tests.conftest import register_and_login, create_brand  # type: ignore
    cookies = await register_and_login(client)
    brand = await create_brand(client, name="Acme")
    return brand["id"], cookies
```

- [ ] **Step 3: Verify the file imports cleanly**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py --collect-only -q`
Expected: 0 tests collected, no import errors.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_dashboard_citation_gaps.py
git commit -m "test(dashboard): scaffold citation gaps test file"
```

---

## Task 2: Backend — Domain normalization

Add `_normalize_domain` helper that maps `twitter.com` → `x.com` and any `*.wikipedia.org` → `wikipedia.org`. Apply it inside the citation gaps loop in `dashboard.py`.

**Files:**
- Modify: `backend/app/routers/dashboard.py` (around line 130 for the helper, line 426 for usage)
- Test: `backend/tests/test_dashboard_citation_gaps.py`

- [ ] **Step 1: Write failing tests for normalization**

Append to `backend/tests/test_dashboard_citation_gaps.py`:

```python
@pytest.mark.asyncio
async def test_twitter_com_normalized_to_x_com(client: httpx.AsyncClient):
    brand_id, _ = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "See https://twitter.com/example for more.", "mentioned": False},
        {"response_text": "See https://twitter.com/another for context.", "mentioned": False},
        {"response_text": "Also https://x.com/yet_another offers details.", "mentioned": False},
    ])
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    x_rows = [g for g in gaps if g["domain"] == "x.com"]
    twitter_rows = [g for g in gaps if g["domain"] == "twitter.com"]
    assert len(x_rows) == 1, f"expected single x.com row, got {gaps}"
    assert x_rows[0]["cited_total"] == 3
    assert twitter_rows == [], "twitter.com should not appear after normalization"


@pytest.mark.asyncio
async def test_wikipedia_subdomains_normalized(client: httpx.AsyncClient):
    brand_id, _ = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "Per https://en.wikipedia.org/wiki/Foo it's clear.", "mentioned": False},
        {"response_text": "And https://fr.wikipedia.org/wiki/Foo agrees.", "mentioned": False},
    ])
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    wiki_rows = [g for g in gaps if g["domain"] == "wikipedia.org"]
    assert len(wiki_rows) == 1
    assert wiki_rows[0]["cited_total"] == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py -v`
Expected: both tests FAIL — `twitter.com` and `en.wikipedia.org` appear as separate rows because no normalization exists.

- [ ] **Step 3: Add the normalizer to `dashboard.py`**

Locate `_DOMAIN_MAP` (around `backend/app/routers/dashboard.py:115`). Add this BELOW the existing `_classify_domain` function (around line 180):

```python
_DOMAIN_ALIASES: dict[str, str] = {
    "twitter.com": "x.com",
}


def _normalize_domain(domain: str) -> str:
    """Collapse domain variants to a canonical form before aggregation.

    twitter.com → x.com.
    *.wikipedia.org → wikipedia.org (any language subdomain).
    """
    d = domain.lower()
    if d in _DOMAIN_ALIASES:
        return _DOMAIN_ALIASES[d]
    if d.endswith(".wikipedia.org"):
        return "wikipedia.org"
    return d
```

- [ ] **Step 4: Apply the normalizer inside the citation_gaps loop**

In `backend/app/routers/dashboard.py` around line 421-430, replace:

```python
    domain_with: dict[str, int] = defaultdict(int)
    domain_total_counts: dict[str, int] = defaultdict(int)
    for qr, _ in rows:
        if not qr.response_text:
            continue
        domains_in_response = _extract_domains(qr.response_text)
        for domain in domains_in_response:
            domain_total_counts[domain] += 1
            if qr.mentioned:
                domain_with[domain] += 1
```

with:

```python
    domain_with: dict[str, int] = defaultdict(int)
    domain_total_counts: dict[str, int] = defaultdict(int)
    for qr, _ in rows:
        if not qr.response_text:
            continue
        domains_in_response = _extract_domains(qr.response_text)
        seen_normalized: set[str] = set()
        for raw in domains_in_response:
            normalized = _normalize_domain(raw)
            # de-dupe within a single response so two variants (e.g.,
            # twitter.com + x.com in the same answer) only count once.
            if normalized in seen_normalized:
                continue
            seen_normalized.add(normalized)
            domain_total_counts[normalized] += 1
            if qr.mentioned:
                domain_with[normalized] += 1
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py -v`
Expected: both normalization tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/dashboard.py backend/tests/test_dashboard_citation_gaps.py
git commit -m "feat(dashboard): normalize domain variants for citation gaps"
```

---

## Task 3: Backend — Actionable filter + platform schema field

Restrict `citation_gaps` to draftable-platform domains only, and surface the platform slug on each gap row.

**Files:**
- Modify: `backend/app/schemas.py` (around line 547)
- Modify: `backend/app/routers/dashboard.py` (around line 432-447)
- Test: `backend/tests/test_dashboard_citation_gaps.py`

- [ ] **Step 1: Write failing tests for the filter and platform field**

Append to `backend/tests/test_dashboard_citation_gaps.py`:

```python
@pytest.mark.asyncio
async def test_non_actionable_domains_excluded(client: httpx.AsyncClient):
    brand_id, _ = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "Per https://techcrunch.com/article and https://reddit.com/r/foo it's clear.", "mentioned": False},
        {"response_text": "Also https://nytimes.com/x noted.", "mentioned": False},
        {"response_text": "https://reddit.com/r/bar adds context.", "mentioned": False},
    ])
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    assert resp.status_code == 200
    gaps = resp.json()["citation_gaps"]
    domains = [g["domain"] for g in gaps]
    assert "reddit.com" in domains
    assert "techcrunch.com" not in domains
    assert "nytimes.com" not in domains


@pytest.mark.asyncio
async def test_no_actionable_citations_returns_empty_list(client: httpx.AsyncClient):
    brand_id, _ = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "https://techcrunch.com/a and https://nytimes.com/b only.", "mentioned": False},
        {"response_text": "https://forbes.com/c is also relevant.", "mentioned": False},
    ])
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    assert resp.status_code == 200
    assert resp.json()["citation_gaps"] == []


@pytest.mark.asyncio
async def test_platform_field_populated(client: httpx.AsyncClient):
    brand_id, _ = await _setup_brand(client)
    await _seed_run(brand_id, [
        {"response_text": "https://reddit.com/r/x and https://medium.com/p/y.", "mentioned": False},
        {"response_text": "https://reddit.com/r/z again.", "mentioned": False},
    ])
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    gaps = resp.json()["citation_gaps"]
    by_domain = {g["domain"]: g for g in gaps}
    assert by_domain["reddit.com"]["platform"] == "reddit"
    assert by_domain["medium.com"]["platform"] == "medium"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py::test_non_actionable_domains_excluded tests/test_dashboard_citation_gaps.py::test_no_actionable_citations_returns_empty_list tests/test_dashboard_citation_gaps.py::test_platform_field_populated -v`
Expected: all three FAIL — non-actionable domains still appear; `platform` key missing from response.

- [ ] **Step 3: Add `platform` to the `CitationGap` schema**

In `backend/app/schemas.py` around line 547, replace:

```python
class CitationGap(BaseModel):
    domain: str
    domain_type: str
    cited_total: int          # times this domain appears across all responses
    cited_with_brand: int     # subset where brand IS mentioned
    gap_score: float          # fraction of citations that don't mention brand (0–1)
```

with:

```python
class CitationGap(BaseModel):
    domain: str
    domain_type: str
    cited_total: int          # times this domain appears across all responses
    cited_with_brand: int     # subset where brand IS mentioned
    gap_score: float          # fraction of citations that don't mention brand (0–1)
    platform: str | None = None  # supported drafting platform slug if domain maps to one
```

- [ ] **Step 4: Add the actionable map and apply the filter**

In `backend/app/routers/dashboard.py`, add the constant directly below `_DOMAIN_ALIASES` (added in Task 2):

```python
_ACTIONABLE_DOMAIN_MAP: dict[str, str] = {
    "reddit.com": "reddit",
    "quora.com": "quora",
    "medium.com": "medium",
    "wikipedia.org": "wikipedia",
    "linkedin.com": "linkedin",
    "x.com": "x",
}
```

Then update the `citation_gaps` block (around line 432-447) to filter and populate `platform`. Replace:

```python
    _MIN_CITATIONS = 2  # ignore domains that appear only once
    citation_gaps = sorted(
        [
            CitationGap(
                domain=dom,
                domain_type=_classify_domain(dom),
                cited_total=cnt,
                cited_with_brand=domain_with.get(dom, 0),
                gap_score=round(1.0 - (domain_with.get(dom, 0) / cnt), 4),
            )
            for dom, cnt in domain_total_counts.items()
            if cnt >= _MIN_CITATIONS
        ],
        key=lambda g: (g.gap_score, g.cited_total),
        reverse=True,
    )[:10]
```

with:

```python
    _MIN_CITATIONS = 2  # ignore domains that appear only once
    citation_gaps = [
        CitationGap(
            domain=dom,
            domain_type=_classify_domain(dom),
            cited_total=cnt,
            cited_with_brand=domain_with.get(dom, 0),
            gap_score=round(1.0 - (domain_with.get(dom, 0) / cnt), 4),
            platform=_ACTIONABLE_DOMAIN_MAP[dom],
        )
        for dom, cnt in domain_total_counts.items()
        if cnt >= _MIN_CITATIONS and dom in _ACTIONABLE_DOMAIN_MAP
    ]
    # Sort + slice happens in Task 4 — leave default order for now
```

- [ ] **Step 5: Run tests to verify the new ones pass and old normalization tests still pass**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py -v`
Expected: all 5 tests so far PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/dashboard.py backend/tests/test_dashboard_citation_gaps.py
git commit -m "feat(dashboard): filter citation gaps to draftable platforms only"
```

---

## Task 4: Backend — Ranking, full-coverage exclusion, slice

Switch from gap-score-based sort to missed-mentions-based sort with partial-presence tiebreaker. Drop rows where the brand is in 100% of citations (no gap). Cap at 6 rows.

**Files:**
- Modify: `backend/app/routers/dashboard.py` (the `citation_gaps` block from Task 3)
- Test: `backend/tests/test_dashboard_citation_gaps.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_dashboard_citation_gaps.py`:

```python
@pytest.mark.asyncio
async def test_ranking_by_missed_mentions(client: httpx.AsyncClient):
    """reddit (8 missed) > medium (3 missed, partial) > linkedin (3 missed, zero presence)."""
    brand_id, _ = await _setup_brand(client)

    # 8 reddit citations, 0 with brand → 8 missed
    reddit_rows = [
        {"response_text": f"https://reddit.com/r/x{i}", "mentioned": False}
        for i in range(8)
    ]
    # 5 medium citations, 2 with brand → 3 missed, partial presence
    medium_rows = [
        {"response_text": f"https://medium.com/p/{i}", "mentioned": (i < 2)}
        for i in range(5)
    ]
    # 3 linkedin citations, 0 with brand → 3 missed, zero presence
    linkedin_rows = [
        {"response_text": f"https://linkedin.com/in/x{i}", "mentioned": False}
        for i in range(3)
    ]
    await _seed_run(brand_id, reddit_rows + medium_rows + linkedin_rows)

    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    gaps = resp.json()["citation_gaps"]
    domains_in_order = [g["domain"] for g in gaps]
    assert domains_in_order[0] == "reddit.com"           # 8 missed
    assert domains_in_order.index("medium.com") < domains_in_order.index("linkedin.com")  # tiebreaker


@pytest.mark.asyncio
async def test_full_coverage_excluded(client: httpx.AsyncClient):
    """If brand appears in every citation of a domain, it's not a gap — drop it."""
    brand_id, _ = await _setup_brand(client)
    rows = [
        # reddit: brand in all 5 citations → no gap, must be excluded
        *[{"response_text": f"https://reddit.com/r/{i}", "mentioned": True} for i in range(5)],
        # medium: brand in 0 of 3 → real gap, must be present
        *[{"response_text": f"https://medium.com/p/{i}", "mentioned": False} for i in range(3)],
    ]
    await _seed_run(brand_id, rows)
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    domains = [g["domain"] for g in resp.json()["citation_gaps"]]
    assert "medium.com" in domains
    assert "reddit.com" not in domains


@pytest.mark.asyncio
async def test_max_six_rows(client: httpx.AsyncClient):
    """Slice to 6 even if all 6 platforms qualify (defense-in-depth)."""
    brand_id, _ = await _setup_brand(client)
    rows = []
    for dom in ("reddit.com", "quora.com", "medium.com", "wikipedia.org", "linkedin.com", "x.com"):
        rows.extend([
            {"response_text": f"https://{dom}/a", "mentioned": False},
            {"response_text": f"https://{dom}/b", "mentioned": False},
        ])
    await _seed_run(brand_id, rows)
    resp = await client.get("/api/dashboard", params={"brand_id": brand_id})
    assert len(resp.json()["citation_gaps"]) <= 6
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py::test_ranking_by_missed_mentions tests/test_dashboard_citation_gaps.py::test_full_coverage_excluded tests/test_dashboard_citation_gaps.py::test_max_six_rows -v`
Expected: ranking and full-coverage tests FAIL (no sort applied yet, full-coverage rows still present); `test_max_six_rows` may pass incidentally — that's fine.

- [ ] **Step 3: Add sort + slice + full-coverage exclusion**

Replace the `citation_gaps` block in `backend/app/routers/dashboard.py` (built in Task 3) with:

```python
    _MIN_CITATIONS = 2
    citation_gaps = sorted(
        [
            CitationGap(
                domain=dom,
                domain_type=_classify_domain(dom),
                cited_total=cnt,
                cited_with_brand=domain_with.get(dom, 0),
                gap_score=round(1.0 - (domain_with.get(dom, 0) / cnt), 4),
                platform=_ACTIONABLE_DOMAIN_MAP[dom],
            )
            for dom, cnt in domain_total_counts.items()
            if cnt >= _MIN_CITATIONS
            and dom in _ACTIONABLE_DOMAIN_MAP
            and domain_with.get(dom, 0) < cnt  # exclude full coverage
        ],
        key=lambda g: (
            g.cited_total - g.cited_with_brand,        # missed mentions, DESC
            1 if g.cited_with_brand > 0 else 0,        # partial presence tiebreaker, DESC
        ),
        reverse=True,
    )[:6]
```

- [ ] **Step 4: Run all tests in the file to verify they pass**

Run: `cd backend && pytest tests/test_dashboard_citation_gaps.py -v`
Expected: all 8 tests PASS.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && pytest tests/ -q`
Expected: all tests PASS. If a pre-existing dashboard test asserts on `citation_gaps` ordering or content, that test needs updating to match the new contract — fix it inline.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/dashboard.py backend/tests/test_dashboard_citation_gaps.py
git commit -m "feat(dashboard): rank citation gaps by missed mentions, cap at 6"
```

---

## Task 5: Frontend — TypeScript interface

Surface the new `platform` field to the typed API client.

**Files:**
- Modify: `frontend/lib/api.ts` (around line 719)

- [ ] **Step 1: Add the optional field**

In `frontend/lib/api.ts` around line 719-724, replace:

```typescript
export interface CitationGap {
  domain: string;
  domain_type: string;
  cited_total: number;
  cited_with_brand: number;
  gap_score: number;
}
```

with:

```typescript
export interface CitationGap {
  domain: string;
  domain_type: string;
  cited_total: number;
  cited_with_brand: number;
  gap_score: number;
  platform?: string;
}
```

- [ ] **Step 2: Run the TypeScript build to confirm no type errors**

Run: `cd frontend && npm run lint`
Expected: no TypeScript errors related to this change.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): add optional platform to CitationGap"
```

---

## Task 6: Frontend — CitationGaps component rewrite

Replace the existing component with the new grid layout. Keep the filename and the default export so dashboard imports don't break.

**Files:**
- Modify: `frontend/components/dashboard/CitationGaps.tsx` (full rewrite)

- [ ] **Step 1: Inspect the existing dashboard styles to match the look**

Run: `grep -n "var(--accent)\|var(--success)\|var(--danger" frontend/components/dashboard/CitationGaps.tsx`
Read 1-2 sibling dashboard components (e.g., `DashboardModelBreakdown`, `BrandTable`) to confirm class/spacing conventions before writing.

- [ ] **Step 2: Replace the file contents**

Overwrite `frontend/components/dashboard/CitationGaps.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { CitationGap } from '@/lib/api';

interface CitationGapsProps {
  gaps: CitationGap[];
  brandId: number;
}

const DOMAIN_TYPE_COLORS: Record<string, string> = {
  Editorial: 'var(--color-perplexity)',
  UGC: 'var(--color-chatgpt)',
  Reference: 'var(--color-gemini)',
  Institutional: 'var(--color-claude)',
  Corporate: 'var(--accent)',
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Draft for Reddit',
  quora: 'Draft for Quora',
  medium: 'Draft for Medium',
  linkedin: 'Draft for LinkedIn',
  x: 'Draft for X',
  wikipedia: 'Edit Wikipedia',
};

export default function CitationGaps({ gaps, brandId }: CitationGapsProps) {
  if (!gaps.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-2xl mb-2 opacity-40">✓</div>
        <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">
          No actionable gaps this run
        </p>
        <p className="text-xs text-[var(--text-faint)] max-w-md">
          AI didn&apos;t cite any draftable sources (Reddit, Quora, Medium, Wikipedia, LinkedIn, X)
          in prompts where your brand was absent. Check Top Cited Domains above for the broader
          source landscape.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[rgba(255,255,255,0.06)]">
      {gaps.map((g, idx) => {
        const platform = g.platform;
        if (!platform) return null;

        const missed = g.cited_total - g.cited_with_brand;
        const partial = g.cited_with_brand > 0;
        const ctaLabel = PLATFORM_LABELS[platform] ?? `Draft for ${platform}`;
        const isWiki = platform === 'wikipedia';
        const typeColor = DOMAIN_TYPE_COLORS[g.domain_type] ?? 'var(--accent)';
        const presenceClass = partial ? 'text-[var(--warning,#f59e0b)]' : 'text-[var(--danger-text,#ef4444)]';

        return (
          <div
            key={g.domain}
            className="grid grid-cols-[20px_1fr_auto_auto_auto] items-center gap-3 py-2.5 text-xs"
          >
            <span className="text-[10px] tabular-nums text-[var(--text-faint)]">{idx + 1}</span>

            <span className="font-medium text-[var(--text-primary)] truncate">{g.domain}</span>

            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
              style={{
                backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
                color: typeColor,
              }}
            >
              {g.domain_type}
            </span>

            <span className="tabular-nums text-[var(--text-faint)] whitespace-nowrap">
              cited {g.cited_total}× · <span className={`font-medium ${presenceClass}`}>you in {g.cited_with_brand}</span>
            </span>

            <Link
              href={`/content/${brandId}?platform=${encodeURIComponent(platform)}`}
              className={`text-[10px] font-medium px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                isWiki
                  ? 'bg-[var(--surface-2,#3f3f46)] text-[var(--text-primary)] hover:bg-[var(--surface-3,#52525b)]'
                  : 'bg-[var(--accent)] text-white hover:opacity-90'
              }`}
            >
              {ctaLabel}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Run the lint to confirm no type errors**

Run: `cd frontend && npm run lint`
Expected: passes. The `brandId` prop is required but the dashboard call site won't pass it yet — that's fixed in Task 7.

If the lint fails because the dashboard page hasn't been updated yet, that's expected — proceed to Task 7 immediately and run lint again at the end of that task.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboard/CitationGaps.tsx
git commit -m "feat(dashboard): rewrite CitationGaps as actionable sources list"
```

---

## Task 7: Frontend — Dashboard page integration

Update the dashboard page: rename heading, update the tooltip, broaden the render guard so the empty state can show, and pass `brandId` to the rewritten component.

**Files:**
- Modify: `frontend/app/dashboard/page.tsx` (around line 918-930)

- [ ] **Step 1: Update the section**

In `frontend/app/dashboard/page.tsx`, find the block (currently around line 918-930):

```tsx
              {/* Row 4: Citation Gaps */}
              {analytics && analytics.citation_gaps && analytics.citation_gaps.length > 0 && (
                <div className="mb-4">
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Link2 size={15} className="text-[var(--accent)]" />
                      <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Citation Gaps</h3>
                      <HelpTooltip text="Domains frequently cited by AI models in responses that don't mention your brand. High gap scores indicate sources where your brand is absent but competitors may be present." />
                    </div>
                    <CitationGaps gaps={analytics.citation_gaps} />
                  </div>
                </div>
              )}
```

Replace with:

```tsx
              {/* Row 4: Sources you're missing from */}
              {analytics && analytics.total_responses_analyzed > 0 && selectedBrand && (
                <div className="mb-4">
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Link2 size={15} className="text-[var(--accent)]" />
                      <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Sources you&apos;re missing from</h3>
                      <HelpTooltip text="Draftable sources AI cites for your prompts — ranked by how many times they were cited without mentioning your brand." />
                    </div>
                    <CitationGaps gaps={analytics.citation_gaps} brandId={selectedBrand.id} />
                  </div>
                </div>
              )}
```

> `selectedBrand` is defined at line 358 of `frontend/app/dashboard/page.tsx` as `const selectedBrand = brands.find((b) => b.id === selectedBrandId);` — it's already in scope at the row 4 block.

- [ ] **Step 2: Run lint**

Run: `cd frontend && npm run lint`
Expected: passes.

- [ ] **Step 3: Run the dev server and smoke-test**

Run (in one terminal): `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`
Run (in another): `cd frontend && npm run dev` (port 3002)

Open the dashboard. Verify:
- Section title reads "Sources you're missing from"
- Hovering the help icon shows the new tooltip
- For a brand with completed runs, rows render correctly (or empty state if no actionable gaps)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(dashboard): rename Citation Gaps section, broaden empty-state guard"
```

---

## Task 8: Frontend — Content page query param handling

Make the content hub honor `?platform=` so the CTA from the dashboard lands the user on the correct platform tab.

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`
- Modify: `frontend/app/content/page.tsx`

- [ ] **Step 1: Forward `?platform=` from the brand-redirect page**

Replace `frontend/app/content/[brandId]/page.tsx` with:

```tsx
'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * /content/[brandId] — redirects to the main Content Hub (/content)
 * which already supports per-brand filtering via the brand selector.
 * Sets the active brand in localStorage so the hub pre-selects the right brand.
 * Forwards ?platform= if present so the hub opens on that platform tab.
 */
export default function ContentBrandRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const brandId = params?.brandId;
    if (brandId) {
      try {
        localStorage.setItem('clarity_active_brand_id', String(brandId));
      } catch {}
    }
    const platform = searchParams?.get('platform');
    if (platform) {
      router.replace(`/content?platform=${encodeURIComponent(platform)}`);
    } else {
      router.replace('/content');
    }
  }, [params, router, searchParams]);

  return null;
}
```

- [ ] **Step 2: Read `?platform=` in the content hub page**

In `frontend/app/content/page.tsx`, locate where state is initialized (around line 909 — `const [platform, setPlatform] = useState<string>('reddit');` and around line 1534 for `draftPlatformFilter`).

First, ensure `useSearchParams` is imported. At the top of the file, if not already present:

```tsx
import { useSearchParams } from 'next/navigation';
```

Then, inside the main component (the one that owns `draftPlatformFilter`), add near the top of the component body:

```tsx
const searchParams = useSearchParams();

// Pre-select platform from ?platform= query param on mount
useEffect(() => {
  const queryPlatform = searchParams?.get('platform');
  const SUPPORTED = ['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x'];
  if (queryPlatform && SUPPORTED.includes(queryPlatform)) {
    setDraftPlatformFilter(queryPlatform);
  }
  // run once on mount only — explicit empty deps + searchParams ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

> The component is large (over 2000 lines per the line numbers seen during exploration). When inserting, place the `useSearchParams()` call and the `useEffect` near other top-of-component hook calls in the same component scope as `setDraftPlatformFilter`. Do **not** add a second top-level `searchParams` if one already exists — reuse it.

- [ ] **Step 3: Run lint**

Run: `cd frontend && npm run lint`
Expected: passes.

- [ ] **Step 4: Smoke test the navigation flow**

With the dev servers running:
1. Open the dashboard
2. Click "Draft for Reddit" on a row in the Sources you're missing from card
3. Confirm the URL changes to `/content?platform=reddit` (after the redirect)
4. Confirm the content hub opens with the Reddit platform tab active

Repeat for Wikipedia (which uses the grey "Edit Wikipedia" button): confirm it lands on the Wikipedia tab.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/page.tsx frontend/app/content/[brandId]/page.tsx
git commit -m "feat(content): honor ?platform= query param from dashboard CTAs"
```

---

## Task 9: Manual verification

End-to-end smoke test on a real brand with real data, plus accessibility check.

- [ ] **Step 1: Start both servers**

```bash
# terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001

# terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Verify each acceptance criterion from the spec**

Open the dashboard for a brand with completed tracking runs. Walk through:

1. **Title:** card heading reads "Sources you're missing from".
2. **Filter:** all visible rows are one of `reddit.com`, `quora.com`, `medium.com`, `wikipedia.org`, `linkedin.com`, `x.com`. No `techcrunch.com`, `nytimes.com`, `.gov`, etc.
3. **Ranking:** rows are ordered by missed mentions (cited_total minus cited_with_brand) descending. If two tie, the one with `cited_with_brand > 0` ranks higher.
4. **Stat:** each row shows `cited N× · you in M`. The `you in M` part is red when M=0, amber when 0<M<N. No "100% gap" text anywhere.
5. **CTA:** each row has one button. Wikipedia is grey, all others are accent-colored.
6. **CTA navigation:** clicking each button lands on the content hub with that platform tab active.
7. **Empty state:** if a brand has no actionable gaps, the card renders the ✓ empty state — not blank, not hidden.
8. **No-data state:** if a brand has zero tracked runs, the card is hidden entirely.

- [ ] **Step 3: Accessibility — quick screen-reader check**

With VoiceOver (Cmd+F5 on macOS) or DevTools accessibility tree:
- Confirm each row reads the rank, domain, type, and stat as text.
- Confirm "you in 0" is read aloud — the color isn't the only signal.

If presence is conveyed only by color in the rendered DOM (e.g., screen reader hears "you in 2" identically for partial vs. full), add a visually-hidden suffix like `<span className="sr-only"> (partial)</span>` or `<span className="sr-only"> (absent)</span>` next to the count. This was flagged as polish in the spec — apply if the screen-reader experience genuinely loses information.

- [ ] **Step 4: Final regression sweep**

```bash
cd backend && pytest tests/ -q
```

Expected: all tests pass.

- [ ] **Step 5: No commit unless code changed**

If the screen-reader check required adding `sr-only` markup, commit:

```bash
git add frontend/components/dashboard/CitationGaps.tsx
git commit -m "a11y(dashboard): add screen-reader text for citation gap presence"
```

Otherwise, this task closes without a commit — the work is done.

---

## Out of Scope Reminders

Per the spec, **do not** include in this implementation:
- Content type sub-suggestions (listicle vs how-to)
- "See non-draftable sources →" drill-down modal
- Mobile stacking polish for narrow widths
- Extending the actionable platform list (Substack, Stack Overflow, etc.)
- Attribution feedback ("posting here worked last time")
- Changes to `_extract_domains` regex behavior
