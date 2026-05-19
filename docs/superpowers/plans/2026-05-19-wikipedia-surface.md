# Wikipedia Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Wikipedia surface — a dedicated `/wiki/[brandId]` page that discovers existing Wikipedia articles where a brand could legitimately be cited, ranks them via an LLM legitimacy gate, and generates copy-paste-ready neutral wikitext on demand.

**Architecture:** Two new tables (`WikipediaCandidate`, `WikipediaScan`). New service modules `app/services/wikipedia/{scanner,drafter,api_client}.py`. Reuse existing `build_wikipedia_prompt` (with three new kwargs) and `parse_wikipedia_draft` from `services/drafting/`. New router `routers/wikipedia.py` with 6 endpoints under `/api/wikipedia/*`, gated to Growth + Pro tiers with rolling-30-day caps. New frontend route `/wiki/[brandId]` with 4 React components, plus a sidebar nav entry.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2.0 async / httpx (already a dep) for Wikipedia API / pytest-asyncio. Next.js 15 / TypeScript / Tailwind / Radix / lucide-react. LLM calls go through `app/services/drafting/client.py:call_claude` with model selection via `app/services/drafting/models.py` constants — never hardcode model strings.

**Reference:** [`docs/superpowers/specs/2026-05-18-wikipedia-surface-design.md`](../specs/2026-05-18-wikipedia-surface-design.md)

---

## Working Conventions

- **Branch:** `feat/wikipedia-surface` (spec lives here at commit `5a42f64`).
- **Worktree:** main worktree at `/Users/ken/Desktop/Lumidian`.
- **Backend tests:** TDD. Write failing test first. Run via `cd backend && ./venv/bin/pytest tests/<file>.py -v`. Do not activate venv; use direct paths.
- **Frontend:** no test suite. Each FE task is: write component → `npm run build` clean → manually click through in dev → commit.
- **Commits:** small and frequent. `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` footer.
- **Async-first.** Every DB call uses `async/await` with `AsyncSessionLocal`.
- **No hardcoded model strings.** Use `CROSS_REF_SUMMARY_MODEL` for cheap classification (legitimacy gate) and `writer_model_for_tier(tier)` for piece generation (drafter). Both live in `app/services/drafting/models.py`.

---

## File Structure

### Backend — created

| File | Responsibility |
|---|---|
| `backend/app/services/wikipedia/__init__.py` | Empty marker. |
| `backend/app/services/wikipedia/api_client.py` | Wikipedia REST API wrapper: search, extract, fetch_wikitext_and_sections. One module = one external API. |
| `backend/app/services/wikipedia/scanner.py` | Orchestrator: search → pre-filter → legitimacy gate → upsert. |
| `backend/app/services/wikipedia/drafter.py` | Orchestrator: fetch wikitext → build prompt with locked title → call_claude → parse → persist. |
| `backend/app/services/wikipedia/legitimacy_gate.py` | One LLM call per candidate; returns (score, reasoning). |
| `backend/app/services/wikipedia/caps.py` | Tier-gating + rolling-30-day cap checks. |
| `backend/app/routers/wikipedia.py` | 6 endpoints under `/api/wikipedia/*`. |
| `backend/tests/test_wikipedia_models.py` | ORM + migration. |
| `backend/tests/test_wikipedia_api_client.py` | API client (mocked httpx). |
| `backend/tests/test_wikipedia_legitimacy_gate.py` | Gate scoring + JSON parsing. |
| `backend/tests/test_wikipedia_scanner.py` | Scanner pipeline. |
| `backend/tests/test_wikipedia_drafter.py` | Drafter with locked title. |
| `backend/tests/test_wikipedia_caps.py` | Cap math. |
| `backend/tests/test_wikipedia_prompt_extension.py` | `build_wikipedia_prompt` locked-title kwarg. |
| `backend/tests/test_wikipedia_routes.py` | Endpoint contract + tier gating + ownership. |
| `backend/tests/test_wikipedia_e2e.py` | Full lifecycle. |

### Backend — modified

| File | What changes |
|---|---|
| `backend/app/models.py` | Add `WikipediaCandidate`, `WikipediaScan` classes. |
| `backend/app/database.py` | Append migration step (2 tables + indexes). |
| `backend/app/schemas.py` | Add `WikipediaCandidateSchema`, `WikipediaScanSchema`, `UpdateCandidateStatusRequest`. |
| `backend/app/services/drafting/prompts.py` | Add 3 optional kwargs to `build_wikipedia_prompt`. |
| `backend/app/main.py` | Mount `wikipedia_router`. |

### Frontend — created

| File | Responsibility |
|---|---|
| `frontend/app/wiki/page.tsx` | Redirect to `/wiki/[brandId]` once active brand resolves. |
| `frontend/app/wiki/[brandId]/page.tsx` | Thin wrapper mounting `<WikipediaSurface />`. |
| `frontend/components/wikipedia/WikipediaSurface.tsx` | Page container. |
| `frontend/components/wikipedia/ScanButton.tsx` | Trigger + poll scan status. |
| `frontend/components/wikipedia/CandidateCard.tsx` | One candidate, all status states. |
| `frontend/components/wikipedia/SuggestedEditPanel.tsx` | Expanded draft view with wikitext + COI reminder. |

### Frontend — modified

| File | What changes |
|---|---|
| `frontend/lib/api.ts` | 6 new typed functions + 3 new types. |
| `frontend/components/Sidebar.tsx` | New "Wikipedia" nav entry, tier-gated. |
| `frontend/components/AppShell.tsx` | Mirror tier-gated nav entry if AppShell also lists. |

### Docs — modified

| File | What changes |
|---|---|
| `CLAUDE.md` | Add `WikipediaCandidate` + `WikipediaScan` to models table; add router row; section under Key Patterns describing the Wikipedia flow. |
| `CURRENT_STATE.md` | Update WIP + Recent Decisions entry. |

---

## Task 1: ORM models for WikipediaCandidate and WikipediaScan

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_wikipedia_models.py` (create)

- [ ] **Step 1.1: Write failing test**

Create `backend/tests/test_wikipedia_models.py`:

```python
"""Tests for WikipediaCandidate and WikipediaScan ORM models."""
import pytest
import pytest_asyncio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)


