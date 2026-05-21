# Prospect Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/agency/prospects` feature for agency staff to generate cold-email AI-visibility audit PDFs for businesses they're pitching.

**Architecture:** Standalone runner under `app/services/prospect_audit/` that fans out 90 LLM queries (10 prompts × 3 models × 3 runs), scores them as RVI (own visibility ÷ peer-average visibility), generates LLM-tailored recommendations, and renders a Playwright PDF. One `ProspectAudit` DB table stores summary stats + PDF path; everything else is in-memory during the run. Auto-deletes after 60 days.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · asyncio fan-out · Anthropic SDK (Haiku for prompts/competitors, Sonnet for recommendations) · Jinja2 + Playwright Chromium for PDF · Next.js 15 App Router · existing `llm_service` query wrappers · `services/competitive_gap.py:_normalize/_mention_matches` for mention detection consistency.

**Reference spec:** `docs/superpowers/specs/2026-05-20-prospect-audit-design.md`

---

## Phase 1 — Data foundation

### Task 1: ProspectAudit ORM model + Pydantic schemas

**Files:**
- Modify: `backend/app/models.py` (append new class at the bottom of the file, before any helper functions)
- Modify: `backend/app/schemas.py` (append new section)

- [ ] **Step 1: Add the `ProspectAudit` ORM model**

Append to `backend/app/models.py` at the end of the model section (just before any helper functions or module-level data — find the last ORM class and add after it):

```python
class ProspectAudit(Base):
    __tablename__ = "prospect_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    business_name: Mapped[str] = mapped_column(String, nullable=False)
    website_url: Mapped[str] = mapped_column(String, nullable=False)
    is_local: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    location: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    overall_visibility_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    aggregate_rvi: Mapped[float | None] = mapped_column(Float, nullable=True)
    rvi_band: Mapped[str | None] = mapped_column(String, nullable=True)

    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

If `Boolean`, `Float`, `Text`, or `ForeignKey` aren't already imported in `models.py`, add the missing ones to the existing `from sqlalchemy import ...` line at the top. Don't reorder existing imports.

- [ ] **Step 2: Add Pydantic schemas to `schemas.py`**

Append at the very end of `backend/app/schemas.py`:

```python
# ── Prospect audits ──────────────────────────────────────────────────────────