@pytest_asyncio.fixture
async def wiki_user(db_session: AsyncSession) -> User:
    user = User(
        email="wiki_models@example.com",
        password_hash="x",
        name="Wiki",
        email_verified=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_wikipedia_scan_creation(db_session: AsyncSession, wiki_user: User) -> None:
    brand = Brand(name="Acme", slug="wiki-acme-1", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()

    scan = WikipediaScan(
        brand_id=brand.id,
        status="running",
        triggered_by=wiki_user.id,
        prompts_searched=0,
        total_candidates_found=0,
        candidates_persisted=0,
    )
    db_session.add(scan)
    await db_session.flush()

    assert scan.id is not None
    assert scan.status == "running"
    assert scan.completed_at is None


@pytest.mark.asyncio
async def test_wikipedia_candidate_creation(db_session: AsyncSession, wiki_user: User) -> None:
    brand = Brand(name="Acme", slug="wiki-acme-2", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is X?", prompt_type="standard")
    db_session.add(prompt)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=wiki_user.id)
    db_session.add(scan)
    await db_session.flush()

    candidate = WikipediaCandidate(
        brand_id=brand.id,
        prompt_id=prompt.id,
        scan_id=scan.id,
        article_title="Brand_visibility_in_LLMs",
        article_url="https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        pageid=12345,
        article_summary="Brand visibility tracking is a discipline focused on…",
        legitimacy_score=0.84,
        legitimacy_reasoning="Topic squarely matches the brand's domain.",
        status="new",
    )
    db_session.add(candidate)
    await db_session.flush()

    assert candidate.id is not None
    assert candidate.status == "new"
    assert candidate.suggested_wikitext is None
    assert candidate.evidence_pack_used is None


@pytest.mark.asyncio
async def test_unique_brand_article(db_session: AsyncSession, wiki_user: User) -> None:
    """One candidate per (brand, article_title)."""
    brand = Brand(name="Acme", slug="wiki-acme-3", user_id=wiki_user.id)
    db_session.add(brand)
    await db_session.flush()
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=wiki_user.id)
    db_session.add(scan)
    await db_session.commit()

    db_session.add(
        WikipediaCandidate(
            brand_id=brand.id,
            scan_id=scan.id,
            article_title="Same_Article",
            article_url="https://en.wikipedia.org/wiki/Same_Article",
            pageid=1,
            article_summary="...",
            legitimacy_score=0.7,
            legitimacy_reasoning="r",
            status="new",
        )
    )
    await db_session.commit()

    db_session.add(
        WikipediaCandidate(
            brand_id=brand.id,
            scan_id=scan.id,
            article_title="Same_Article",
            article_url="https://en.wikipedia.org/wiki/Same_Article",
            pageid=1,
            article_summary="...",
            legitimacy_score=0.8,
            legitimacy_reasoning="r2",
            status="new",
        )
    )
    with pytest.raises((IntegrityError, Exception)):
        await db_session.commit()
```

- [ ] **Step 1.2: Run, expect ImportError**

```bash
cd backend && ./venv/bin/pytest tests/test_wikipedia_models.py -v
```

Expected: 3 errors — `cannot import name 'WikipediaCandidate'`.

- [ ] **Step 1.3: Add models to `backend/app/models.py`**

Append after the existing `BrandSource` class (around line 946+):

```python
class WikipediaScan(Base):
    __tablename__ = "wikipedia_scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    triggered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    prompts_searched: Mapped[int] = mapped_column(default=0)
    total_candidates_found: Mapped[int] = mapped_column(default=0)
    candidates_persisted: Mapped[int] = mapped_column(default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class WikipediaCandidate(Base):
    __tablename__ = "wikipedia_candidates"
    __table_args__ = (
        UniqueConstraint("brand_id", "article_title", name="uq_wikipedia_candidates_brand_article"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    prompt_id: Mapped[int | None] = mapped_column(ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("wikipedia_scans.id", ondelete="CASCADE"))
    article_title: Mapped[str] = mapped_column(String(512))
    article_url: Mapped[str] = mapped_column(String(2048))
    pageid: Mapped[int] = mapped_column()
    article_summary: Mapped[str] = mapped_column(Text, default="")
    legitimacy_score: Mapped[float] = mapped_column(default=0.0)
    legitimacy_reasoning: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="new")
    suggested_wikitext: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_insert_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    evidence_pack_used: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_drafted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_status_change_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
```

Ensure `UniqueConstraint`, `Text`, `JSON`, `String`, `ForeignKey`, `datetime`, `UTC` are already imported at the top of `models.py` (they should be; verify with grep before adding).

- [ ] **Step 1.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_models.py -v
```

Expected: 3 pass. `conftest.py` uses `Base.metadata.create_all` so tables are auto-derived from the ORM.

- [ ] **Step 1.5: Commit**

```bash
git add backend/app/models.py backend/tests/test_wikipedia_models.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): WikipediaCandidate and WikipediaScan ORM models

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Database migration

**Files:**
- Modify: `backend/app/database.py`

- [ ] **Step 2.1: Locate the migration anchor**

```bash
grep -n "MIGRATION\|run_migrations\|^    # --- Migration" backend/app/database.py | tail -10
```

Migration blocks live at the bottom of the `run_migrations()` function. Read the most recent block to mimic its style.

- [ ] **Step 2.2: Append migration**

Add at the bottom of `run_migrations()`:

```python
    # --- Migration: wikipedia surface (2026-05-19) ---
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS wikipedia_scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                triggered_by INTEGER,
                prompts_searched INTEGER NOT NULL DEFAULT 0,
                total_candidates_found INTEGER NOT NULL DEFAULT 0,
                candidates_persisted INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                started_at DATETIME NOT NULL,
                completed_at DATETIME,
                FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
                FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wikipedia_scans_brand ON wikipedia_scans (brand_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wikipedia_scans_brand_started ON wikipedia_scans (brand_id, started_at)"))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS wikipedia_candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                prompt_id INTEGER,
                scan_id INTEGER NOT NULL,
                article_title TEXT NOT NULL,
                article_url TEXT NOT NULL,
                pageid INTEGER NOT NULL,
                article_summary TEXT NOT NULL DEFAULT '',
                legitimacy_score REAL NOT NULL DEFAULT 0.0,
                legitimacy_reasoning TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new',
                suggested_wikitext TEXT,
                suggested_section TEXT,
                suggested_insert_location TEXT,
                evidence_pack_used JSON,
                last_drafted_at DATETIME,
                last_status_change_at DATETIME,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL,
                FOREIGN KEY (scan_id) REFERENCES wikipedia_scans(id) ON DELETE CASCADE,
                UNIQUE (brand_id, article_title)
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wikipedia_candidates_brand ON wikipedia_candidates (brand_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wikipedia_candidates_last_drafted ON wikipedia_candidates (brand_id, last_drafted_at)"))
```

- [ ] **Step 2.3: Run model tests + full regression check**

```bash
./venv/bin/pytest tests/test_wikipedia_models.py -v
./venv/bin/pytest tests/ -q 2>&1 | tail -5
```

Expected: all tests pass (no regression).

- [ ] **Step 2.4: Commit**

```bash
git add backend/app/database.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): migration — wikipedia_scans + wikipedia_candidates tables

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 3.1: Append schemas to `backend/app/schemas.py`**

```python
# ── Wikipedia Surface ────────────────────────────────────────────────────────

class WikipediaScanSchema(BaseModel):
    id: int
    brand_id: int
    status: str
    triggered_by: int | None
    prompts_searched: int
    total_candidates_found: int
    candidates_persisted: int
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class WikipediaCandidateSchema(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None
    scan_id: int
    article_title: str
    article_url: str
    pageid: int
    article_summary: str
    legitimacy_score: float
    legitimacy_reasoning: str
    status: str
    suggested_wikitext: str | None
    suggested_section: str | None
    suggested_insert_location: str | None
    evidence_pack_used: dict | None
    last_drafted_at: datetime | None
    last_status_change_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UpdateCandidateStatusRequest(BaseModel):
    status: str  # 'submitted' | 'accepted' | 'reverted' | 'dismissed'

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("submitted", "accepted", "reverted", "dismissed"):
            raise ValueError("status must be one of submitted/accepted/reverted/dismissed")
        return v
```

- [ ] **Step 3.2: Verify imports**

```bash
cd /Users/ken/Desktop/Lumidian/backend && ./venv/bin/python -c "from app.schemas import WikipediaCandidateSchema, WikipediaScanSchema, UpdateCandidateStatusRequest; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3.3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): Pydantic schemas for candidates + scans

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wikipedia API client

**Files:**
- Create: `backend/app/services/wikipedia/__init__.py` (empty)
- Create: `backend/app/services/wikipedia/api_client.py`
- Test: `backend/tests/test_wikipedia_api_client.py`

- [ ] **Step 4.1: Create the empty package marker**

```bash
mkdir -p /Users/ken/Desktop/Lumidian/backend/app/services/wikipedia
touch /Users/ken/Desktop/Lumidian/backend/app/services/wikipedia/__init__.py
```

- [ ] **Step 4.2: Write failing test**

Create `backend/tests/test_wikipedia_api_client.py`:

```python
"""Tests for the Wikipedia REST API client wrapper."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.wikipedia.api_client import (
    WIKIPEDIA_USER_AGENT,
    fetch_lead_extract,
    fetch_wikitext_and_sections,
    search_articles,
)


def _mock_response(json_body: dict, status_code: int = 200) -> httpx.Response:
    return httpx.Response(status_code=status_code, json=json_body, request=httpx.Request("GET", "https://en.wikipedia.org/w/api.php"))


@pytest.mark.asyncio
async def test_search_articles_returns_top_results() -> None:
    body = {
        "query": {
            "search": [
                {"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "Brand visibility…"},
                {"title": "AI search", "pageid": 1002, "snippet": "AI search…"},
            ]
        }
    }
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        results = await search_articles("brand visibility LLM", limit=5)

    assert len(results) == 2
    assert results[0]["title"] == "Brand visibility in LLMs"
    assert results[0]["pageid"] == 1001


@pytest.mark.asyncio
async def test_search_articles_empty() -> None:
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value={"query": {"search": []}})):
        results = await search_articles("nonsense query", limit=5)
    assert results == []


@pytest.mark.asyncio
async def test_fetch_lead_extract() -> None:
    body = {"query": {"pages": {"1001": {"pageid": 1001, "title": "Brand visibility in LLMs", "extract": "Brand visibility tracking is…"}}}}
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        title, extract = await fetch_lead_extract(1001)

    assert title == "Brand visibility in LLMs"
    assert extract.startswith("Brand visibility")


@pytest.mark.asyncio
async def test_fetch_lead_extract_missing_page() -> None:
    body = {"query": {"pages": {"-1": {"missing": ""}}}}
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        result = await fetch_lead_extract(99999)
    assert result is None


@pytest.mark.asyncio
async def test_fetch_wikitext_and_sections() -> None:
    body = {
        "parse": {
            "wikitext": {"*": "== History ==\nSome history text.\n\n== Methodology ==\nSome methodology."},
            "sections": [
                {"line": "History", "level": "2"},
                {"line": "Methodology", "level": "2"},
            ],
        }
    }
    with patch("app.services.wikipedia.api_client._get_json", new=AsyncMock(return_value=body)):
        wikitext, sections = await fetch_wikitext_and_sections(1001)

    assert "== History ==" in wikitext
    assert sections == ["History", "Methodology"]


def test_user_agent_descriptive() -> None:
    assert "Lumidian" in WIKIPEDIA_USER_AGENT
    assert "lumidian.app" in WIKIPEDIA_USER_AGENT
```

- [ ] **Step 4.3: Run, expect ImportError**

```bash
./venv/bin/pytest tests/test_wikipedia_api_client.py -v
```

Expected: 6 errors — `cannot import name 'search_articles'`.

- [ ] **Step 4.4: Create the API client**

Create `backend/app/services/wikipedia/api_client.py`:

```python
"""Wikipedia REST API client wrapper.

Single source of truth for talking to en.wikipedia.org/w/api.php. No business
logic in here — just typed wrappers around the underlying GET calls. Tests mock
``_get_json`` to isolate the orchestrators from network IO.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WIKIPEDIA_USER_AGENT = "Lumidian/1.0 (https://lumidian.app; support@lumidian.app)"
_WIKI_API_URL = "https://en.wikipedia.org/w/api.php"
_TIMEOUT_SECONDS = 10.0


async def _get_json(params: dict[str, Any]) -> dict:
    """Single GET to the Wikipedia API. One retry on network error."""
    params = {**params, "format": "json", "formatversion": "2"}
    headers = {"User-Agent": WIKIPEDIA_USER_AGENT}
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, headers=headers) as client:
                resp = await client.get(_WIKI_API_URL, params=params)
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_error = e
            if attempt == 0:
                logger.warning("Wikipedia API call failed, retrying: %s", e)
                continue
            logger.exception("Wikipedia API call failed after retry: %s", e)
            raise
    if last_error:
        raise last_error
    return {}


async def search_articles(query: str, limit: int = 5) -> list[dict]:
    """Returns a list of {title, pageid, snippet} dicts. Empty list on no results."""
    body = await _get_json(
        {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": limit,
        }
    )
    results = body.get("query", {}).get("search", []) or []
    return [
        {"title": r.get("title", ""), "pageid": int(r.get("pageid", 0)), "snippet": r.get("snippet", "")}
        for r in results
        if r.get("pageid")
    ]


async def fetch_lead_extract(pageid: int) -> tuple[str, str] | None:
    """Returns (verified_title, plain-text intro) or None if the page is missing."""
    body = await _get_json(
        {
            "action": "query",
            "prop": "extracts",
            "exintro": "1",
            "explaintext": "1",
            "pageids": pageid,
        }
    )
    # formatversion=2 returns a list under "pages"
    pages = body.get("query", {}).get("pages", [])
    if not pages:
        return None
    page = pages[0]
    if page.get("missing"):
        return None
    title = page.get("title") or ""
    extract = page.get("extract") or ""
    if not title or not extract:
        return None
    return title, extract


async def fetch_wikitext_and_sections(pageid: int) -> tuple[str, list[str]]:
    """Returns (full wikitext, list of section names). Empty string + empty list if missing."""
    body = await _get_json(
        {
            "action": "parse",
            "pageid": pageid,
            "prop": "wikitext|sections",
        }
    )
    parse = body.get("parse") or {}
    wikitext = (parse.get("wikitext") or {}).get("*", "") if isinstance(parse.get("wikitext"), dict) else (parse.get("wikitext") or "")
    section_objs = parse.get("sections") or []
    sections = [s.get("line", "") for s in section_objs if s.get("line")]
    return wikitext, sections
```

- [ ] **Step 4.5: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_api_client.py -v
```

Expected: 6 pass.

- [ ] **Step 4.6: Commit**

```bash
git add backend/app/services/wikipedia/__init__.py backend/app/services/wikipedia/api_client.py backend/tests/test_wikipedia_api_client.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): Wikipedia REST API client wrapper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Legitimacy gate

**Files:**
- Create: `backend/app/services/wikipedia/legitimacy_gate.py`
- Test: `backend/tests/test_wikipedia_legitimacy_gate.py`

- [ ] **Step 5.1: Write failing test**

Create `backend/tests/test_wikipedia_legitimacy_gate.py`:

```python
"""Tests for the LLM legitimacy gate."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.wikipedia.legitimacy_gate import LEGITIMACY_THRESHOLD, score_candidate


@pytest.mark.asyncio
async def test_score_candidate_parses_strict_json() -> None:
    raw = '{"score": 0.82, "reasoning": "Article topic overlaps with brand domain."}'
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value=raw)):
        score, reasoning = await score_candidate(
            brand_name="Acme",
            profile_block="Name: Acme\nDescription: Tracks LLM citations",
            article_title="Brand visibility in LLMs",
            article_summary="A discipline focused on…",
        )
    assert score == pytest.approx(0.82)
    assert "overlaps" in reasoning


@pytest.mark.asyncio
async def test_score_candidate_strips_markdown_fences() -> None:
    raw = '```json\n{"score": 0.6, "reasoning": "ok"}\n```'
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value=raw)):
        score, reasoning = await score_candidate(
            brand_name="Acme", profile_block="x", article_title="T", article_summary="S",
        )
    assert score == pytest.approx(0.6)


@pytest.mark.asyncio
async def test_score_candidate_handles_garbage() -> None:
    with patch("app.services.wikipedia.legitimacy_gate._call_llm", new=AsyncMock(return_value="totally not json")):
        score, reasoning = await score_candidate(
            brand_name="Acme", profile_block="x", article_title="T", article_summary="S",
        )
    assert score == 0.0
    assert "unparseable" in reasoning.lower()


def test_threshold_is_in_range() -> None:
    assert 0.0 < LEGITIMACY_THRESHOLD < 1.0
```

- [ ] **Step 5.2: Run, expect failure**

```bash
./venv/bin/pytest tests/test_wikipedia_legitimacy_gate.py -v
```

Expected: 4 errors — `cannot import name 'score_candidate'`.

- [ ] **Step 5.3: Create the legitimacy gate**

Create `backend/app/services/wikipedia/legitimacy_gate.py`:

```python
"""LLM legitimacy gate — scores whether a brand could legitimately cite a Wikipedia article."""
from __future__ import annotations

import json
import logging

from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

LEGITIMACY_THRESHOLD = 0.55

_PROMPT_TEMPLATE = """You are reviewing whether {brand_name} could legitimately add a neutral, citation-backed contribution to this Wikipedia article.

Article: {article_title}
Article summary: {article_summary}

Brand:
{profile_block}

A LEGITIMATE candidate (score ≥ 0.6):
- The article topic substantively overlaps with the brand's domain expertise.
- The brand could supply a neutral fact or cite-worthy claim, not promotional copy.
- The brand is NOT the article's subject (we never edit our own article).

ILLEGITIMATE (score < 0.5):
- The brand is the article's subject or a direct competitor.
- The article topic is unrelated to brand expertise.
- Any plausible contribution would read as marketing.

Output strict JSON only — no markdown fences, no prose:
{{"score": <float 0..1>, "reasoning": "<one sentence>"}}"""


async def _call_llm(prompt: str) -> str:
    """Thin wrapper for test mocking."""
    return (await call_claude(prompt=prompt, max_tokens=200, model=CROSS_REF_SUMMARY_MODEL)).strip()


def _parse(raw: str) -> tuple[float, str]:
    s = raw.strip()
    if s.startswith("```"):
        parts = s.split("```")
        s = parts[1].lstrip("json").strip() if len(parts) >= 2 else s
    try:
        data = json.loads(s)
        return float(data.get("score", 0.0)), str(data.get("reasoning", ""))
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.warning("Legitimacy gate returned unparseable output: %s", raw[:120])
        return 0.0, "Unparseable LLM response."


async def score_candidate(
    *,
    brand_name: str,
    profile_block: str,
    article_title: str,
    article_summary: str,
) -> tuple[float, str]:
    """Return (score in [0,1], one-sentence reasoning)."""
    prompt = _PROMPT_TEMPLATE.format(
        brand_name=brand_name,
        profile_block=profile_block,
        article_title=article_title,
        article_summary=article_summary[:800],
    )
    raw = await _call_llm(prompt)
    return _parse(raw)
```

- [ ] **Step 5.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_legitimacy_gate.py -v
```

Expected: 4 pass.

- [ ] **Step 5.5: Commit**

```bash
git add backend/app/services/wikipedia/legitimacy_gate.py backend/tests/test_wikipedia_legitimacy_gate.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): LLM legitimacy gate via CROSS_REF_SUMMARY_MODEL

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Scanner orchestrator

**Files:**
- Create: `backend/app/services/wikipedia/scanner.py`
- Test: `backend/tests/test_wikipedia_scanner.py`

- [ ] **Step 6.1: Write failing test**

Create `backend/tests/test_wikipedia_scanner.py`:

```python
"""Tests for the Wikipedia scanner orchestrator."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.wikipedia.scanner import is_obviously_illegitimate, run_scan


@pytest_asyncio.fixture
async def scan_setup(db_session: AsyncSession) -> tuple[User, Brand, list[Prompt]]:
    user = User(email="wiki_scanner@example.com", password_hash="x", name="S", email_verified=True)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="scanner-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompts = [
        Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard"),
        Prompt(brand_id=brand.id, text="AI search citations", prompt_type="standard"),
    ]
    for p in prompts:
        db_session.add(p)
    await db_session.commit()
    return user, brand, prompts


def test_pre_filter_disambiguation() -> None:
    assert is_obviously_illegitimate(
        title="Visibility (disambiguation)", summary="A disambiguation page.", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_list_page() -> None:
    assert is_obviously_illegitimate(
        title="List of search engines", summary="...", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_brand_self() -> None:
    assert is_obviously_illegitimate(
        title="Acme (company)", summary="Acme is a company that…", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_competitor() -> None:
    assert is_obviously_illegitimate(
        title="OpenAI", summary="OpenAI is…", brand_name="Acme", competitor_names=["OpenAI"]
    )


def test_pre_filter_thin_summary() -> None:
    assert is_obviously_illegitimate(
        title="Topic", summary="short.", brand_name="Acme", competitor_names=[]
    )


def test_pre_filter_passes_legitimate() -> None:
    assert not is_obviously_illegitimate(
        title="Brand visibility in LLMs",
        summary="Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers across ChatGPT, Claude, Perplexity, and Gemini. Practitioners use specialized tools to monitor citation rates.",
        brand_name="Acme",
        competitor_names=[],
    )


@pytest.mark.asyncio
async def test_run_scan_persists_candidates(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup

    search_results = [
        {"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."},
    ]
    extract = (
        "Brand visibility in LLMs",
        "Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers across ChatGPT, Claude, Perplexity, and Gemini. Practitioners use specialized tools to monitor citation rates.",
    )

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.82, "Topic squarely matches the brand's domain.")),
    ):
        scan = await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    assert scan.status == "completed"
    candidates = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand.id))).scalars().all()
    assert len(candidates) == 1
    c = candidates[0]
    assert c.article_title == "Brand visibility in LLMs"
    assert c.pageid == 1001
    assert c.legitimacy_score == pytest.approx(0.82)
    assert c.status == "new"