class ProspectAuditCreate(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    website_url: str = Field(min_length=1, max_length=2048)
    is_local: bool = False
    location: str | None = Field(default=None, max_length=200)

    @field_validator("location")
    @classmethod
    def _location_required_when_local(cls, v, info):
        if info.data.get("is_local") and not (v and v.strip()):
            raise ValueError("location is required when is_local is true")
        return v.strip() if v else None

    @field_validator("website_url")
    @classmethod
    def _coerce_url(cls, v):
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        return v


class ProspectAuditListItem(BaseModel):
    id: int
    business_name: str
    website_url: str
    is_local: bool
    location: str | None
    status: str
    overall_visibility_pct: float | None
    aggregate_rvi: float | None
    rvi_band: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ProspectAuditOut(ProspectAuditListItem):
    status_message: str | None
    error_message: str | None
    cancel_requested: bool
    started_at: datetime | None
    has_pdf: bool   # computed from pdf_path is not None

    model_config = ConfigDict(from_attributes=True)
```

If `Field`, `field_validator`, `ConfigDict`, or `datetime` are not already imported at the top of `schemas.py`, add them. Look for the existing `from pydantic import ...` line and the `from datetime import ...` line.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py
git commit -m "feat(prospect-audit): add ProspectAudit model + schemas"
```

---

### Task 2: Database migration for `prospect_audits` table

**Files:**
- Modify: `backend/app/database.py` (append a new `ALTER` step at the bottom of `run_migrations()`)
- Create: `backend/tests/test_prospect_audit_migration.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_prospect_audit_migration.py`:

```python
"""Verifies the prospect_audits table exists after migrations run."""
import pytest
from sqlalchemy import inspect

from app.database import engine


@pytest.mark.asyncio
async def test_prospect_audits_table_exists():
    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    assert "prospect_audits" in tables


@pytest.mark.asyncio
async def test_prospect_audits_columns():
    async with engine.connect() as conn:
        cols = await conn.run_sync(
            lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("prospect_audits")}
        )
    required = {
        "id", "staff_user_id", "business_name", "website_url",
        "is_local", "location", "status", "status_message",
        "error_message", "cancel_requested",
        "overall_visibility_pct", "aggregate_rvi", "rvi_band",
        "pdf_path", "created_at", "started_at", "completed_at",
    }
    assert required.issubset(cols), f"missing columns: {required - cols}"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_migration.py -v
```

Expected: FAIL — `prospect_audits` table not in inspected tables (model exists in Python but no migration has been run).

- [ ] **Step 3: Add the migration step**

Open `backend/app/database.py` and find `run_migrations()`. Scroll to the bottom of that function (the very last `await` step). Append a new step there:

```python
        # 2026-05-20: prospect_audits table — agency staff cold-email audit deliverable
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS prospect_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_user_id INTEGER NOT NULL REFERENCES users(id),
                business_name TEXT NOT NULL,
                website_url TEXT NOT NULL,
                is_local BOOLEAN NOT NULL DEFAULT 0,
                location TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                status_message TEXT,
                error_message TEXT,
                cancel_requested BOOLEAN NOT NULL DEFAULT 0,
                overall_visibility_pct REAL,
                aggregate_rvi REAL,
                rvi_band TEXT,
                pdf_path TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME,
                completed_at DATETIME
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_prospect_audits_staff_user_id ON prospect_audits(staff_user_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_prospect_audits_status ON prospect_audits(status)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_prospect_audits_created_at ON prospect_audits(created_at)"))
```

Confirm `from sqlalchemy import text` is already imported at the top of `database.py` — it almost certainly is, since other migration steps use `text(...)`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_migration.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py backend/tests/test_prospect_audit_migration.py
git commit -m "feat(prospect-audit): migration for prospect_audits table"
```

---

### Task 3: RVI scoring module

**Files:**
- Create: `backend/app/services/prospect_audit/__init__.py`
- Create: `backend/app/services/prospect_audit/scoring.py`
- Create: `backend/tests/test_prospect_audit_scoring.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_scoring.py`:

```python
"""Pure unit tests for prospect-audit RVI scoring math."""
from app.services.prospect_audit.scoring import (
    PromptScore,
    QueryRecord,
    CompetitorRecord,
    score_prompt,
    aggregate_audit,
    band_for_rvi,
)


def _q(model: str, run: int, mentioned: bool, error: str | None = None) -> QueryRecord:
    return QueryRecord(model=model, run=run, response_text="" if error else "x", mentioned=mentioned, error=error)


def test_band_thresholds():
    assert band_for_rvi(2.5) == "dominant"
    assert band_for_rvi(2.0) == "dominant"
    assert band_for_rvi(1.9) == "winning"
    assert band_for_rvi(1.2) == "winning"
    assert band_for_rvi(1.0) == "even"
    assert band_for_rvi(0.8) == "even"
    assert band_for_rvi(0.79) == "losing"
    assert band_for_rvi(0.2) == "losing"
    assert band_for_rvi(0.19) == "invisible"
    assert band_for_rvi(0.0) == "invisible"


def test_score_prompt_normal_case():
    queries = [_q("chatgpt", 1, True), _q("chatgpt", 2, False), _q("perplexity", 1, True)]
    comp_mentions = {
        1: [True, False, True],   # competitor 1 mentioned in 2/3
        2: [False, False, True],  # competitor 2 mentioned in 1/3
    }
    competitors = [CompetitorRecord(id=1, is_subject=False), CompetitorRecord(id=2, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    # own = 2/3 = 66.67%
    assert score.own_visibility_pct == pytest.approx(66.67, abs=0.01)
    # peer_avg = (66.67 + 33.33) / 2 = 50%
    assert score.peer_avg_visibility_pct == pytest.approx(50.0, abs=0.01)
    # rvi = 66.67 / 50 = 1.33 → winning
    assert score.rvi == pytest.approx(1.33, abs=0.01)
    assert score.rvi_band == "winning"


def test_score_prompt_subject_excluded():
    queries = [_q("chatgpt", 1, False)]
    comp_mentions = {
        1: [True],   # subject — should be excluded
        2: [False],
    }
    competitors = [
        CompetitorRecord(id=1, is_subject=True),
        CompetitorRecord(id=2, is_subject=False),
    ]
    score = score_prompt(queries, comp_mentions, competitors)
    # peer_avg uses only competitor 2 = 0%
    assert score.peer_avg_visibility_pct == 0.0
    # own=0, peer_avg=0 → even (both absent)
    assert score.rvi == 1.0
    assert score.rvi_band == "even"


def test_score_prompt_dominant_band():
    queries = [_q("chatgpt", 1, True), _q("perplexity", 1, True)]
    comp_mentions = {1: [False, False]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    assert score.own_visibility_pct == 100.0
    assert score.peer_avg_visibility_pct == 0.0
    # own>0, peer_avg=0 → rvi=None, band="dominant"
    assert score.rvi is None
    assert score.rvi_band == "dominant"


def test_score_prompt_invisible_band():
    queries = [_q("chatgpt", 1, False)]
    comp_mentions = {1: [True]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    assert score.own_visibility_pct == 0.0
    assert score.peer_avg_visibility_pct == 100.0
    assert score.rvi == 0.0
    assert score.rvi_band == "invisible"


def test_score_prompt_query_errors_excluded():
    queries = [
        _q("chatgpt", 1, False, error=None),
        _q("chatgpt", 2, True, error="timeout"),   # excluded from denom
    ]
    comp_mentions = {1: [False, True]}
    competitors = [CompetitorRecord(id=1, is_subject=False)]
    score = score_prompt(queries, comp_mentions, competitors)
    # Only 1 non-error query, own not mentioned
    assert score.own_visibility_pct == 0.0
    # Competitor mentioned in same query (after error filtering)
    assert score.peer_avg_visibility_pct == 0.0


def test_aggregate_ignores_infinite_band_rows():
    p1 = PromptScore(prompt_index=0, own_visibility_pct=100.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="dominant")
    p2 = PromptScore(prompt_index=1, own_visibility_pct=20.0, peer_avg_visibility_pct=80.0, rvi=0.25, rvi_band="losing")
    p3 = PromptScore(prompt_index=2, own_visibility_pct=50.0, peer_avg_visibility_pct=50.0, rvi=1.0, rvi_band="even")
    overall_vis, agg_rvi, band = aggregate_audit([p1, p2, p3], total_queries=30, mention_count=17)
    # overall = 17/30 * 100
    assert overall_vis == pytest.approx(56.67, abs=0.01)
    # agg_rvi = (0.25 + 1.0) / 2 = 0.625 — p1 excluded since rvi is None
    assert agg_rvi == pytest.approx(0.625, abs=0.001)
    assert band == "losing"


def test_aggregate_no_finite_rvi():
    p = PromptScore(prompt_index=0, own_visibility_pct=100.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="dominant")
    overall_vis, agg_rvi, band = aggregate_audit([p], total_queries=3, mention_count=3)
    # Only dominant prompts → aggregate_rvi=None, band=dominant
    assert overall_vis == 100.0
    assert agg_rvi is None
    assert band == "dominant"


def test_aggregate_no_queries():
    overall_vis, agg_rvi, band = aggregate_audit([], total_queries=0, mention_count=0)
    assert overall_vis == 0.0
    assert agg_rvi is None
    assert band == "invisible"
```

Add `import pytest` at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_scoring.py -v
```

Expected: ImportError (`scoring` module not found).

- [ ] **Step 3: Create the empty package**

Create `backend/app/services/prospect_audit/__init__.py` with a single comment line:

```python
"""Prospect audit feature — agency-side cold-email AI visibility audits."""
```

- [ ] **Step 4: Implement the scoring module**

Create `backend/app/services/prospect_audit/scoring.py`:

```python
"""RVI (Relative Visibility Index) math for prospect audits.

RVI = own_visibility_pct / peer_avg_visibility_pct.
Peer group = detected competitors, excluding any flagged is_subject.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QueryRecord:
    """A single LLM query result held in memory during a prospect-audit run."""
    model: str           # "chatgpt" | "perplexity" | "gemini"
    run: int             # 1, 2, or 3
    response_text: str   # may be empty on error
    mentioned: bool      # own brand mentioned (exact or fuzzy)
    error: str | None


@dataclass(frozen=True)
class CompetitorRecord:
    id: int              # in-memory id (1..N) per audit run
    is_subject: bool     # True if the prompt is "alternative to X" and this competitor IS X


@dataclass(frozen=True)
class PromptScore:
    prompt_index: int
    own_visibility_pct: float
    peer_avg_visibility_pct: float
    rvi: float | None         # None when peer_avg == 0 and own > 0 (band='dominant')
    rvi_band: str             # dominant | winning | even | losing | invisible


_BAND_THRESHOLDS = (
    (2.0, "dominant"),
    (1.2, "winning"),
    (0.8, "even"),
    (0.2, "losing"),
    (0.0, "invisible"),
)


def band_for_rvi(rvi: float) -> str:
    """Return the band label for a finite RVI value."""
    for threshold, band in _BAND_THRESHOLDS:
        if rvi >= threshold:
            return band
    return "invisible"


def score_prompt(
    queries: list[QueryRecord],
    competitor_mentions: dict[int, list[bool]],
    competitors: list[CompetitorRecord],
) -> PromptScore:
    """Compute own_visibility, peer_avg_visibility, and RVI for one prompt.

    Args:
        queries: All query results for this prompt (3 models × 3 runs = 9 in the happy path).
        competitor_mentions: Map from competitor.id to a list[bool] aligned with queries[i].
            Errored queries are filtered using queries[i].error before the mention list is consumed.
        competitors: All competitors detected for this audit.
    """
    # Filter out errored queries from BOTH the own-visibility numerator/denominator
    # and the competitor-mention arrays.
    valid_indices = [i for i, q in enumerate(queries) if q.error is None]
    if not valid_indices:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=0.0,
            peer_avg_visibility_pct=0.0,
            rvi=1.0,
            rvi_band="even",
        )

    valid_queries = [queries[i] for i in valid_indices]
    total = len(valid_queries)
    own_hits = sum(1 for q in valid_queries if q.mentioned)
    own_pct = (own_hits / total) * 100.0

    peer_competitors = [c for c in competitors if not c.is_subject]
    if peer_competitors:
        peer_pcts: list[float] = []
        for c in peer_competitors:
            full = competitor_mentions.get(c.id, [False] * len(queries))
            valid_mentions = [full[i] for i in valid_indices]
            peer_pcts.append((sum(1 for m in valid_mentions if m) / total) * 100.0)
        peer_avg_pct = sum(peer_pcts) / len(peer_pcts)
    else:
        peer_avg_pct = 0.0

    if peer_avg_pct == 0.0 and own_pct > 0.0:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=round(own_pct, 2),
            peer_avg_visibility_pct=0.0,
            rvi=None,
            rvi_band="dominant",
        )
    if peer_avg_pct == 0.0 and own_pct == 0.0:
        return PromptScore(
            prompt_index=0,
            own_visibility_pct=0.0,
            peer_avg_visibility_pct=0.0,
            rvi=1.0,
            rvi_band="even",
        )

    rvi = own_pct / peer_avg_pct
    return PromptScore(
        prompt_index=0,
        own_visibility_pct=round(own_pct, 2),
        peer_avg_visibility_pct=round(peer_avg_pct, 2),
        rvi=round(rvi, 3),
        rvi_band=band_for_rvi(rvi),
    )


def aggregate_audit(
    prompt_scores: list[PromptScore],
    total_queries: int,
    mention_count: int,
) -> tuple[float, float | None, str]:
    """Compute audit-level visibility%, aggregate RVI, and band.

    aggregate_rvi = arithmetic mean of finite per-prompt RVIs.
    If all prompts are dominant (rvi=None), aggregate_rvi=None and band='dominant'.
    If no prompts at all, returns (0, None, 'invisible').

    Returns (overall_visibility_pct, aggregate_rvi, rvi_band).
    """
    if total_queries == 0:
        return 0.0, None, "invisible"

    overall_pct = round((mention_count / total_queries) * 100.0, 2)

    finite = [p.rvi for p in prompt_scores if p.rvi is not None]
    if finite:
        agg = round(sum(finite) / len(finite), 3)
        return overall_pct, agg, band_for_rvi(agg)

    # No finite RVI rows. If any prompt has a band, prefer 'dominant' (won the prompts we could score)
    # over 'invisible' (only when nothing was scored at all).
    if any(p.rvi_band == "dominant" for p in prompt_scores):
        return overall_pct, None, "dominant"
    return overall_pct, None, "invisible"
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_scoring.py -v
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/prospect_audit/__init__.py backend/app/services/prospect_audit/scoring.py backend/tests/test_prospect_audit_scoring.py
git commit -m "feat(prospect-audit): RVI scoring module + unit tests"
```

---

## Phase 2 — Support modules

### Task 4: Logo fetcher (og:image → favicon → text tile)

**Files:**
- Create: `backend/app/services/prospect_audit/logo_fetch.py`
- Create: `backend/tests/test_prospect_audit_logo.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_logo.py`:

```python
"""Logo fetch fallback chain: og:image → favicon → text tile."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.logo_fetch import fetch_prospect_logo, _text_tile_data_uri


@pytest.mark.asyncio
async def test_og_image_present_returns_og_image():
    html = '<html><head><meta property="og:image" content="https://example.com/logo.png"></head></html>'
    image_bytes = b"\x89PNG\r\n\x1a\nfake"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/logo.png":
            return _MockResp(200, "image/png", image_bytes)
        raise AssertionError(f"unexpected url {url}")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_og_image_absent_falls_back_to_favicon():
    html = "<html><head><title>No og image</title></head></html>"
    favicon_bytes = b"\x00\x00\x01\x00fake"

    async def fake_get(url, timeout=10):
        if url == "https://example.com":
            return _MockResp(200, "text/html", html.encode())
        if url == "https://example.com/favicon.ico":
            return _MockResp(200, "image/x-icon", favicon_bytes)
        raise AssertionError(f"unexpected url {url}")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/x-icon;base64,")


@pytest.mark.asyncio
async def test_all_fallbacks_fail_returns_text_tile():
    async def fake_get(url, timeout=10):
        raise RuntimeError("network down")

    with patch("app.services.prospect_audit.logo_fetch._http_get", new=AsyncMock(side_effect=fake_get)):
        uri = await fetch_prospect_logo("https://example.com", "Acme")
    assert uri.startswith("data:image/svg+xml;base64,")


def test_text_tile_uses_first_letter():
    uri = _text_tile_data_uri("Acme Dental")
    import base64
    svg = base64.b64decode(uri.split(",", 1)[1]).decode()
    # Should contain the letter A (uppercase first letter of "Acme")
    assert ">A<" in svg


class _MockResp:
    def __init__(self, status: int, content_type: str, body: bytes):
        self.status_code = status
        self.headers = {"content-type": content_type}
        self.content = body
        self.text = body.decode(errors="replace")
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_logo.py -v
```

Expected: ImportError — `logo_fetch` not found.

- [ ] **Step 3: Implement `logo_fetch.py`**

Create `backend/app/services/prospect_audit/logo_fetch.py`:

```python
"""Resolve a prospect's logo as a data URI for embedding in the PDF.

Fallback chain: og:image meta tag → /favicon.ico → text-tile SVG (first letter).
All network calls are best-effort — any failure cascades to the next step.
"""
from __future__ import annotations

import base64
import logging
import re
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)


_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


async def _http_get(url: str, timeout: float = 10):
    """Wrapped so tests can patch one symbol."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        return await client.get(url)


async def fetch_prospect_logo(website_url: str, business_name: str) -> str:
    """Return a data URI for the prospect's logo. Never raises."""
    base = website_url.rstrip("/")

    # 1. og:image
    try:
        resp = await _http_get(base)
        ct = resp.headers.get("content-type", "")
        if resp.status_code == 200 and "html" in ct.lower():
            m = _OG_IMAGE_RE.search(resp.text)
            if m:
                og_url = urljoin(base + "/", m.group(1))
                uri = await _fetch_as_data_uri(og_url)
                if uri:
                    return uri
    except Exception as exc:
        logger.debug("prospect logo og:image fetch failed for %s: %s", base, exc)

    # 2. favicon
    try:
        favicon_url = urljoin(base + "/", "/favicon.ico")
        uri = await _fetch_as_data_uri(favicon_url)
        if uri:
            return uri
    except Exception as exc:
        logger.debug("prospect logo favicon fetch failed for %s: %s", base, exc)

    # 3. text tile
    return _text_tile_data_uri(business_name)


async def _fetch_as_data_uri(url: str) -> str | None:
    try:
        resp = await _http_get(url)
    except Exception:
        return None
    if resp.status_code != 200 or not resp.content:
        return None
    ct = resp.headers.get("content-type", "image/png").split(";")[0].strip()
    if not ct.startswith("image/"):
        return None
    b64 = base64.b64encode(resp.content).decode("ascii")
    return f"data:{ct};base64,{b64}"


def _text_tile_data_uri(business_name: str) -> str:
    """Generate a small colored-square SVG with the business's first letter."""
    initial = (business_name.strip()[:1] or "?").upper()
    # Deterministic color from the initial — feels less random than literal random
    palette = ["#5f7ea6", "#0f766e", "#7c3aed", "#b91c1c", "#b45309", "#1d4ed8"]
    color = palette[(ord(initial) if initial else 0) % len(palette)]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">'
        f'<rect width="140" height="140" fill="{color}" rx="14"/>'
        f'<text x="70" y="92" font-family="Georgia, serif" font-size="76" '
        f'fill="white" text-anchor="middle">{initial}</text>'
        f'</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_logo.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/logo_fetch.py backend/tests/test_prospect_audit_logo.py
git commit -m "feat(prospect-audit): logo fetcher with og:image → favicon → text-tile fallback"
```

---

### Task 5: Prompt generator (Claude Haiku, geo-aware)

**Files:**
- Create: `backend/app/services/prospect_audit/prompt_gen.py`
- Create: `backend/tests/test_prospect_audit_prompt_gen.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_prompt_gen.py`:

```python
from unittest.mock import AsyncMock, patch
import json

import pytest

from app.services.prospect_audit.prompt_gen import generate_prompts


def _mock_claude(text: str):
    """Helper to build an anthropic-style response object."""
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


@pytest.mark.asyncio
async def test_generate_prompts_returns_ten():
    fake_json = json.dumps([f"Question {i}?" for i in range(10)])
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await generate_prompts(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="We make widgets",
            location=None,
        )
    assert len(result) == 10
    assert all(q.endswith("?") for q in result)


@pytest.mark.asyncio
async def test_generate_prompts_local_includes_location_in_system_prompt():
    fake_json = json.dumps([f"Q{i}?" for i in range(10)])
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        await generate_prompts(
            business_name="Acme Dental",
            website_url="https://acme.com",
            homepage_excerpt="dentist",
            location="Austin, TX",
        )
    # Check the system prompt sent to Claude mentioned the location
    call_kwargs = fake_create.await_args.kwargs
    msg_text = call_kwargs["messages"][0]["content"]
    assert "Austin, TX" in msg_text
    assert "geographically" in msg_text.lower() or "local" in msg_text.lower()


@pytest.mark.asyncio
async def test_generate_prompts_fails_on_too_few():
    fake_json = json.dumps(["Q1?", "Q2?", "Q3?"])   # only 3
    fake_create = AsyncMock(return_value=_mock_claude(fake_json))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        with pytest.raises(RuntimeError, match="prompts"):
            await generate_prompts(
                business_name="Acme",
                website_url="https://acme.com",
                homepage_excerpt="",
                location=None,
            )


@pytest.mark.asyncio
async def test_generate_prompts_missing_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await generate_prompts(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="",
            location=None,
        )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_prompt_gen.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `prompt_gen.py`**

Create `backend/app/services/prospect_audit/prompt_gen.py`:

```python
"""Generate 10 high-value AI-visibility tracking prompts for a prospect.

For local businesses, prompts must be geographically anchored — include the
city name explicitly in roughly half, and use "near me"-style framing in others.
"""
from __future__ import annotations

import json
import logging
import os
import re

import anthropic

logger = logging.getLogger(__name__)

_MIN_PROMPTS_REQUIRED = 10
_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 1500


def _system_prompt(business_name: str, website_url: str, homepage_excerpt: str, location: str | None) -> str:
    context = f"Business name: {business_name}\nWebsite: {website_url}"
    if homepage_excerpt.strip():
        context += f"\nHomepage content (excerpt):\n{homepage_excerpt.strip()[:3000]}"

    if location:
        geo_block = f"""
This is a LOCAL business in {location}. EVERY prompt must be geographically sensitive:
- Include "{location}" or the city name explicitly in at least half of the prompts
- Use "near me", "in {location}", or similar framing in the rest
- DO NOT generate generic prompts — every question must be one a person physically near {location} would ask"""
    else:
        geo_block = ""

    return f"""You generate AI visibility tracking prompts for businesses. Find the real queries a potential customer types into ChatGPT/Perplexity/Gemini when researching solutions — NOT looking up a specific brand.

{context}
{geo_block}

Return ONLY a valid JSON array of exactly {_MIN_PROMPTS_REQUIRED} strings — no explanation, no markdown.
EVERY prompt MUST be phrased as a question and end with "?".

Mix of intents:
- Category queries ("best X")
- Comparison queries ("X vs Y")
- Problem-seeking queries ("how do I...")
- Buying-decision queries ("worth it", "alternatives")

NEVER include the business name "{business_name}" in any question.
Avoid duplicates — each of the {_MIN_PROMPTS_REQUIRED} prompts must explore a distinct angle."""


async def generate_prompts(
    *,
    business_name: str,
    website_url: str,
    homepage_excerpt: str,
    location: str | None,
) -> list[str]:
    """Generate the 10 audit prompts. Raises RuntimeError on failure."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    msg = _system_prompt(business_name, website_url, homepage_excerpt, location)
    client = anthropic.AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        messages=[{"role": "user", "content": msg}],
    )

    raw = resp.content[0].text.strip() if resp.content else ""
    m = re.search(r"\[[\s\S]*\]", raw)
    try:
        items = json.loads(m.group() if m else raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise RuntimeError(f"Failed to parse prompt JSON: {exc}") from exc

    if not isinstance(items, list):
        raise RuntimeError("Prompt generation did not return a list")

    cleaned: list[str] = []
    for s in items:
        if not isinstance(s, str):
            continue
        s = s.strip()
        if not s:
            continue
        if not s.endswith("?"):
            s += "?"
        cleaned.append(s)

    if len(cleaned) < _MIN_PROMPTS_REQUIRED - 2:   # tolerate 8 — 9 hard failures fall here
        raise RuntimeError(f"Only {len(cleaned)} valid prompts returned, need at least {_MIN_PROMPTS_REQUIRED - 1}")

    return cleaned[:_MIN_PROMPTS_REQUIRED]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_prompt_gen.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/prompt_gen.py backend/tests/test_prospect_audit_prompt_gen.py
git commit -m "feat(prospect-audit): geo-aware prompt generator via Claude Haiku"
```

---

### Task 6: Competitor detector

**Files:**
- Create: `backend/app/services/prospect_audit/competitor_detect.py`
- Create: `backend/tests/test_prospect_audit_competitor_detect.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_competitor_detect.py`:

```python
from unittest.mock import AsyncMock, patch
import json

import pytest

from app.services.prospect_audit.competitor_detect import detect_competitors, DetectedCompetitor


def _mock_claude(text: str):
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


@pytest.mark.asyncio
async def test_detect_competitors_returns_list():
    payload = json.dumps([
        {"name": "GRAIL", "website": "https://grail.com"},
        {"name": "Freenome", "website": "https://freenome.com"},
        {"name": "Delfi", "website": "https://delfi.com"},
    ])
    fake_create = AsyncMock(return_value=_mock_claude(payload))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await detect_competitors(
            business_name="Spot It Early",
            website_url="https://spotitearly.com",
            homepage_excerpt="early cancer detection",
            prompts=["best cancer screening test?"],
        )
    assert len(result) == 3
    assert all(isinstance(c, DetectedCompetitor) for c in result)
    assert result[0].name == "GRAIL"
    assert all(not c.is_subject for c in result)   # no prompt names a competitor explicitly


@pytest.mark.asyncio
async def test_detect_competitors_flags_subject_when_named_in_prompts():
    payload = json.dumps([
        {"name": "GRAIL", "website": "https://grail.com"},
        {"name": "Freenome", "website": "https://freenome.com"},
    ])
    fake_create = AsyncMock(return_value=_mock_claude(payload))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        result = await detect_competitors(
            business_name="Spot It Early",
            website_url="https://spotitearly.com",
            homepage_excerpt="",
            prompts=["alternatives to GRAIL?", "best cancer screening?"],
        )
    by_name = {c.name: c for c in result}
    assert by_name["GRAIL"].is_subject is True
    assert by_name["Freenome"].is_subject is False


@pytest.mark.asyncio
async def test_detect_competitors_fails_on_zero():
    fake_create = AsyncMock(return_value=_mock_claude("[]"))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_create
        with pytest.raises(RuntimeError, match="peer"):
            await detect_competitors(
                business_name="Acme",
                website_url="https://acme.com",
                homepage_excerpt="",
                prompts=["test?"],
            )


@pytest.mark.asyncio
async def test_detect_competitors_missing_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        await detect_competitors(
            business_name="Acme",
            website_url="https://acme.com",
            homepage_excerpt="",
            prompts=["t?"],
        )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_competitor_detect.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `competitor_detect.py`**

Create `backend/app/services/prospect_audit/competitor_detect.py`:

```python
"""Identify 3–5 peer brands for a prospect via Claude Haiku.

A competitor is marked is_subject when the audit's generated prompts name it
explicitly (e.g. "alternatives to GRAIL?"). Subject competitors are excluded
from the peer-average denominator in RVI scoring.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

import anthropic

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 800
_MIN_COMPETITORS = 1   # hard fail below this — RVI undefined without peers


@dataclass(frozen=True)
class DetectedCompetitor:
    name: str
    website_url: str | None
    is_subject: bool


def _system_prompt(business_name: str, website_url: str, homepage_excerpt: str) -> str:
    context = f"Business: {business_name} ({website_url})"
    if homepage_excerpt.strip():
        context += f"\nHomepage excerpt:\n{homepage_excerpt.strip()[:2500]}"

    return f"""Identify 3–5 real, well-known competitor brands for this business.

{context}

Return ONLY a valid JSON array. Each item: {{"name": "...", "website": "https://..."}}.

CRITICAL RULES:
- Only real, publicly-known brands. If you are not confident a competitor exists, omit it.
- Brands in the same product category and target market.
- Do NOT include the business itself.
- 3–5 entries. Never more than 5.
- No explanation, no markdown — just the JSON array."""


def _subject_matches_prompt(name: str, prompts: list[str]) -> bool:
    """True if any prompt mentions this competitor by name (case-insensitive)."""
    n = name.strip().lower()
    if len(n) < 3:
        return False
    pattern = re.compile(rf"\b{re.escape(n)}\b", re.IGNORECASE)
    return any(pattern.search(p) for p in prompts)


async def detect_competitors(
    *,
    business_name: str,
    website_url: str,
    homepage_excerpt: str,
    prompts: list[str],
) -> list[DetectedCompetitor]:
    """Returns a non-empty list. Raises RuntimeError if 0 detected or API errors."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    client = anthropic.AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        messages=[{"role": "user", "content": _system_prompt(business_name, website_url, homepage_excerpt)}],
    )
    raw = resp.content[0].text.strip() if resp.content else ""
    m = re.search(r"\[[\s\S]*\]", raw)
    try:
        items = json.loads(m.group() if m else raw)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise RuntimeError(f"Failed to parse competitor JSON: {exc}") from exc

    if not isinstance(items, list):
        raise RuntimeError("Competitor detection did not return a list")

    out: list[DetectedCompetitor] = []
    for raw_item in items[:5]:
        if not isinstance(raw_item, dict):
            continue
        name = (raw_item.get("name") or "").strip()
        if not name:
            continue
        if name.strip().lower() == business_name.strip().lower():
            continue   # skip self
        website = (raw_item.get("website") or "").strip() or None
        if website and not website.startswith(("http://", "https://")):
            website = "https://" + website
        out.append(DetectedCompetitor(
            name=name,
            website_url=website,
            is_subject=_subject_matches_prompt(name, prompts),
        ))

    if len(out) < _MIN_COMPETITORS:
        raise RuntimeError(f"Could not identify peer brands ({len(out)} found, need ≥{_MIN_COMPETITORS})")
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_competitor_detect.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/competitor_detect.py backend/tests/test_prospect_audit_competitor_detect.py
git commit -m "feat(prospect-audit): competitor detector with subject-exclusion flag"
```

---

### Task 7: 90-query fan-out runner

**Files:**
- Create: `backend/app/services/prospect_audit/query_runner.py`
- Create: `backend/tests/test_prospect_audit_query_runner.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_query_runner.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.query_runner import run_queries_for_audit


@pytest.mark.asyncio
async def test_run_queries_produces_one_record_per_combination():
    fake_query = AsyncMock(return_value={
        "response_text": "Acme is great",
        "mentioned": True,
        "latency_ms": 100,
        "error": None,
    })
    progress_updates: list[str] = []

    async def progress(msg: str) -> None:
        progress_updates.append(msg)

    with patch("app.services.prospect_audit.query_runner.query_model", new=fake_query):
        results = await run_queries_for_audit(
            prompts=["q1?", "q2?"],
            models=["chatgpt", "perplexity"],
            runs_per=2,
            brand_name="Acme",
            on_progress=progress,
            cancel_event=None,
        )

    # 2 prompts × 2 models × 2 runs = 8 query records
    assert len(results) == 8
    # Each result tagged with prompt_index, model, run
    by_keys = {(r["prompt_index"], r["model"], r["run"]) for r in results}
    assert (0, "chatgpt", 1) in by_keys
    assert (1, "perplexity", 2) in by_keys
    # Progress notifications fired
    assert any("queries:" in s for s in progress_updates)


@pytest.mark.asyncio
async def test_run_queries_records_errors_without_halting():
    call_count = {"n": 0}

    async def flaky(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] % 3 == 0:
            return {"response_text": None, "mentioned": False, "latency_ms": 0, "error": "rate limited"}
        return {"response_text": "ok", "mentioned": True, "latency_ms": 50, "error": None}

    with patch("app.services.prospect_audit.query_runner.query_model", new=AsyncMock(side_effect=flaky)):
        results = await run_queries_for_audit(
            prompts=["q?"],
            models=["chatgpt", "perplexity", "gemini"],
            runs_per=3,
            brand_name="Acme",
            on_progress=None,
            cancel_event=None,
        )

    assert len(results) == 9
    errored = [r for r in results if r["error"] is not None]
    successful = [r for r in results if r["error"] is None]
    # Roughly 1/3 errored (3 out of 9)
    assert len(errored) >= 1
    assert len(successful) >= 1


@pytest.mark.asyncio
async def test_run_queries_respects_cancellation():
    import asyncio
    cancel = asyncio.Event()
    cancel.set()   # already set before we start

    async def fake_query(*args, **kwargs):
        return {"response_text": "", "mentioned": False, "latency_ms": 0, "error": None}

    with patch("app.services.prospect_audit.query_runner.query_model", new=AsyncMock(side_effect=fake_query)):
        with pytest.raises(asyncio.CancelledError):
            await run_queries_for_audit(
                prompts=["q?"],
                models=["chatgpt"],
                runs_per=3,
                brand_name="Acme",
                on_progress=None,
                cancel_event=cancel,
            )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_query_runner.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `query_runner.py`**

Create `backend/app/services/prospect_audit/query_runner.py`:

```python
"""Fan out N prompts × M models × K runs against the existing llm_service.

Returns a flat list of result dicts with prompt_index/model/run metadata so the
caller can slot them into the right scoring buckets.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.services.llm_service import query_model

logger = logging.getLogger(__name__)

_MAX_CONCURRENT = 10


async def run_queries_for_audit(
    *,
    prompts: list[str],
    models: list[str],
    runs_per: int,
    brand_name: str,
    on_progress: Callable[[str], Awaitable[None]] | None,
    cancel_event: asyncio.Event | None,
) -> list[dict]:
    """Execute every (prompt × model × run) combination concurrently.

    Each result dict has shape:
        {prompt_index, model, run, response_text, mentioned, latency_ms, error}

    Raises asyncio.CancelledError if cancel_event is set at any check-in point.
    """
    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    sem = asyncio.Semaphore(_MAX_CONCURRENT)
    total = len(prompts) * len(models) * runs_per
    completed = {"n": 0}

    async def one(prompt_index: int, prompt: str, model: str, run: int) -> dict:
        async with sem:
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError()
            res = await query_model(
                model=model,
                prompt=prompt,
                brand_name=brand_name,
                pro=True,   # use upgraded model variants (sonar-pro etc.) for audit quality
                cancel_event=cancel_event,
            )
            completed["n"] += 1
            if on_progress and (completed["n"] % 5 == 0 or completed["n"] == total):
                await on_progress(f"queries: {completed['n']}/{total}")
            return {
                "prompt_index": prompt_index,
                "model": model,
                "run": run,
                "response_text": res.get("response_text") or "",
                "mentioned": bool(res.get("mentioned", False)),
                "latency_ms": int(res.get("latency_ms") or 0),
                "error": res.get("error"),
            }

    tasks: list[asyncio.Task] = []
    for prompt_index, prompt in enumerate(prompts):
        for model in models:
            for run in range(1, runs_per + 1):
                tasks.append(asyncio.create_task(one(prompt_index, prompt, model, run)))

    results = await asyncio.gather(*tasks, return_exceptions=False)
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_query_runner.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/query_runner.py backend/tests/test_prospect_audit_query_runner.py
git commit -m "feat(prospect-audit): 90-query fan-out runner with cancel + progress callbacks"
```

---

### Task 8: Recommendations generator (Claude Sonnet + Haiku fallback)

**Files:**
- Create: `backend/app/services/prospect_audit/recommendations.py`
- Create: `backend/tests/test_prospect_audit_recommendations.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_recommendations.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from app.services.prospect_audit.recommendations import (
    AuditSummaryForRecs,
    PromptInsight,
    draft_recommendations,
)


def _mock_claude(text: str):
    class _Content:
        def __init__(self, t): self.text = t
    class _Resp:
        def __init__(self, t): self.content = [_Content(t)]
    return _Resp(text)


def _summary() -> AuditSummaryForRecs:
    return AuditSummaryForRecs(
        business_name="Acme Dental",
        location="Austin, TX",
        overall_visibility_pct=18.0,
        peer_avg_visibility_pct=52.0,
        aggregate_rvi=0.35,
        rvi_band="losing",
        worst_prompts=[
            PromptInsight(
                prompt_text="best dentist in Austin?",
                own_visibility_pct=11.0,
                peer_avg_visibility_pct=89.0,
                rvi=0.12,
                top_competitor_name="Brilliant Smile",
                top_competitor_visibility_pct=92.0,
            ),
        ],
    )


@pytest.mark.asyncio
async def test_draft_recommendations_uses_sonnet_first():
    fake_sonnet = AsyncMock(return_value=_mock_claude("1. **Publish 12 articles** — because reasons."))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = fake_sonnet
        result = await draft_recommendations(_summary())
    assert result is not None
    assert "Publish" in result
    # Confirm the sonnet model was used
    call_kwargs = fake_sonnet.await_args.kwargs
    assert "sonnet" in call_kwargs["model"].lower()


@pytest.mark.asyncio
async def test_draft_recommendations_falls_back_to_haiku_on_sonnet_failure():
    sonnet_then_haiku = AsyncMock(side_effect=[
        Exception("sonnet down"),
        _mock_claude("1. **Fallback rec** — body."),
    ])
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = sonnet_then_haiku
        result = await draft_recommendations(_summary())
    assert result is not None
    assert "Fallback" in result
    # Two calls — sonnet then haiku
    assert sonnet_then_haiku.await_count == 2


@pytest.mark.asyncio
async def test_draft_recommendations_returns_none_when_both_fail():
    boom = AsyncMock(side_effect=Exception("both down"))
    with patch("anthropic.AsyncAnthropic") as mock_cls:
        mock_cls.return_value.messages.create = boom
        result = await draft_recommendations(_summary())
    assert result is None


@pytest.mark.asyncio
async def test_draft_recommendations_no_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = await draft_recommendations(_summary())
    assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_recommendations.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `recommendations.py`**

Create `backend/app/services/prospect_audit/recommendations.py`:

```python
"""Generate 3–5 prescriptive recommendations from the scored audit data.

Sonnet first (better narrative quality). Haiku as fallback if Sonnet errors.
Returns None if both fail — caller substitutes a static block in the PDF.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import anthropic

logger = logging.getLogger(__name__)

_SONNET = "claude-sonnet-4-6"
_HAIKU = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 1500


@dataclass(frozen=True)
class PromptInsight:
    prompt_text: str
    own_visibility_pct: float
    peer_avg_visibility_pct: float
    rvi: float | None
    top_competitor_name: str | None
    top_competitor_visibility_pct: float | None


@dataclass(frozen=True)
class AuditSummaryForRecs:
    business_name: str
    location: str | None
    overall_visibility_pct: float
    peer_avg_visibility_pct: float
    aggregate_rvi: float | None
    rvi_band: str
    worst_prompts: list[PromptInsight]


def _system_prompt(s: AuditSummaryForRecs) -> str:
    loc = f" in {s.location}" if s.location else ""
    rvi_str = f"{s.aggregate_rvi:.2f}" if s.aggregate_rvi is not None else "n/a"

    worst_lines: list[str] = []
    for p in s.worst_prompts:
        line = f"- \"{p.prompt_text}\" — you: {p.own_visibility_pct:.0f}%, peer avg: {p.peer_avg_visibility_pct:.0f}%"
        if p.top_competitor_name and p.top_competitor_visibility_pct is not None:
            line += f" (top competitor: {p.top_competitor_name} at {p.top_competitor_visibility_pct:.0f}%)"
        worst_lines.append(line)
    worst_block = "\n".join(worst_lines) if worst_lines else "(no notably losing prompts)"

    return f"""You are a senior consultant at Lumidian, an AI visibility agency. Write 3–5 prescriptive recommendations for {s.business_name}{loc} based on this audit.

Audit summary:
- Overall visibility: {s.overall_visibility_pct:.0f}% (peer avg: {s.peer_avg_visibility_pct:.0f}%)
- Aggregate RVI: {rvi_str} (band: {s.rvi_band})
- Methodology: 10 prompts × 3 models × 3 runs = 90 queries against ChatGPT search, Perplexity, Gemini.

Worst-performing prompts:
{worst_block}

Lumidian's deliverables: 12+ AI-optimized long-form drafts per month posted across LinkedIn, Medium, Reddit, Quora, X; weekly AI visibility tracking; site-audit + schema fixes; competitor monitoring.

Write 3–5 recommendations as numbered markdown items. Each one:
- Bold one-line claim (e.g. "**Publish 12 long-form articles on Invisalign in Austin**")
- 2 sentences of justification tied to the actual gap above (name the competitor where relevant)
- Tie to a specific Lumidian deliverable

Output ONLY the numbered markdown list. No preamble, no closing remarks, no explanation."""


async def _try_model(model: str, prompt: str) -> str | None:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        resp = await client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip() if resp.content else ""
        return text or None
    except Exception as exc:
        logger.warning("recommendations call to %s failed: %s", model, exc)
        return None


async def draft_recommendations(summary: AuditSummaryForRecs) -> str | None:
    """Returns markdown recommendations, or None if all attempts failed.

    PDF render substitutes a static fallback block when this returns None.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    prompt = _system_prompt(summary)
    # Try Sonnet first
    text = await _try_model(_SONNET, prompt)
    if text:
        return text
    # Fallback to Haiku
    return await _try_model(_HAIKU, prompt)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_recommendations.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/recommendations.py backend/tests/test_prospect_audit_recommendations.py
git commit -m "feat(prospect-audit): LLM recommendations generator with Haiku fallback"
```

---

## Phase 3 — Pipeline orchestrator

### Task 9: Cancel events registry in `state.py`

**Files:**
- Modify: `backend/app/state.py`

- [ ] **Step 1: Add cancel events dict**

Open `backend/app/state.py` and append at the end:

```python
import asyncio

prospect_audit_cancel_events: dict[int, asyncio.Event] = {}
"""Map of audit_id -> Event. Set by the /cancel endpoint, consumed by the runner.
Single-process: this lives in one uvicorn worker. Cancel intent also persists
to ProspectAudit.cancel_requested so a process restart still observes it."""
```

If `asyncio` is already imported, don't add a duplicate import.

- [ ] **Step 2: Commit**

```bash
git add backend/app/state.py
git commit -m "feat(prospect-audit): cancel-events registry in state.py"
```

---

### Task 10: Runner orchestrator (state machine driver)

**Files:**
- Create: `backend/app/services/prospect_audit/runner.py`
- Create: `backend/tests/test_prospect_audit_runner.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_runner.py`:

```python
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit, User
from app.services.prospect_audit.runner import run_audit


async def _make_audit(business_name: str = "Acme", is_local: bool = False, location: str | None = None) -> int:
    async with AsyncSessionLocal() as db:
        user = User(email=f"staff-{business_name}@x.com", password_hash="x", name="Staff", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()
        a = ProspectAudit(
            staff_user_id=user.id,
            business_name=business_name,
            website_url="https://example.com",
            is_local=is_local,
            location=location,
        )
        db.add(a)
        await db.commit()
        return a.id


async def _reload(audit_id: int) -> ProspectAudit:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        return result.scalar_one()


@pytest.mark.asyncio
async def test_run_audit_happy_path(tmp_path, monkeypatch):
    """End-to-end happy path with every external call mocked."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)

    audit_id = await _make_audit()

    # Mock all the steps:
    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="example excerpt")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:image/png;base64,xx")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=_fake_queries())), \
         patch("app.services.prospect_audit.runner.draft_recommendations", new=AsyncMock(return_value="1. **Do X**")), \
         patch("app.services.prospect_audit.runner.render_prospect_pdf", new=AsyncMock(return_value=b"%PDF-1.4 fake")):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "completed"
    assert a.overall_visibility_pct is not None
    assert a.aggregate_rvi is not None or a.rvi_band == "dominant"
    assert a.rvi_band in {"dominant", "winning", "even", "losing", "invisible"}
    assert a.pdf_path is not None
    assert (tmp_path / a.pdf_path.split("/")[-1]).exists()
    assert a.completed_at is not None
    assert a.error_message is None


@pytest.mark.asyncio
async def test_run_audit_fails_when_anthropic_key_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value=None)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "failed"
    assert a.error_message and "prompts" in a.error_message.lower()


@pytest.mark.asyncio
async def test_run_audit_cancels_mid_run(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    async def cancel_during_queries(*args, **kwargs):
        # Simulate the user hitting cancel while queries are in flight
        raise asyncio.CancelledError()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(side_effect=cancel_during_queries)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "canceled"


@pytest.mark.asyncio
async def test_run_audit_continues_when_recommendations_fail(tmp_path, monkeypatch):
    """Recommendations are non-fatal — PDF uses fallback block but audit completes."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=_fake_queries())), \
         patch("app.services.prospect_audit.runner.draft_recommendations", new=AsyncMock(return_value=None)), \
         patch("app.services.prospect_audit.runner.render_prospect_pdf", new=AsyncMock(return_value=b"%PDF")):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "completed"   # non-fatal


@pytest.mark.asyncio
async def test_run_audit_fails_on_too_many_query_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake")
    monkeypatch.setattr("app.services.prospect_audit.runner.PROSPECT_AUDIT_PDF_DIR", tmp_path)
    audit_id = await _make_audit()

    # All queries error
    errored = [
        {"prompt_index": pi, "model": m, "run": r, "response_text": "", "mentioned": False, "latency_ms": 0, "error": "boom"}
        for pi in range(10) for m in ("chatgpt", "perplexity", "gemini") for r in (1, 2, 3)
    ]

    with patch("app.services.prospect_audit.runner._scrape_homepage", new=AsyncMock(return_value="")), \
         patch("app.services.prospect_audit.runner.fetch_prospect_logo", new=AsyncMock(return_value="data:x")), \
         patch("app.services.prospect_audit.runner.generate_prompts", new=AsyncMock(return_value=[f"Q{i}?" for i in range(10)])), \
         patch("app.services.prospect_audit.runner.detect_competitors", new=AsyncMock(return_value=_fake_competitors())), \
         patch("app.services.prospect_audit.runner.run_queries_for_audit", new=AsyncMock(return_value=errored)):
        await run_audit(audit_id)

    a = await _reload(audit_id)
    assert a.status == "failed"
    assert "query" in a.error_message.lower() or "fail" in a.error_message.lower()


def _fake_competitors():
    from app.services.prospect_audit.competitor_detect import DetectedCompetitor
    return [
        DetectedCompetitor(name="CompA", website_url="https://a.com", is_subject=False),
        DetectedCompetitor(name="CompB", website_url="https://b.com", is_subject=False),
    ]


def _fake_queries():
    """10 prompts × 3 models × 3 runs = 90 results, with own mentioned in some."""
    results = []
    for pi in range(10):
        for m in ("chatgpt", "perplexity", "gemini"):
            for r in (1, 2, 3):
                results.append({
                    "prompt_index": pi,
                    "model": m,
                    "run": r,
                    "response_text": f"text about Acme {pi}",
                    "mentioned": pi % 2 == 0,
                    "latency_ms": 100,
                    "error": None,
                })
    return results
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_runner.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `runner.py`**

Create `backend/app/services/prospect_audit/runner.py`:

```python
"""Prospect audit orchestrator — drives the state machine end-to-end.

Never raises. Failures are caught at the outer boundary and persisted to
ProspectAudit.error_message + status='failed'. Cancellation observed via
state.prospect_audit_cancel_events and ProspectAudit.cancel_requested.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit
from app.services.competitive_gap import _mention_matches
from app.services.jina_service import fetch_url_content
from app.services.prospect_audit.competitor_detect import DetectedCompetitor, detect_competitors
from app.services.prospect_audit.logo_fetch import fetch_prospect_logo
from app.services.prospect_audit.pdf_render import render_prospect_pdf
from app.services.prospect_audit.prompt_gen import generate_prompts
from app.services.prospect_audit.query_runner import run_queries_for_audit
from app.services.prospect_audit.recommendations import (
    AuditSummaryForRecs,
    PromptInsight,
    draft_recommendations,
)
from app.services.prospect_audit.scoring import (
    CompetitorRecord,
    PromptScore,
    QueryRecord,
    aggregate_audit,
    score_prompt,
)
from app.state import prospect_audit_cancel_events

logger = logging.getLogger(__name__)

PROSPECT_AUDIT_PDF_DIR = Path(os.getenv("PROSPECT_AUDIT_PDF_DIR", "data/prospect_audits"))

_MODELS = ["chatgpt", "perplexity", "gemini"]
_RUNS_PER = 3
_MAX_QUERY_ERROR_RATIO = 0.40   # >40% query errors → hard fail


async def _scrape_homepage(website_url: str) -> str:
    """Best-effort homepage scrape via Jina. Returns empty string on failure."""
    try:
        text = await fetch_url_content(website_url)
        return (text or "")[:8000]
    except Exception as exc:
        logger.info("scrape_homepage failed for %s: %s", website_url, exc)
        return ""


async def run_audit(audit_id: int) -> None:
    """Walk the state machine end-to-end. Never raises."""
    cancel_event = asyncio.Event()
    prospect_audit_cancel_events[audit_id] = cancel_event
    try:
        await _run_audit_inner(audit_id, cancel_event)
    except Exception as exc:
        logger.exception("prospect audit %d crashed unexpectedly", audit_id)
        await _persist_status(audit_id, status="failed", error_message=f"Unexpected error: {exc!s}", completed_at=datetime.utcnow())
    finally:
        prospect_audit_cancel_events.pop(audit_id, None)


async def _run_audit_inner(audit_id: int, cancel_event: asyncio.Event) -> None:
    audit = await _load(audit_id)
    if audit is None:
        logger.warning("prospect audit %d not found", audit_id)
        return

    # Pre-check cancel flag from DB (process restart case)
    if audit.cancel_requested:
        cancel_event.set()

    await _persist_status(audit_id, status="scraping", started_at=datetime.utcnow())

    # Step 1: scrape + logo (concurrent)
    try:
        excerpt, logo_data_uri = await asyncio.gather(
            _scrape_homepage(audit.website_url),
            fetch_prospect_logo(audit.website_url, audit.business_name),
        )
    except asyncio.CancelledError:
        return await _mark_canceled(audit_id)

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    # Step 2: prompts + competitors (need prompts first to compute is_subject for competitors)
    await _persist_status(audit_id, status="generating_prompts")
    try:
        prompts = await generate_prompts(
            business_name=audit.business_name,
            website_url=audit.website_url,
            homepage_excerpt=excerpt,
            location=audit.location if audit.is_local else None,
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"Failed to generate audit prompts: {exc!s}", completed_at=datetime.utcnow())

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    await _persist_status(audit_id, status="detecting_competitors")
    try:
        competitors = await detect_competitors(
            business_name=audit.business_name,
            website_url=audit.website_url,
            homepage_excerpt=excerpt,
            prompts=prompts,
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"Could not identify peer brands: {exc!s}", completed_at=datetime.utcnow())

    if cancel_event.is_set():
        return await _mark_canceled(audit_id)

    # Step 3: run 90 queries
    await _persist_status(audit_id, status="running_queries", status_message=f"queries: 0/{len(prompts) * len(_MODELS) * _RUNS_PER}")

    async def on_progress(msg: str) -> None:
        await _persist_status(audit_id, status_message=msg)

    try:
        query_results = await run_queries_for_audit(
            prompts=prompts,
            models=_MODELS,
            runs_per=_RUNS_PER,
            brand_name=audit.business_name,
            on_progress=on_progress,
            cancel_event=cancel_event,
        )
    except asyncio.CancelledError:
        return await _mark_canceled(audit_id)

    error_count = sum(1 for r in query_results if r["error"] is not None)
    if query_results and error_count / len(query_results) > _MAX_QUERY_ERROR_RATIO:
        return await _persist_status(audit_id, status="failed", error_message=f"Too many query failures ({error_count}/{len(query_results)}).", completed_at=datetime.utcnow())

    # Detect competitor mentions for every result (in-memory only)
    comp_records = [CompetitorRecord(id=i + 1, is_subject=c.is_subject) for i, c in enumerate(competitors)]
    # Build {prompt_index: {comp_id: [bool aligned with queries for that prompt]}}
    per_prompt_queries: dict[int, list[dict]] = {}
    for r in query_results:
        per_prompt_queries.setdefault(r["prompt_index"], []).append(r)

    # Step 4: score
    await _persist_status(audit_id, status="scoring")
    prompt_scores: list[PromptScore] = []
    for pi, prompt_text in enumerate(prompts):
        prompt_results = per_prompt_queries.get(pi, [])
        q_records = [
            QueryRecord(
                model=r["model"],
                run=r["run"],
                response_text=r["response_text"],
                mentioned=r["mentioned"],
                error=r["error"],
            )
            for r in prompt_results
        ]
        comp_mentions: dict[int, list[bool]] = {}
        for i, comp in enumerate(competitors, start=1):
            comp_mentions[i] = [
                _mention_matches(r["response_text"], comp.name) if r["error"] is None else False
                for r in prompt_results
            ]
        score = score_prompt(q_records, comp_mentions, comp_records)
        # Re-tag with the actual prompt_index (score_prompt returns 0 by default)
        prompt_scores.append(PromptScore(
            prompt_index=pi,
            own_visibility_pct=score.own_visibility_pct,
            peer_avg_visibility_pct=score.peer_avg_visibility_pct,
            rvi=score.rvi,
            rvi_band=score.rvi_band,
        ))

    total_queries = sum(1 for r in query_results if r["error"] is None)
    mention_count = sum(1 for r in query_results if r["error"] is None and r["mentioned"])
    overall_vis, agg_rvi, rvi_band = aggregate_audit(prompt_scores, total_queries, mention_count)

    # Step 5: recommendations (non-fatal)
    await _persist_status(audit_id, status="drafting_recs")
    worst_three = sorted(
        prompt_scores,
        key=lambda p: (p.rvi if p.rvi is not None else (-1.0 if p.rvi_band == "dominant" else 0.0)),
    )[:3]

    def _top_comp_for(prompt_index: int) -> tuple[str | None, float | None]:
        prompt_results = per_prompt_queries.get(prompt_index, [])
        best_name: str | None = None
        best_pct: float = -1.0
        non_error = [r for r in prompt_results if r["error"] is None]
        if not non_error:
            return None, None
        for comp in competitors:
            if comp.is_subject:
                continue
            hits = sum(1 for r in non_error if _mention_matches(r["response_text"], comp.name))
            pct = (hits / len(non_error)) * 100.0
            if pct > best_pct:
                best_pct = pct
                best_name = comp.name
        if best_name is None or best_pct <= 0.0:
            return None, None
        return best_name, round(best_pct, 1)

    insights: list[PromptInsight] = []
    for ps in worst_three:
        top_name, top_pct = _top_comp_for(ps.prompt_index)
        insights.append(PromptInsight(
            prompt_text=prompts[ps.prompt_index],
            own_visibility_pct=ps.own_visibility_pct,
            peer_avg_visibility_pct=ps.peer_avg_visibility_pct,
            rvi=ps.rvi,
            top_competitor_name=top_name,
            top_competitor_visibility_pct=top_pct,
        ))

    peer_avg_overall = sum(p.peer_avg_visibility_pct for p in prompt_scores) / max(len(prompt_scores), 1)
    summary = AuditSummaryForRecs(
        business_name=audit.business_name,
        location=audit.location if audit.is_local else None,
        overall_visibility_pct=overall_vis,
        peer_avg_visibility_pct=round(peer_avg_overall, 2),
        aggregate_rvi=agg_rvi,
        rvi_band=rvi_band,
        worst_prompts=insights,
    )
    recommendations_md = await draft_recommendations(summary)

    # Step 6: render PDF
    await _persist_status(audit_id, status="rendering_pdf")
    try:
        pdf_bytes = await render_prospect_pdf(
            audit=audit,
            prompts=prompts,
            prompt_scores=prompt_scores,
            competitors=competitors,
            summary=summary,
            recommendations_md=recommendations_md,
            logo_data_uri=logo_data_uri,
            per_prompt_top_competitor={p.prompt_index: _top_comp_for(p.prompt_index) for p in worst_three},
        )
    except Exception as exc:
        return await _persist_status(audit_id, status="failed", error_message=f"PDF render failed: {exc!s}", completed_at=datetime.utcnow())

    PROSPECT_AUDIT_PDF_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = PROSPECT_AUDIT_PDF_DIR / f"{audit_id}.pdf"
    pdf_path.write_bytes(pdf_bytes)

    # Step 7: persist final state
    await _persist_status(
        audit_id,
        status="completed",
        completed_at=datetime.utcnow(),
        overall_visibility_pct=overall_vis,
        aggregate_rvi=agg_rvi,
        rvi_band=rvi_band,
        pdf_path=str(pdf_path),
        status_message=None,
    )


async def _load(audit_id: int) -> ProspectAudit | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        return result.scalar_one_or_none()


async def _persist_status(audit_id: int, **fields) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))
        a = result.scalar_one_or_none()
        if a is None:
            return
        for k, v in fields.items():
            setattr(a, k, v)
        await db.commit()


async def _mark_canceled(audit_id: int) -> None:
    await _persist_status(audit_id, status="canceled", completed_at=datetime.utcnow())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_runner.py -v
```

Expected: 5 passed. If `fetch_url_content` import fails, check `app/services/jina_service.py` for the actual function name and adjust the import.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/runner.py backend/tests/test_prospect_audit_runner.py
git commit -m "feat(prospect-audit): orchestrator state machine + happy/error/cancel tests"
```

---

## Phase 4 — PDF deliverable

### Task 11: HTML/CSS Jinja2 template

**Files:**
- Create: `backend/app/services/prospect_audit/templates/__init__.py` (empty)
- Create: `backend/app/services/prospect_audit/templates/prospect_audit.html.j2`

- [ ] **Step 1: Create the empty package marker**

Create `backend/app/services/prospect_audit/templates/__init__.py` with no content (zero bytes).

- [ ] **Step 2: Create the Jinja2 HTML template**

Create `backend/app/services/prospect_audit/templates/prospect_audit.html.j2`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>AI Visibility Audit — {{ business_name }}</title>
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, sans-serif; color: #0f172a; background: #fafafa; }
  .page { width: 8.5in; min-height: 11in; padding: 0.75in 0.75in 1in; page-break-after: always; position: relative; background: #fafafa; }
  .page:last-child { page-break-after: auto; }
  h1, h2, h3, h4 { margin: 0; font-weight: 600; }
  h2 { font-size: 22pt; line-height: 1.2; color: #0f172a; }
  h3 { font-size: 13pt; margin-bottom: 4pt; color: #0f172a; line-height: 1.3; }
  h4 { font-size: 9pt; margin: 14pt 0 6pt; color: #64748b; text-transform: uppercase; letter-spacing: 1.5pt; font-weight: 600; }
  p { margin: 0 0 10pt; line-height: 1.6; font-size: 10.5pt; color: #334155; }
  .muted { color: #94a3b8; }
  .footer { position: absolute; left: 0.75in; right: 0.75in; bottom: 0.45in; display: flex; justify-content: space-between; font-size: 9pt; color: #94a3b8; }
  .footer .wordmark { font-weight: 600; color: #64748b; }

  /* Cover */
  .cover { position: relative; height: 9.5in; }
  .cover .logo { width: 140px; height: auto; max-height: 80px; object-fit: contain; }
  .cover .hero { text-align: center; position: absolute; left: 0; right: 0; top: 46%; transform: translateY(-50%); padding: 0 0.75in; }
  .cover .hero .label { font-size: 11pt; letter-spacing: 3pt; text-transform: uppercase; color: #64748b; margin-bottom: 28pt; }
  .cover .hero .name { font-family: Georgia, "Times New Roman", serif; font-size: 44pt; color: #0f172a; margin: 0 0 16pt; line-height: 1.1; word-break: break-word; }
  .cover .hero .date { font-size: 15pt; color: #475569; margin-bottom: 32pt; }
  .cover .band-badge { display: inline-block; padding: 8pt 22pt; border-radius: 999px; font-family: Georgia, serif; font-size: 22pt; font-weight: 600; letter-spacing: 1pt; }
  .cover .band-rvi { font-size: 11pt; color: #475569; margin-top: 14pt; letter-spacing: 1pt; }
  .cover .meta { display: flex; justify-content: space-between; font-size: 10pt; color: #64748b; padding-top: 14pt; border-top: 1px solid #ececec; position: absolute; left: 0.75in; right: 0.75in; bottom: 0.75in; }

  /* Band colors */
  .band-dominant   { background: #ecfdf5; color: #059669; border: 1px solid #6ee7b7; }
  .band-winning    { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }
  .band-even       { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .band-losing     { background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; }
  .band-invisible  { background: #fef2f2; color: #e11d48; border: 1px solid #fca5a5; }

  /* Executive summary */
  .headline { font-family: Georgia, serif; font-size: 26pt; line-height: 1.2; color: #0f172a; margin: 24pt 0 20pt; }
  .headline strong { font-weight: 600; }
  .score-row { display: flex; gap: 12pt; margin: 14pt 0 28pt; }
  .score-card { flex: 1; background: #fff; border: 1px solid #ececec; border-radius: 10px; padding: 16pt 14pt; text-align: center; }
  .score-card .label { font-size: 9pt; text-transform: uppercase; letter-spacing: 1.5pt; color: #64748b; margin-bottom: 10pt; }
  .score-card .value { font-family: Georgia, serif; font-size: 38pt; line-height: 1; color: #0f172a; font-weight: 600; }
  .score-card .caption { font-size: 9.5pt; color: #475569; margin-top: 8pt; line-height: 1.45; }
  .methodology { font-size: 9pt; color: #94a3b8; line-height: 1.6; margin-top: 24pt; padding-top: 14pt; border-top: 1px solid #ececec; }

  /* Per-prompt scorecard */
  .prompt-card { background: #fff; border: 1px solid #ececec; border-radius: 8px; padding: 14pt 16pt; margin-bottom: 10pt; page-break-inside: avoid; }
  .prompt-card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 14pt; margin-bottom: 10pt; }
  .prompt-card .q { font-style: italic; color: #0f172a; font-size: 10.5pt; line-height: 1.5; flex: 1; }
  .prompt-card .rvi-num { font-family: Georgia, serif; font-size: 16pt; color: #0f172a; font-weight: 600; }
  .pill { display: inline-block; padding: 2pt 10pt; border-radius: 999px; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.5pt; text-transform: uppercase; }
  .bar-row { display: flex; align-items: center; gap: 10pt; margin: 4pt 0; font-size: 9.5pt; }
  .bar-row .bar-label { width: 60pt; color: #64748b; }
  .bar-row .bar { flex: 1; height: 8pt; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-row .bar > span { display: block; height: 100%; }
  .bar-row .pct { width: 38pt; text-align: right; color: #334155; font-variant-numeric: tabular-nums; }
  .bar-own > span  { background: #5f7ea6; }
  .bar-peer > span { background: #94a3b8; }

  /* Who's winning */
  .winner-block { background: #fff; border: 1px solid #ececec; border-radius: 10px; padding: 18pt 20pt; margin-bottom: 14pt; page-break-inside: avoid; }
  .winner-block .q { font-style: italic; color: #475569; font-size: 10pt; margin-bottom: 10pt; }
  .winner-block .punch { font-size: 13pt; line-height: 1.5; color: #0f172a; margin-bottom: 8pt; }
  .winner-block .punch strong { font-weight: 700; }
  .winner-block .cause { font-size: 10pt; color: #64748b; line-height: 1.5; }
  .model-dots { display: inline-flex; gap: 5pt; margin-left: 6pt; }
  .model-dots span { display: inline-block; width: 9pt; height: 9pt; border-radius: 50%; }
  .dot-chatgpt    { background: #10a37f; }
  .dot-perplexity { background: #8b5cf6; }
  .dot-gemini     { background: #4285f4; }

  /* Recommendations */
  .rec { background: #fff; border: 1px solid #ececec; border-radius: 10px; padding: 18pt 20pt; margin-bottom: 14pt; position: relative; page-break-inside: avoid; }
  .rec .priority-num { position: absolute; top: 14pt; right: 22pt; font-family: Georgia, serif; font-size: 36pt; line-height: 1; color: #e2e8f0; font-weight: 700; }
  .rec .body { font-size: 10.5pt; color: #334155; line-height: 1.6; }
  .rec .body p { margin: 4pt 0; }
  .rec .body strong { color: #0f172a; font-weight: 700; }
  .rec ol, .rec ul { margin: 6pt 0; padding-left: 22pt; }
  .static-fallback { background: #fff; border: 1px solid #ececec; border-radius: 10px; padding: 18pt 20pt; }
  .static-fallback ul { margin: 8pt 0; padding-left: 22pt; }
  .static-fallback li { margin-bottom: 6pt; font-size: 10.5pt; line-height: 1.55; color: #334155; }

  /* CTA page */
  .cta-page { text-align: center; padding-top: 1.5in; }
  .cta-page .hook { font-family: Georgia, serif; font-size: 32pt; color: #0f172a; line-height: 1.2; margin-bottom: 28pt; }
  .cta-page .cta-body { font-size: 12pt; color: #334155; line-height: 1.6; max-width: 5in; margin: 0 auto 18pt; }
  .cta-page .cta-link { display: inline-block; margin: 8pt 0; font-size: 11pt; color: #5f7ea6; font-weight: 500; text-decoration: none; }
  .cta-page .credit { margin-top: 48pt; font-size: 10pt; color: #64748b; }
  .cta-page .credit .who { font-weight: 600; color: #0f172a; }
</style>
</head>
<body>

<!-- PAGE 1 — Cover -->
<div class="page cover">
  <div>
    {% if logo_data_uri %}
      <img src="{{ logo_data_uri }}" class="logo" alt="{{ business_name }}" />
    {% else %}
      <div style="font-size:18pt;font-weight:700;color:#0f172a;">{{ business_name }}</div>
    {% endif %}
  </div>
  <div class="hero">
    <div class="label">AI Visibility Audit</div>
    <div class="name">{{ business_name }}</div>
    <div class="date">{{ audit_month }}</div>
    <div class="band-badge band-{{ rvi_band }}">{{ rvi_band|upper }}</div>
    <div class="band-rvi">
      {% if aggregate_rvi is not none %}Aggregate RVI · {{ "%.2f"|format(aggregate_rvi) }}{% else %}Peer group absent on these prompts{% endif %}
    </div>
  </div>
  <div class="meta">
    <div>Prepared by Lumidian</div>
    <div>{{ generated_label }}</div>
  </div>
</div>

<!-- PAGE 2 — Executive summary -->
<div class="page">
  <h4>Executive Summary</h4>
  <div class="headline">
    {{ business_name }} is <strong>{{ rvi_band }}</strong> on AI search.
  </div>

  <div class="score-row">
    <div class="score-card">
      <div class="label">Your Visibility</div>
      <div class="value">{{ overall_visibility_pct|round|int }}%</div>
      <div class="caption">your name appears in {{ overall_visibility_pct|round|int }}% of relevant AI responses</div>
    </div>
    <div class="score-card">
      <div class="label">Peer Average</div>
      <div class="value">{{ peer_avg_overall|round|int }}%</div>
      <div class="caption">competitors averaged {{ peer_avg_overall|round|int }}% across the same prompts</div>
    </div>
    <div class="score-card">
      <div class="label">RVI</div>
      <div class="value">{% if aggregate_rvi is not none %}{{ "%.2f"|format(aggregate_rvi) }}{% else %}—{% endif %}</div>
      <div class="caption">
        {% if aggregate_rvi is not none %}
          you're at {{ (aggregate_rvi * 100)|round|int }}% of peer average
        {% else %}
          peer group absent — you dominated these prompts
        {% endif %}
      </div>
    </div>
  </div>

  <p>
    Across 90 queries to ChatGPT, Perplexity, and Gemini — questions a
    {% if location %}potential customer in {{ location }}{% else %}potential customer{% endif %}
    would actually ask when researching this space — <strong>{{ business_name }}</strong> appeared in
    <strong>{{ overall_visibility_pct|round|int }}%</strong> of relevant responses. Your peer group
    ({{ peer_names_joined }}) averaged <strong>{{ peer_avg_overall|round|int }}%</strong>.
    {% if rvi_band == "losing" or rvi_band == "invisible" %}
      That puts you at roughly {{ (aggregate_rvi * 100)|round|int if aggregate_rvi else 0 }}% of peer-group visibility — there's significant room to recover ground.
    {% elif rvi_band == "even" %}
      That puts you roughly in line with peers — small wins on the right prompts could move you ahead.
    {% else %}
      That puts you ahead of your peer group on AI search — the goal now is widening that gap.
    {% endif %}
  </p>

  <p class="methodology">
    <strong>Methodology:</strong> 10 generated prompts × 3 models (ChatGPT search, Perplexity Sonar-Pro, Gemini 2.5 Flash) × 3 runs = 90 queries total. RVI = your visibility ÷ peer-group average visibility per prompt; aggregate is the mean across all prompts. Generated {{ generated_label }}.
  </p>
</div>

<!-- PAGE 3 — Per-prompt scorecard -->
<div class="page">
  <h2>Per-prompt scorecard</h2>
  <p class="muted" style="margin-bottom: 18pt;">Sorted worst RVI first — where the biggest gaps are.</p>

  {% for ps in sorted_prompt_scores %}
  <div class="prompt-card">
    <div class="top">
      <div class="q">"{{ prompts[ps.prompt_index] }}"</div>
      <div style="text-align: right;">
        <div class="rvi-num">{% if ps.rvi is not none %}{{ "%.2f"|format(ps.rvi) }}{% else %}∞{% endif %}</div>
        <span class="pill band-{{ ps.rvi_band }}">{{ ps.rvi_band }}</span>
      </div>
    </div>
    <div class="bar-row bar-own">
      <div class="bar-label">You</div>
      <div class="bar"><span style="width: {{ ps.own_visibility_pct }}%"></span></div>
      <div class="pct">{{ ps.own_visibility_pct|round|int }}%</div>
    </div>
    <div class="bar-row bar-peer">
      <div class="bar-label">Peers avg</div>
      <div class="bar"><span style="width: {{ ps.peer_avg_visibility_pct }}%"></span></div>
      <div class="pct">{{ ps.peer_avg_visibility_pct|round|int }}%</div>
    </div>
  </div>
  {% endfor %}
</div>

<!-- PAGE 4 — Who's winning, where -->
<div class="page">
  <h2>Who's winning, where</h2>
  <p class="muted" style="margin-bottom: 18pt;">The three prompts where the gap matters most.</p>

  {% for w in winner_blocks %}
  <div class="winner-block">
    <div class="q">"{{ w.prompt_text }}"</div>
    <div class="punch">
      {% if w.top_competitor_name %}
        <strong>{{ w.top_competitor_name }}</strong> dominates this question with
        <strong>{{ w.top_competitor_visibility_pct|round|int }}%</strong> visibility —
        you sit at <strong>{{ w.own_visibility_pct|round|int }}%</strong>.
      {% else %}
        No single competitor dominates this prompt — your peer group averages
        <strong>{{ w.peer_avg_visibility_pct|round|int }}%</strong> visibility while you sit at
        <strong>{{ w.own_visibility_pct|round|int }}%</strong>.
      {% endif %}
    </div>
    <div class="cause">
      Likely because they've published content the AI models are pulling from. Models cited:
      <span class="model-dots">
        <span class="dot-chatgpt" title="ChatGPT"></span>
        <span class="dot-perplexity" title="Perplexity"></span>
        <span class="dot-gemini" title="Gemini"></span>
      </span>
    </div>
  </div>
  {% endfor %}
</div>

<!-- PAGE 5 — What we'd do about it -->
<div class="page">
  <h2>What we'd do about it</h2>
  <p class="muted" style="margin-bottom: 18pt;">Three to five recommendations, ranked by impact.</p>

  {% if recommendations_html %}
    <div class="rec">
      <div class="body">{{ recommendations_html|safe }}</div>
    </div>
  {% else %}
    <div class="static-fallback">
      <p>Lumidian closes AI visibility gaps with a recurring monthly playbook:</p>
      <ul>
        <li><strong>12+ AI-optimized long-form drafts every month</strong> — published across LinkedIn, Medium, Reddit, Quora, and X, structured for how ChatGPT and Perplexity actually cite content.</li>
        <li><strong>Weekly visibility tracking</strong> across ChatGPT, Claude, Perplexity, and Gemini — so you know which prompts moved and why.</li>
        <li><strong>Site & schema audit</strong> — fixes the technical issues that block AI crawlers from pulling your site (robots.txt, schema, llms.txt).</li>
        <li><strong>Competitor monitoring</strong> — when a peer publishes something that's now being cited, you know within days and can respond.</li>
        <li><strong>Authority surface building</strong> — citations, mentions, and verified profiles where AI models look for trust signals.</li>
      </ul>
    </div>
  {% endif %}
</div>

<!-- PAGE 6 — CTA + methodology -->
<div class="page cta-page">
  <div class="hook">Want to be the answer instead?</div>
  <div class="cta-body">
    Lumidian builds AI visibility for businesses like {{ business_name }}.
    Reply to this email — or book a 20-minute call below.
  </div>
  {% if cta_url %}
  <a class="cta-link" href="{{ cta_url }}">{{ cta_url }}</a><br/>
  {% endif %}
  {% if cta_email %}
  <a class="cta-link" href="mailto:{{ cta_email }}">{{ cta_email }}</a>
  {% endif %}

  <div class="credit">
    <div class="who">Lumidian</div>
    <div class="muted">AI visibility audits and content for B2B teams</div>
  </div>

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ generated_label }}</div>
  </div>
</div>

</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/prospect_audit/templates/__init__.py backend/app/services/prospect_audit/templates/prospect_audit.html.j2
git commit -m "feat(prospect-audit): PDF Jinja2 template (6 pages, print-tuned)"
```

---

### Task 12: PDF renderer module (Playwright)

**Files:**
- Create: `backend/app/services/prospect_audit/pdf_render.py`
- Create: `backend/tests/test_prospect_audit_pdf_render.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_prospect_audit_pdf_render.py`:

```python
"""End-to-end PDF render test using real Playwright Chromium."""
import pytest

from app.models import ProspectAudit
from app.services.prospect_audit.competitor_detect import DetectedCompetitor
from app.services.prospect_audit.pdf_render import render_prospect_pdf
from app.services.prospect_audit.recommendations import AuditSummaryForRecs, PromptInsight
from app.services.prospect_audit.scoring import PromptScore


@pytest.mark.asyncio
async def test_render_prospect_pdf_produces_pdf_bytes():
    audit = ProspectAudit(
        id=1,
        staff_user_id=1,
        business_name="Acme Dental",
        website_url="https://acme.com",
        is_local=True,
        location="Austin, TX",
        status="rendering_pdf",
    )
    prompts = [f"Q{i}?" for i in range(10)]
    prompt_scores = [
        PromptScore(prompt_index=i, own_visibility_pct=10.0 + i, peer_avg_visibility_pct=50.0, rvi=0.2 + 0.05 * i, rvi_band="losing")
        for i in range(10)
    ]
    competitors = [
        DetectedCompetitor(name="Brilliant Smile", website_url="https://b.com", is_subject=False),
        DetectedCompetitor(name="Austin Bright", website_url="https://ab.com", is_subject=False),
    ]
    summary = AuditSummaryForRecs(
        business_name="Acme Dental",
        location="Austin, TX",
        overall_visibility_pct=14.5,
        peer_avg_visibility_pct=50.0,
        aggregate_rvi=0.29,
        rvi_band="losing",
        worst_prompts=[
            PromptInsight(prompt_text="best dentist in Austin?", own_visibility_pct=11, peer_avg_visibility_pct=89, rvi=0.12,
                          top_competitor_name="Brilliant Smile", top_competitor_visibility_pct=92),
        ],
    )

    pdf_bytes = await render_prospect_pdf(
        audit=audit,
        prompts=prompts,
        prompt_scores=prompt_scores,
        competitors=competitors,
        summary=summary,
        recommendations_md="1. **Publish 12 articles** — short justification.",
        logo_data_uri=None,
        per_prompt_top_competitor={},
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 5000   # real PDF, not empty
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_pdf_render.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `pdf_render.py`**

Create `backend/app/services/prospect_audit/pdf_render.py`:

```python
"""Render the prospect audit Jinja2 template to PDF bytes via Playwright Chromium.

Reuses the same `async_playwright` pattern as `services/site_audit/pdf_renderer.py`.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.models import ProspectAudit
from app.services.prospect_audit.competitor_detect import DetectedCompetitor
from app.services.prospect_audit.recommendations import AuditSummaryForRecs
from app.services.prospect_audit.scoring import PromptScore

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=select_autoescape(["html", "j2"]))


def _sort_key(p: PromptScore) -> tuple[int, float]:
    """Sort worst-first: invisible/losing prompts before even/winning/dominant."""
    band_order = {"invisible": 0, "losing": 1, "even": 2, "winning": 3, "dominant": 4}
    return (band_order.get(p.rvi_band, 5), p.rvi if p.rvi is not None else 99.0)


async def render_prospect_pdf(
    *,
    audit: ProspectAudit,
    prompts: list[str],
    prompt_scores: list[PromptScore],
    competitors: list[DetectedCompetitor],
    summary: AuditSummaryForRecs,
    recommendations_md: str | None,
    logo_data_uri: str | None,
    per_prompt_top_competitor: dict[int, tuple[str | None, float | None]],
) -> bytes:
    """Render the audit HTML template and return PDF bytes."""
    template = _env.get_template("prospect_audit.html.j2")

    sorted_scores = sorted(prompt_scores, key=_sort_key)
    worst_three = sorted_scores[:3]

    winner_blocks = []
    for ps in worst_three:
        top_name, top_pct = per_prompt_top_competitor.get(ps.prompt_index, (None, None))
        winner_blocks.append({
            "prompt_text": prompts[ps.prompt_index],
            "own_visibility_pct": ps.own_visibility_pct,
            "peer_avg_visibility_pct": ps.peer_avg_visibility_pct,
            "top_competitor_name": top_name,
            "top_competitor_visibility_pct": top_pct,
        })

    peer_names = [c.name for c in competitors if not c.is_subject][:3]
    if not peer_names:
        peer_names_joined = "your peer group"
    elif len(peer_names) == 1:
        peer_names_joined = peer_names[0]
    elif len(peer_names) == 2:
        peer_names_joined = f"{peer_names[0]} and {peer_names[1]}"
    else:
        peer_names_joined = ", ".join(peer_names[:-1]) + f", and {peer_names[-1]}"

    recommendations_html = _md.markdown(recommendations_md) if recommendations_md else None

    cta_url = os.getenv("PROSPECT_AUDIT_CTA_URL", "https://lumidian.io")
    cta_email = os.getenv("PROSPECT_AUDIT_CTA_EMAIL") or os.getenv("SUPPORT_EMAIL") or ""

    html = template.render(
        business_name=audit.business_name,
        location=audit.location if audit.is_local else None,
        logo_data_uri=logo_data_uri,
        audit_month=datetime.utcnow().strftime("%B %Y"),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
        rvi_band=summary.rvi_band,
        aggregate_rvi=summary.aggregate_rvi,
        overall_visibility_pct=summary.overall_visibility_pct,
        peer_avg_overall=summary.peer_avg_visibility_pct,
        peer_names_joined=peer_names_joined,
        prompts=prompts,
        sorted_prompt_scores=sorted_scores,
        winner_blocks=winner_blocks,
        recommendations_html=recommendations_html,
        cta_url=cta_url,
        cta_email=cta_email,
    )

    return await _playwright_pdf(html)


async def _playwright_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            await page.emulate_media(media="print")
            return await page.pdf(
                format="Letter",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
        finally:
            await browser.close()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_pdf_render.py -v
```

Expected: 1 passed (Playwright Chromium already installed for site-audit tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prospect_audit/pdf_render.py backend/tests/test_prospect_audit_pdf_render.py
git commit -m "feat(prospect-audit): Playwright PDF renderer"
```

---

## Phase 5 — API surface

### Task 13: Router scaffold + POST/GET/list endpoints

**Files:**
- Create: `backend/app/routers/prospect_audit.py`
- Create: `backend/tests/test_prospect_audit_router.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_router.py`:

```python
"""Router endpoints — auth, multi-tenancy, basic state transitions."""
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from tests.conftest import register_and_login   # existing helper


async def _make_staff(client: AsyncClient, email: str = "staff1@x.com") -> dict:
    """Register a user and promote to agency staff. Returns auth headers."""
    headers, user_id = await register_and_login(client, email=email)
    # Promote to staff via direct DB write (no admin endpoint for this in tests)
    from app.database import AsyncSessionLocal
    from app.models import User
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
        u.is_agency_staff = True
        await db.commit()
    return headers


@pytest.mark.asyncio
async def test_post_creates_audit_and_schedules_task(client: AsyncClient):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    assert body["id"]
    mock_run.assert_called_once_with(body["id"])


@pytest.mark.asyncio
async def test_post_requires_location_when_local(client: AsyncClient):
    headers = await _make_staff(client)
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": True},
        headers=headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_blocks_non_staff(client: AsyncClient):
    headers, _ = await register_and_login(client, email="regular@x.com")
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        headers=headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_returns_only_callers_audits(client: AsyncClient):
    h1 = await _make_staff(client, email="s1@x.com")
    h2 = await _make_staff(client, email="s2@x.com")
    with patch("app.routers.prospect_audit.run_audit"):
        await client.post("/api/agency/prospects", json={"business_name": "A", "website_url": "https://a.com", "is_local": False}, headers=h1)
        await client.post("/api/agency/prospects", json={"business_name": "B", "website_url": "https://b.com", "is_local": False}, headers=h2)
    list1 = await client.get("/api/agency/prospects", headers=h1)
    assert list1.status_code == 200
    items1 = list1.json()
    assert len(items1) == 1
    assert items1[0]["business_name"] == "A"


@pytest.mark.asyncio
async def test_get_single_audit(client: AsyncClient):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = post_resp.json()["id"]
    detail = await client.get(f"/api/agency/prospects/{audit_id}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["business_name"] == "Acme"
    assert body["status"] == "pending"
    assert "has_pdf" in body


@pytest.mark.asyncio
async def test_get_404_when_not_owner(client: AsyncClient):
    h1 = await _make_staff(client, email="s1@x.com")
    h2 = await _make_staff(client, email="s2@x.com")
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=h1,
        )
    audit_id = post_resp.json()["id"]
    resp = await client.get(f"/api/agency/prospects/{audit_id}", headers=h2)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_router.py -v
```

Expected: ImportError or 404 (router not mounted yet).

- [ ] **Step 3: Implement the router**

Create `backend/app/routers/prospect_audit.py`:

```python
"""Prospect audit router — agency staff cold-email audit deliverable.

Mounted by app.main as /api/agency/prospects/*.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.dependencies import DbDep, require_agency_staff
from app.models import ProspectAudit, User
from app.schemas import ProspectAuditCreate, ProspectAuditListItem, ProspectAuditOut
from app.services.prospect_audit.runner import PROSPECT_AUDIT_PDF_DIR, run_audit
from app.state import prospect_audit_cancel_events

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agency/prospects", tags=["prospect-audit"])


def _to_out(a: ProspectAudit) -> ProspectAuditOut:
    return ProspectAuditOut(
        id=a.id,
        business_name=a.business_name,
        website_url=a.website_url,
        is_local=a.is_local,
        location=a.location,
        status=a.status,
        status_message=a.status_message,
        error_message=a.error_message,
        cancel_requested=a.cancel_requested,
        overall_visibility_pct=a.overall_visibility_pct,
        aggregate_rvi=a.aggregate_rvi,
        rvi_band=a.rvi_band,
        created_at=a.created_at,
        started_at=a.started_at,
        completed_at=a.completed_at,
        has_pdf=a.pdf_path is not None,
    )


def _to_list_item(a: ProspectAudit) -> ProspectAuditListItem:
    return ProspectAuditListItem(
        id=a.id,
        business_name=a.business_name,
        website_url=a.website_url,
        is_local=a.is_local,
        location=a.location,
        status=a.status,
        overall_visibility_pct=a.overall_visibility_pct,
        aggregate_rvi=a.aggregate_rvi,
        rvi_band=a.rvi_band,
        created_at=a.created_at,
        completed_at=a.completed_at,
    )


@router.post("", response_model=ProspectAuditOut, status_code=status.HTTP_201_CREATED)
async def create_prospect_audit(
    payload: ProspectAuditCreate,
    background: BackgroundTasks,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    """Create a new prospect audit and kick off the background pipeline."""
    # Soft hourly rate limit: count audits started by this staff member in last 60min
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(hours=1)
    recent_count = (await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.staff_user_id == user.id,
            ProspectAudit.created_at >= cutoff,
        )
    )).scalars().all()
    if len(recent_count) >= 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded — max 10 prospect audits per hour per staff member.",
        )

    audit = ProspectAudit(
        staff_user_id=user.id,
        business_name=payload.business_name,
        website_url=payload.website_url,
        is_local=payload.is_local,
        location=payload.location,
        status="pending",
    )
    db.add(audit)
    await db.commit()
    await db.refresh(audit)

    background.add_task(run_audit, audit.id)
    return _to_out(audit)


@router.get("", response_model=list[ProspectAuditListItem])
async def list_prospect_audits(
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> list[ProspectAuditListItem]:
    result = await db.execute(
        select(ProspectAudit)
        .where(ProspectAudit.staff_user_id == user.id)
        .order_by(ProspectAudit.created_at.desc())
        .limit(100)
    )
    return [_to_list_item(a) for a in result.scalars().all()]


@router.get("/{audit_id}", response_model=ProspectAuditOut)
async def get_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    return _to_out(audit)
```

- [ ] **Step 4: Mount the router in `main.py`**

Open `backend/app/main.py` and find the block of `app.include_router(...)` calls. Add this line near the other agency-adjacent routers (look for agency.py mount; if not present, add after the others):

```python
from app.routers import prospect_audit as prospect_audit_router
# ...
app.include_router(prospect_audit_router.router, prefix="/api")
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_router.py -v
```

Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/prospect_audit.py backend/app/main.py backend/tests/test_prospect_audit_router.py
git commit -m "feat(prospect-audit): router create/list/get + 10/hour rate limit"
```

---

### Task 14: Cancel / retry / delete / PDF endpoints

**Files:**
- Modify: `backend/app/routers/prospect_audit.py`
- Modify: `backend/tests/test_prospect_audit_router.py` (append tests)

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/test_prospect_audit_router.py`:

```python
@pytest.mark.asyncio
async def test_cancel_sets_event_and_db_flag(client: AsyncClient):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]

    # Pretend the runner registered a cancel_event for this audit
    import asyncio
    from app.state import prospect_audit_cancel_events
    prospect_audit_cancel_events[audit_id] = asyncio.Event()

    cancel = await client.post(f"/api/agency/prospects/{audit_id}/cancel", headers=headers)
    assert cancel.status_code == 204
    assert prospect_audit_cancel_events[audit_id].is_set()

    detail = await client.get(f"/api/agency/prospects/{audit_id}", headers=headers)
    assert detail.json()["cancel_requested"] is True


@pytest.mark.asyncio
async def test_retry_409_when_non_terminal(client: AsyncClient):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]
    # Status is "pending" — non-terminal
    retry = await client.post(f"/api/agency/prospects/{audit_id}/retry", headers=headers)
    assert retry.status_code == 409


@pytest.mark.asyncio
async def test_retry_succeeds_when_failed(client: AsyncClient, tmp_path):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]

    # Mark as failed and stub a PDF on disk to verify cleanup
    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    stale_pdf = tmp_path / "stale.pdf"
    stale_pdf.write_bytes(b"%PDF stale")
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.status = "failed"
        a.error_message = "boom"
        a.pdf_path = str(stale_pdf)
        await db.commit()

    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        retry = await client.post(f"/api/agency/prospects/{audit_id}/retry", headers=headers)
    assert retry.status_code == 200
    body = retry.json()
    assert body["status"] == "pending"
    assert body["error_message"] is None
    assert not stale_pdf.exists()
    mock_run.assert_called_once_with(audit_id)


@pytest.mark.asyncio
async def test_delete_removes_row_and_pdf(client: AsyncClient, tmp_path):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]

    pdf_file = tmp_path / "del.pdf"
    pdf_file.write_bytes(b"%PDF")
    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.pdf_path = str(pdf_file)
        await db.commit()

    del_resp = await client.delete(f"/api/agency/prospects/{audit_id}", headers=headers)
    assert del_resp.status_code == 204
    assert not pdf_file.exists()

    after = await client.get(f"/api/agency/prospects/{audit_id}", headers=headers)
    assert after.status_code == 404


@pytest.mark.asyncio
async def test_pdf_returns_404_when_not_completed(client: AsyncClient):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]
    pdf = await client.get(f"/api/agency/prospects/{audit_id}/pdf", headers=headers)
    assert pdf.status_code == 404


@pytest.mark.asyncio
async def test_pdf_streams_when_completed(client: AsyncClient, tmp_path):
    headers = await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
            headers=headers,
        )
    audit_id = resp.json()["id"]

    pdf_bytes = b"%PDF-1.4\nfake"
    pdf_file = tmp_path / "stream.pdf"
    pdf_file.write_bytes(pdf_bytes)
    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.status = "completed"
        a.pdf_path = str(pdf_file)
        await db.commit()

    pdf = await client.get(f"/api/agency/prospects/{audit_id}/pdf", headers=headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in pdf.headers["content-disposition"].lower()
    assert pdf.content == pdf_bytes
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_router.py -v
```

Expected: the new tests fail (endpoints not implemented).

- [ ] **Step 3: Add endpoints to `routers/prospect_audit.py`**

Append to `backend/app/routers/prospect_audit.py`:

```python
@router.post("/{audit_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> None:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")

    audit.cancel_requested = True
    await db.commit()

    event = prospect_audit_cancel_events.get(audit_id)
    if event is not None:
        event.set()


@router.post("/{audit_id}/retry", response_model=ProspectAuditOut)
async def retry_prospect_audit(
    audit_id: int,
    background: BackgroundTasks,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> ProspectAuditOut:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    if audit.status not in {"failed", "canceled", "completed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot retry — audit is currently {audit.status}.")

    # Cleanup stale PDF
    if audit.pdf_path:
        try:
            Path(audit.pdf_path).unlink(missing_ok=True)
        except Exception as exc:
            logger.warning("retry: failed to delete stale PDF %s: %s", audit.pdf_path, exc)

    audit.status = "pending"
    audit.status_message = None
    audit.error_message = None
    audit.cancel_requested = False
    audit.overall_visibility_pct = None
    audit.aggregate_rvi = None
    audit.rvi_band = None
    audit.pdf_path = None
    audit.started_at = None
    audit.completed_at = None
    await db.commit()
    await db.refresh(audit)

    background.add_task(run_audit, audit.id)
    return _to_out(audit)


@router.delete("/{audit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prospect_audit(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
) -> None:
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")

    if audit.pdf_path:
        try:
            Path(audit.pdf_path).unlink(missing_ok=True)
        except Exception as exc:
            logger.warning("delete: failed to remove PDF %s: %s", audit.pdf_path, exc)

    await db.delete(audit)
    await db.commit()


@router.get("/{audit_id}/pdf")
async def get_prospect_audit_pdf(
    audit_id: int,
    db: DbDep,
    user: User = Depends(require_agency_staff),
):
    result = await db.execute(
        select(ProspectAudit).where(
            ProspectAudit.id == audit_id,
            ProspectAudit.staff_user_id == user.id,
        )
    )
    audit = result.scalar_one_or_none()
    if audit is None or audit.status != "completed" or not audit.pdf_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF not available")

    path = Path(audit.pdf_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file missing")

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in audit.business_name).strip().replace(" ", "-")
    filename = f"{safe_name or 'prospect'}-ai-visibility-audit.pdf"
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

- [ ] **Step 4: Run all router tests**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_router.py -v
```

Expected: 12 passed (6 original + 6 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/prospect_audit.py backend/tests/test_prospect_audit_router.py
git commit -m "feat(prospect-audit): cancel/retry/delete/pdf-download endpoints"
```

---

## Phase 6 — Scheduler integration

### Task 15: 60-day cleanup job

**Files:**
- Modify: `backend/app/scheduler.py`
- Create: `backend/tests/test_prospect_audit_cleanup.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_prospect_audit_cleanup.py`:

```python
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ProspectAudit, User
from app.scheduler import cleanup_stale_prospect_audits


@pytest.mark.asyncio
async def test_cleanup_removes_audits_older_than_60_days(tmp_path):
    async with AsyncSessionLocal() as db:
        user = User(email="staff-c1@x.com", password_hash="x", name="S", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()

        old_pdf = tmp_path / "old.pdf"
        old_pdf.write_bytes(b"%PDF")
        old = ProspectAudit(
            staff_user_id=user.id,
            business_name="Old",
            website_url="https://o.com",
            is_local=False,
            status="completed",
            pdf_path=str(old_pdf),
            created_at=datetime.utcnow() - timedelta(days=61),
        )
        recent = ProspectAudit(
            staff_user_id=user.id,
            business_name="Recent",
            website_url="https://r.com",
            is_local=False,
            status="completed",
            created_at=datetime.utcnow() - timedelta(days=5),
        )
        db.add_all([old, recent])
        await db.commit()
        old_id, recent_id = old.id, recent.id

    deleted = await cleanup_stale_prospect_audits()
    assert deleted == 1
    assert not old_pdf.exists()

    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(ProspectAudit).where(ProspectAudit.id == old_id))).scalar_one_or_none() is None
        assert (await db.execute(select(ProspectAudit).where(ProspectAudit.id == recent_id))).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_cleanup_handles_missing_pdf_file_gracefully():
    async with AsyncSessionLocal() as db:
        user = User(email="staff-c2@x.com", password_hash="x", name="S", is_agency_staff=True, email_verified=True)
        db.add(user)
        await db.flush()
        a = ProspectAudit(
            staff_user_id=user.id,
            business_name="Gone",
            website_url="https://g.com",
            is_local=False,
            status="completed",
            pdf_path="/nonexistent/path.pdf",
            created_at=datetime.utcnow() - timedelta(days=70),
        )
        db.add(a)
        await db.commit()

    # Should NOT raise
    deleted = await cleanup_stale_prospect_audits()
    assert deleted == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_cleanup.py -v
```

Expected: ImportError (`cleanup_stale_prospect_audits` not defined).

- [ ] **Step 3: Add the cleanup function and wire it into the daily job**

Open `backend/app/scheduler.py`. Find the existing pitch-expiry-sweep function (search for `pitch_expires_at <= now`). After that function, add:

```python
async def cleanup_stale_prospect_audits(retention_days: int = 60) -> int:
    """Delete ProspectAudit rows older than `retention_days`. Returns delete count.

    Silently logs and continues on missing PDF files."""
    from datetime import datetime, timedelta
    from pathlib import Path

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    deleted = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ProspectAudit).where(ProspectAudit.created_at < cutoff))
        stale = result.scalars().all()
        for a in stale:
            if a.pdf_path:
                try:
                    Path(a.pdf_path).unlink(missing_ok=True)
                except Exception as exc:
                    logger.warning("prospect-audit cleanup: failed to remove PDF %s: %s", a.pdf_path, exc)
            await db.delete(a)
            deleted += 1
        if deleted:
            await db.commit()
            logger.info("Scheduler: cleaned up %d stale prospect audits (>%d days old)", deleted, retention_days)
    return deleted
```

Now find the pitch-expiry-sweep function's body (the one with the `# ── Pass 2: delete expired brands` comment). After it commits the deletions, add a call to the new cleanup function. Find the end of the function (the last `await db.commit()` after expired brands deletion) and append after the function body (NOT inside it — same indentation as the `async def`):

Actually — re-read the existing function more carefully. The existing pitch-expiry function is decorated/scheduled separately. The cleanest extension is to invoke `cleanup_stale_prospect_audits()` from inside that same function so it runs in the same 06:00 UTC pass. Find the function definition (search for `def pitch_expiry_sweep` or whatever it's named) and add inside, just before its return:

```python
        # Prospect audits — 60-day retention
        try:
            await cleanup_stale_prospect_audits()
        except Exception:
            logger.exception("prospect-audit cleanup failed inside daily sweep")
```

If the exact function name differs (search the file for the function that handles `pitch_expires_at <= now`), substitute its name.

- [ ] **Step 4: Run the cleanup tests to verify they pass**

```bash
cd backend && source venv/bin/activate
pytest tests/test_prospect_audit_cleanup.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduler.py backend/tests/test_prospect_audit_cleanup.py
git commit -m "feat(prospect-audit): daily 60-day cleanup in existing 06:00 UTC sweep"
```

---

## Phase 7 — Frontend

### Task 16: API client methods + types in `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add types and methods**

Open `frontend/lib/api.ts`. Find an existing TypeScript types block (somewhere near the top — look for `export interface BrandOut` or similar). Append new types in the same style:

```ts
export interface ProspectAuditCreate {
  business_name: string;
  website_url: string;
  is_local: boolean;
  location?: string | null;
}

export interface ProspectAuditListItem {
  id: number;
  business_name: string;
  website_url: string;
  is_local: boolean;
  location: string | null;
  status: string;
  overall_visibility_pct: number | null;
  aggregate_rvi: number | null;
  rvi_band: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ProspectAuditOut extends ProspectAuditListItem {
  status_message: string | null;
  error_message: string | null;
  cancel_requested: boolean;
  started_at: string | null;
  has_pdf: boolean;
}
```

Then find the existing API method exports (the file exports an `api` object or named functions — match whichever style is used; from CLAUDE.md, this file uses a typed Axios client with named methods). Add the prospect-audit methods near the other agency methods (search for any existing `agency*` methods to anchor placement):

```ts
// ── Prospect audits ──────────────────────────────────────────────────────────

export async function listProspectAudits(): Promise<ProspectAuditListItem[]> {
  const { data } = await axiosInstance.get<ProspectAuditListItem[]>("/agency/prospects");
  return data;
}

export async function getProspectAudit(id: number): Promise<ProspectAuditOut> {
  const { data } = await axiosInstance.get<ProspectAuditOut>(`/agency/prospects/${id}`);
  return data;
}

export async function createProspectAudit(payload: ProspectAuditCreate): Promise<ProspectAuditOut> {
  const { data } = await axiosInstance.post<ProspectAuditOut>("/agency/prospects", payload);
  return data;
}

export async function cancelProspectAudit(id: number): Promise<void> {
  await axiosInstance.post(`/agency/prospects/${id}/cancel`);
}

export async function retryProspectAudit(id: number): Promise<ProspectAuditOut> {
  const { data } = await axiosInstance.post<ProspectAuditOut>(`/agency/prospects/${id}/retry`);
  return data;
}

export async function deleteProspectAudit(id: number): Promise<void> {
  await axiosInstance.delete(`/agency/prospects/${id}`);
}

export function prospectAuditPdfUrl(id: number): string {
  // axiosInstance.defaults.baseURL is set elsewhere (e.g., /api). Use the same prefix.
  const base = axiosInstance.defaults.baseURL ?? "";
  return `${base}/agency/prospects/${id}/pdf`;
}
```

If the file uses a different import name for the Axios instance (e.g. `apiClient` or `http` instead of `axiosInstance`), match the existing convention exactly. Search the file for `axios.create` to find the actual instance name.

- [ ] **Step 2: Verify the file still compiles (type-check)**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: No new TypeScript errors involving `ProspectAudit*` symbols. (Other unrelated build warnings are out of scope.)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(prospect-audit): API client methods + types"
```

---

### Task 17: Sidebar entry

**Files:**
- Modify: `frontend/components/agency/AgencySidebar.tsx`

- [ ] **Step 1: Add "Prospects" to the NAV array**

Open `frontend/components/agency/AgencySidebar.tsx`. Find the `NAV` array (currently has Today / Clients / Documents). Add an import for `Crosshair` to the existing `import { Home, Users, FileText, ArrowLeft, Shield } from 'lucide-react'` line:

```tsx
import {
  Home,
  Users,
  FileText,
  Crosshair,
  ArrowLeft,
  Shield,
} from 'lucide-react';
```

Then add a new entry to the `NAV` array, between Clients and Documents:

```tsx
const NAV = [
  { href: '/agency', label: 'Today', icon: Home, exact: true },
  { href: '/agency/clients', label: 'Clients', icon: Users, exact: false },
  { href: '/agency/prospects', label: 'Prospects', icon: Crosshair, exact: false },
  { href: '/agency/documents', label: 'Documents', icon: FileText, exact: false },
];
```

- [ ] **Step 2: Visual smoke check**

Open the dev frontend in a browser. Make sure the dev servers are running on the project's configured ports (backend on 3001, frontend on 3002 — verify with `lsof -i :3001 -i :3002 | head -5`). If not running, start them with `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001` and `cd frontend && PORT=3002 npm run dev` in separate terminals.

Navigate to the agency page after logging in as an agency staff user. Confirm the "Prospects" entry appears in the sidebar between Clients and Documents, with the Crosshair icon. Hovering should reveal the underline/hover state.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/agency/AgencySidebar.tsx
git commit -m "feat(prospect-audit): sidebar entry"
```

---

### Task 18: RviBandBadge + ProspectsList + list page

**Files:**
- Create: `frontend/components/agency/RviBandBadge.tsx`
- Create: `frontend/components/agency/ProspectsList.tsx`
- Create: `frontend/app/agency/prospects/page.tsx`

- [ ] **Step 1: Create `RviBandBadge.tsx`**

Create `frontend/components/agency/RviBandBadge.tsx`:

```tsx
type Band = 'dominant' | 'winning' | 'even' | 'losing' | 'invisible';

interface Props {
  band: string | null | undefined;
  className?: string;
}

const STYLES: Record<Band, string> = {
  dominant:  'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30',
  winning:   'bg-green-500/10 text-green-400 ring-green-500/30',
  even:      'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  losing:    'bg-amber-500/10 text-amber-400 ring-amber-500/30',
  invisible: 'bg-rose-500/10 text-rose-400 ring-rose-500/30',
};

export function RviBandBadge({ band, className = '' }: Props) {
  const safe = (band && (band in STYLES) ? band : 'even') as Band;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ${STYLES[safe]} ${className}`}
    >
      {safe}
    </span>
  );
}
```

- [ ] **Step 2: Create `ProspectsList.tsx`**

Create `frontend/components/agency/ProspectsList.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Download, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

import { ProspectAuditListItem, prospectAuditPdfUrl } from '@/lib/api';
import { RviBandBadge } from './RviBandBadge';

interface Props {
  items: ProspectAuditListItem[];
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

export function ProspectsList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-12 text-center text-sm text-[var(--text-secondary)]">
        No prospect audits yet. <Link href="/agency/prospects/new" className="text-[var(--accent)] hover:underline">Create your first one →</Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Business</th>
            <th className="px-4 py-3 text-left font-medium">Location</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Visibility</th>
            <th className="px-4 py-3 text-left font-medium">RVI</th>
            <th className="px-4 py-3 text-left font-medium">Created</th>
            <th className="px-4 py-3 text-right font-medium">PDF</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-raised)]/40">
              <td className="px-4 py-3">
                <Link href={`/agency/prospects/${p.id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                  {p.business_name}
                </Link>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <a href={p.website_url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {p.website_url.replace(/^https?:\/\//, '')}
                  </a>
                  <ExternalLink className="h-3 w-3" />
                </div>
              </td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">
                {p.is_local ? p.location : <span className="text-[var(--text-muted)]">—</span>}
              </td>
              <td className="px-4 py-3">
                <span className="text-[var(--text-secondary)]">{p.status}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                {p.overall_visibility_pct !== null ? `${Math.round(p.overall_visibility_pct)}%` : '—'}
              </td>
              <td className="px-4 py-3">
                {p.rvi_band ? <RviBandBadge band={p.rvi_band} /> : <span className="text-[var(--text-muted)]">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
              </td>
              <td className="px-4 py-3 text-right">
                {p.status === 'completed' ? (
                  <a
                    href={prospectAuditPdfUrl(p.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-raised)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PDF
                  </a>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create the list page**

Create `frontend/app/agency/prospects/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { ProspectsList } from '@/components/agency/ProspectsList';
import { listProspectAudits, type ProspectAuditListItem } from '@/lib/api';

export default function ProspectsPage() {
  const [items, setItems] = useState<ProspectAuditListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProspectAudits()
      .then(setItems)
      .catch((e) => setError(e?.message ?? 'Failed to load prospects'));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Prospect audits</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Generate cold-email PDF audits for businesses you're pitching.
          </p>
        </div>
        <Link
          href="/agency/prospects/new"
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          <Plus className="h-4 w-4" />
          New prospect
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!error && items === null && (
        <div className="text-sm text-[var(--text-muted)]">Loading…</div>
      )}

      {items !== null && <ProspectsList items={items} />}
    </div>
  );
}
```

- [ ] **Step 4: Smoke check in the browser**

With dev servers running, navigate to `/agency/prospects`. Expected: header "Prospect audits", "New prospect" button, and the empty-state message. No console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/RviBandBadge.tsx frontend/components/agency/ProspectsList.tsx frontend/app/agency/prospects/page.tsx
git commit -m "feat(prospect-audit): list page + RVI band badge"
```