@pytest.mark.asyncio
async def test_run_scan_drops_below_threshold(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup
    search_results = [{"title": "Unrelated topic", "pageid": 2002, "snippet": "..."}]
    extract = ("Unrelated topic", "A long enough summary " * 20)

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.3, "Topic unrelated.")),
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    candidates = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand.id))).scalars().all()
    assert candidates == []


@pytest.mark.asyncio
async def test_run_scan_preserves_user_status_on_rescan(db_session: AsyncSession, scan_setup) -> None:
    user, brand, prompts = scan_setup

    # First scan: candidate enters as 'new' then we mark it 'submitted'
    search_results = [{"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."}]
    extract = ("Brand visibility in LLMs", "A long enough summary " * 20)

    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate", new=AsyncMock(return_value=(0.8, "ok"))
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    candidate = (await db_session.execute(select(WikipediaCandidate))).scalars().first()
    candidate.status = "submitted"
    await db_session.commit()

    # Second scan: same article, lower score; status must stay 'submitted'
    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate", new=AsyncMock(return_value=(0.7, "still ok"))
    ):
        await run_scan(db_session, brand_id=brand.id, triggered_by=user.id)

    refreshed = (await db_session.execute(select(WikipediaCandidate))).scalars().first()
    assert refreshed.status == "submitted"
    assert refreshed.legitimacy_score == pytest.approx(0.7)
```

- [ ] **Step 6.2: Run, expect failures**

```bash
./venv/bin/pytest tests/test_wikipedia_scanner.py -v
```

Expected: import errors / failures.

- [ ] **Step 6.3: Create scanner**

Create `backend/app/services/wikipedia/scanner.py`:

```python
"""Wikipedia scanner — discovers and ranks candidate articles for a brand."""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Competitor,
    Prompt,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.wikipedia.api_client import fetch_lead_extract, search_articles
from app.services.wikipedia.legitimacy_gate import LEGITIMACY_THRESHOLD, score_candidate

logger = logging.getLogger(__name__)

_PRESERVE_STATUSES = {"submitted", "accepted", "reverted"}


def is_obviously_illegitimate(*, title: str, summary: str, brand_name: str, competitor_names: list[str]) -> bool:
    """Free pre-filter — drops obvious non-starters before the LLM gate fires."""
    t = (title or "").lower()
    s = (summary or "").strip()
    if not t or not s:
        return True
    if len(s) < 100:
        return True
    if "(disambiguation)" in t:
        return True
    if t.startswith("list of "):
        return True
    if t.startswith("year ") or (len(t) == 4 and t.isdigit()):
        return True
    bn = (brand_name or "").lower().strip()
    if bn and (t == bn or t.startswith(bn + " (") or t.startswith(bn + ",")):
        return True
    for comp in competitor_names:
        c = (comp or "").lower().strip()
        if c and (t == c or t.startswith(c + " (")):
            return True
    return False


async def _build_profile_block(db: AsyncSession, brand_id: int) -> tuple[str, str]:
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one()
    profile = (await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))).scalar_one_or_none()
    parts = [f"Name: {brand.name}"]
    if profile:
        if profile.company_description:
            parts.append(f"Description: {profile.company_description}")
        if profile.key_stats:
            parts.append(f"Key stats: {profile.key_stats}")
        if profile.target_audience:
            parts.append(f"Target audience: {profile.target_audience}")
    return brand.name, "\n".join(parts)


async def _competitor_names(db: AsyncSession, brand_id: int) -> list[str]:
    rows = (await db.execute(select(Competitor.name).where(Competitor.brand_id == brand_id))).scalars().all()
    return [r for r in rows if r]


async def run_scan(
    db: AsyncSession,
    *,
    brand_id: int,
    triggered_by: int | None,
) -> WikipediaScan:
    """Run a single scan: search per prompt -> pre-filter -> legitimacy gate -> upsert.

    Persists a WikipediaScan row that summarizes the run. Caller is responsible
    for tier + cap checks; this function just executes.
    """
    scan = WikipediaScan(brand_id=brand_id, status="running", triggered_by=triggered_by, started_at=datetime.now(UTC))
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    try:
        brand_name, profile_block = await _build_profile_block(db, brand_id)
        competitor_names = await _competitor_names(db, brand_id)
        prompts = (
            await db.execute(
                select(Prompt).where(Prompt.brand_id == brand_id, Prompt.prompt_type == "standard")
            )
        ).scalars().all()

        # 1. Search per prompt, dedupe by pageid
        seen_pageids: dict[int, dict] = {}
        scan.prompts_searched = len(prompts)
        for prompt in prompts:
            try:
                results = await search_articles(prompt.text, limit=5)
            except Exception:
                logger.exception("search_articles failed for prompt %d", prompt.id)
                continue
            for r in results:
                pid = r.get("pageid")
                if not pid or pid in seen_pageids:
                    continue
                seen_pageids[pid] = {**r, "discovered_via_prompt_id": prompt.id}
        scan.total_candidates_found = len(seen_pageids)

        # 2. Fetch lead extracts + pre-filter
        survivors: list[dict] = []
        for pid, info in seen_pageids.items():
            try:
                extract_result = await fetch_lead_extract(pid)
            except Exception:
                logger.exception("fetch_lead_extract failed for pageid %d", pid)
                continue
            if extract_result is None:
                continue
            verified_title, summary = extract_result
            if is_obviously_illegitimate(
                title=verified_title, summary=summary, brand_name=brand_name, competitor_names=competitor_names
            ):
                continue
            info["verified_title"] = verified_title
            info["summary"] = summary
            survivors.append(info)

        # 3. Legitimacy gate per survivor
        persisted = 0
        for s in survivors:
            try:
                score, reasoning = await score_candidate(
                    brand_name=brand_name,
                    profile_block=profile_block,
                    article_title=s["verified_title"],
                    article_summary=s["summary"],
                )
            except Exception:
                logger.exception("score_candidate failed for pageid %d", s["pageid"])
                continue
            if score < LEGITIMACY_THRESHOLD:
                continue

            existing = (
                await db.execute(
                    select(WikipediaCandidate).where(
                        WikipediaCandidate.brand_id == brand_id,
                        WikipediaCandidate.article_title == s["verified_title"],
                    )
                )
            ).scalar_one_or_none()

            if existing:
                # Refresh score, summary, scan link — but never clobber user status
                existing.legitimacy_score = score
                existing.legitimacy_reasoning = reasoning
                existing.article_summary = s["summary"]
                existing.scan_id = scan.id
                existing.pageid = s["pageid"]
                existing.article_url = f"https://en.wikipedia.org/wiki/{s['verified_title'].replace(' ', '_')}"
                # status preserved if user has acted on it
                if existing.status not in _PRESERVE_STATUSES:
                    existing.status = "new" if existing.status == "new" else existing.status
                persisted += 1
            else:
                db.add(
                    WikipediaCandidate(
                        brand_id=brand_id,
                        prompt_id=s.get("discovered_via_prompt_id"),
                        scan_id=scan.id,
                        article_title=s["verified_title"],
                        article_url=f"https://en.wikipedia.org/wiki/{s['verified_title'].replace(' ', '_')}",
                        pageid=s["pageid"],
                        article_summary=s["summary"],
                        legitimacy_score=score,
                        legitimacy_reasoning=reasoning,
                        status="new",
                        created_at=datetime.now(UTC),
                    )
                )
                persisted += 1

        scan.candidates_persisted = persisted
        scan.status = "completed"
        scan.completed_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(scan)
        return scan
    except Exception as e:
        logger.exception("Scan %d failed: %s", scan.id, e)
        scan.status = "failed"
        scan.error_message = str(e)[:1000]
        scan.completed_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(scan)
        return scan