---

### Task 19: Create form page

**Files:**
- Create: `frontend/components/agency/NewProspectForm.tsx`
- Create: `frontend/app/agency/prospects/new/page.tsx`

- [ ] **Step 1: Create the form component**

Create `frontend/components/agency/NewProspectForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createProspectAudit } from '@/lib/api';

export function NewProspectForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isLocal, setIsLocal] = useState(false);
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    businessName.trim().length > 0 &&
    websiteUrl.trim().length > 0 &&
    (!isLocal || location.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const audit = await createProspectAudit({
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        is_local: isLocal,
        location: isLocal ? location.trim() : null,
      });
      router.push(`/agency/prospects/${audit.id}`);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Failed to create audit.';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Business name</label>
        <input
          type="text"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Acme Dental"
          className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)]">Website URL</label>
        <input
          type="url"
          required
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://acmedental.com"
          className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is_local"
          type="checkbox"
          checked={isLocal}
          onChange={(e) => setIsLocal(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
        />
        <label htmlFor="is_local" className="text-sm text-[var(--text-primary)]">
          This is a local business
        </label>
      </div>

      {isLocal && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)]">Location</label>
          <input
            type="text"
            required={isLocal}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Austin, TX"
            className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            City + state/region. Every generated prompt will reference this location.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Generate audit'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create the new-page route**

Create `frontend/app/agency/prospects/new/page.tsx`:

```tsx
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { NewProspectForm } from '@/components/agency/NewProspectForm';

export default function NewProspectPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <Link
        href="/agency/prospects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to prospects
      </Link>
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">New prospect audit</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-secondary)]">
        Generates a PDF visibility report from the business's name and website. Takes 90–150 seconds.
      </p>
      <NewProspectForm />
    </div>
  );
}
```

- [ ] **Step 3: Smoke check in the browser**

Navigate to `/agency/prospects/new`. Verify the form renders. Tick "This is a local business" — confirm the Location field appears. Untick — confirm it disappears. Don't submit yet (Task 21's detail page isn't built).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/NewProspectForm.tsx frontend/app/agency/prospects/new/page.tsx
git commit -m "feat(prospect-audit): create form page"
```

---

### Task 20: Detail page + polling

**Files:**
- Create: `frontend/components/agency/ProspectDetailView.tsx`
- Create: `frontend/app/agency/prospects/[id]/page.tsx`

- [ ] **Step 1: Create the detail view component (shell — panels added in Task 21)**

Create `frontend/components/agency/ProspectDetailView.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  getProspectAudit,
  type ProspectAuditOut,
} from '@/lib/api';
import { ProspectRunningPanel } from './ProspectRunningPanel';
import { ProspectResultsPanel } from './ProspectResultsPanel';
import { ProspectErrorPanel } from './ProspectErrorPanel';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);
const POLL_INTERVAL_MS = 2000;

interface Props {
  auditId: number;
}

export function ProspectDetailView({ auditId }: Props) {
  const [audit, setAudit] = useState<ProspectAuditOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const next = await getProspectAudit(auditId);
        if (cancelled) return;
        setAudit(next);
        setError(null);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Failed to load audit.';
        setError(msg);
        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS * 3);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [auditId]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/agency/prospects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to prospects
      </Link>

      {error && !audit && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>
      )}

      {audit && audit.status === 'completed' && <ProspectResultsPanel audit={audit} />}
      {audit && (audit.status === 'failed' || audit.status === 'canceled') && <ProspectErrorPanel audit={audit} />}
      {audit && !TERMINAL_STATUSES.has(audit.status) && <ProspectRunningPanel audit={audit} />}
    </div>
  );
}
```