```

- [ ] **Step 6.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_scanner.py -v
```

Expected: 9 pass (6 pre-filter unit tests + 3 scan integration tests).

- [ ] **Step 6.5: Commit**

```bash
git add backend/app/services/wikipedia/scanner.py backend/tests/test_wikipedia_scanner.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): scanner orchestrator (search + pre-filter + legitimacy gate + upsert)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extend `build_wikipedia_prompt` with locked-title kwargs

**Files:**
- Modify: `backend/app/services/drafting/prompts.py`
- Test: `backend/tests/test_wikipedia_prompt_extension.py`

- [ ] **Step 7.1: Write failing test**

Create `backend/tests/test_wikipedia_prompt_extension.py`:

```python
"""Tests for build_wikipedia_prompt locked-article kwargs."""
from app.services.drafting.prompts import build_wikipedia_prompt


def test_unlocked_call_unchanged() -> None:
    out = build_wikipedia_prompt(
        brand_name="Acme",
        prompt_text="What is X?",
        profile_context="Name: Acme",
        response_analysis="...",
    )
    assert "FIXED ARTICLE" not in out
    # The existing instruction stays
    assert "ARTICLE SELECTION" in out or "specific, real, existing Wikipedia article" in out


def test_locked_title_replaces_article_selection() -> None:
    out = build_wikipedia_prompt(
        brand_name="Acme",
        prompt_text="What is X?",
        profile_context="Name: Acme",
        response_analysis="...",
        locked_article_title="Brand visibility in LLMs",
        article_section_list=["History", "Methodology"],
        citation_needed_hints=["…tracking emerged in the 2020s.{{citation needed}}"],
    )
    assert "FIXED ARTICLE" in out
    assert "Brand visibility in LLMs" in out
    assert "History" in out
    assert "Methodology" in out
    assert "CITATION NEEDED" in out
```

- [ ] **Step 7.2: Run, expect failure**

```bash
./venv/bin/pytest tests/test_wikipedia_prompt_extension.py -v
```

Expected: 1 pass (unlocked unchanged), 1 fail (unexpected kwargs).

- [ ] **Step 7.3: Extend `build_wikipedia_prompt`**

In `backend/app/services/drafting/prompts.py`, find the `build_wikipedia_prompt` signature and add three new optional kwargs at the end:

```python
def build_wikipedia_prompt(
    brand_name: str,
    prompt_text: str,
    profile_context: str,
    response_analysis: str,
    publications: list[dict] | None = None,
    website_url: str | None = None,
    evidence_pack: EvidencePack | None = None,
    locked_article_title: str | None = None,        # NEW
    article_section_list: list[str] | None = None,  # NEW
    citation_needed_hints: list[str] | None = None, # NEW
) -> str:
```

Then build a `fixed_article_section` string before the return:

```python
    fixed_article_section = ""
    if locked_article_title:
        sections_block = ""
        if article_section_list:
            sections_block = "\nEXISTING SECTIONS in this article (pick the best fit):\n" + "\n".join(
                f"  - {s}" for s in article_section_list
            )
        cn_block = ""
        if citation_needed_hints:
            cn_block = "\n\nCITATION NEEDED hints (existing {{citation needed}} locations the brand could help fill):\n" + "\n".join(
                f"  - {h}" for h in citation_needed_hints
            )
        fixed_article_section = (
            f"\nFIXED ARTICLE — non-negotiable. Insert into the Wikipedia article titled "
            f'"{locked_article_title}". Do not choose a different article. Do not invent a title.'
            f"{sections_block}{cn_block}\n"
        )
```

In the return f-string, find the line containing `ARTICLE SELECTION —` (around line 109) and conditionally swap it out. The simplest approach: place `{fixed_article_section}` immediately before that paragraph, and rewrite the original `ARTICLE SELECTION` paragraph to be conditional on whether `locked_article_title` is None.

Concretely — replace:

```python
ARTICLE SELECTION — choose the article whose topic most directly matches the key terms in the target query. The article title and section should use the same vocabulary as the query. Never target: brand articles, disambiguation pages, or articles you are inventing.
```

with:

```python
{fixed_article_section if locked_article_title else "ARTICLE SELECTION — choose the article whose topic most directly matches the key terms in the target query. The article title and section should use the same vocabulary as the query. Never target: brand articles, disambiguation pages, or articles you are inventing."}
```

- [ ] **Step 7.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_prompt_extension.py -v
```

Expected: 2 pass.

- [ ] **Step 7.5: Confirm no regression in existing prompt tests**

```bash
./venv/bin/pytest -k "wikipedia or prompt" tests/ -q 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 7.6: Commit**

```bash
git add backend/app/services/drafting/prompts.py backend/tests/test_wikipedia_prompt_extension.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): build_wikipedia_prompt accepts locked-article kwargs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Drafter orchestrator

**Files:**
- Create: `backend/app/services/wikipedia/drafter.py`
- Test: `backend/tests/test_wikipedia_drafter.py`

- [ ] **Step 8.1: Write failing test**

Create `backend/tests/test_wikipedia_drafter.py`:

```python
"""Tests for the Wikipedia drafter."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.wikipedia.drafter import (
    ArticleNotFoundError,
    TitleMismatchError,
    draft_candidate,
)


@pytest_asyncio.fixture
async def drafter_setup(db_session: AsyncSession) -> tuple[Brand, Prompt, WikipediaCandidate]:
    user = User(
        email="wiki_drafter@example.com",
        password_hash="x",
        name="D",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="drafter-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id,
        prompt_id=prompt.id,
        scan_id=scan.id,
        article_title="Brand visibility in LLMs",
        article_url="https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        pageid=1001,
        article_summary="...",
        legitimacy_score=0.82,
        legitimacy_reasoning="ok",
        status="new",
    )
    db_session.add(candidate)
    await db_session.commit()
    return brand, prompt, candidate


@pytest.mark.asyncio
async def test_draft_candidate_happy_path(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup
    parsed = (
        "Brand visibility in LLMs",
        "https://en.wikipedia.org/wiki/Brand_visibility_in_LLMs",
        "History",
        "end of section",
        "Brand visibility tracking emerged in the early 2020s.<ref>{{cite web|url=https://acme.example|title=…}}</ref>",
    )

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("== History ==\nFoo.\n", ["History", "Methodology"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw-llm-output")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=parsed
    ):
        result = await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.suggested_wikitext.startswith("Brand visibility tracking emerged")
    assert refreshed.suggested_section == "History"
    assert refreshed.suggested_insert_location == "end of section"
    assert refreshed.status == "drafted"
    assert refreshed.last_drafted_at is not None
    assert result.id == candidate.id


@pytest.mark.asyncio
async def test_draft_candidate_preserves_user_status(db_session: AsyncSession, drafter_setup) -> None:
    """Regenerating a draft for a candidate already marked 'submitted' must not reset status."""
    brand, prompt, candidate = drafter_setup
    candidate.status = "submitted"
    await db_session.commit()

    parsed = ("Brand visibility in LLMs", "url", "Methodology", "after lead paragraph", "New text.")

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("body", ["History", "Methodology"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch("app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=parsed):
        await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.status == "submitted"
    assert refreshed.suggested_wikitext == "New text."


@pytest.mark.asyncio
async def test_draft_candidate_article_missing(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("", [])),
    ):
        with pytest.raises(ArticleNotFoundError):
            await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")

    refreshed = (await db_session.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate.id))).scalar_one()
    assert refreshed.status == "dismissed"


@pytest.mark.asyncio
async def test_draft_candidate_title_mismatch_retries_then_errors(db_session: AsyncSession, drafter_setup) -> None:
    brand, prompt, candidate = drafter_setup
    mismatch_parsed = ("Some other article", "url", "Section", "loc", "text")

    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("body", ["S"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft", return_value=mismatch_parsed
    ):
        with pytest.raises(TitleMismatchError):
            await draft_candidate(db_session, candidate_id=candidate.id, tier="starter")
```

- [ ] **Step 8.2: Run, expect failure**

```bash
./venv/bin/pytest tests/test_wikipedia_drafter.py -v
```

Expected: import errors.

- [ ] **Step 8.3: Create drafter**

Create `backend/app/services/wikipedia/drafter.py`:

```python
"""Wikipedia drafter — produces a locked-article suggested edit for a candidate."""
from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    WikipediaCandidate,
)
from app.services.drafting.client import call_claude
from app.services.drafting.evidence import build_evidence_pack
from app.services.drafting.models import writer_model_for_tier
from app.services.drafting.pipeline import parse_wikipedia_draft
from app.services.drafting.prompts import build_wikipedia_prompt
from app.services.drafting_service import _analyze_responses_for_prompt, _extract_publications, _load_profile_context
from app.services.wikipedia.api_client import fetch_wikitext_and_sections

logger = logging.getLogger(__name__)


class ArticleNotFoundError(Exception):
    """Article has been deleted or renamed since the scan."""


class TitleMismatchError(Exception):
    """LLM returned wikitext for a different article than the locked title."""


_TITLE_NORMALIZE_RE = re.compile(r"[\s_]+")


def _normalize_title(t: str) -> str:
    return _TITLE_NORMALIZE_RE.sub(" ", (t or "").strip().lower())


def _extract_citation_needed(wikitext: str) -> list[str]:
    """Return a short list of context strings around each {{citation needed}} template."""
    hints: list[str] = []
    for match in re.finditer(r"\{\{citation needed[^}]*\}\}", wikitext, flags=re.IGNORECASE):
        start = max(match.start() - 80, 0)
        end = min(match.end() + 20, len(wikitext))
        snippet = wikitext[start:end].strip().replace("\n", " ")
        hints.append(snippet)
        if len(hints) >= 5:
            break
    return hints


async def _call_writer(prompt: str, *, tier: str | None) -> str:
    return (await call_claude(prompt=prompt, max_tokens=1500, model=writer_model_for_tier(tier))).strip()


async def draft_candidate(
    db: AsyncSession,
    *,
    candidate_id: int,
    tier: str | None,
) -> WikipediaCandidate:
    """Produce a suggested wikitext edit for the candidate. Persists in place."""
    candidate = (await db.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate_id))).scalar_one()
    brand = (await db.execute(select(Brand).where(Brand.id == candidate.brand_id))).scalar_one()
    profile = (await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))).scalar_one_or_none()
    prompt_row = None
    if candidate.prompt_id:
        prompt_row = (await db.execute(select(Prompt).where(Prompt.id == candidate.prompt_id))).scalar_one_or_none()

    # Fetch current article state
    wikitext, sections = await fetch_wikitext_and_sections(candidate.pageid)
    if not wikitext:
        candidate.status = "dismissed"
        candidate.last_status_change_at = datetime.now(UTC)
        await db.commit()
        raise ArticleNotFoundError(f"Article '{candidate.article_title}' (pageid {candidate.pageid}) is no longer available")

    cn_hints = _extract_citation_needed(wikitext)

    # Build inputs
    profile_context = await _load_profile_context(db, brand.id) if hasattr(__import__("app.services.drafting_service", fromlist=["_load_profile_context"]), "_load_profile_context") else f"Name: {brand.name}"
    prompt_text = prompt_row.text if prompt_row else candidate.article_title
    response_analysis = await _analyze_responses_for_prompt(db, brand.id, prompt_row.id) if prompt_row else ""
    publications = _extract_publications(profile) if profile else []
    evidence_pack = None
    if prompt_row is not None:
        try:
            evidence_pack = await build_evidence_pack(db, brand_id=brand.id, prompt_id=prompt_row.id)
        except Exception:
            logger.exception("build_evidence_pack failed for prompt %d (non-fatal)", prompt_row.id)

    locked_title = candidate.article_title

    async def _generate_once(extra_lock_hint: bool = False) -> tuple:
        prompt_for_llm = build_wikipedia_prompt(
            brand_name=brand.name,
            prompt_text=prompt_text,
            profile_context=profile_context,
            response_analysis=response_analysis,
            publications=publications,
            website_url=brand.website_url,
            evidence_pack=evidence_pack,
            locked_article_title=locked_title + (" — DO NOT SUBSTITUTE" if extra_lock_hint else ""),
            article_section_list=sections,
            citation_needed_hints=cn_hints,
        )
        raw = await _call_writer(prompt_for_llm, tier=tier)
        return parse_wikipedia_draft(raw)

    article_title, article_url, section, insert_location, wiki_text = await _generate_once()

    if _normalize_title(article_title) != _normalize_title(locked_title):
        # One auto-retry with a stronger instruction
        article_title, article_url, section, insert_location, wiki_text = await _generate_once(extra_lock_hint=True)
        if _normalize_title(article_title) != _normalize_title(locked_title):
            raise TitleMismatchError(
                f"LLM produced wikitext for '{article_title}' but candidate locked to '{locked_title}'"
            )

    # Persist
    candidate.suggested_wikitext = wiki_text
    candidate.suggested_section = section
    candidate.suggested_insert_location = insert_location
    candidate.last_drafted_at = datetime.now(UTC)
    if evidence_pack and evidence_pack.sources:
        candidate.evidence_pack_used = {"source_refs": [s.ref for s in evidence_pack.sources]}
    if candidate.status == "new":
        candidate.status = "drafted"
        candidate.last_status_change_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(candidate)
    return candidate
```

- [ ] **Step 8.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_drafter.py -v
```

Expected: 4 pass.

- [ ] **Step 8.5: Commit**

```bash
git add backend/app/services/wikipedia/drafter.py backend/tests/test_wikipedia_drafter.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): drafter orchestrator with locked-title enforcement + retry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Tier gating and rolling-30-day caps

**Files:**
- Create: `backend/app/services/wikipedia/caps.py`
- Test: `backend/tests/test_wikipedia_caps.py`

- [ ] **Step 9.1: Write failing test**

Create `backend/tests/test_wikipedia_caps.py`:

```python
"""Tests for tier gating + rolling-30-day caps."""
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, User, WikipediaCandidate, WikipediaScan
from app.services.wikipedia.caps import (
    WIKIPEDIA_ENABLED_TIERS,
    is_tier_eligible,
    remaining_drafts_in_window,
    remaining_scans_in_window,
)


@pytest_asyncio.fixture
async def caps_brand(db_session: AsyncSession) -> tuple[User, Brand]:
    user = User(email="caps@example.com", password_hash="x", name="C", email_verified=True, subscription_tier="starter")
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="caps-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    return user, brand


def test_tier_eligibility() -> None:
    assert is_tier_eligible("starter", brand_type="standard")
    assert is_tier_eligible("pro", brand_type="standard")
    assert not is_tier_eligible(None, brand_type="standard")  # Free
    assert not is_tier_eligible("basic", brand_type="standard")  # Starter UI = basic key
    # Agency brands are always eligible regardless of subscription
    assert is_tier_eligible(None, brand_type="agency")
    assert is_tier_eligible("basic", brand_type="agency")


def test_enabled_tiers_constant_matches_spec() -> None:
    assert WIKIPEDIA_ENABLED_TIERS == {"starter", "pro"}


@pytest.mark.asyncio
async def test_remaining_scans_pro_unlimited(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    user.subscription_tier = "pro"
    await db_session.commit()
    assert await remaining_scans_in_window(db_session, brand_id=brand.id, tier="pro", brand_type="standard") is None  # None = unlimited


@pytest.mark.asyncio
async def test_remaining_scans_growth_caps_at_4(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC)
    # 3 scans in the last 30 days
    for i in range(3):
        db_session.add(
            WikipediaScan(
                brand_id=brand.id,
                status="completed",
                triggered_by=user.id,
                started_at=now - timedelta(days=i),
            )
        )
    await db_session.commit()
    remaining = await remaining_scans_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 1


@pytest.mark.asyncio
async def test_remaining_scans_growth_old_scans_dont_count(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC)
    db_session.add(
        WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id, started_at=now - timedelta(days=31))
    )
    await db_session.commit()
    remaining = await remaining_scans_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 4


@pytest.mark.asyncio
async def test_remaining_drafts_growth_counts_last_drafted_at(db_session: AsyncSession, caps_brand) -> None:
    user, brand = caps_brand
    now = datetime.now(UTC)
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    for i in range(5):
        db_session.add(
            WikipediaCandidate(
                brand_id=brand.id,
                scan_id=scan.id,
                article_title=f"Article_{i}",
                article_url=f"https://en.wikipedia.org/wiki/Article_{i}",
                pageid=i + 1,
                article_summary="x",
                legitimacy_score=0.9,
                legitimacy_reasoning="ok",
                status="drafted",
                last_drafted_at=now - timedelta(days=i),
            )
        )
    await db_session.commit()
    remaining = await remaining_drafts_in_window(db_session, brand_id=brand.id, tier="starter", brand_type="standard")
    assert remaining == 25  # 30 cap - 5 used
```

- [ ] **Step 9.2: Run, expect failure**

```bash
./venv/bin/pytest tests/test_wikipedia_caps.py -v
```

Expected: import errors.

- [ ] **Step 9.3: Create caps module**

Create `backend/app/services/wikipedia/caps.py`:

```python
"""Tier gating + rolling-30-day cap math for the Wikipedia surface."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WikipediaCandidate, WikipediaScan

WIKIPEDIA_ENABLED_TIERS: frozenset[str] = frozenset({"starter", "pro"})

# Per-tier caps over a rolling 30-day window. None = unlimited.
_SCAN_CAPS: dict[str, int | None] = {"starter": 4, "pro": None}
_DRAFT_CAPS: dict[str, int | None] = {"starter": 30, "pro": None}

WINDOW_DAYS = 30


def is_tier_eligible(tier: str | None, *, brand_type: str) -> bool:
    """Agency brands always eligible. Otherwise tier must be in WIKIPEDIA_ENABLED_TIERS."""
    if brand_type == "agency":
        return True
    if not tier:
        return False
    return tier in WIKIPEDIA_ENABLED_TIERS


def _window_start() -> datetime:
    return datetime.now(UTC) - timedelta(days=WINDOW_DAYS)


async def remaining_scans_in_window(
    db: AsyncSession, *, brand_id: int, tier: str | None, brand_type: str
) -> int | None:
    """Returns scans left in the 30-day window. None = unlimited."""
    if brand_type == "agency" or tier == "pro":
        return None
    cap = _SCAN_CAPS.get(tier or "")
    if cap is None:
        return None
    count = (
        await db.execute(
            select(func.count(WikipediaScan.id)).where(
                WikipediaScan.brand_id == brand_id,
                WikipediaScan.started_at >= _window_start(),
            )
        )
    ).scalar_one()
    return max(cap - int(count or 0), 0)


async def remaining_drafts_in_window(
    db: AsyncSession, *, brand_id: int, tier: str | None, brand_type: str
) -> int | None:
    if brand_type == "agency" or tier == "pro":
        return None
    cap = _DRAFT_CAPS.get(tier or "")
    if cap is None:
        return None
    count = (
        await db.execute(
            select(func.count(WikipediaCandidate.id)).where(
                WikipediaCandidate.brand_id == brand_id,
                WikipediaCandidate.last_drafted_at >= _window_start(),
            )
        )
    ).scalar_one()
    return max(cap - int(count or 0), 0)
```

- [ ] **Step 9.4: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_caps.py -v
```

Expected: 5 pass.

- [ ] **Step 9.5: Commit**

```bash
git add backend/app/services/wikipedia/caps.py backend/tests/test_wikipedia_caps.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): tier gating + rolling-30-day caps for scans and drafts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: API router

**Files:**
- Create: `backend/app/routers/wikipedia.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_wikipedia_routes.py`

- [ ] **Step 10.1: Write failing route tests**

Create `backend/tests/test_wikipedia_routes.py`:

```python
"""Tests for /api/wikipedia/* endpoints."""
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)


async def _auth_cookie_for(user: User) -> str:
    from datetime import UTC as _UTC, datetime as _dt, timedelta as _td
    import jwt as pyjwt
    secret = os.getenv("JWT_SECRET", "test-secret-key-for-wiki-32+chars-please")
    return pyjwt.encode({"sub": str(user.id), "exp": _dt.now(_UTC) + _td(hours=1)}, secret, algorithm="HS256")


@pytest_asyncio.fixture
async def auth_setup(db_session: AsyncSession, client: AsyncClient) -> tuple[User, Brand, Prompt]:
    user = User(
        email="wiki_routes@example.com",
        password_hash="x",
        name="R",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="routes-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="x"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()
    token = await _auth_cookie_for(user)
    client.cookies.set("clarity_token", token)
    return user, brand, prompt


@pytest.mark.asyncio
async def test_list_candidates_requires_auth(client: AsyncClient) -> None:
    r = await client.get("/api/wikipedia/1/candidates")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_candidates_empty(client: AsyncClient, auth_setup) -> None:
    user, brand, prompt = auth_setup
    r = await client.get(f"/api/wikipedia/{brand.id}/candidates")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_free_tier_blocked_with_402(client: AsyncClient, db_session: AsyncSession) -> None:
    user = User(email="free_wiki@example.com", password_hash="x", name="F", email_verified=True, subscription_tier=None)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="free-wiki-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    client.cookies.set("clarity_token", await _auth_cookie_for(user))
    r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 402


@pytest.mark.asyncio
async def test_scan_dispatches_background_task(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup

    with patch("app.routers.wikipedia.run_scan", new=AsyncMock()) as mock_scan:
        r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "running"


@pytest.mark.asyncio
async def test_scan_cap_exceeded_returns_429(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    now = datetime.now(UTC)
    for i in range(4):
        db_session.add(WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id, started_at=now - timedelta(days=i)))
    await db_session.commit()

    r = await client.post(f"/api/wikipedia/{brand.id}/scan")
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_draft_candidate_endpoint(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id, prompt_id=prompt.id, scan_id=scan.id,
        article_title="A", article_url="u", pageid=1, article_summary="s" * 200,
        legitimacy_score=0.8, legitimacy_reasoning="r", status="new",
    )
    db_session.add(candidate)
    await db_session.commit()

    async def fake_draft(db, *, candidate_id, tier):
        c = (await db.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate_id))).scalar_one()
        c.suggested_wikitext = "drafted text"
        c.status = "drafted"
        await db.commit()
        return c

    with patch("app.routers.wikipedia.draft_candidate", new=fake_draft):
        r = await client.post(f"/api/wikipedia/{brand.id}/candidates/{candidate.id}/draft")
    assert r.status_code == 200
    assert r.json()["suggested_wikitext"] == "drafted text"


@pytest.mark.asyncio
async def test_update_status_endpoint(client: AsyncClient, db_session: AsyncSession, auth_setup) -> None:
    user, brand, prompt = auth_setup
    scan = WikipediaScan(brand_id=brand.id, status="completed", triggered_by=user.id)
    db_session.add(scan)
    await db_session.flush()
    candidate = WikipediaCandidate(
        brand_id=brand.id, prompt_id=prompt.id, scan_id=scan.id,
        article_title="A", article_url="u", pageid=1, article_summary="s" * 200,
        legitimacy_score=0.8, legitimacy_reasoning="r", status="drafted",
        suggested_wikitext="x",
    )
    db_session.add(candidate)
    await db_session.commit()

    r = await client.patch(f"/api/wikipedia/{brand.id}/candidates/{candidate.id}/status", json={"status": "submitted"})
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


@pytest.mark.asyncio
async def test_cross_user_isolation_404(client: AsyncClient, db_session: AsyncSession) -> None:
    a = User(email="iso_a@example.com", password_hash="x", name="A", email_verified=True, subscription_tier="starter")
    b = User(email="iso_b@example.com", password_hash="x", name="B", email_verified=True, subscription_tier="starter")
    db_session.add(a)
    db_session.add(b)
    await db_session.flush()
    brand_b = Brand(name="B", slug="iso-b", user_id=b.id)
    db_session.add(brand_b)
    await db_session.commit()
    client.cookies.set("clarity_token", await _auth_cookie_for(a))
    r = await client.get(f"/api/wikipedia/{brand_b.id}/candidates")
    assert r.status_code == 404
```

- [ ] **Step 10.2: Run, expect failures (no router yet)**

```bash
./venv/bin/pytest tests/test_wikipedia_routes.py -v
```

Expected: all fail with 404.

- [ ] **Step 10.3: Create router**

Create `backend/app/routers/wikipedia.py`:

```python
"""Wikipedia surface API endpoints."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.dependencies import CurrentUser
from app.models import (
    Brand,
    WikipediaCandidate,
    WikipediaScan,
)
from app.schemas import (
    UpdateCandidateStatusRequest,
    WikipediaCandidateSchema,
    WikipediaScanSchema,
)
from app.services.wikipedia.caps import (
    is_tier_eligible,
    remaining_drafts_in_window,
    remaining_scans_in_window,
)
from app.services.wikipedia.drafter import (
    ArticleNotFoundError,
    TitleMismatchError,
    draft_candidate,
)
from app.services.wikipedia.scanner import run_scan

DbDep = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(prefix="/wikipedia", tags=["wikipedia"])


async def _ensure_brand_owned(db: AsyncSession, brand_id: int, user_id: int) -> Brand:
    brand = (
        await db.execute(select(Brand).where(Brand.id == brand_id, Brand.user_id == user_id))
    ).scalar_one_or_none()
    if brand is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Brand not found")
    return brand


def _enforce_tier(user: CurrentUser, brand: Brand) -> str | None:
    tier = user.subscription_tier
    if not is_tier_eligible(tier, brand_type=brand.brand_type or "standard"):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Wikipedia surface requires Growth or Pro")
    return tier


@router.get("/{brand_id}/candidates", response_model=list[WikipediaCandidateSchema])
async def list_candidates(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    status: str | None = None,
    min_score: float | None = None,
) -> list[WikipediaCandidate]:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    _enforce_tier(user, brand)
    stmt = select(WikipediaCandidate).where(WikipediaCandidate.brand_id == brand_id)
    if status:
        stmt = stmt.where(WikipediaCandidate.status == status)
    if min_score is not None:
        stmt = stmt.where(WikipediaCandidate.legitimacy_score >= min_score)
    stmt = stmt.order_by(desc(WikipediaCandidate.legitimacy_score))
    return list((await db.execute(stmt)).scalars().all())


@router.get("/{brand_id}/candidates/{candidate_id}", response_model=WikipediaCandidateSchema)
async def get_candidate(
    brand_id: int,
    candidate_id: int,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    return candidate


@router.post("/{brand_id}/scan", response_model=WikipediaScanSchema, status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    background: BackgroundTasks,
) -> WikipediaScan:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    tier = _enforce_tier(user, brand)

    remaining = await remaining_scans_in_window(db, brand_id=brand_id, tier=tier, brand_type=brand.brand_type or "standard")
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Scan cap exceeded for this 30-day window")

    # Seed the scan row synchronously so the response carries an id, then run the rest in the background
    scan = WikipediaScan(
        brand_id=brand_id, status="running", triggered_by=user.id, started_at=datetime.now(UTC)
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    async def _bg() -> None:
        async with AsyncSessionLocal() as bg_db:
            try:
                # The run_scan helper creates its own row; we override by passing through:
                await run_scan(bg_db, brand_id=brand_id, triggered_by=user.id)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("background scan failed for brand %d", brand_id)

    background.add_task(_bg)
    return scan


@router.get("/{brand_id}/scans/latest", response_model=WikipediaScanSchema | None)
async def get_latest_scan(brand_id: int, db: DbDep, user: CurrentUser) -> WikipediaScan | None:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    _enforce_tier(user, brand)
    return (
        await db.execute(
            select(WikipediaScan).where(WikipediaScan.brand_id == brand_id).order_by(desc(WikipediaScan.id)).limit(1)
        )
    ).scalar_one_or_none()


@router.post("/{brand_id}/candidates/{candidate_id}/draft", response_model=WikipediaCandidateSchema)
async def draft_endpoint(
    brand_id: int,
    candidate_id: int,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    tier = _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")

    remaining = await remaining_drafts_in_window(
        db, brand_id=brand_id, tier=tier, brand_type=brand.brand_type or "standard"
    )
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Draft cap exceeded for this 30-day window")

    try:
        return await draft_candidate(db, candidate_id=candidate.id, tier=tier)
    except ArticleNotFoundError as e:
        raise HTTPException(status.HTTP_410_GONE, str(e))
    except TitleMismatchError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.patch("/{brand_id}/candidates/{candidate_id}/status", response_model=WikipediaCandidateSchema)
async def update_status_endpoint(
    brand_id: int,
    candidate_id: int,
    request: UpdateCandidateStatusRequest,
    db: DbDep,
    user: CurrentUser,
) -> WikipediaCandidate:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    _enforce_tier(user, brand)
    candidate = (
        await db.execute(
            select(WikipediaCandidate).where(
                WikipediaCandidate.id == candidate_id, WikipediaCandidate.brand_id == brand_id
            )
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    candidate.status = request.status
    candidate.last_status_change_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(candidate)
    return candidate
```

- [ ] **Step 10.4: Mount in `backend/app/main.py`**

In the router imports block (near line 60-72 with the other `from app.routers import X as X_router` lines):

```python
from app.routers import wikipedia as wikipedia_router
```

In the mount section (near line 215 with the other `app.include_router(...)` calls):

```python
app.include_router(wikipedia_router.router, prefix="/api")
```

- [ ] **Step 10.5: Run, expect pass**

```bash
./venv/bin/pytest tests/test_wikipedia_routes.py -v
```

Expected: 7 pass.

- [ ] **Step 10.6: Commit**

```bash
git add backend/app/routers/wikipedia.py backend/app/main.py backend/tests/test_wikipedia_routes.py
git commit -m "$(cat <<'EOF'
feat(wikipedia): API router — list, detail, scan, latest, draft, status

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: End-to-end smoke test

**Files:**
- Create: `backend/tests/test_wikipedia_e2e.py`

- [ ] **Step 11.1: Write the smoke test**

Create `backend/tests/test_wikipedia_e2e.py`:

```python
"""End-to-end smoke test: scan → list → draft → status."""
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    User,
    WikipediaCandidate,
    WikipediaScan,
)