- [ ] **Step 2: Create the route page**

Create `frontend/app/agency/prospects/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { ProspectDetailView } from '@/components/agency/ProspectDetailView';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProspectDetailPage({ params }: Props) {
  const { id } = await params;
  const auditId = Number(id);
  if (!Number.isFinite(auditId)) return notFound();
  return <ProspectDetailView auditId={auditId} />;
}
```

- [ ] **Step 3: Commit (panels follow in Task 21)**

```bash
git add frontend/components/agency/ProspectDetailView.tsx frontend/app/agency/prospects/[id]/page.tsx
git commit -m "feat(prospect-audit): detail page polling shell"
```

---

### Task 21: Running / Results / Error panels

**Files:**
- Create: `frontend/components/agency/ProspectRunningPanel.tsx`
- Create: `frontend/components/agency/ProspectResultsPanel.tsx`
- Create: `frontend/components/agency/ProspectErrorPanel.tsx`

- [ ] **Step 1: Create `ProspectRunningPanel.tsx`**

Create `frontend/components/agency/ProspectRunningPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { cancelProspectAudit, type ProspectAuditOut } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  scraping: 'Reading their site',
  generating_prompts: 'Generating audit prompts',
  detecting_competitors: 'Identifying peer brands',
  running_queries: 'Running queries on ChatGPT, Perplexity, Gemini',
  scoring: 'Computing visibility scores',
  drafting_recs: 'Writing recommendations',
  rendering_pdf: 'Rendering PDF',
};

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectRunningPanel({ audit }: Props) {
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (cancelling || audit.cancel_requested) return;
    setCancelling(true);
    try {
      await cancelProspectAudit(audit.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{audit.website_url}</p>

      <div className="mt-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {STATUS_LABELS[audit.status] ?? audit.status}
          </div>
          {audit.status_message && (
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{audit.status_message}</div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--text-muted)]">
        This typically takes 90–150 seconds. You can leave this page and come back — the audit will keep running.
      </p>

      <button
        type="button"
        onClick={handleCancel}
        disabled={audit.cancel_requested || cancelling}
        className="mt-6 inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        {audit.cancel_requested ? 'Cancellation requested' : 'Cancel'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `ProspectResultsPanel.tsx`**

Create `frontend/components/agency/ProspectResultsPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  deleteProspectAudit,
  prospectAuditPdfUrl,
  type ProspectAuditOut,
} from '@/lib/api';
import { RviBandBadge } from './RviBandBadge';

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectResultsPanel({ audit }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete prospect audit for ${audit.business_name}? This removes the PDF too.`)) return;
    setDeleting(true);
    try {
      await deleteProspectAudit(audit.id);
      router.push('/agency/prospects');
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {audit.website_url}{audit.is_local && audit.location ? ` · ${audit.location}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Your visibility</div>
          <div className="mt-3 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            {audit.overall_visibility_pct !== null ? `${Math.round(audit.overall_visibility_pct)}%` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Aggregate RVI</div>
          <div className="mt-3 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            {audit.aggregate_rvi !== null ? audit.aggregate_rvi.toFixed(2) : '∞'}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Band</div>
          <div className="mt-3">
            <RviBandBadge band={audit.rvi_band} className="text-sm" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {audit.has_pdf && (
          <a
            href={prospectAuditPdfUrl(audit.id)}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Detailed per-prompt scores, competitor breakdown, and recommendations are in the PDF — designed for the cold email.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create `ProspectErrorPanel.tsx`**

Create `frontend/components/agency/ProspectErrorPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AlertTriangle, RotateCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { deleteProspectAudit, retryProspectAudit, type ProspectAuditOut } from '@/lib/api';

interface Props {
  audit: ProspectAuditOut;
}

export function ProspectErrorPanel({ audit }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleRetry() {
    if (busy) return;
    setBusy(true);
    try {
      await retryProspectAudit(audit.id);
      // Reload the same page — the polling effect will pick up the new pending status
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete prospect audit for ${audit.business_name}?`)) return;
    setBusy(true);
    try {
      await deleteProspectAudit(audit.id);
      router.push('/agency/prospects');
    } catch {
      setBusy(false);
    }
  }

  const isCanceled = audit.status === 'canceled';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{audit.business_name}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{audit.website_url}</p>

      <div className="mt-6 flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {isCanceled ? 'Audit canceled' : 'Audit failed'}
          </div>
          {audit.error_message && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">{audit.error_message}</div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
          Retry
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke check the whole flow in the browser**

Make sure dev servers are running (backend on 3001, frontend on 3002). Log in as an agency-staff user.

1. Navigate to `/agency/prospects` — sidebar item visible, page loads.
2. Click "New prospect" — form appears.
3. Enter a real business (e.g. a local coffee shop with a basic website), check "is_local", enter a city, submit.
4. Redirect to detail page — ProspectRunningPanel shows, status text updates as the pipeline progresses (refresh polling every 2s).
5. After 90–150s the page should switch to ProspectResultsPanel with the three summary cards and a Download PDF button.
6. Click Download PDF — confirm a real PDF downloads with the business name in the filename.
7. Open the PDF — visually verify the cover, executive summary, per-prompt scorecard, winner blocks, recommendations, and CTA all render correctly. Check for any layout breakage (text overflow, missing logo, broken bars).

If the PDF looks broken in any way, capture screenshots and iterate on `prospect_audit.html.j2` + `prospect_audit.css` before continuing.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/ProspectRunningPanel.tsx frontend/components/agency/ProspectResultsPanel.tsx frontend/components/agency/ProspectErrorPanel.tsx
git commit -m "feat(prospect-audit): running / results / error panels"
```

---

## Phase 8 — End-to-end smoke verification

### Task 22: End-to-end smoke run against a real brand

**Files:** none (manual verification)

- [ ] **Step 1: Confirm full backend test suite passes**

```bash
cd backend && source venv/bin/activate
pytest tests/ -x -q
```

Expected: full suite green, including the new prospect-audit tests. If any pre-existing test broke (it shouldn't — this feature is fully additive), stop and diagnose.

- [ ] **Step 2: Verify env vars for the smoke check**

Make sure `backend/.env` has these set with real values:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...
GEMINI_API_KEY=...
PROSPECT_AUDIT_CTA_URL=https://cal.com/your-handle/intro       # optional
PROSPECT_AUDIT_CTA_EMAIL=ken@lumidian.io                       # optional, falls back to SUPPORT_EMAIL
```

Without LLM keys the audit will fail at the prompt-generation step.

- [ ] **Step 3: Run an end-to-end audit against a real brand**

With dev servers running, log in as an agency-staff user. Create a new prospect for a real well-known business (e.g. one of Ken's existing brands or a local coffee shop with a clean website). Run two audits:

1. **Non-local biz** (e.g. a B2B SaaS company) — confirm no location prompt, generic question phrasings.
2. **Local biz** (e.g. a dentist or coffee shop) — confirm prompts mention the location.

For each, watch the running panel cycle through statuses. After ~2 minutes the results panel should render. Download the PDF.

- [ ] **Step 4: Visually inspect the PDF**

Open each PDF and confirm:

- Cover page: prospect logo visible (or text tile if og:image absent), business name in serif, RVI band badge centered with correct color.
- Executive summary: headline matches the RVI band ("X is losing on AI search."), three score cards aligned and legible, paragraph mentions the location for the local biz only.
- Per-prompt scorecard: 10 cards sorted worst-first, bars rendered (no overflow), RVI numerics readable.
- Winner blocks: 3 cards, top-competitor named, model dots present.
- Recommendations: 3–5 numbered items, content tied to the prospect's actual gaps (not generic).
- CTA page: hook, link, methodology.
- No layout breakage — no orphaned headers on the wrong page, no text overflowing the page bounds.

If anything looks off, iterate on the template and re-render before considering the task done.

- [ ] **Step 5: Check the rate limit is enforced**

Quickly create 10 prospect audits in succession (you can hit the API directly via curl or browser dev tools to skip waiting). The 11th attempt within an hour should return HTTP 429.

```bash
curl -X POST http://localhost:3001/api/agency/prospects \
  -H "Content-Type: application/json" \
  -H "Cookie: clarity_token=<token from browser>" \
  -d '{"business_name":"Test","website_url":"https://example.com","is_local":false}'
```

- [ ] **Step 6: Verify the cleanup job logs but doesn't crash**

Manually invoke the cleanup function once:

```bash
cd backend && source venv/bin/activate
python -c "import asyncio; from app.scheduler import cleanup_stale_prospect_audits; print('deleted:', asyncio.run(cleanup_stale_prospect_audits()))"
```

Expected: prints `deleted: 0` (nothing should be older than 60 days yet). No errors.

- [ ] **Step 7: Update `CURRENT_STATE.md`**

Per the project convention (see `CLAUDE.md`), every Claude session must update `CURRENT_STATE.md` before ending. Add a "Recent Decisions" entry dated 2026-05-20 noting Prospect Audit shipped, and update the "Most recent work" line under "Current Task / WIP".

- [ ] **Step 8: Final commit + push (only if explicitly authorized)**

If Ken has authorized merging:

```bash
git add CURRENT_STATE.md
git commit -m "docs: update CURRENT_STATE — prospect audit shipped"
```

Do NOT push to origin or merge to main without explicit user approval. The smoke run is the gate.

---

## Spec coverage cross-check

The plan implements every section of `docs/superpowers/specs/2026-05-20-prospect-audit-design.md`:

| Spec requirement | Task |
|---|---|
| `ProspectAudit` table with summary fields | Task 1, 2 |
| RVI math (peer-avg, banding, subject exclusion) | Task 3 |
| Logo fetch with og:image → favicon → text-tile fallback | Task 4 |
| Geo-aware Claude Haiku prompt generation | Task 5 |
| Claude Haiku competitor detection with `is_subject` flag | Task 6 |
| 90-query fan-out with semaphore + cancel + progress | Task 7 |
| Claude Sonnet recommendations with Haiku fallback | Task 8 |
| `app/state.py` cancel-events registry | Task 9 |
| Orchestrator state machine (8 stages) + error handling | Task 10 |
| 6-page Jinja2 PDF template (cover / exec / per-prompt / winners / recs / CTA) | Task 11 |
| Playwright headless Chromium PDF render | Task 12 |
| 7 router endpoints + 10/hour rate limit | Tasks 13, 14 |
| Mount router in main.py | Task 13 |
| Daily 60-day cleanup in existing 06:00 UTC sweep | Task 15 |
| API client + types in `lib/api.ts` | Task 16 |
| Sidebar entry between Clients and Documents | Task 17 |
| RviBandBadge + list page | Task 18 |
| Create form with conditional location field | Task 19 |
| Detail page with 2-second polling | Task 20 |
| Running / Results / Error panels (status-based) | Task 21 |
| End-to-end smoke verification | Task 22 |

Every spec section is covered. Implementation is fully additive — no existing files have their behavior changed beyond the additive integrations (router mount, scheduler extension, sidebar nav entry).