@pytest_asyncio.fixture
async def e2e_setup(db_session: AsyncSession, client: AsyncClient) -> tuple[User, Brand, Prompt]:
    import jwt as pyjwt
    user = User(
        email="wiki_e2e@example.com",
        password_hash="x",
        name="E",
        email_verified=True,
        subscription_tier="starter",
    )
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="wiki-e2e-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLM citations"))
    prompt = Prompt(brand_id=brand.id, text="Brand visibility in LLMs", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()
    secret = os.getenv("JWT_SECRET", "test-secret-key-for-wiki-e2e-32+chars")
    token = pyjwt.encode({"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(hours=1)}, secret, algorithm="HS256")
    client.cookies.set("clarity_token", token)
    return user, brand, prompt


@pytest.mark.asyncio
async def test_full_wikipedia_lifecycle(client: AsyncClient, db_session: AsyncSession, e2e_setup) -> None:
    user, brand, prompt = e2e_setup

    search_results = [{"title": "Brand visibility in LLMs", "pageid": 1001, "snippet": "..."}]
    extract = (
        "Brand visibility in LLMs",
        "Brand visibility tracking is an emerging discipline focused on how brands appear in AI-generated answers. Practitioners use specialized tools to monitor citation rates across ChatGPT, Claude, Perplexity, and Gemini.",
    )

    # 1. Trigger scan (mocked to run synchronously via FastAPI's BackgroundTasks in the test client)
    with patch("app.services.wikipedia.scanner.search_articles", new=AsyncMock(return_value=search_results)), patch(
        "app.services.wikipedia.scanner.fetch_lead_extract", new=AsyncMock(return_value=extract)
    ), patch(
        "app.services.wikipedia.scanner.score_candidate",
        new=AsyncMock(return_value=(0.82, "Topic matches.")),
    ):
        r1 = await client.post(f"/api/wikipedia/{brand.id}/scan")
        assert r1.status_code == 202

    # 2. List candidates — should have 1
    r2 = await client.get(f"/api/wikipedia/{brand.id}/candidates")
    assert r2.status_code == 200
    candidates = r2.json()
    assert len(candidates) == 1
    candidate_id = candidates[0]["id"]
    assert candidates[0]["status"] == "new"

    # 3. Generate draft
    with patch(
        "app.services.wikipedia.drafter.fetch_wikitext_and_sections",
        new=AsyncMock(return_value=("== History ==\nFoo.", ["History"])),
    ), patch(
        "app.services.wikipedia.drafter._call_writer", new=AsyncMock(return_value="raw")
    ), patch(
        "app.services.wikipedia.drafter.parse_wikipedia_draft",
        return_value=("Brand visibility in LLMs", "url", "History", "end of section", "Suggested text."),
    ):
        r3 = await client.post(f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/draft")
    assert r3.status_code == 200
    assert r3.json()["suggested_wikitext"] == "Suggested text."
    assert r3.json()["status"] == "drafted"

    # 4. Mark as submitted
    r4 = await client.patch(
        f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/status",
        json={"status": "submitted"},
    )
    assert r4.status_code == 200
    assert r4.json()["status"] == "submitted"

    # 5. Mark as accepted
    r5 = await client.patch(
        f"/api/wikipedia/{brand.id}/candidates/{candidate_id}/status",
        json={"status": "accepted"},
    )
    assert r5.status_code == 200
    assert r5.json()["status"] == "accepted"
```

- [ ] **Step 11.2: Run**

```bash
./venv/bin/pytest tests/test_wikipedia_e2e.py -v
```

Expected: 1 pass.

- [ ] **Step 11.3: Run full Wikipedia suite as regression**

```bash
./venv/bin/pytest tests/test_wikipedia_*.py -q 2>&1 | tail -3
```

Expected: 30+ pass, 0 fail.

- [ ] **Step 11.4: Commit**

```bash
git add backend/tests/test_wikipedia_e2e.py
git commit -m "$(cat <<'EOF'
test(wikipedia): end-to-end smoke covering scan -> list -> draft -> status

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend API client functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 12.1: Append types and functions**

Append at the end of `frontend/lib/api.ts`:

```typescript
// ----- Wikipedia Surface -----

export interface WikipediaScan {
  id: number;
  brand_id: number;
  status: 'running' | 'completed' | 'failed';
  triggered_by: number | null;
  prompts_searched: number;
  total_candidates_found: number;
  candidates_persisted: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface WikipediaCandidate {
  id: number;
  brand_id: number;
  prompt_id: number | null;
  scan_id: number;
  article_title: string;
  article_url: string;
  pageid: number;
  article_summary: string;
  legitimacy_score: number;
  legitimacy_reasoning: string;
  status: 'new' | 'drafted' | 'submitted' | 'accepted' | 'reverted' | 'dismissed';
  suggested_wikitext: string | null;
  suggested_section: string | null;
  suggested_insert_location: string | null;
  evidence_pack_used: Record<string, unknown> | null;
  last_drafted_at: string | null;
  last_status_change_at: string | null;
  created_at: string;
}

export type WikipediaCandidateStatusUpdate = 'submitted' | 'accepted' | 'reverted' | 'dismissed';

export async function listWikipediaCandidates(
  brandId: number,
  opts?: { status?: WikipediaCandidate['status']; minScore?: number },
): Promise<WikipediaCandidate[]> {
  const params: Record<string, string | number> = {};
  if (opts?.status) params.status = opts.status;
  if (opts?.minScore != null) params.min_score = opts.minScore;
  const res = await api.get<WikipediaCandidate[]>(`/wikipedia/${brandId}/candidates`, { params });
  return res.data;
}

export async function getWikipediaCandidate(brandId: number, candidateId: number): Promise<WikipediaCandidate> {
  const res = await api.get<WikipediaCandidate>(`/wikipedia/${brandId}/candidates/${candidateId}`);
  return res.data;
}

export async function scanWikipedia(brandId: number): Promise<WikipediaScan> {
  const res = await api.post<WikipediaScan>(`/wikipedia/${brandId}/scan`);
  return res.data;
}

export async function getLatestWikipediaScan(brandId: number): Promise<WikipediaScan | null> {
  const res = await api.get<WikipediaScan | null>(`/wikipedia/${brandId}/scans/latest`);
  return res.data;
}

export async function draftWikipediaCandidate(brandId: number, candidateId: number): Promise<WikipediaCandidate> {
  const res = await api.post<WikipediaCandidate>(`/wikipedia/${brandId}/candidates/${candidateId}/draft`);
  return res.data;
}

export async function updateWikipediaCandidateStatus(
  brandId: number,
  candidateId: number,
  status: WikipediaCandidateStatusUpdate,
): Promise<WikipediaCandidate> {
  const res = await api.patch<WikipediaCandidate>(`/wikipedia/${brandId}/candidates/${candidateId}/status`, { status });
  return res.data;
}
```

- [ ] **Step 12.2: Build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 12.3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(wikipedia): frontend API client functions + types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `SuggestedEditPanel` component

**Files:**
- Create: `frontend/components/wikipedia/SuggestedEditPanel.tsx`

- [ ] **Step 13.1: Create component**

```tsx
'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, AlertCircle } from 'lucide-react';
import {
  updateWikipediaCandidateStatus,
  type WikipediaCandidate,
  type WikipediaCandidateStatusUpdate,
} from '@/lib/api';

interface Props {
  brandId: number;
  candidate: WikipediaCandidate;
  onUpdated: (c: WikipediaCandidate) => void;
}

export function SuggestedEditPanel({ brandId, candidate, onUpdated }: Props) {
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!candidate.suggested_wikitext) return null;

  async function copyText() {
    if (!candidate.suggested_wikitext) return;
    await navigator.clipboard.writeText(candidate.suggested_wikitext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function updateStatus(status: WikipediaCandidateStatusUpdate) {
    setUpdating(true);
    try {
      const updated = await updateWikipediaCandidateStatus(brandId, candidate.id, status);
      onUpdated(updated);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Insert into section: <span className="font-medium text-slate-800">{candidate.suggested_section ?? '(unspecified)'}</span>
        {candidate.suggested_insert_location && (
          <>
            {' · '}Position: <span className="font-medium text-slate-800">{candidate.suggested_insert_location}</span>
          </>
        )}
      </div>

      <pre className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-xs text-slate-800">
        {candidate.suggested_wikitext}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyText}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy wikitext'}
        </button>
        <a
          href={candidate.article_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          <ExternalLink className="h-3 w-3" />
          Open Wikipedia to edit
        </a>
      </div>

      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          COI reminder: Disclose your affiliation on the article talk page before editing. We do not post to Wikipedia for you.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {candidate.status === 'drafted' && (
          <button
            type="button"
            onClick={() => updateStatus('submitted')}
            disabled={updating}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            I submitted this ✓
          </button>
        )}
        {candidate.status === 'submitted' && (
          <>
            <button
              type="button"
              onClick={() => updateStatus('accepted')}
              disabled={updating}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Mark accepted
            </button>
            <button
              type="button"
              onClick={() => updateStatus('reverted')}
              disabled={updating}
              className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
            >
              Mark reverted
            </button>
          </>
        )}
        {candidate.status !== 'dismissed' && (
          <button
            type="button"
            onClick={() => updateStatus('dismissed')}
            disabled={updating}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 13.3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/components/wikipedia/SuggestedEditPanel.tsx
git commit -m "$(cat <<'EOF'
feat(wikipedia): SuggestedEditPanel component (wikitext + copy + status)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `CandidateCard` component

**Files:**
- Create: `frontend/components/wikipedia/CandidateCard.tsx`

- [ ] **Step 14.1: Create component**

```tsx
'use client';

import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { draftWikipediaCandidate, type WikipediaCandidate } from '@/lib/api';
import { SuggestedEditPanel } from './SuggestedEditPanel';

interface Props {
  brandId: number;
  candidate: WikipediaCandidate;
  onUpdated: (c: WikipediaCandidate) => void;
}

const STATUS_LABEL: Record<WikipediaCandidate['status'], string> = {
  new: 'New',
  drafted: 'Drafted',
  submitted: 'Submitted',
  accepted: 'Accepted',
  reverted: 'Reverted',
  dismissed: 'Dismissed',
};

const STATUS_TONE: Record<WikipediaCandidate['status'], string> = {
  new: 'bg-slate-100 text-slate-700',
  drafted: 'bg-sky-100 text-sky-800',
  submitted: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  reverted: 'bg-rose-100 text-rose-800',
  dismissed: 'bg-slate-100 text-slate-400',
};

export function CandidateCard({ brandId, candidate, onUpdated }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(candidate.status !== 'new');
  const [error, setError] = useState<string | null>(null);

  async function generateDraft() {
    setDrafting(true);
    setError(null);
    try {
      const updated = await draftWikipediaCandidate(brandId, candidate.id);
      onUpdated(updated);
      setExpanded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate draft';
      setError(msg);
    } finally {
      setDrafting(false);
    }
  }

  const score = Math.round(candidate.legitimacy_score * 100);
  const isLocked = candidate.status === 'accepted' || candidate.status === 'dismissed';

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-opacity ${isLocked ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-mono font-semibold text-white">
              <Star className="h-3 w-3" /> {score}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[candidate.status]}`}>
              {STATUS_LABEL[candidate.status]}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-900">
            <a href={candidate.article_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {candidate.article_title}
            </a>
          </h3>
          <p className="mt-1 text-xs text-slate-500 truncate">↗ {candidate.article_url}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700 line-clamp-3">{candidate.article_summary}</p>

      <p className="mt-2 text-xs text-slate-500 italic">
        Why this fits: {candidate.legitimacy_reasoning}
      </p>

      {!candidate.suggested_wikitext && candidate.status === 'new' && (
        <div className="mt-4">
          <button
            type="button"
            onClick={generateDraft}
            disabled={drafting}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {drafting && <Loader2 className="h-3 w-3 animate-spin" />}
            {drafting ? 'Generating…' : 'Generate suggested edit →'}
          </button>
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
      )}

      {candidate.suggested_wikitext && (
        <>
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-4 text-sm font-medium text-sky-700 hover:text-sky-900"
            >
              View suggested edit →
            </button>
          ) : (
            <SuggestedEditPanel brandId={brandId} candidate={candidate} onUpdated={onUpdated} />
          )}
          {(candidate.status === 'drafted' || candidate.status === 'reverted') && (
            <button
              type="button"
              onClick={generateDraft}
              disabled={drafting}
              className="mt-2 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {drafting ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 14.2: Build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 14.3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/components/wikipedia/CandidateCard.tsx
git commit -m "$(cat <<'EOF'
feat(wikipedia): CandidateCard component (all status states)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `ScanButton` component

**Files:**
- Create: `frontend/components/wikipedia/ScanButton.tsx`

- [ ] **Step 15.1: Create component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getLatestWikipediaScan, scanWikipedia, type WikipediaScan } from '@/lib/api';

interface Props {
  brandId: number;
  onScanCompleted: () => void;
}

const POLL_INTERVAL_MS = 3000;

export function ScanButton({ brandId, onScanCompleted }: Props) {
  const [scan, setScan] = useState<WikipediaScan | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch + poll while running
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const latest = await getLatestWikipediaScan(brandId);
        if (cancelled) return;
        setScan(latest);
        if (latest && latest.status === 'running') {
          intervalId ??= setInterval(refresh, POLL_INTERVAL_MS);
        } else if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
          if (latest && latest.status === 'completed') onScanCompleted();
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch scan status');
      }
    }

    refresh();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [brandId, onScanCompleted]);

  async function trigger() {
    setTriggering(true);
    setError(null);
    try {
      const newScan = await scanWikipedia(brandId);
      setScan(newScan);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setTriggering(false);
    }
  }

  const isRunning = scan?.status === 'running' || triggering;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={trigger}
        disabled={isRunning}
        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {isRunning ? 'Scanning…' : 'Scan Wikipedia'}
      </button>
      {scan?.status === 'running' && (
        <span className="text-xs text-slate-500">
          Searching {scan.prompts_searched || '…'} prompts
        </span>
      )}
      {scan?.status === 'completed' && scan.completed_at && (
        <span className="text-xs text-slate-500">
          Last scan: {new Date(scan.completed_at).toLocaleString()} · {scan.candidates_persisted} candidates
        </span>
      )}
      {scan?.status === 'failed' && (
        <span className="text-xs text-rose-700">Last scan failed{scan.error_message ? `: ${scan.error_message}` : ''}</span>
      )}
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 15.2: Build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 15.3: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/components/wikipedia/ScanButton.tsx
git commit -m "$(cat <<'EOF'
feat(wikipedia): ScanButton with polling for in-flight scans

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `WikipediaSurface` page container + routes

**Files:**
- Create: `frontend/components/wikipedia/WikipediaSurface.tsx`
- Create: `frontend/app/wiki/page.tsx`
- Create: `frontend/app/wiki/[brandId]/page.tsx`

- [ ] **Step 16.1: Create the surface component**

`frontend/components/wikipedia/WikipediaSurface.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listWikipediaCandidates, type WikipediaCandidate } from '@/lib/api';
import { CandidateCard } from './CandidateCard';
import { ScanButton } from './ScanButton';

interface Props {
  brandId: number;
}

type Filter = 'all' | WikipediaCandidate['status'];

const FILTERS: Filter[] = ['all', 'new', 'drafted', 'submitted', 'accepted', 'reverted'];

export function WikipediaSurface({ brandId }: Props) {
  const [candidates, setCandidates] = useState<WikipediaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWikipediaCandidates(brandId);
      setCandidates(data);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (brandId) refresh();
  }, [brandId, refresh]);

  function onCandidateUpdated(updated: WikipediaCandidate) {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  const visible = candidates.filter((c) => {
    if (c.status === 'dismissed' && !showDismissed) return false;
    if (filter !== 'all' && c.status !== filter) return false;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Wikipedia opportunities</h1>
          <p className="mt-1 text-sm text-slate-500">
            Find existing Wikipedia pages where your brand can be cited authoritatively.
          </p>
        </div>
        <ScanButton brandId={brandId} onScanCompleted={refresh} />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {f}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="h-3 w-3"
          />
          Show dismissed
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-slate-700">
            {candidates.length === 0
              ? 'No scans yet. Click "Scan Wikipedia" to find candidate articles.'
              : 'No candidates match this filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {visible.map((c) => (
            <CandidateCard key={c.id} brandId={brandId} candidate={c} onUpdated={onCandidateUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 16.2: Create `/wiki/[brandId]/page.tsx`**

```tsx
'use client';

import { useParams } from 'next/navigation';
import { WikipediaSurface } from '@/components/wikipedia/WikipediaSurface';

export default function WikipediaBrandPage() {
  const params = useParams<{ brandId: string }>();
  const brandId = Number(params?.brandId);
  if (!Number.isFinite(brandId)) return null;
  return <WikipediaSurface brandId={brandId} />;
}
```

- [ ] **Step 16.3: Create `/wiki/page.tsx`** — redirect to brand-scoped surface

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/contexts/BrandContext';

export default function WikipediaIndexPage() {
  const router = useRouter();
  const { activeBrandId, loading } = useBrand();

  useEffect(() => {
    if (loading) return;
    if (activeBrandId) router.replace(`/wiki/${activeBrandId}`);
  }, [loading, activeBrandId, router]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900">Wikipedia opportunities</h1>
      <p className="mt-2 text-sm text-slate-500">Select a brand to begin.</p>
    </div>
  );
}
```

- [ ] **Step 16.4: Build**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 16.5: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/components/wikipedia/WikipediaSurface.tsx frontend/app/wiki
git commit -m "$(cat <<'EOF'
feat(wikipedia): WikipediaSurface page + /wiki/[brandId] route

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Sidebar nav entry

**Files:**
- Modify: `frontend/components/Sidebar.tsx`

- [ ] **Step 17.1: Inspect the existing pattern**

```bash
grep -n "Site Audit\|subscription_tier" /Users/ken/Desktop/Lumidian/frontend/components/Sidebar.tsx | head -8
```

The Site Audit entry is rendered conditionally on `user?.subscription_tier`. Mirror that pattern for Wikipedia.

- [ ] **Step 17.2: Add the nav entry**

Find the `navItems` array (around line 115). Add the Wikipedia entry next to Site Audit, tier-gated to Growth or Pro (`starter` or `pro`):

```tsx
    ...(user?.subscription_tier === 'starter' || user?.subscription_tier === 'pro'
      ? [{ label: 'Wikipedia', href: '/wiki', icon: BookOpen }]
      : []),
```

Make sure `BookOpen` is imported from `lucide-react` at the top of the file. If not present, add it to the existing `import { ... } from 'lucide-react';` line.

- [ ] **Step 17.3: Build + manual check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build 2>&1 | grep -E "✓ Compiled|error" | tail -3
```

In dev (`npm run dev`), log in as a Growth user; verify "Wikipedia" appears in the sidebar. Log in as Free; verify it does NOT appear.

- [ ] **Step 17.4: Commit**

```bash
cd /Users/ken/Desktop/Lumidian && git add frontend/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(wikipedia): sidebar nav entry (Growth + Pro only)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Update CLAUDE.md and CURRENT_STATE.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CURRENT_STATE.md`

- [ ] **Step 18.1: CLAUDE.md — add to models table**

In `CLAUDE.md`, in the "Model Summary" table, add two rows after `BrandSource`:

```
| `WikipediaScan` | id, brand_id FK, status (running/completed/failed), triggered_by FK, prompts_searched, total_candidates_found, candidates_persisted, error_message, started_at, completed_at |
| `WikipediaCandidate` | id, brand_id FK, prompt_id FK (nullable), scan_id FK, article_title, article_url, pageid, article_summary, legitimacy_score, legitimacy_reasoning, status (new/drafted/submitted/accepted/reverted/dismissed), suggested_wikitext, suggested_section, suggested_insert_location, evidence_pack_used (JSON), last_drafted_at, last_status_change_at |
```

In the "Router Mounts" table, add:

```
| wikipedia.py | /api/wikipedia | Wikipedia surface: candidate list, scan trigger, on-demand draft, status update |
```

Under "Key Patterns", append a section:

```markdown
### Wikipedia Surface (`services/wikipedia/`)
Dedicated `/wiki/[brandId]` surface for discovering existing Wikipedia articles where a brand could legitimately contribute. Manual scan via `POST /api/wikipedia/{brand_id}/scan` queries the Wikipedia REST API for each tracked prompt, pre-filters obvious non-starters (disambiguation, list pages, brand-self, competitors, thin summaries), then runs `services/wikipedia/legitimacy_gate.py:score_candidate()` (one haiku call per candidate) and persists survivors above the 0.55 threshold as `WikipediaCandidate` rows. On-demand drafting via `POST /api/wikipedia/{brand_id}/candidates/{id}/draft` reuses `build_wikipedia_prompt()` with new `locked_article_title` / `article_section_list` / `citation_needed_hints` kwargs to constrain the LLM to a verified article. Status lifecycle is user-recorded (`new` → `drafted` → `submitted` → `accepted` / `reverted`); we never edit Wikipedia ourselves. Growth + Pro tier only, with rolling-30-day caps (Growth: 4 scans + 30 drafts; Pro: unlimited).
```

- [ ] **Step 18.2: CURRENT_STATE.md — update WIP + Decisions**

Replace the "Most recent work" line with:

```markdown
- **Most recent work:** **Wikipedia surface shipped on `feat/wikipedia-surface`.** Dedicated `/wiki/[brandId]` page with real Wikipedia API article discovery, LLM legitimacy gate (claude-haiku), on-demand wikitext generation via the existing `build_wikipedia_prompt` (extended with locked-title kwargs), and user-recorded status lifecycle. 2 new tables, 6 endpoints under `/api/wikipedia/*`, 4 new frontend components, sidebar entry. Growth + Pro tier with rolling-30-day caps. Specs: `docs/superpowers/specs/2026-05-18-wikipedia-surface-design.md`. Plan: `docs/superpowers/plans/2026-05-19-wikipedia-surface.md`.
- **Branch:** `feat/wikipedia-surface`
- **Next concrete step:** Merge to main when ready. Monitor first real scans against live brands; tune legitimacy threshold if candidate quality is off.
```

Append a new entry at the top of "Recent Decisions":

```markdown
- **2026-05-19** — Shipped **Wikipedia surface** (Phase 2 of content-hub consolidation) on `feat/wikipedia-surface`. Carved Wikipedia out of the marketing-content flow into its own discovery + on-demand draft surface. Real article discovery via the Wikipedia REST API (no hallucination), LLM legitimacy gate via claude-haiku, manual scan trigger only, user-recorded status lifecycle, Growth + Pro tier with caps. Reuses existing `build_wikipedia_prompt` + `parse_wikipedia_draft` primitives via new optional kwargs.
```

- [ ] **Step 18.3: Commit**

```bash
git add CLAUDE.md CURRENT_STATE.md
git commit -m "$(cat <<'EOF'
docs(wikipedia): update CLAUDE.md + CURRENT_STATE.md for Wikipedia surface

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

- [ ] **Backend suite**

```bash
cd /Users/ken/Desktop/Lumidian/backend && ./venv/bin/pytest -q 2>&1 | tail -5
```

Expected: all green. Investigate any failure before merging.

- [ ] **Frontend build + lint**

```bash
cd /Users/ken/Desktop/Lumidian/frontend && npm run build && npm run lint
```

Expected: no errors.

- [ ] **Manual smoke in dev**

Backend on port 3001, frontend on 3002. Steps:
1. Log in as a Growth/Pro user.
2. Confirm "Wikipedia" appears in the sidebar; log out and log in as Free, confirm it's hidden.
3. Open `/wiki/<your-brand-id>`. Empty state should show.
4. Hit "Scan Wikipedia" — wait for the scan banner to complete (real LLM calls, real Wikipedia API).
5. Verify candidates appear sorted by legitimacy_score desc. Each card shows title (linked), score, reasoning, status badge.
6. Click "Generate suggested edit" on a candidate. Confirm wikitext appears with copy button and COI reminder.
7. Click "I submitted this ✓" → status becomes `submitted`. Click "Mark accepted" → status becomes `accepted`, card greys out.
8. Re-scan: candidates with `accepted` status should NOT reset.
9. Filter chips: clicking "Submitted" filters to submitted candidates only. "Show dismissed" toggle reveals dismissed ones.

If anything is off, fix in a follow-up commit on the same branch.

---

## Notes for the implementing engineer

- **DRY:** all LLM calls go through `call_claude` from `app/services/drafting/client.py`. Model selection via `CROSS_REF_SUMMARY_MODEL` (legitimacy gate) or `writer_model_for_tier(tier)` (drafter). No raw model strings anywhere.
- **YAGNI:** revert-detection, scheduled scans, non-English Wikipedia, auto-COI-disclosure are all parked. Don't add them.
- **TDD:** every backend task has a failing-test step before the implementation step. Run the test, confirm the failure mode, then implement. Don't skip.
- **Tests use existing fixtures.** `db_session`, `client` (HTTPX AsyncClient) come from `tests/conftest.py`. Each cluster test file defines its own local user fixture with a unique email to avoid collisions; do the same here.
- **Rolling-30-day cap math:** if the user downgrades from Pro to Growth mid-month, scans that fired during the Pro window still count toward the new Growth cap (single counter, tier-agnostic). Acceptable; the spec calls this out.
- **Background scan task:** uses FastAPI's `BackgroundTasks` with a fresh `AsyncSessionLocal()` to avoid sharing the request's DB session. The scan response carries the seeded `WikipediaScan` row so the UI can poll `/scans/latest` immediately.
- **COI reminder is not optional.** Keep the warning text in `SuggestedEditPanel`; do not let designers strip it. Wikipedia's COI policy is real and the brand bears the legal/policy risk.
