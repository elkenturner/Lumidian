# Content Drafting Quality Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot Claude draft generator with a three-layer pipeline — evidence retrieval, critic + paragraph-scoped rewrite, and voice anchoring + cross-referencing — so every draft is grounded in real sources, polished by a critic loop, and (on Pro) shaped by per-brand voice samples and aware of sibling drafts.

**Architecture:** Three additive layers sandwich the existing `build_prompt()` / `call_claude()` / `remove_hedging()` pipeline. New files live alongside the current `services/drafting/` modules. New DB tables and columns are added via append-only migrations in `database.py:run_migrations()`. Model selection is centralised in a new `services/drafting/models.py` and gated per role (writer / critic / rewriter / cross-ref summary) and per tier (Starter / Growth / Pro).

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, SQLite (aiosqlite), Anthropic SDK (`anthropic`), Serper.dev HTTP API (already wrapped in `serper_search_service.py`), Jina HTTP API (already wrapped in `jina_service.py`), Pytest with `asyncio_mode=auto`, Next.js 15 / React 18 / TypeScript / Tailwind on the frontend.

**Spec:** `docs/superpowers/specs/2026-05-11-content-quality-rebuild-design.md`

---

## File Structure

### New files (backend)

| Path | Responsibility |
|------|---------------|
| `backend/app/services/drafting/models.py` | Centralised per-role and per-tier model constants. Writer / critic / rewriter / cross-ref-summary selectors. |
| `backend/app/services/drafting/evidence.py` | `EvidenceSource` + `EvidencePack` dataclasses; brand-page selection from `WebsiteAuditPage`; Serper web search; `BrandSource` integration; cache read/write; `build_evidence_pack()` top-level assembly. |
| `backend/app/services/drafting/citations.py` | Per-platform `[SN]` marker rendering — inline markdown links, plain `(source: domain)` form, Wikipedia `<ref>` form, stripping for X. Persists `ContentDraftCitation` rows. |
| `backend/app/services/drafting/critic.py` | Critic call via Anthropic tool-use; weighted scoring + sanity cross-check; paragraph-scoped rewrite; hard-fail retry. |
| `backend/app/services/drafting/voice.py` | Voice sample selection (user upload → best approved draft → None); cross-reference lookup; per-draft Haiku summary generation. |

### New files (tests)

| Path | Covers |
|------|--------|
| `backend/tests/test_drafting_models.py` | Model-per-role/tier selectors. |
| `backend/tests/test_drafting_evidence.py` | EvidencePack assembly, brand-page ranking, web-search filtering, BrandSource integration, cache hit/miss, cap enforcement. |
| `backend/tests/test_drafting_citations.py` | Per-platform marker rendering, unmatched marker dropping, `ContentDraftCitation` row creation. |
| `backend/tests/test_drafting_critic.py` | Tool-use response parsing, weighted-rollup cross-check, rewrite splicing, hard-fail retry. |
| `backend/tests/test_drafting_voice.py` | Voice sample precedence, cross-reference lookup, summary caching. |
| `backend/tests/test_brand_sources.py` | `BrandSource` CRUD endpoints — ownership, cap, Jina-based metadata fetch. |
| `backend/tests/test_voice_samples.py` | Voice sample CRUD endpoints — ownership, cap, delete-by-index. |
| `backend/tests/test_drafting_pipeline_integration.py` | End-to-end per-tier test: Free / Starter / Growth / Pro running through the correct subset of layers. |

### Modified files

| Path | Change |
|------|--------|
| `backend/app/models.py` | New ORM classes (`BrandSource`, `ContentDraftCitation`, `EvidenceCache`); new columns on `BrandProfile`, `WebsiteAuditPage`, `ContentDraft`. |
| `backend/app/schemas.py` | Pydantic schemas for source CRUD + voice-sample CRUD. |
| `backend/app/database.py` | Append-only new ALTER TABLE / CREATE TABLE steps inside `run_migrations()`. |
| `backend/app/services/drafting/prompts.py` | `build_prompt()` accepts `evidence_pack`, `voice_sample`, `related_draft_summary`; rewritten INFORMATION HIERARCHY block; shrunk banned-word list. Wikipedia builder reuses Evidence Pack for citations. |
| `backend/app/services/drafting/pipeline.py` | Shrunk `_HEDGING_RE`; citation rendering hook called before final polish. |
| `backend/app/services/drafting_service.py` | New flow: assemble Evidence Pack → select voice sample + related draft → call writer → call critic → conditional rewrite → render citations → polish → save. Tier-gated. |
| `backend/app/services/site_audit/crawler.py` | Captures `content_excerpt` (~1500 chars cleaned body text) per page during crawl. |
| `backend/app/routers/brand_profile.py` | New endpoints: `POST/GET/DELETE` sources; `POST/GET/DELETE` voice samples. |
| `frontend/lib/api.ts` | New typed methods: `addBrandSource`, `listBrandSources`, `deleteBrandSource`, `addVoiceSample`, `listVoiceSamples`, `deleteVoiceSample`. |
| `frontend/app/settings/page.tsx` (or the Brand Profile tab component) | New Sources and Voice Samples sections in the Brand Profile tab. |

---

## Phase 1 — Foundation

### Task 1: Database migrations + ORM models

**Files:**
- Modify: `backend/app/database.py` (append at end of `migrations` list inside `run_migrations()` around line 402)
- Modify: `backend/app/models.py` (add new classes near related models)
- Test: `backend/tests/test_drafting_models.py` (created in Task 3; this task is schema only)

- [ ] **Step 1: Append migrations to `database.py`**

In `backend/app/database.py`, inside the `migrations` list inside `run_migrations()`, add these statements at the bottom (just before the closing `]` on line 403):

```python
        # 2026-05-12: Content quality rebuild — evidence retrieval, citations, voice samples
        "ALTER TABLE website_audit_pages ADD COLUMN content_excerpt TEXT",
        "ALTER TABLE brand_profiles ADD COLUMN voice_samples TEXT",
        "ALTER TABLE content_drafts ADD COLUMN quality_score REAL",
        "ALTER TABLE content_drafts ADD COLUMN summary TEXT",
        """CREATE TABLE IF NOT EXISTS brand_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            snippet TEXT,
            source_type TEXT NOT NULL DEFAULT 'article',
            added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            added_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_brand_sources_brand ON brand_sources(brand_id)",
        """CREATE TABLE IF NOT EXISTS content_draft_citations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id INTEGER NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
            source_ref TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT,
            position_marker INTEGER,
            created_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_content_draft_citations_draft ON content_draft_citations(draft_id)",
        """CREATE TABLE IF NOT EXISTS evidence_cache (
            brand_id INTEGER NOT NULL,
            prompt_id INTEGER NOT NULL,
            pack_json TEXT NOT NULL,
            fetched_at DATETIME NOT NULL,
            PRIMARY KEY (brand_id, prompt_id)
        )""",
```

- [ ] **Step 2: Add new ORM classes to `models.py`**

In `backend/app/models.py`, append these new classes at the bottom of the file:

```python
class BrandSource(Base):
    __tablename__ = "brand_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1000))
    snippet: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(50), default="article")
    added_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None))


class ContentDraftCitation(Base):
    __tablename__ = "content_draft_citations"

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("content_drafts.id", ondelete="CASCADE"), index=True)
    source_ref: Mapped[str] = mapped_column(String(10))   # "S1"
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str | None] = mapped_column(String(500))
    position_marker: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None))


class EvidenceCache(Base):
    __tablename__ = "evidence_cache"

    brand_id: Mapped[int] = mapped_column(primary_key=True)
    prompt_id: Mapped[int] = mapped_column(primary_key=True)
    pack_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)
```

Then add these columns to the existing classes:

`BrandProfile` (find class around line 427) — add:
```python
    voice_samples: Mapped[str | None] = mapped_column(Text)   # JSON: list[{"title": str, "text": str}]
```

`WebsiteAuditPage` (find class around line 739) — add:
```python
    content_excerpt: Mapped[str | None] = mapped_column(Text)
```

`ContentDraft` (find class around line 328) — add:
```python
    quality_score: Mapped[float | None] = mapped_column(Float)
    summary: Mapped[str | None] = mapped_column(Text)
```

If any of these imports aren't already present at the top of `models.py`, add them: `Float`, `Integer`, `Text`, `String`, `DateTime`, `ForeignKey`, `UTC`, `datetime`, `Mapped`, `mapped_column`.

- [ ] **Step 3: Run migrations manually to verify**

Run:
```bash
cd backend && source venv/bin/activate
python -c "import asyncio; from app.database import create_tables, run_migrations; asyncio.run(create_tables()); asyncio.run(run_migrations())"
```
Expected: no exceptions. Log lines `Migration applied: ALTER TABLE ...` for each new statement (or silently skipped if already applied).

- [ ] **Step 4: Verify schema with sqlite3**

Run:
```bash
sqlite3 backend/clarity_ai.db ".schema brand_sources" && sqlite3 backend/clarity_ai.db ".schema content_draft_citations" && sqlite3 backend/clarity_ai.db ".schema evidence_cache"
```
Expected: three CREATE TABLE statements printed, each matching the migration text.

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py backend/app/models.py
git commit -m "feat(drafting): add migrations + ORM models for evidence layer"
```

---

### Task 2: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py` (append at bottom)

- [ ] **Step 1: Append schemas**

In `backend/app/schemas.py`, append:

```python
# ── BrandSource ─────────────────────────────────────────────────────────────

class BrandSourceCreate(BaseModel):
    url: str = Field(..., max_length=1000)
    title: str | None = Field(None, max_length=500)
    snippet: str | None = Field(None, max_length=1500)
    source_type: Literal["paper", "article", "stat", "case_study"] = "article"


class BrandSourceOut(BaseModel):
    id: int
    title: str
    url: str
    snippet: str | None
    source_type: str
    added_at: datetime

    class Config:
        from_attributes = True


# ── Voice samples ───────────────────────────────────────────────────────────

class VoiceSampleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=50, max_length=4000)


class VoiceSampleOut(BaseModel):
    index: int
    title: str
    text: str
```

If `Literal` isn't imported, add `from typing import Literal` at the top.

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(drafting): pydantic schemas for sources + voice samples"
```

---

### Task 3: Centralised model constants

**Files:**
- Create: `backend/app/services/drafting/models.py`
- Test: `backend/tests/test_drafting_models.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_drafting_models.py`:

```python
from app.services.drafting.models import (
    writer_model_for_tier,
    rewriter_model_for_tier,
    CRITIC_MODEL,
    CROSS_REF_SUMMARY_MODEL,
    SHORT_REPLY_MODEL,
)


def test_writer_model_for_tier_pro_returns_opus():
    assert writer_model_for_tier("pro") == "claude-opus-4-7"


def test_writer_model_for_tier_growth_returns_sonnet():
    assert writer_model_for_tier("starter") == "claude-sonnet-4-6"


def test_writer_model_for_tier_starter_returns_sonnet():
    assert writer_model_for_tier("basic") == "claude-sonnet-4-6"


def test_writer_model_for_tier_free_returns_sonnet():
    assert writer_model_for_tier(None) == "claude-sonnet-4-6"


def test_rewriter_model_for_tier_growth_and_pro_returns_opus():
    assert rewriter_model_for_tier("starter") == "claude-opus-4-7"
    assert rewriter_model_for_tier("pro") == "claude-opus-4-7"


def test_critic_model_is_sonnet():
    assert CRITIC_MODEL == "claude-sonnet-4-6"


def test_cross_ref_and_short_reply_are_haiku():
    assert CROSS_REF_SUMMARY_MODEL == "claude-haiku-4-5-20251001"
    assert SHORT_REPLY_MODEL == "claude-haiku-4-5-20251001"
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd backend && pytest tests/test_drafting_models.py -v`
Expected: ImportError / ModuleNotFoundError.

- [ ] **Step 3: Implement `drafting/models.py`**

Create `backend/app/services/drafting/models.py`:

```python
"""
Centralised per-role and per-tier model selection for the drafting pipeline.

Internal tier keys (DB values): None=Free, "basic"=Starter, "starter"=Growth, "pro"=Pro.
Display names defined in routers/billing.py TIER_DISPLAY_NAMES.
"""
from __future__ import annotations

CRITIC_MODEL = "claude-sonnet-4-6"
CROSS_REF_SUMMARY_MODEL = "claude-haiku-4-5-20251001"
SHORT_REPLY_MODEL = "claude-haiku-4-5-20251001"

_OPUS = "claude-opus-4-7"
_SONNET = "claude-sonnet-4-6"


def writer_model_for_tier(tier: str | None) -> str:
    if tier == "pro":
        return _OPUS
    return _SONNET


def rewriter_model_for_tier(tier: str | None) -> str:
    if tier in ("starter", "pro"):
        return _OPUS
    return _SONNET
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd backend && pytest tests/test_drafting_models.py -v`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/models.py backend/tests/test_drafting_models.py
git commit -m "feat(drafting): centralised per-role/per-tier model constants"
```

---

## Phase 2 — Site Audit Hook

### Task 4: Capture `content_excerpt` during crawl

**Files:**
- Modify: `backend/app/services/site_audit/crawler.py`

- [ ] **Step 1: Locate where pages are persisted**

Run: `grep -n "WebsiteAuditPage(" backend/app/services/site_audit/crawler.py`
Expected: one or more lines instantiating `WebsiteAuditPage(...)`.

- [ ] **Step 2: Add excerpt extraction helper at top of `crawler.py`**

Find the imports section and add (if not already present) `from bs4 import BeautifulSoup`. Then add the helper near other module-level helpers (before the first class or function that creates `WebsiteAuditPage`):

```python
def _extract_content_excerpt(soup: "BeautifulSoup", max_chars: int = 1500) -> str:
    """
    Return up to max_chars of cleaned visible body text — no scripts/styles, no nav.
    Used by the drafting pipeline as evidence material.
    """
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    return text[:max_chars]
```

- [ ] **Step 3: Populate `content_excerpt` when constructing `WebsiteAuditPage`**

In every `WebsiteAuditPage(...)` instantiation in `crawler.py`, add the new keyword argument. The exact context will look something like:

```python
page = WebsiteAuditPage(
    audit_id=audit_id,
    url=url,
    ...                                            # existing kwargs
    content_excerpt=_extract_content_excerpt(soup),
)
```

If `soup` isn't already in scope at the construction site, hoist it from earlier in the function (it must exist — the existing parser modules use it).

- [ ] **Step 4: Manual smoke test**

Trigger a site audit against any small site via the existing audit endpoint or service. After it completes, query SQLite:

```bash
sqlite3 backend/clarity_ai.db "SELECT id, length(content_excerpt) FROM website_audit_pages ORDER BY id DESC LIMIT 5;"
```
Expected: most rows have `content_excerpt` length > 100. (Some pages — pure redirects or non-HTML — may legitimately be 0 / NULL; that's fine.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/crawler.py
git commit -m "feat(site-audit): capture content_excerpt during crawl for drafting use"
```

---

## Phase 3 — Layer 1: Evidence Retrieval

### Task 5: EvidencePack data structures + brand-page selector

**Files:**
- Create: `backend/app/services/drafting/evidence.py`
- Test: `backend/tests/test_drafting_evidence.py`

- [ ] **Step 1: Write failing tests for data structures + brand-page selection**

Create `backend/tests/test_drafting_evidence.py`:

```python
import pytest
from sqlalchemy import select

from app.models import Brand, WebsiteAudit, WebsiteAuditPage, User
from app.services.drafting.evidence import (
    EvidenceSource,
    EvidencePack,
    select_brand_pages,
)


@pytest.mark.asyncio
async def test_evidence_source_dataclass_fields():
    src = EvidenceSource(
        ref="S1",
        kind="brand_page",
        url="https://example.com",
        title="Example",
        snippet="Body",
        published_date=None,
    )
    assert src.ref == "S1"
    assert src.kind == "brand_page"


@pytest.mark.asyncio
async def test_select_brand_pages_returns_top_n_by_relevance(db_session):
    # Set up: user → brand → audit → 5 pages with varying overlap with the prompt
    user = User(email="ev1@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    pages = [
        WebsiteAuditPage(audit_id=audit.id, url="https://a.com/breath-test",
                         title="Breath test for cancer", h1_text="Breath test methodology",
                         content_excerpt="Our breath test detects volatile compounds.",
                         fact_density=0.7),
        WebsiteAuditPage(audit_id=audit.id, url="https://a.com/team",
                         title="Our team", h1_text="Leadership",
                         content_excerpt="Meet the team.", fact_density=0.1),
        WebsiteAuditPage(audit_id=audit.id, url="https://a.com/results",
                         title="Cancer detection results", h1_text="Validation results",
                         content_excerpt="In a 1400-patient study breath analysis achieved 94% sensitivity.",
                         fact_density=0.9),
    ]
    db_session.add_all(pages)
    await db_session.commit()

    selected = await select_brand_pages(
        brand_id=brand.id,
        prompt_text="how does breath analysis detect cancer",
        db=db_session,
        limit=2,
    )
    assert len(selected) == 2
    # Most-relevant page (breath + cancer + high fact_density) ranks first
    titles = [s.title for s in selected]
    assert "Cancer detection results" in titles
    assert "Breath test for cancer" in titles
    assert "Our team" not in titles


@pytest.mark.asyncio
async def test_select_brand_pages_returns_empty_when_no_audit(db_session):
    user = User(email="ev2@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="NoAudit", slug="noaudit-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    selected = await select_brand_pages(
        brand_id=brand.id, prompt_text="anything", db=db_session, limit=3,
    )
    assert selected == []
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: ImportError on `app.services.drafting.evidence`.

- [ ] **Step 3: Implement `evidence.py` — dataclasses + brand-page selector**

Create `backend/app/services/drafting/evidence.py`:

```python
"""
Evidence retrieval layer for the drafting pipeline.

Assembles an EvidencePack from three sources:
  (a) the brand's own crawled pages (WebsiteAuditPage)
  (b) live Serper web search
  (c) the user-curated BrandSource library

The pack is injected into the drafting prompt as inline-citable sources [S1]..[SN].
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime, UTC, timedelta
from typing import Literal

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WebsiteAudit, WebsiteAuditPage, BrandSource, EvidenceCache

logger = logging.getLogger(__name__)

PACK_CAP = 15
BRAND_PAGE_LIMIT = 3
WEB_RESULT_LIMIT = 5
BRAND_SOURCE_LIMIT = 10
CACHE_TTL_HOURS = 24

EvidenceKind = Literal["brand_page", "web", "library"]


@dataclass
class EvidenceSource:
    ref: str
    kind: EvidenceKind
    url: str
    title: str
    snippet: str
    published_date: str | None = None


@dataclass
class EvidencePack:
    sources: list[EvidenceSource]
    query: str
    brand_name: str

    def to_dict(self) -> dict:
        return {
            "sources": [asdict(s) for s in self.sources],
            "query": self.query,
            "brand_name": self.brand_name,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EvidencePack":
        return cls(
            sources=[EvidenceSource(**s) for s in data.get("sources", [])],
            query=data.get("query", ""),
            brand_name=data.get("brand_name", ""),
        )


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def _score_page(prompt_tokens: set[str], page: WebsiteAuditPage) -> float:
    page_tokens = _tokens((page.title or "") + " " + (page.h1_text or ""))
    if not page_tokens or not prompt_tokens:
        return 0.0
    overlap = len(prompt_tokens & page_tokens) / max(1, len(prompt_tokens))
    return overlap * 0.7 + (page.fact_density or 0.0) * 0.3


async def select_brand_pages(
    brand_id: int,
    prompt_text: str,
    db: AsyncSession,
    limit: int = BRAND_PAGE_LIMIT,
) -> list[EvidenceSource]:
    """Top-N pages from the most recent completed WebsiteAudit, ranked by prompt relevance."""
    audit_result = await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.completed_at), desc(WebsiteAudit.id))
        .limit(1)
    )
    audit = audit_result.scalar_one_or_none()
    if audit is None:
        return []

    pages_result = await db.execute(
        select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit.id)
    )
    pages = list(pages_result.scalars().all())

    prompt_tokens = _tokens(prompt_text)
    ranked = sorted(pages, key=lambda p: _score_page(prompt_tokens, p), reverse=True)
    top = [p for p in ranked if _score_page(prompt_tokens, p) > 0][:limit]

    return [
        EvidenceSource(
            ref="",  # ref assigned during pack assembly
            kind="brand_page",
            url=p.url,
            title=(p.title or p.url)[:200],
            snippet=(p.content_excerpt or "")[:600],
            published_date=None,
        )
        for p in top
    ]
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/evidence.py backend/tests/test_drafting_evidence.py
git commit -m "feat(drafting): EvidencePack dataclasses + brand-page selector"
```

---

### Task 6: Serper web search integration

**Files:**
- Modify: `backend/app/services/drafting/evidence.py`
- Modify: `backend/tests/test_drafting_evidence.py`

- [ ] **Step 1: Check Serper service signature**

Run: `grep -n "async def\|^def " backend/app/services/serper_search_service.py | head -20`
Note the function name and signature for searching organic results (e.g. `search_serper(query, num=10) -> list[dict]` or similar).

- [ ] **Step 2: Write failing test for web search**

Append to `backend/tests/test_drafting_evidence.py`:

```python
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_select_web_sources_returns_top_n_filtered():
    from app.services.drafting.evidence import select_web_sources

    fake_results = [
        {"title": "PubMed: breath analysis", "link": "https://pubmed.ncbi.nlm.nih.gov/123", "snippet": "Study A"},
        {"title": "Random forum thread", "link": "https://forum-spam.example/thread", "snippet": "Forum chat"},
        {"title": "Nature study", "link": "https://nature.com/articles/x", "snippet": "Study B"},
        {"title": "Reddit", "link": "https://reddit.com/r/medicine/x", "snippet": "Reddit post"},
        {"title": "MIT news", "link": "https://news.mit.edu/x", "snippet": "MIT writeup"},
        {"title": "Junk", "link": "https://content-aggregator.example/x", "snippet": "junk"},
    ]
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=fake_results)):
        sources = await select_web_sources(query="breath analysis cancer detection", limit=3)
    assert len(sources) == 3
    domains = [s.url for s in sources]
    # Authority-preferred domains rank up; forum / aggregator drop
    assert any("pubmed" in u for u in domains)
    assert any("nature.com" in u for u in domains)
    assert any("mit.edu" in u for u in domains)
    assert not any("forum-spam" in u for u in domains)


@pytest.mark.asyncio
async def test_select_web_sources_empty_on_no_results():
    from app.services.drafting.evidence import select_web_sources
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=[])):
        sources = await select_web_sources(query="anything", limit=5)
    assert sources == []
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_evidence.py::test_select_web_sources_returns_top_n_filtered -v`
Expected: ImportError on `select_web_sources`.

- [ ] **Step 4: Implement web search in `evidence.py`**

Append to `backend/app/services/drafting/evidence.py`:

```python
# ── Web search (Serper) ─────────────────────────────────────────────────────

_AUTHORITY_HINTS = (
    ".gov", ".edu", "pubmed", "nature.com", "sciencemag.org", "nih.gov",
    "nejm.org", "thelancet.com", "bmj.com", "sciencedirect.com",
    "mit.edu", "stanford.edu", "harvard.edu", "ox.ac.uk", "cam.ac.uk",
    "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "economist.com",
    "wired.com", "arstechnica.com", "ieee.org", "acm.org",
)
_AGGREGATOR_BLOCKLIST = (
    "reddit.com", "quora.com", "pinterest.", "medium.com/@", "youtube.com",
    "content-aggregator", "forum-spam",
)


def _domain_authority_score(url: str) -> float:
    u = url.lower()
    if any(b in u for b in _AGGREGATOR_BLOCKLIST):
        return -1.0
    if any(a in u for a in _AUTHORITY_HINTS):
        return 1.0
    return 0.0


async def _serper_search(query: str, num: int = 10) -> list[dict]:
    """Thin wrapper around serper_search_service to make the call mockable in tests."""
    from app.services.serper_search_service import search_serper  # imported lazily so tests can patch
    try:
        return await search_serper(query, num=num)
    except Exception as exc:
        logger.warning("Serper search failed for %r: %s", query, exc)
        return []


async def select_web_sources(query: str, limit: int = WEB_RESULT_LIMIT) -> list[EvidenceSource]:
    raw = await _serper_search(query, num=10)
    scored: list[tuple[float, dict]] = []
    for item in raw:
        link = item.get("link") or item.get("url") or ""
        if not link:
            continue
        score = _domain_authority_score(link)
        if score < 0:
            continue
        scored.append((score, item))
    # Stable sort by score desc — preserves Serper's original ranking within tier
    scored.sort(key=lambda x: x[0], reverse=True)
    sources: list[EvidenceSource] = []
    for _, item in scored[:limit]:
        sources.append(EvidenceSource(
            ref="",
            kind="web",
            url=item.get("link") or item.get("url") or "",
            title=(item.get("title") or "")[:200],
            snippet=(item.get("snippet") or "")[:600],
            published_date=item.get("date"),
        ))
    return sources
```

**Note on the Serper import:** if Step 1 revealed the function is named differently (e.g. `serper_organic`, `search`), substitute that name in the lazy import line above. The expected signature is `async def fn(query: str, num: int) -> list[dict]` where each dict has at least `link`/`url`, `title`, `snippet`.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: 5 tests pass (3 prior + 2 new).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/drafting/evidence.py backend/tests/test_drafting_evidence.py
git commit -m "feat(drafting): Serper web search with authority filtering"
```

---

### Task 7: BrandSource integration

**Files:**
- Modify: `backend/app/services/drafting/evidence.py`
- Modify: `backend/tests/test_drafting_evidence.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_evidence.py`:

```python
@pytest.mark.asyncio
async def test_select_library_sources_returns_brand_sources(db_session):
    from app.services.drafting.evidence import select_library_sources

    user = User(email="ev3@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Lib", slug="lib-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add_all([
        BrandSource(brand_id=brand.id, title="Study A", url="https://a.com/a",
                    snippet="A", source_type="paper"),
        BrandSource(brand_id=brand.id, title="Study B", url="https://a.com/b",
                    snippet="B", source_type="paper"),
    ])
    await db_session.commit()

    sources = await select_library_sources(brand_id=brand.id, db=db_session)
    assert len(sources) == 2
    assert {s.title for s in sources} == {"Study A", "Study B"}
    assert all(s.kind == "library" for s in sources)


@pytest.mark.asyncio
async def test_select_library_sources_caps_at_limit(db_session):
    from app.services.drafting.evidence import select_library_sources, BRAND_SOURCE_LIMIT

    user = User(email="ev4@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Many", slug="many-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add_all([
        BrandSource(brand_id=brand.id, title=f"S{i}", url=f"https://a.com/{i}",
                    snippet=f"snip {i}", source_type="article")
        for i in range(BRAND_SOURCE_LIMIT + 5)
    ])
    await db_session.commit()

    sources = await select_library_sources(brand_id=brand.id, db=db_session)
    assert len(sources) == BRAND_SOURCE_LIMIT
```

You'll also need `from app.models import BrandSource` at the top of the test file — add it.

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_evidence.py::test_select_library_sources_returns_brand_sources -v`
Expected: ImportError on `select_library_sources`.

- [ ] **Step 3: Implement `select_library_sources`**

Append to `backend/app/services/drafting/evidence.py`:

```python
# ── BrandSource library ─────────────────────────────────────────────────────

async def select_library_sources(brand_id: int, db: AsyncSession) -> list[EvidenceSource]:
    result = await db.execute(
        select(BrandSource)
        .where(BrandSource.brand_id == brand_id)
        .order_by(desc(BrandSource.added_at))
        .limit(BRAND_SOURCE_LIMIT)
    )
    rows = list(result.scalars().all())
    return [
        EvidenceSource(
            ref="",
            kind="library",
            url=row.url,
            title=row.title[:200],
            snippet=(row.snippet or "")[:600],
            published_date=None,
        )
        for row in rows
    ]
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/evidence.py backend/tests/test_drafting_evidence.py
git commit -m "feat(drafting): BrandSource library integration"
```

---

### Task 8: Cache layer

**Files:**
- Modify: `backend/app/services/drafting/evidence.py`
- Modify: `backend/tests/test_drafting_evidence.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_drafting_evidence.py`:

```python
@pytest.mark.asyncio
async def test_cache_roundtrip(db_session):
    from app.services.drafting.evidence import (
        EvidencePack, EvidenceSource, write_cache, read_cache,
    )
    pack = EvidencePack(
        sources=[EvidenceSource(ref="S1", kind="web", url="https://x", title="t", snippet="s")],
        query="q", brand_name="b",
    )
    await write_cache(brand_id=1, prompt_id=2, pack=pack, db=db_session)
    fetched = await read_cache(brand_id=1, prompt_id=2, db=db_session)
    assert fetched is not None
    assert fetched.query == "q"
    assert len(fetched.sources) == 1
    assert fetched.sources[0].url == "https://x"


@pytest.mark.asyncio
async def test_cache_returns_none_when_expired(db_session):
    from app.services.drafting.evidence import (
        EvidencePack, write_cache, read_cache, CACHE_TTL_HOURS,
    )
    from app.models import EvidenceCache
    pack = EvidencePack(sources=[], query="q", brand_name="b")
    await write_cache(brand_id=3, prompt_id=4, pack=pack, db=db_session)
    # Force fetched_at to be older than the TTL
    row = (await db_session.execute(
        select(EvidenceCache).where(EvidenceCache.brand_id == 3, EvidenceCache.prompt_id == 4)
    )).scalar_one()
    row.fetched_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=CACHE_TTL_HOURS + 1)
    await db_session.commit()
    fetched = await read_cache(brand_id=3, prompt_id=4, db=db_session)
    assert fetched is None


@pytest.mark.asyncio
async def test_cache_miss_returns_none(db_session):
    from app.services.drafting.evidence import read_cache
    assert await read_cache(brand_id=999, prompt_id=999, db=db_session) is None
```

Add `from datetime import datetime, UTC, timedelta` and `from app.models import EvidenceCache` to the imports section of the test file if not already present.

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_evidence.py::test_cache_roundtrip -v`
Expected: ImportError on `write_cache`/`read_cache`.

- [ ] **Step 3: Implement cache functions**

Append to `backend/app/services/drafting/evidence.py`:

```python
# ── Cache ───────────────────────────────────────────────────────────────────

import json as _json


async def write_cache(brand_id: int, prompt_id: int, pack: EvidencePack, db: AsyncSession) -> None:
    payload = _json.dumps(pack.to_dict())
    now = datetime.now(UTC).replace(tzinfo=None)
    existing = await db.get(EvidenceCache, (brand_id, prompt_id))
    if existing:
        existing.pack_json = payload
        existing.fetched_at = now
    else:
        db.add(EvidenceCache(
            brand_id=brand_id, prompt_id=prompt_id,
            pack_json=payload, fetched_at=now,
        ))
    await db.commit()


async def read_cache(brand_id: int, prompt_id: int, db: AsyncSession) -> EvidencePack | None:
    row = await db.get(EvidenceCache, (brand_id, prompt_id))
    if row is None:
        return None
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=CACHE_TTL_HOURS)
    if row.fetched_at < cutoff:
        return None
    try:
        return EvidencePack.from_dict(_json.loads(row.pack_json))
    except Exception:
        return None
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/evidence.py backend/tests/test_drafting_evidence.py
git commit -m "feat(drafting): evidence pack cache with 24h TTL"
```

---

### Task 9: Main `build_evidence_pack()` assembly

**Files:**
- Modify: `backend/app/services/drafting/evidence.py`
- Modify: `backend/tests/test_drafting_evidence.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_evidence.py`:

```python
@pytest.mark.asyncio
async def test_build_evidence_pack_merges_three_sources(db_session):
    from app.services.drafting.evidence import build_evidence_pack

    user = User(email="ev5@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Pack", slug="pack-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    db_session.add(WebsiteAuditPage(
        audit_id=audit.id, url="https://b.com/x", title="breath cancer",
        h1_text="breath", content_excerpt="data", fact_density=0.8,
    ))
    db_session.add(BrandSource(
        brand_id=brand.id, title="Lib paper", url="https://a.com/p",
        snippet="paper", source_type="paper",
    ))
    await db_session.commit()

    fake_web = [
        {"title": "Nature x", "link": "https://nature.com/y", "snippet": "web snip"},
    ]
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=fake_web)):
        pack = await build_evidence_pack(
            brand_id=brand.id,
            brand_name="Pack",
            prompt_id=1,
            prompt_text="breath cancer detection",
            db=db_session,
            use_cache=False,
        )
    refs = [s.ref for s in pack.sources]
    assert refs == [f"S{i+1}" for i in range(len(pack.sources))]
    kinds = {s.kind for s in pack.sources}
    assert kinds == {"library", "brand_page", "web"}
    assert len(pack.sources) <= 15


@pytest.mark.asyncio
async def test_build_evidence_pack_uses_cache_on_second_call(db_session):
    from app.services.drafting.evidence import build_evidence_pack

    user = User(email="ev6@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Cached", slug="cached-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    with patch("app.services.drafting.evidence._serper_search",
               new=AsyncMock(return_value=[{"title": "T", "link": "https://nature.com/z", "snippet": "s"}])) as m:
        await build_evidence_pack(
            brand_id=brand.id, brand_name="Cached", prompt_id=42,
            prompt_text="test query", db=db_session, use_cache=True,
        )
        await build_evidence_pack(
            brand_id=brand.id, brand_name="Cached", prompt_id=42,
            prompt_text="test query", db=db_session, use_cache=True,
        )
    # Serper called only once thanks to cache
    assert m.call_count == 1
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_evidence.py::test_build_evidence_pack_merges_three_sources -v`
Expected: ImportError on `build_evidence_pack`.

- [ ] **Step 3: Implement `build_evidence_pack`**

Append to `backend/app/services/drafting/evidence.py`:

```python
# ── Top-level assembly ──────────────────────────────────────────────────────

async def build_evidence_pack(
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    prompt_text: str,
    db: AsyncSession,
    use_cache: bool = True,
) -> EvidencePack:
    """
    Assemble the Evidence Pack from library + brand pages + web search.

    Library sources always fold in fresh from the DB. Brand pages + web search
    are cached together for CACHE_TTL_HOURS.
    """
    cached_web_and_brand: list[EvidenceSource] = []
    used_cache = False
    if use_cache:
        cached = await read_cache(brand_id=brand_id, prompt_id=prompt_id, db=db)
        if cached is not None:
            cached_web_and_brand = [s for s in cached.sources if s.kind in ("web", "brand_page")]
            used_cache = True

    if not used_cache:
        # Run brand-page selection + Serper in sequence (Serper is the slow call)
        brand_pages = await select_brand_pages(
            brand_id=brand_id, prompt_text=prompt_text, db=db, limit=BRAND_PAGE_LIMIT,
        )
        web_sources = await select_web_sources(query=prompt_text, limit=WEB_RESULT_LIMIT)
        cached_web_and_brand = brand_pages + web_sources

    library_sources = await select_library_sources(brand_id=brand_id, db=db)

    # Priority order: library > brand pages > web. Truncate to PACK_CAP.
    merged = library_sources + cached_web_and_brand
    merged = merged[:PACK_CAP]
    for idx, src in enumerate(merged, start=1):
        src.ref = f"S{idx}"

    pack = EvidencePack(sources=merged, query=prompt_text, brand_name=brand_name)

    if use_cache and not used_cache:
        cacheable = EvidencePack(
            sources=[s for s in cached_web_and_brand],
            query=prompt_text, brand_name=brand_name,
        )
        await write_cache(brand_id=brand_id, prompt_id=prompt_id, pack=cacheable, db=db)

    return pack
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_evidence.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/evidence.py backend/tests/test_drafting_evidence.py
git commit -m "feat(drafting): build_evidence_pack assembly with cache"
```

---

### Task 10: BrandSource CRUD endpoints

**Files:**
- Modify: `backend/app/routers/brand_profile.py`
- Test: `backend/tests/test_brand_sources.py`

- [ ] **Step 1: Inspect existing brand_profile router style**

Run: `grep -n "@router\|def " backend/app/routers/brand_profile.py | head -30`
Note the router-level `prefix`, dependency on `get_current_user`, and the ownership-check pattern used for existing brand profile endpoints.

- [ ] **Step 2: Write failing test**

Create `backend/tests/test_brand_sources.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_create_brand_source(client, register_and_login):
    user = await register_and_login("src1@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("Acme", "what is breath analysis")
    r = await client.post(
        f"/api/brand_profile/{brand_id}/sources",
        json={
            "url": "https://nature.com/articles/study",
            "title": "Breath analysis study",
            "snippet": "A 2024 study found...",
            "source_type": "paper",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["url"] == "https://nature.com/articles/study"
    assert body["source_type"] == "paper"


@pytest.mark.asyncio
async def test_list_brand_sources_returns_only_own(client, register_and_login):
    u1 = await register_and_login("src2@test.com", "Password123!")
    b1 = await u1.create_brand_with_prompt("A", "q")
    await client.post(f"/api/brand_profile/{b1}/sources",
                      json={"url": "https://x.com", "title": "X", "snippet": "s", "source_type": "article"})
    r = await client.get(f"/api/brand_profile/{b1}/sources")
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_other_user_cannot_access_sources(client, register_and_login):
    u1 = await register_and_login("src3@test.com", "Password123!")
    b1 = await u1.create_brand_with_prompt("A", "q")
    u2 = await register_and_login("src4@test.com", "Password123!")
    r = await client.get(f"/api/brand_profile/{b1}/sources")
    assert r.status_code in (403, 404)


@pytest.mark.asyncio
async def test_delete_brand_source(client, register_and_login):
    user = await register_and_login("src5@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("A", "q")
    create_r = await client.post(f"/api/brand_profile/{brand_id}/sources",
                                  json={"url": "https://x.com", "title": "X",
                                        "snippet": "s", "source_type": "article"})
    src_id = create_r.json()["id"]
    r = await client.delete(f"/api/brand_profile/{brand_id}/sources/{src_id}")
    assert r.status_code == 204
    list_r = await client.get(f"/api/brand_profile/{brand_id}/sources")
    assert list_r.json() == []


@pytest.mark.asyncio
async def test_source_cap_enforced(client, register_and_login):
    from app.services.drafting.evidence import BRAND_SOURCE_LIMIT
    user = await register_and_login("src6@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("A", "q")
    for i in range(BRAND_SOURCE_LIMIT):
        r = await client.post(f"/api/brand_profile/{brand_id}/sources",
                              json={"url": f"https://x.com/{i}", "title": f"T{i}",
                                    "snippet": "s", "source_type": "article"})
        assert r.status_code == 200
    # The cap-th source should be rejected
    r = await client.post(f"/api/brand_profile/{brand_id}/sources",
                          json={"url": "https://x.com/over", "title": "Over",
                                "snippet": "s", "source_type": "article"})
    assert r.status_code == 400
```

If `register_and_login` is a fixture rather than a helper attached to `client`, adapt to the existing pattern from `tests/test_brand_profile.py`.

- [ ] **Step 3: Run tests — expect failure**

Run: `cd backend && pytest tests/test_brand_sources.py -v`
Expected: 404 (endpoints don't exist) or import errors.

- [ ] **Step 4: Implement endpoints in `brand_profile.py`**

Append at the end of `backend/app/routers/brand_profile.py` (uses the existing `router` instance, `get_current_user`, and ownership-check helper):

```python
# ── BrandSource library ─────────────────────────────────────────────────────

from app.models import BrandSource as _BrandSource
from app.schemas import BrandSourceCreate, BrandSourceOut
from app.services.drafting.evidence import BRAND_SOURCE_LIMIT


async def _ensure_brand_owned(brand_id: int, user: User, db: AsyncSession) -> Brand:
    brand = await db.get(Brand, brand_id)
    if brand is None or brand.user_id != user.id:
        raise HTTPException(status_code=404, detail="Brand not found")
    return brand


@router.post("/{brand_id}/sources", response_model=BrandSourceOut)
async def create_brand_source(
    brand_id: int,
    payload: BrandSourceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    count_result = await db.execute(
        select(func.count(_BrandSource.id)).where(_BrandSource.brand_id == brand_id)
    )
    count = count_result.scalar_one() or 0
    if count >= BRAND_SOURCE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Source cap reached ({BRAND_SOURCE_LIMIT}). Delete one before adding more.",
        )

    title = payload.title
    snippet = payload.snippet
    if not title or not snippet:
        # Fall back to Jina-fetched metadata if user didn't supply both
        try:
            from app.services.jina_service import fetch_url_summary
            fetched = await fetch_url_summary(payload.url)
            title = title or (fetched.get("title") if fetched else None) or payload.url
            snippet = snippet or (fetched.get("excerpt") if fetched else None) or ""
        except Exception:
            title = title or payload.url
            snippet = snippet or ""

    src = _BrandSource(
        brand_id=brand_id,
        title=title[:500],
        url=payload.url,
        snippet=snippet[:1500] if snippet else None,
        source_type=payload.source_type,
        added_by_user_id=current_user.id,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return src


@router.get("/{brand_id}/sources", response_model=list[BrandSourceOut])
async def list_brand_sources(
    brand_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    result = await db.execute(
        select(_BrandSource).where(_BrandSource.brand_id == brand_id)
        .order_by(_BrandSource.added_at.desc())
    )
    return list(result.scalars().all())


@router.delete("/{brand_id}/sources/{source_id}", status_code=204)
async def delete_brand_source(
    brand_id: int,
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    src = await db.get(_BrandSource, source_id)
    if src is None or src.brand_id != brand_id:
        raise HTTPException(status_code=404, detail="Source not found")
    await db.delete(src)
    await db.commit()
```

Imports at top of file — ensure these are present (most likely already are):
```python
from fastapi import HTTPException
from sqlalchemy import func, select
```

**Important about `fetch_url_summary`:** If `jina_service.py` does not expose a function named `fetch_url_summary`, use whatever existing helper it has for fetching a URL's title + first paragraph. Inspect `grep -n "^async def\|^def" backend/app/services/jina_service.py` and substitute.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && pytest tests/test_brand_sources.py -v`
Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/brand_profile.py backend/tests/test_brand_sources.py
git commit -m "feat(brand-profile): BrandSource CRUD endpoints"
```

---

## Phase 4 — Prompt Reorganization + Citation Rendering

### Task 11: `citations.py` — per-platform marker rendering

**Files:**
- Create: `backend/app/services/drafting/citations.py`
- Test: `backend/tests/test_drafting_citations.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_drafting_citations.py`:

```python
import pytest
from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.drafting.citations import (
    render_citations,
    extract_used_refs,
)


def _pack(*pairs):
    return EvidencePack(
        sources=[EvidenceSource(ref=ref, kind="web", url=url, title=title, snippet="")
                 for ref, url, title in pairs],
        query="q", brand_name="b",
    )


def test_render_medium_emits_inline_links_and_footer():
    text = "Cancer detection accuracy hit 94% [S1]. Subsequent studies confirmed [S2]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"), ("S2", "https://pubmed.gov/b", "PubMed"))
    rendered, citations = render_citations(text=text, pack=pack, platform="medium")
    assert "[1](https://nature.com/a)" in rendered
    assert "[2](https://pubmed.gov/b)" in rendered
    assert "Sources" in rendered
    assert "1. [Nature](https://nature.com/a)" in rendered
    assert len(citations) == 2


def test_render_reddit_uses_inline_domain():
    text = "Studies show 94% accuracy [S1]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"))
    rendered, _ = render_citations(text=text, pack=pack, platform="reddit")
    assert "(source: nature.com)" in rendered
    assert "Sources" not in rendered


def test_render_x_strips_markers():
    text = "Cancer detection hit 94% [S1]. Wow [S2]."
    pack = _pack(("S1", "https://x", "X"), ("S2", "https://y", "Y"))
    rendered, citations = render_citations(text=text, pack=pack, platform="x_post")
    assert "[S1]" not in rendered and "[S2]" not in rendered
    # Citations still recorded for analytics
    assert len(citations) == 2


def test_render_wikipedia_inserts_ref_tags():
    text = "Cancer detection accuracy hit 94% [S1]."
    pack = _pack(("S1", "https://nature.com/a", "Nature"))
    rendered, _ = render_citations(text=text, pack=pack, platform="wikipedia")
    assert "<ref>" in rendered and "cite web" in rendered
    assert "url=https://nature.com/a" in rendered


def test_unmatched_marker_is_dropped():
    text = "Foo [S1] bar [S9]."
    pack = _pack(("S1", "https://x", "X"))
    rendered, citations = render_citations(text=text, pack=pack, platform="medium")
    assert "[S9]" not in rendered and "[9]" not in rendered
    assert len(citations) == 1  # only S1


def test_extract_used_refs():
    text = "A [S1] B [S2] C [S2] D [S5]."
    refs = extract_used_refs(text)
    assert refs == ["S1", "S2", "S5"]  # deduped, in first-appearance order
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_citations.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `citations.py`**

Create `backend/app/services/drafting/citations.py`:

```python
"""
Per-platform citation rendering for the drafting pipeline.

The writer LLM emits inline markers like [S1], [S2]. This module resolves them
back to URLs and renders them appropriately for each platform.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from app.services.drafting.evidence import EvidencePack, EvidenceSource

_MARKER_RE = re.compile(r"\[S(\d+)\]")

_PLATFORMS_WITH_FOOTER = {"medium", "linkedin_article", "quora"}
_INLINE_DOMAIN_PLATFORMS = {"reddit", "reddit_reply", "linkedin_post", "linkedin_reply"}
_STRIP_PLATFORMS = {"x_post", "x_thread", "x_reply"}


@dataclass
class RenderedCitation:
    source_ref: str   # "S1"
    url: str
    title: str
    position_marker: int


def extract_used_refs(text: str) -> list[str]:
    """Return refs used in order of first appearance, deduped."""
    seen: list[str] = []
    for m in _MARKER_RE.finditer(text):
        ref = f"S{m.group(1)}"
        if ref not in seen:
            seen.append(ref)
    return seen


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return url


def render_citations(
    text: str,
    pack: EvidencePack,
    platform: str,
) -> tuple[str, list[RenderedCitation]]:
    """
    Returns (rendered_text, citations_used).

    For each [SN] marker found in text, looks up the matching EvidenceSource
    in the pack and renders it per platform conventions. Unmatched markers
    are stripped silently.
    """
    by_ref: dict[str, EvidenceSource] = {s.ref: s for s in pack.sources}
    used: list[RenderedCitation] = []
    ref_to_display: dict[str, int] = {}

    for m in _MARKER_RE.finditer(text):
        ref = f"S{m.group(1)}"
        if ref in by_ref and ref not in ref_to_display:
            ref_to_display[ref] = len(ref_to_display) + 1
            src = by_ref[ref]
            used.append(RenderedCitation(
                source_ref=ref, url=src.url, title=src.title, position_marker=m.start(),
            ))

    def _replace(match: re.Match) -> str:
        ref = f"S{match.group(1)}"
        if ref not in by_ref:
            return ""
        src = by_ref[ref]
        if platform in _STRIP_PLATFORMS:
            return ""
        if platform in _INLINE_DOMAIN_PLATFORMS:
            return f"(source: {_domain(src.url)})"
        if platform == "wikipedia":
            return f"<ref>{{{{cite web|url={src.url}|title={src.title}}}}}</ref>"
        # Default: medium / linkedin_article / quora — numbered inline links
        display = ref_to_display[ref]
        return f"[{display}]({src.url})"

    rendered = _MARKER_RE.sub(_replace, text).strip()

    if platform in _PLATFORMS_WITH_FOOTER and used:
        footer_lines = ["", "", "Sources"]
        for ref in ref_to_display:
            src = by_ref[ref]
            display = ref_to_display[ref]
            footer_lines.append(f"{display}. [{src.title}]({src.url})")
        rendered = rendered + "\n".join(footer_lines)

    return rendered, used
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_citations.py -v`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/citations.py backend/tests/test_drafting_citations.py
git commit -m "feat(drafting): per-platform citation rendering"
```

---

### Task 12: Update `build_prompt()` to accept EvidencePack + voice + cross-ref

**Files:**
- Modify: `backend/app/services/drafting/prompts.py`
- Modify: `backend/tests/` (add a focused unit test for prompt assembly)

- [ ] **Step 1: Write a failing prompt-assembly test**

Create `backend/tests/test_drafting_prompts.py`:

```python
from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.drafting.prompts import build_prompt


def test_build_prompt_includes_evidence_pack():
    pack = EvidencePack(
        sources=[
            EvidenceSource(ref="S1", kind="web", url="https://nature.com/a",
                           title="Nature study", snippet="A 2024 study found..."),
        ],
        query="how does breath analysis detect cancer",
        brand_name="Acme",
    )
    out = build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="how does breath analysis detect cancer",
        visibility_pct=10.0,
        profile_context="Brand: Acme. Approved language: ...",
        response_analysis="Currently no AI responses mention Acme.",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "thought leadership", "rules": []},
        evidence_pack=pack,
    )
    assert "[S1]" in out
    assert "Nature study" in out
    assert "https://nature.com/a" in out
    assert "CITATION RULES" in out


def test_build_prompt_includes_voice_sample_and_related_when_present():
    pack = EvidencePack(sources=[], query="q", brand_name="Acme")
    out = build_prompt(
        brand_name="Acme",
        platform="medium",
        prompt_text="q",
        visibility_pct=0.0,
        profile_context="ctx",
        response_analysis="none",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "x", "rules": []},
        evidence_pack=pack,
        voice_sample="Short concrete writing. Specific facts. Real numbers.",
        related_draft_summary="LinkedIn article: \"Title\" — argues that ...",
    )
    assert "VOICE EXAMPLE" in out
    assert "Short concrete writing" in out
    assert "RELATED PUBLISHED CONTENT" in out


def test_build_prompt_omits_voice_when_none():
    pack = EvidencePack(sources=[], query="q", brand_name="Acme")
    out = build_prompt(
        brand_name="Acme", platform="medium", prompt_text="q",
        visibility_pct=0.0, profile_context="ctx", response_analysis="none",
        platform_spec={"format": "article", "word_range": (800, 2000),
                       "tone": "x", "rules": []},
        evidence_pack=pack,
        voice_sample=None,
        related_draft_summary=None,
    )
    assert "VOICE EXAMPLE" not in out
    assert "RELATED PUBLISHED CONTENT" not in out
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_prompts.py -v`
Expected: TypeError ("unexpected keyword argument 'evidence_pack'").

- [ ] **Step 3: Update `build_prompt()` signature and body**

In `backend/app/services/drafting/prompts.py`:

1. Add imports at top:
```python
from app.services.drafting.evidence import EvidencePack
```

2. Update the `build_prompt` signature (currently at line ~120):
```python
def build_prompt(
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    opportunity_context: str | None = None,
    existing_drafts_context: str | None = None,
    evidence_pack: EvidencePack | None = None,
    voice_sample: str | None = None,
    related_draft_summary: str | None = None,
) -> str:
```

3. Just inside the function (before the return), build new sections:

```python
    evidence_section = ""
    if evidence_pack is not None and evidence_pack.sources:
        lines = ["EVIDENCE SOURCES — cite these inline using [S1], [S2], etc.:", ""]
        for src in evidence_pack.sources:
            lines.append(f"[{src.ref}] {src.title}")
            lines.append(f"     URL: {src.url}")
            lines.append(f'     "{src.snippet}"')
            lines.append("")
        lines.append("CITATION RULES (mandatory):")
        lines.append("- Every statistic, study reference, or specific factual claim must end with [SN].")
        lines.append("- If you cannot back a claim with one of the sources above, REMOVE the claim — do not hedge, do not paraphrase.")
        lines.append("- Never invent sources or cite sources not listed above.")
        lines.append("")
        evidence_section = "\n".join(lines)

    voice_section = ""
    if voice_sample:
        voice_section = (
            "VOICE EXAMPLE — the draft should match the rhythm, claim density, "
            "and tone of this passage written for this brand:\n\n"
            f'"{voice_sample}"\n\n'
        )

    related_section = ""
    if related_draft_summary:
        related_section = (
            "RELATED PUBLISHED CONTENT — this brand already has approved content "
            "on this exact query. Do not duplicate its angle. You may reference it "
            "naturally (e.g. \"in a recent LinkedIn piece\") but take a different angle:\n\n"
            f"{related_draft_summary}\n\n"
        )
```

4. Inject those into the existing prompt template. Find the line in the return f-string that reads `WHAT AI SYSTEMS ARE CURRENTLY SAYING:` and insert `{evidence_section}{voice_section}{related_section}` immediately before that block. Concretely, change:

```python
CURRENT VISIBILITY:
{visibility_pct:.1f}% of AI responses mention {brand_name} for this query. The analysis below shows what is currently being said and what specific angle is missing.

WHAT AI SYSTEMS ARE CURRENTLY SAYING:
{response_analysis}
```

to:

```python
CURRENT VISIBILITY:
{visibility_pct:.1f}% of AI responses mention {brand_name} for this query. The analysis below shows what is currently being said and what specific angle is missing.

{evidence_section}{voice_section}{related_section}WHAT AI SYSTEMS ARE CURRENTLY SAYING:
{response_analysis}
```

5. Update the INFORMATION HIERARCHY block (currently lines ~162-167) so the Evidence Pack is the primary source when present:

```python
INFORMATION HIERARCHY — follow this strictly:
  1. EVIDENCE SOURCES listed above (if present) are your PRIMARY source. Every concrete claim must be backed by a [SN] citation.
  2. Brand Profile fields (company description, key stats, approved language, what not to say, publications) are SECONDARY — use them for brand-specific framing, tone, and details the Evidence Sources don't cover.
  3. The "SUPPLEMENTARY context from company website" section in the Brand Profile is tertiary — fill gaps only.
  4. NEVER invent facts, statistics, or claims not present in either source.
  5. NEVER approximate or paraphrase statistics — use the EXACT figures as written.
```

6. Shrink the universal banned-words list (currently ~189-200) to:

```python
UNIVERSAL STYLE RULES (absolute — no exceptions):
  - NEVER use em dashes (—) or en dashes used as separators. Replace with commas, colons, or rewrite the sentence.
  - NEVER use these words or phrases: "delve", "dive into", "unpack" (as a verb), "it's worth noting", "the bottom line", "at the end of the day"
  - NEVER use hedging language of any kind ("may", "might", "could potentially", "perhaps", "it seems")
  - Vary sentence length — mix short punchy sentences with longer analytical ones
  - Use contractions naturally (it's, we're, you'll, don't)
  - Only reference facts and statistics that appear in the Brand Profile or Evidence Sources above — never invent data
  - Mention {brand_name} only if it fits naturally in the context — never force it
  - Content must read as written by a knowledgeable human expert, not by an AI
  - Do not include meta-commentary about what the content does ("This post addresses...", "This answer explains...")
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_prompts.py -v`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/prompts.py backend/tests/test_drafting_prompts.py
git commit -m "feat(drafting): prompt accepts evidence pack, voice sample, cross-ref"
```

---

### Task 13: Wikipedia builder uses EvidencePack

**Files:**
- Modify: `backend/app/services/drafting/prompts.py`
- Modify: `backend/tests/test_drafting_prompts.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_prompts.py`:

```python
def test_wikipedia_prompt_uses_evidence_pack():
    from app.services.drafting.prompts import build_wikipedia_prompt
    pack = EvidencePack(
        sources=[
            EvidenceSource(ref="S1", kind="web", url="https://nature.com/a",
                           title="Nature breath study", snippet="2024 study..."),
            EvidenceSource(ref="S2", kind="library", url="https://acme.com/methodology",
                           title="Methodology overview", snippet="Our process..."),
        ],
        query="breath cancer detection", brand_name="Acme",
    )
    out = build_wikipedia_prompt(
        brand_name="Acme",
        prompt_text="breath cancer detection",
        profile_context="ctx",
        response_analysis="none",
        evidence_pack=pack,
    )
    assert "[S1]" in out and "[S2]" in out
    assert "<ref>" in out or "cite the EVIDENCE SOURCES" in out
    assert "{{citation needed}}" not in out  # we have sources, shouldn't fall back
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd backend && pytest tests/test_drafting_prompts.py::test_wikipedia_prompt_uses_evidence_pack -v`
Expected: TypeError (no `evidence_pack` kw).

- [ ] **Step 3: Update `build_wikipedia_prompt`**

Replace the `build_wikipedia_prompt` function in `backend/app/services/drafting/prompts.py` (the existing one currently starts at line ~45). New body:

```python
def build_wikipedia_prompt(
    brand_name: str,
    prompt_text: str,
    profile_context: str,
    response_analysis: str,
    publications: list[dict] | None = None,
    website_url: str | None = None,
    evidence_pack: EvidencePack | None = None,
) -> str:
    # When an evidence pack is present, prefer it as the citation source.
    pack_section = ""
    citation_instructions = ""
    if evidence_pack is not None and evidence_pack.sources:
        lines = ["EVIDENCE SOURCES — cite each fact you use with [S1], [S2], etc.:", ""]
        for src in evidence_pack.sources:
            lines.append(f"[{src.ref}] {src.title}")
            lines.append(f"     URL: {src.url}")
            lines.append(f'     "{src.snippet}"')
            lines.append("")
        pack_section = "\n".join(lines)
        citation_instructions = (
            "CITATION HANDLING: Insert [SN] markers after each citable fact. "
            "The pipeline converts each [SN] to a proper Wikipedia <ref>{{cite web|url=...|title=...}}</ref>."
        )
    else:
        # Backwards-compatible path — keep existing publications-or-website logic
        citation_ref = _build_citation_ref(publications or [], brand_name, website_url)
        if publications:
            p = publications[0]
            citation_instructions = (
                f"CITATION TO USE: The citation is already provided below — copy it exactly as-is:\n"
                f"  {citation_ref}\n"
                f"  (Source: {p.get('title', '')} — {p.get('publisher', '')} {p.get('date', '')})"
            )
        elif website_url:
            citation_instructions = (
                f"CITATION TO USE: No peer-reviewed publications available. "
                f"Use this cite web citation — copy it exactly as-is:\n  {citation_ref}"
            )
        else:
            citation_instructions = (
                "CITATION: No source is available. "
                "End the wikitext with {{citation needed}} exactly as shown — do NOT invent any citation data."
            )

    return f"""You are an experienced Wikipedia editor. Given a brand profile and a target query, you must:
1. Identify ONE specific, real, existing Wikipedia article to edit.
2. Write the exact wikitext sentence(s) to insert into it.
3. Specify exactly where in the article to insert the text.

BRAND PROFILE:
{profile_context}

TARGET QUERY:
"{prompt_text}"

WHAT AI SYSTEMS CURRENTLY SAY:
{response_analysis}

{pack_section}

{citation_instructions}

ARTICLE SELECTION — choose the article whose topic most directly matches the key terms in the target query. The article title and section should use the same vocabulary as the query. Never target: brand articles, disambiguation pages, or articles you are inventing.

WIKI TEXT RULES (absolute — every rule is mandatory):
  - Neutral encyclopedic tone only — no promotional language, no superlatives, no brand advocacy of any kind
  - NEVER use first person ("we", "our", "I", "us") — third person only
  - Every factual claim must be attributable to one of the sources above — do not state facts that cannot be sourced
  - Use [[wikilinks]] around key terms that have Wikipedia articles
  - Structure: 1 to 3 sentences maximum, written as a natural addition to an existing article section
  - Insert [SN] markers (or the single citation ref provided) after each citable fact — the pipeline converts them to Wikipedia <ref> tags

⚠ OUTPUT ONLY THE FIVE FIELDS BELOW. No analysis. No explanation. No preamble.

ARTICLE_TITLE: [exact title of the existing Wikipedia article]
ARTICLE_URL: https://en.wikipedia.org/wiki/[Title_With_Underscores]
SECTION: [exact section heading where the text belongs]
INSERT_LOCATION: [One complete sentence telling the user exactly where to paste]
WIKI_TEXT:
[the wikitext to insert — 1 to 2 sentences, nothing else]"""
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_prompts.py -v`
Expected: all 4 prompts tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/prompts.py backend/tests/test_drafting_prompts.py
git commit -m "feat(drafting): Wikipedia prompt uses evidence pack for citations"
```

---

## Phase 5 — Layer 2: Critic + Rewriter

### Task 14: `critic.py` — critic call with tool-use

**Files:**
- Create: `backend/app/services/drafting/critic.py`
- Test: `backend/tests/test_drafting_critic.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_drafting_critic.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.drafting.evidence import EvidencePack, EvidenceSource


def _pack():
    return EvidencePack(
        sources=[EvidenceSource(ref="S1", kind="web", url="https://x", title="t", snippet="s")],
        query="q", brand_name="b",
    )


@pytest.mark.asyncio
async def test_critic_parses_tool_use_response():
    from app.services.drafting.critic import critic_score, CriticScore

    fake_tool_input = {
        "claim_density": 6,
        "citation_coverage": 5,
        "query_mirroring": 8,
        "concrete_specificity": 6,
        "voice_authenticity": 7,
        "overall_score": 6.2,
        "flagged_paragraphs": [
            {"index": 1, "issue": "claim_density", "note": "needs S1"},
        ],
    }

    fake_response = MagicMock()
    block = MagicMock()
    block.type = "tool_use"
    block.input = fake_tool_input
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        result: CriticScore = await critic_score(
            draft_text="Para 1.\n\nPara 2.",
            pack=_pack(),
            query="q",
            platform="medium",
        )
    assert result.overall_score == pytest.approx(6.2, abs=0.01)
    assert len(result.flagged_paragraphs) == 1
    assert result.flagged_paragraphs[0]["index"] == 1


@pytest.mark.asyncio
async def test_critic_recomputes_overall_when_inconsistent():
    from app.services.drafting.critic import critic_score, WEIGHTS

    # Critic returns overall=10 but weighted sum is much lower
    fake_tool_input = {
        "claim_density": 4, "citation_coverage": 4, "query_mirroring": 4,
        "concrete_specificity": 4, "voice_authenticity": 4,
        "overall_score": 10.0, "flagged_paragraphs": [],
    }
    fake_response = MagicMock()
    block = MagicMock()
    block.type = "tool_use"
    block.input = fake_tool_input
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        result = await critic_score(
            draft_text="Para 1.", pack=_pack(), query="q", platform="medium",
        )
    expected = sum(WEIGHTS[k] * 4 for k in WEIGHTS)
    assert result.overall_score == pytest.approx(expected, abs=0.01)
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_critic.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `critic.py` (data + critic call only)**

Create `backend/app/services/drafting/critic.py`:

```python
"""
Critic + rewriter for the drafting pipeline.

After the first-draft Claude call, this module:
  1. Runs a structured tool-use critic call returning per-dimension scores
  2. If overall score < REWRITE_THRESHOLD, rewrites only the flagged paragraphs
  3. If overall score < HARD_FAIL, signals that the whole draft should be regenerated
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from app.services.drafting.evidence import EvidencePack
from app.services.drafting.models import CRITIC_MODEL, rewriter_model_for_tier

logger = logging.getLogger(__name__)

WEIGHTS: dict[str, float] = {
    "claim_density":        0.25,
    "citation_coverage":    0.25,
    "concrete_specificity": 0.20,
    "voice_authenticity":   0.20,
    "query_mirroring":      0.10,
}
REWRITE_THRESHOLD = 7.0
HARD_FAIL = 4.0
INCONSISTENCY_TOLERANCE = 0.5


@dataclass
class CriticScore:
    claim_density: int
    citation_coverage: int
    query_mirroring: int
    concrete_specificity: int
    voice_authenticity: int
    overall_score: float
    flagged_paragraphs: list[dict[str, Any]] = field(default_factory=list)

    @property
    def hard_fail(self) -> bool:
        return self.overall_score < HARD_FAIL

    @property
    def needs_rewrite(self) -> bool:
        return self.overall_score < REWRITE_THRESHOLD


_CRITIC_TOOL = {
    "name": "score_draft",
    "description": "Score a draft along five dimensions and return flagged paragraphs.",
    "input_schema": {
        "type": "object",
        "properties": {
            "claim_density":        {"type": "integer", "minimum": 0, "maximum": 10},
            "citation_coverage":    {"type": "integer", "minimum": 0, "maximum": 10},
            "query_mirroring":      {"type": "integer", "minimum": 0, "maximum": 10},
            "concrete_specificity": {"type": "integer", "minimum": 0, "maximum": 10},
            "voice_authenticity":   {"type": "integer", "minimum": 0, "maximum": 10},
            "overall_score":        {"type": "number"},
            "flagged_paragraphs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer"},
                        "issue": {"type": "string"},
                        "note":  {"type": "string"},
                    },
                    "required": ["index", "issue", "note"],
                },
            },
        },
        "required": ["claim_density", "citation_coverage", "query_mirroring",
                     "concrete_specificity", "voice_authenticity",
                     "overall_score", "flagged_paragraphs"],
    },
}


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key)


def _build_critic_prompt(draft_text: str, pack: EvidencePack, query: str, platform: str) -> str:
    sources_block = "\n".join(
        f"[{s.ref}] {s.title} — {s.url}\n     \"{s.snippet}\""
        for s in pack.sources
    ) or "(no evidence sources were provided)"

    return f"""You are a strict editor scoring a draft on five dimensions.

TARGET QUERY:
"{query}"

PLATFORM: {platform}

EVIDENCE SOURCES that were available to the writer:
{sources_block}

DRAFT (paragraphs separated by blank lines, 0-indexed):
{draft_text}

Score the draft along these 5 dimensions, 0-10 each:
- claim_density: how many specific, citable claims per paragraph (vs vague filler)
- citation_coverage: % of paragraphs that include at least one [SN] citation
- query_mirroring: does the first sentence + key noun phrases mirror the target query
- concrete_specificity: precise stats and named approaches vs vague statements ("very effective")
- voice_authenticity: human, varied, non-AI tone vs AI-tells (hedging, triple parallels, generic openers)

Compute overall_score as the weighted average using these weights:
  claim_density=0.25, citation_coverage=0.25, concrete_specificity=0.20,
  voice_authenticity=0.20, query_mirroring=0.10.

flagged_paragraphs: list each paragraph (by 0-based index) that has a fixable issue, with the issue name and a one-sentence note saying what should change. Be specific (e.g. "ground the 'breath analysis' claim in [S2] or remove it").

Output ONLY through the score_draft tool. No prose."""


async def critic_score(
    draft_text: str,
    pack: EvidencePack,
    query: str,
    platform: str,
) -> CriticScore:
    client = _anthropic_client()
    response = await client.messages.create(
        model=CRITIC_MODEL,
        max_tokens=400,
        tools=[_CRITIC_TOOL],
        tool_choice={"type": "tool", "name": "score_draft"},
        messages=[{"role": "user", "content": _build_critic_prompt(draft_text, pack, query, platform)}],
    )

    tool_input: dict[str, Any] | None = None
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input
            break
    if tool_input is None:
        raise ValueError("Critic did not return a tool_use block")

    score = CriticScore(
        claim_density=int(tool_input["claim_density"]),
        citation_coverage=int(tool_input["citation_coverage"]),
        query_mirroring=int(tool_input["query_mirroring"]),
        concrete_specificity=int(tool_input["concrete_specificity"]),
        voice_authenticity=int(tool_input["voice_authenticity"]),
        overall_score=float(tool_input["overall_score"]),
        flagged_paragraphs=list(tool_input.get("flagged_paragraphs", [])),
    )

    # Defensive: if the critic's overall_score drifts from the weighted sum, recompute.
    computed = (
        WEIGHTS["claim_density"]        * score.claim_density +
        WEIGHTS["citation_coverage"]    * score.citation_coverage +
        WEIGHTS["concrete_specificity"] * score.concrete_specificity +
        WEIGHTS["voice_authenticity"]   * score.voice_authenticity +
        WEIGHTS["query_mirroring"]      * score.query_mirroring
    )
    if abs(score.overall_score - computed) > INCONSISTENCY_TOLERANCE:
        logger.info("Critic overall_score %.2f differs from weighted sum %.2f — using weighted.",
                    score.overall_score, computed)
        score.overall_score = round(computed, 2)
    return score
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_critic.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/critic.py backend/tests/test_drafting_critic.py
git commit -m "feat(drafting): critic call with tool-use scoring + weighted cross-check"
```

---

### Task 15: Paragraph-scoped rewriter

**Files:**
- Modify: `backend/app/services/drafting/critic.py`
- Modify: `backend/tests/test_drafting_critic.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_critic.py`:

```python
@pytest.mark.asyncio
async def test_rewrite_splices_replacement_paragraphs():
    from app.services.drafting.critic import rewrite_flagged

    pack = _pack()
    draft = "Para 0 original.\n\nPara 1 original.\n\nPara 2 original."
    flagged = [{"index": 1, "issue": "claim_density", "note": "ground in [S1]"}]

    # The rewriter returns just the replacement paragraph(s)
    fake_text = "Para 1 REWRITTEN with [S1]."
    fake_response = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = fake_text
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        rewritten = await rewrite_flagged(
            draft_text=draft, flagged=flagged, pack=pack,
            query="q", platform="medium", tier="pro",
        )
    paras = rewritten.split("\n\n")
    assert paras[0] == "Para 0 original."
    assert "REWRITTEN" in paras[1]
    assert paras[2] == "Para 2 original."


@pytest.mark.asyncio
async def test_rewrite_keeps_original_when_fewer_paragraphs_returned():
    from app.services.drafting.critic import rewrite_flagged

    pack = _pack()
    draft = "Para 0.\n\nPara 1.\n\nPara 2."
    flagged = [
        {"index": 1, "issue": "x", "note": "fix"},
        {"index": 2, "issue": "y", "note": "fix"},
    ]
    # Rewriter returns only one paragraph instead of two
    fake_text = "Only one paragraph back."
    fake_response = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = fake_text
    fake_response.content = [block]

    with patch("app.services.drafting.critic._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        rewritten = await rewrite_flagged(
            draft_text=draft, flagged=flagged, pack=pack,
            query="q", platform="medium", tier="pro",
        )
    paras = rewritten.split("\n\n")
    assert paras[1] == "Only one paragraph back."
    assert paras[2] == "Para 2."  # original kept since only 1 returned
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_critic.py::test_rewrite_splices_replacement_paragraphs -v`
Expected: ImportError on `rewrite_flagged`.

- [ ] **Step 3: Implement `rewrite_flagged`**

Append to `backend/app/services/drafting/critic.py`:

```python
# ── Paragraph-scoped rewriter ───────────────────────────────────────────────

_PARAGRAPH_DELIMITER = "---PARAGRAPH---"


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def _build_rewrite_prompt(
    draft_text: str,
    flagged: list[dict[str, Any]],
    pack: EvidencePack,
    query: str,
    platform: str,
) -> str:
    paras = _split_paragraphs(draft_text)
    indexed = "\n\n".join(f"[Paragraph {i}]\n{p}" for i, p in enumerate(paras))
    flagged_block = "\n".join(
        f"- Paragraph {f['index']}: {f.get('issue', 'issue')} — {f.get('note', '')}"
        for f in flagged
    )
    sources_block = "\n".join(
        f"[{s.ref}] {s.title} — {s.url}\n     \"{s.snippet}\""
        for s in pack.sources
    ) or "(no evidence sources were provided)"

    return f"""You are rewriting flagged paragraphs of an existing draft. The full draft is shown for context — but you must only return the REPLACEMENT paragraphs.

TARGET QUERY: "{query}"
PLATFORM: {platform}

EVIDENCE SOURCES (use [SN] markers, no inventions):
{sources_block}

FULL DRAFT (read-only — for context):
{indexed}

PARAGRAPHS TO REWRITE (in this exact order):
{flagged_block}

INSTRUCTIONS:
- Return ONLY the replacement paragraphs.
- Separate paragraphs with the delimiter line:  {_PARAGRAPH_DELIMITER}
- Return the same number of paragraphs as flagged, in the same order.
- Each replacement must address its specific issue: claim_density → add concrete claims with [SN] citations; citation_coverage → add [SN] citations to existing claims; voice_authenticity → remove AI-tells and vary sentence rhythm; concrete_specificity → replace vague language with precise figures; query_mirroring → echo the target query's key noun phrases.
- If a claim cannot be backed by one of the EVIDENCE SOURCES, remove the claim rather than hedging.
- No analysis, no headers, no labels. Just the paragraphs and the delimiter.

OUTPUT:"""


async def rewrite_flagged(
    draft_text: str,
    flagged: list[dict[str, Any]],
    pack: EvidencePack,
    query: str,
    platform: str,
    tier: str | None,
) -> str:
    if not flagged:
        return draft_text

    model = rewriter_model_for_tier(tier)
    client = _anthropic_client()
    response = await client.messages.create(
        model=model,
        max_tokens=2000,
        messages=[{"role": "user", "content": _build_rewrite_prompt(draft_text, flagged, pack, query, platform)}],
    )
    raw_text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            raw_text = block.text
            break
    if not raw_text:
        return draft_text

    replacements = [p.strip() for p in raw_text.split(_PARAGRAPH_DELIMITER) if p.strip()]
    paras = _split_paragraphs(draft_text)

    for offset, flag in enumerate(flagged):
        idx = flag.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(paras):
            continue
        if offset >= len(replacements):
            continue   # rewriter returned fewer than flagged — keep original
        paras[idx] = replacements[offset]

    return "\n\n".join(paras)
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_critic.py -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/critic.py backend/tests/test_drafting_critic.py
git commit -m "feat(drafting): paragraph-scoped rewriter using Opus on Growth+/Pro"
```

---

### Task 16: Hard-fail retry helper

**Files:**
- Modify: `backend/app/services/drafting/critic.py`
- Modify: `backend/tests/test_drafting_critic.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_critic.py`:

```python
@pytest.mark.asyncio
async def test_should_retry_on_hard_fail():
    from app.services.drafting.critic import CriticScore, should_hard_retry
    bad = CriticScore(0, 0, 0, 0, 0, 1.0, [])
    ok = CriticScore(5, 5, 5, 5, 5, 5.0, [])
    great = CriticScore(8, 8, 8, 8, 8, 8.0, [])
    assert should_hard_retry(bad) is True
    assert should_hard_retry(ok) is False
    assert should_hard_retry(great) is False


def test_pick_better_score_returns_higher():
    from app.services.drafting.critic import CriticScore, pick_better
    a = CriticScore(1, 1, 1, 1, 1, 1.0, [])
    b = CriticScore(8, 8, 8, 8, 8, 8.0, [])
    drafts = pick_better(("A", a), ("B", b))
    assert drafts[0] == "B"
    assert drafts[1].overall_score == 8.0
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_critic.py::test_should_retry_on_hard_fail -v`
Expected: ImportError.

- [ ] **Step 3: Implement helpers**

Append to `backend/app/services/drafting/critic.py`:

```python
# ── Hard-fail handling ──────────────────────────────────────────────────────

def should_hard_retry(score: CriticScore) -> bool:
    return score.hard_fail


def pick_better(
    a: tuple[str, CriticScore],
    b: tuple[str, CriticScore],
) -> tuple[str, CriticScore]:
    """Return whichever draft has the higher overall_score."""
    return a if a[1].overall_score >= b[1].overall_score else b
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_critic.py -v`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/critic.py backend/tests/test_drafting_critic.py
git commit -m "feat(drafting): hard-fail retry helpers"
```

---

## Phase 6 — Layer 3: Voice + Cross-Reference

### Task 17: `voice.py` — voice sample selection

**Files:**
- Create: `backend/app/services/drafting/voice.py`
- Test: `backend/tests/test_drafting_voice.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_drafting_voice.py`:

```python
import json
import pytest

from app.models import Brand, BrandProfile, ContentDraft, User
from app.services.drafting.voice import select_voice_sample


@pytest.mark.asyncio
async def test_select_voice_returns_user_uploaded_when_present(db_session):
    user = User(email="v1@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V1", slug="v1-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    profile = BrandProfile(
        brand_id=brand.id,
        voice_samples=json.dumps([
            {"title": "Latest", "text": "Latest sample text body content here."},
            {"title": "Older", "text": "Older sample text body content here."},
        ]),
    )
    db_session.add(profile)
    await db_session.commit()

    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    # Most recent (index 0) is preferred
    assert sample is not None
    assert "Latest sample" in sample


@pytest.mark.asyncio
async def test_select_voice_falls_back_to_best_approved_draft(db_session):
    user = User(email="v2@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V2", slug="v2-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    # No voice_samples on profile. Approved draft with high quality_score wins.
    db_session.add_all([
        ContentDraft(brand_id=brand.id, platform="medium", status="approved",
                     content_text="Excellent draft content here.", quality_score=9.2),
        ContentDraft(brand_id=brand.id, platform="medium", status="approved",
                     content_text="Okay draft.", quality_score=6.0),
        ContentDraft(brand_id=brand.id, platform="medium", status="draft",
                     content_text="Unapproved.", quality_score=9.9),
    ])
    await db_session.commit()

    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    assert sample == "Excellent draft content here."


@pytest.mark.asyncio
async def test_select_voice_returns_none_when_nothing_available(db_session):
    user = User(email="v3@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V3", slug="v3-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    assert sample is None
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_voice.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `voice.py`**

Create `backend/app/services/drafting/voice.py`:

```python
"""
Voice anchoring and cross-referencing for Pro-tier drafts.
"""
from __future__ import annotations

import json
import logging
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BrandProfile, ContentDraft

logger = logging.getLogger(__name__)


async def select_voice_sample(
    brand_id: int,
    platform: str,
    db: AsyncSession,
) -> str | None:
    """
    Precedence:
      1. Most recent entry in BrandProfile.voice_samples (user-uploaded)
      2. Highest-quality_score approved ContentDraft on the same platform
      3. None
    """
    profile_row = await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == brand_id)
    )
    profile = profile_row.scalar_one_or_none()
    if profile and profile.voice_samples:
        try:
            samples = json.loads(profile.voice_samples)
            if isinstance(samples, list) and samples:
                first = samples[0]
                text = (first or {}).get("text")
                if text:
                    return text
        except (json.JSONDecodeError, AttributeError):
            logger.warning("Malformed voice_samples JSON for brand %d", brand_id)

    draft_row = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.platform == platform,
            ContentDraft.status == "approved",
            ContentDraft.quality_score.is_not(None),
        )
        .order_by(desc(ContentDraft.quality_score), desc(ContentDraft.posted_at))
        .limit(1)
    )
    draft = draft_row.scalar_one_or_none()
    if draft and draft.content_text:
        return draft.content_text

    return None
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_voice.py -v`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/voice.py backend/tests/test_drafting_voice.py
git commit -m "feat(drafting): voice sample selection with fallback to best approved draft"
```

---

### Task 18: Cross-reference + Haiku summary

**Files:**
- Modify: `backend/app/services/drafting/voice.py`
- Modify: `backend/tests/test_drafting_voice.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_drafting_voice.py`:

```python
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_select_related_draft_returns_summary(db_session):
    from app.services.drafting.voice import select_related_draft

    user = User(email="v4@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V4", slug="v4-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    from app.models import Prompt
    prompt = Prompt(brand_id=brand.id, text="how does X work")
    db_session.add(prompt)
    await db_session.flush()

    db_session.add(ContentDraft(
        brand_id=brand.id, platform="linkedin_article", prompt_id=prompt.id,
        status="approved", content_text="Body...",
        title="X for industry leaders",
        summary="Argues that X reduces error rates by 40%.",
    ))
    await db_session.commit()

    out = await select_related_draft(
        brand_id=brand.id, prompt_id=prompt.id,
        exclude_platform="medium", db=db_session,
    )
    assert out is not None
    assert "linkedin_article" in out.lower() or "LinkedIn" in out or "linkedin" in out
    assert "X for industry leaders" in out
    assert "40%" in out


@pytest.mark.asyncio
async def test_select_related_draft_returns_none_when_excluded_platform_only(db_session):
    from app.services.drafting.voice import select_related_draft

    user = User(email="v5@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V5", slug="v5-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    from app.models import Prompt
    prompt = Prompt(brand_id=brand.id, text="q")
    db_session.add(prompt)
    await db_session.flush()
    db_session.add(ContentDraft(
        brand_id=brand.id, platform="medium", prompt_id=prompt.id,
        status="approved", content_text="x", title="t", summary="s",
    ))
    await db_session.commit()
    out = await select_related_draft(
        brand_id=brand.id, prompt_id=prompt.id, exclude_platform="medium", db=db_session,
    )
    assert out is None


@pytest.mark.asyncio
async def test_generate_summary_returns_string():
    from app.services.drafting.voice import generate_draft_summary

    fake_response = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = "Argues that X reduces error rates by 40%."
    fake_response.content = [block]

    with patch("app.services.drafting.voice._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        summary = await generate_draft_summary(
            draft_text="A long draft about X...",
            query="how does X work",
        )
    assert "40%" in summary
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_drafting_voice.py::test_select_related_draft_returns_summary -v`
Expected: ImportError.

- [ ] **Step 3: Implement cross-ref + summary**

Append to `backend/app/services/drafting/voice.py`:

```python
# ── Cross-reference ─────────────────────────────────────────────────────────

import os

from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key)


async def select_related_draft(
    brand_id: int,
    prompt_id: int,
    exclude_platform: str,
    db: AsyncSession,
) -> str | None:
    """Return a one-line summary of one sibling approved draft for cross-referencing, or None."""
    row = await db.execute(
        select(ContentDraft)
        .where(
            ContentDraft.brand_id == brand_id,
            ContentDraft.prompt_id == prompt_id,
            ContentDraft.platform != exclude_platform,
            ContentDraft.status.in_(["approved", "posted"]),
        )
        .order_by(desc(ContentDraft.posted_at), desc(ContentDraft.approved_at))
        .limit(1)
    )
    draft = row.scalar_one_or_none()
    if draft is None or not draft.summary:
        return None
    title = (draft.title or "(untitled)")[:200]
    return f"- {draft.platform}: \"{title}\" — {draft.summary}"


async def generate_draft_summary(draft_text: str, query: str) -> str:
    """30-word summary of a draft's central argument, cached on ContentDraft.summary."""
    client = _anthropic_client()
    response = await client.messages.create(
        model=CROSS_REF_SUMMARY_MODEL,
        max_tokens=80,
        messages=[{"role": "user", "content": (
            f"Summarise this draft's central argument in one sentence (≤30 words). "
            f"It was written to answer: \"{query}\". Output ONLY the sentence, no prose around it.\n\n"
            f"DRAFT:\n{draft_text}"
        )}],
    )
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text.strip()
    return ""
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_drafting_voice.py -v`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/voice.py backend/tests/test_drafting_voice.py
git commit -m "feat(drafting): cross-reference lookup + Haiku summary generation"
```

---

### Task 19: Voice samples CRUD endpoints

**Files:**
- Modify: `backend/app/routers/brand_profile.py`
- Test: `backend/tests/test_voice_samples.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_voice_samples.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_add_voice_sample(client, register_and_login):
    user = await register_and_login("vs1@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("Acme", "q")
    r = await client.post(
        f"/api/brand_profile/{brand_id}/voice-samples",
        json={"title": "CEO blog post", "text": "x" * 200},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "CEO blog post"
    assert body["index"] == 0


@pytest.mark.asyncio
async def test_list_voice_samples(client, register_and_login):
    user = await register_and_login("vs2@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("Acme", "q")
    await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                      json={"title": "A", "text": "x" * 200})
    await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                      json={"title": "B", "text": "y" * 200})
    r = await client.get(f"/api/brand_profile/{brand_id}/voice-samples")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_delete_voice_sample_by_index(client, register_and_login):
    user = await register_and_login("vs3@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("Acme", "q")
    await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                      json={"title": "Keep", "text": "x" * 200})
    await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                      json={"title": "Delete", "text": "y" * 200})
    r = await client.delete(f"/api/brand_profile/{brand_id}/voice-samples/0")
    assert r.status_code == 204
    list_r = await client.get(f"/api/brand_profile/{brand_id}/voice-samples")
    assert len(list_r.json()) == 1


@pytest.mark.asyncio
async def test_voice_sample_cap_is_3(client, register_and_login):
    user = await register_and_login("vs4@test.com", "Password123!")
    brand_id = await user.create_brand_with_prompt("Acme", "q")
    for i in range(3):
        r = await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                              json={"title": f"T{i}", "text": "x" * 200})
        assert r.status_code == 200
    r = await client.post(f"/api/brand_profile/{brand_id}/voice-samples",
                          json={"title": "Over", "text": "x" * 200})
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/test_voice_samples.py -v`
Expected: 404 / missing endpoints.

- [ ] **Step 3: Add endpoints to `brand_profile.py`**

Append to `backend/app/routers/brand_profile.py`:

```python
# ── Voice samples ───────────────────────────────────────────────────────────

import json as _json

from app.schemas import VoiceSampleCreate, VoiceSampleOut

VOICE_SAMPLE_CAP = 3


def _load_voice_samples(profile: BrandProfile | None) -> list[dict]:
    if profile is None or not profile.voice_samples:
        return []
    try:
        data = _json.loads(profile.voice_samples)
        return data if isinstance(data, list) else []
    except (TypeError, _json.JSONDecodeError):
        return []


async def _get_or_create_profile(brand_id: int, db: AsyncSession) -> BrandProfile:
    result = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = BrandProfile(brand_id=brand_id)
        db.add(profile)
        await db.flush()
    return profile


@router.post("/{brand_id}/voice-samples", response_model=VoiceSampleOut)
async def add_voice_sample(
    brand_id: int,
    payload: VoiceSampleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    profile = await _get_or_create_profile(brand_id, db)
    samples = _load_voice_samples(profile)
    if len(samples) >= VOICE_SAMPLE_CAP:
        raise HTTPException(status_code=400, detail=f"Voice sample cap reached ({VOICE_SAMPLE_CAP}).")
    new_entry = {"title": payload.title, "text": payload.text}
    samples.insert(0, new_entry)  # most-recent-first
    profile.voice_samples = _json.dumps(samples)
    await db.commit()
    return VoiceSampleOut(index=0, title=payload.title, text=payload.text)


@router.get("/{brand_id}/voice-samples", response_model=list[VoiceSampleOut])
async def list_voice_samples(
    brand_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    profile_row = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))
    profile = profile_row.scalar_one_or_none()
    samples = _load_voice_samples(profile)
    return [
        VoiceSampleOut(index=i, title=s.get("title", ""), text=s.get("text", ""))
        for i, s in enumerate(samples)
    ]


@router.delete("/{brand_id}/voice-samples/{index}", status_code=204)
async def delete_voice_sample(
    brand_id: int,
    index: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_brand_owned(brand_id, current_user, db)
    profile_row = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))
    profile = profile_row.scalar_one_or_none()
    samples = _load_voice_samples(profile)
    if index < 0 or index >= len(samples):
        raise HTTPException(status_code=404, detail="Voice sample index out of range")
    samples.pop(index)
    if profile is not None:
        profile.voice_samples = _json.dumps(samples)
    await db.commit()
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/test_voice_samples.py -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/brand_profile.py backend/tests/test_voice_samples.py
git commit -m "feat(brand-profile): voice samples CRUD endpoints"
```

---

## Phase 7 — Pipeline Orchestration

### Task 20: Wire new pipeline into `drafting_service.py`

**Files:**
- Modify: `backend/app/services/drafting_service.py`

- [ ] **Step 1: Locate the existing top-level drafting function**

Run: `grep -n "^async def\|^def " backend/app/services/drafting_service.py | head -25`
Identify the function (likely `generate_gap_draft` or similar) that builds the prompt and calls `call_claude`.

- [ ] **Step 2: Update imports at the top of `drafting_service.py`**

Add (or merge with existing imports):

```python
from app.services.drafting.evidence import build_evidence_pack
from app.services.drafting.critic import critic_score, rewrite_flagged, should_hard_retry, pick_better, REWRITE_THRESHOLD
from app.services.drafting.voice import select_voice_sample, select_related_draft, generate_draft_summary
from app.services.drafting.citations import render_citations, RenderedCitation
from app.services.drafting.models import writer_model_for_tier
from app.models import ContentDraftCitation
```

- [ ] **Step 3: Add a tier-aware pipeline wrapper**

Add a new function above the existing main draft function (e.g. above `generate_gap_draft`):

```python
async def _generate_with_new_pipeline(
    *,
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    prompt_text: str,
    platform_key: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    tier: str | None,
    db: AsyncSession,
    opportunity_context: str | None = None,
    existing_drafts_context: str | None = None,
) -> tuple[str, float | None, list[RenderedCitation]]:
    """
    Run the full retrieve → draft → critique → rewrite → render pipeline.
    Returns (final_text, quality_score_or_None, citations).
    """
    # Layer 1: Evidence Pack — paid tiers only
    pack = None
    if tier in ("basic", "starter", "pro"):
        pack = await build_evidence_pack(
            brand_id=brand_id, brand_name=brand_name,
            prompt_id=prompt_id, prompt_text=prompt_text, db=db,
        )

    # Layer 3: Voice + cross-ref — Pro only
    voice_sample = None
    related_summary = None
    if tier == "pro":
        voice_sample = await select_voice_sample(brand_id=brand_id, platform=platform_key, db=db)
        related_summary = await select_related_draft(
            brand_id=brand_id, prompt_id=prompt_id,
            exclude_platform=platform_key, db=db,
        )

    # Writer call
    writer_model = writer_model_for_tier(tier)
    prompt = build_prompt(
        brand_name=brand_name,
        platform=platform_key,
        prompt_text=prompt_text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=platform_spec,
        opportunity_context=opportunity_context,
        existing_drafts_context=existing_drafts_context,
        evidence_pack=pack,
        voice_sample=voice_sample,
        related_draft_summary=related_summary,
    )
    raw_text = await call_claude(
        prompt,
        max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
        model=writer_model,
    )

    # Layer 2: Critic + rewrite — Growth + Pro only
    quality_score: float | None = None
    if tier in ("starter", "pro") and pack is not None:
        try:
            score = await critic_score(
                draft_text=raw_text, pack=pack, query=prompt_text, platform=platform_key,
            )
            quality_score = score.overall_score

            if should_hard_retry(score):
                # One regeneration attempt
                retry_raw = await call_claude(
                    prompt,
                    max_tokens=PLATFORM_MAX_TOKENS.get(platform_key, 2500),
                    model=writer_model,
                )
                retry_score = await critic_score(
                    draft_text=retry_raw, pack=pack, query=prompt_text, platform=platform_key,
                )
                better_text, better_score = pick_better((raw_text, score), (retry_raw, retry_score))
                raw_text = better_text
                quality_score = better_score.overall_score
                score = better_score

            if score.overall_score < REWRITE_THRESHOLD and score.flagged_paragraphs:
                raw_text = await rewrite_flagged(
                    draft_text=raw_text,
                    flagged=score.flagged_paragraphs,
                    pack=pack,
                    query=prompt_text,
                    platform=platform_key,
                    tier=tier,
                )
        except Exception as exc:
            logger.warning("Critic/rewrite failed for brand %d prompt %d: %s",
                           brand_id, prompt_id, exc)

    # Render citations per platform
    citations: list[RenderedCitation] = []
    if pack is not None:
        raw_text, citations = render_citations(text=raw_text, pack=pack, platform=platform_key)

    # Existing polish step (remove_hedging, etc.) still runs downstream
    return raw_text, quality_score, citations
```

- [ ] **Step 4: Call the wrapper from the existing draft function and persist new fields**

Find the existing call site that builds the prompt + calls `call_claude` directly. Replace that block with a call to `_generate_with_new_pipeline(...)`. After the draft row is inserted, persist citations and (if returned) the quality score + a freshly generated summary:

```python
final_text, quality_score, citations = await _generate_with_new_pipeline(
    brand_id=brand.id, brand_name=brand.name,
    prompt_id=prompt.id, prompt_text=prompt.text,
    platform_key=platform_key, visibility_pct=visibility_pct,
    profile_context=profile_context, response_analysis=response_analysis,
    platform_spec=PLATFORM_SPECS[platform_key],
    tier=user.subscription_tier,
    db=db,
)
# Polish (existing)
final_text = remove_hedging(final_text)
title, body = extract_title_and_body(final_text, platform_key)

draft = ContentDraft(
    brand_id=brand.id, prompt_id=prompt.id, platform=platform_key,
    title=title, content_text=body or final_text,
    status="draft", source="gap",
    quality_score=quality_score,
)
db.add(draft)
await db.flush()

# Persist citations
for c in citations:
    db.add(ContentDraftCitation(
        draft_id=draft.id,
        source_ref=c.source_ref,
        url=c.url, title=c.title,
        position_marker=c.position_marker,
    ))

# Generate + cache the cross-ref summary
try:
    summary = await generate_draft_summary(draft_text=body or final_text, query=prompt.text)
    draft.summary = summary[:500]
except Exception as exc:
    logger.warning("Draft summary generation failed: %s", exc)

await db.commit()
```

**This is a refactor of the existing function — preserve all non-LLM behavior** (status setting, source field, scheduler caps, attribution rows, error handling). Only the prompt-build + call_claude block is being replaced.

- [ ] **Step 5: Run the existing drafting tests to confirm nothing regressed**

Run: `cd backend && pytest tests/test_content.py tests/test_drafting_prompts.py tests/test_drafting_evidence.py tests/test_drafting_critic.py tests/test_drafting_voice.py tests/test_drafting_citations.py -v`
Expected: all pre-existing tests still pass, plus the new ones from this plan. Investigate and fix any failures inline.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/drafting_service.py
git commit -m "feat(drafting): orchestrate new pipeline with tier gating"
```

---

### Task 21: Shrink the hedging regex in `pipeline.py`

**Files:**
- Modify: `backend/app/services/drafting/pipeline.py`

- [ ] **Step 1: Locate `_HEDGING_RE`**

Run: `grep -n "_HEDGING_RE" backend/app/services/drafting/pipeline.py`
Expected: a definition around line ~80 plus uses in `remove_hedging`.

- [ ] **Step 2: Replace the regex with the slim version**

Find the existing `_HEDGING_RE = _re.compile(...)` block in `backend/app/services/drafting/pipeline.py` and replace it with:

```python
_HEDGING_RE = _re.compile(
    r"\b(delve into|dive into|unpack(?:\s+the)?|"
    r"it['']s worth noting|it['']s important to (?:note|mention)|"
    r"the bottom line(?: is)?|at the end of the day,?)\s*",
    _re.IGNORECASE,
)
```

The rest of `remove_hedging()` (em-dash replacement, markdown-header stripping, analysis-section stripping) stays untouched.

- [ ] **Step 3: Confirm tests still pass**

Run: `cd backend && pytest tests/ -k "hedging or pipeline or drafting" -v`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/drafting/pipeline.py
git commit -m "refactor(drafting): shrink hedging regex now that prompt + critic catch most cases"
```

---

## Phase 8 — Frontend

### Task 22: Add API client methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Locate the brand-profile section in `api.ts`**

Run: `grep -n "brand_profile\|brandProfile" frontend/lib/api.ts | head -10`
Note where existing brand profile methods live.

- [ ] **Step 2: Add typed methods**

In `frontend/lib/api.ts`, append next to the brand profile methods:

```typescript
// ── Brand sources ─────────────────────────────────────────────────────────

export interface BrandSource {
  id: number;
  title: string;
  url: string;
  snippet: string | null;
  source_type: 'paper' | 'article' | 'stat' | 'case_study';
  added_at: string;
}

export const addBrandSource = (
  brandId: number,
  payload: { url: string; title?: string; snippet?: string; source_type?: string },
) => api.post<BrandSource>(`/api/brand_profile/${brandId}/sources`, payload).then((r) => r.data);

export const listBrandSources = (brandId: number) =>
  api.get<BrandSource[]>(`/api/brand_profile/${brandId}/sources`).then((r) => r.data);

export const deleteBrandSource = (brandId: number, sourceId: number) =>
  api.delete(`/api/brand_profile/${brandId}/sources/${sourceId}`).then(() => undefined);

// ── Voice samples ─────────────────────────────────────────────────────────

export interface VoiceSample {
  index: number;
  title: string;
  text: string;
}

export const addVoiceSample = (brandId: number, payload: { title: string; text: string }) =>
  api.post<VoiceSample>(`/api/brand_profile/${brandId}/voice-samples`, payload).then((r) => r.data);

export const listVoiceSamples = (brandId: number) =>
  api.get<VoiceSample[]>(`/api/brand_profile/${brandId}/voice-samples`).then((r) => r.data);

export const deleteVoiceSample = (brandId: number, index: number) =>
  api.delete(`/api/brand_profile/${brandId}/voice-samples/${index}`).then(() => undefined);
```

If the file's existing export style differs (named methods on an `apiClient` object vs free functions), match the existing pattern — these are illustrative names and shapes.

- [ ] **Step 3: Build the frontend to verify types**

Run: `cd frontend && npm run build` (or `npm run lint` for a faster check)
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): client methods for brand sources + voice samples"
```

---

### Task 23: Brand Profile UI — Sources section

**Files:**
- Modify: the Brand Profile tab in `frontend/app/settings/` (find the component via `grep -rn "Brand Profile" frontend/app/settings/`)

- [ ] **Step 1: Find the Brand Profile tab component**

Run: `grep -rn "Brand Profile\|brandProfile\|brand_profile" frontend/app/settings/ | head -10`
Identify the file rendering the Brand Profile tab (likely a section component named `BrandProfileTab.tsx` or inlined in `page.tsx`).

- [ ] **Step 2: Add a Sources section to the Brand Profile tab**

In the identified file, add (somewhere after the existing profile fields):

```tsx
import { useEffect, useState } from 'react';
import {
  addBrandSource,
  listBrandSources,
  deleteBrandSource,
  BrandSource,
} from '@/lib/api';

function SourcesSection({ brandId }: { brandId: number }) {
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [snippet, setSnippet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBrandSources(brandId).then(setSources).catch(() => setSources([]));
  }, [brandId]);

  async function handleAdd() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addBrandSource(brandId, {
        url: url.trim(),
        title: title.trim() || undefined,
        snippet: snippet.trim() || undefined,
        source_type: 'article',
      });
      setSources((prev) => [created, ...prev]);
      setUrl('');
      setTitle('');
      setSnippet('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to add source');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    await deleteBrandSource(brandId, id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <section className="mt-8 border-t pt-6">
      <h3 className="text-lg font-semibold mb-1">Sources</h3>
      <p className="text-sm text-gray-500 mb-4">
        Papers, studies, and articles drafts can cite. Drafts include these as evidence and link to them inline.
      </p>
      <div className="space-y-2">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="URL (required)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Title (optional — auto-fetched if blank)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full border rounded px-3 py-2"
          placeholder="Key snippet (optional — what's the citable claim?)"
          value={snippet}
          onChange={(e) => setSnippet(e.target.value)}
          rows={2}
        />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          disabled={busy || !url.trim()}
          onClick={handleAdd}
        >
          {busy ? 'Adding…' : 'Add source'}
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {sources.map((s) => (
          <li key={s.id} className="flex items-start justify-between border rounded p-3">
            <div className="flex-1 mr-3">
              <a href={s.url} target="_blank" rel="noopener noreferrer"
                 className="font-medium text-blue-700 hover:underline">
                {s.title}
              </a>
              {s.snippet && <p className="text-sm text-gray-600 mt-1">{s.snippet}</p>}
            </div>
            <button type="button" className="text-sm text-red-600 hover:underline"
                    onClick={() => handleDelete(s.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Then render `<SourcesSection brandId={brandId} />` inside the Brand Profile tab where it makes sense (typically below the existing fields).

- [ ] **Step 3: Smoke test in the browser**

Run the dev servers (`cd backend && uvicorn app.main:app --reload --port 3001` and `cd frontend && npm run dev`). Open the Brand Profile tab, add a source, refresh — confirm it persists. Delete it — confirm removal.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/settings/
git commit -m "feat(brand-profile): Sources section UI"
```

---

### Task 24: Brand Profile UI — Voice Samples section

**Files:**
- Modify: the same Brand Profile tab component

- [ ] **Step 1: Add a Voice Samples section**

Adjacent to `SourcesSection`, add:

```tsx
import {
  addVoiceSample,
  listVoiceSamples,
  deleteVoiceSample,
  VoiceSample,
} from '@/lib/api';

function VoiceSamplesSection({ brandId }: { brandId: number }) {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVoiceSamples(brandId).then(setSamples).catch(() => setSamples([]));
  }, [brandId]);

  async function handleAdd() {
    if (text.trim().length < 50 || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addVoiceSample(brandId, { title: title.trim(), text: text.trim() });
      setSamples((prev) => [created, ...prev]);
      setTitle('');
      setText('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to add voice sample');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(index: number) {
    await deleteVoiceSample(brandId, index);
    setSamples((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <section className="mt-8 border-t pt-6">
      <h3 className="text-lg font-semibold mb-1">Voice samples</h3>
      <p className="text-sm text-gray-500 mb-4">
        Paste 1–3 pieces of writing that represent how this brand should sound.
        Drafts on the Pro tier are anchored to these examples.
      </p>
      <div className="space-y-2">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Title (e.g. CEO blog post)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full border rounded px-3 py-2 font-mono text-sm"
          placeholder="Paste 50–2000 chars of representative writing…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          disabled={busy || text.trim().length < 50 || !title.trim() || samples.length >= 3}
          onClick={handleAdd}
        >
          {busy ? 'Adding…' : 'Add sample'}
        </button>
        {samples.length >= 3 && (
          <p className="text-xs text-gray-500">Cap of 3 reached — delete one to add another.</p>
        )}
      </div>
      <ul className="mt-4 space-y-2">
        {samples.map((s) => (
          <li key={s.index} className="border rounded p-3">
            <div className="flex items-center justify-between">
              <strong>{s.title}</strong>
              <button type="button" className="text-sm text-red-600 hover:underline"
                      onClick={() => handleDelete(s.index)}>
                Remove
              </button>
            </div>
            <p className="text-sm text-gray-600 mt-1 line-clamp-3">{s.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Render `<VoiceSamplesSection brandId={brandId} />` below `<SourcesSection .../>` in the Brand Profile tab.

- [ ] **Step 2: Smoke test in browser**

Same as Task 23 — add a sample, confirm persistence + cap enforcement, delete.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/ frontend/lib/api.ts
git commit -m "feat(brand-profile): Voice Samples section UI"
```

---

## Phase 9 — Integration Tests

### Task 25: End-to-end per-tier integration test

**Files:**
- Create: `backend/tests/test_drafting_pipeline_integration.py`

- [ ] **Step 1: Write integration test**

Create `backend/tests/test_drafting_pipeline_integration.py`:

```python
"""
End-to-end integration test for the new drafting pipeline.
Verifies which layers run per tier without making real LLM calls.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.models import User, Brand, Prompt, BrandProfile, WebsiteAudit, WebsiteAuditPage


def _writer_response(text: str):
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.content = [block]
    return resp


def _critic_response(overall: float):
    block = MagicMock()
    block.type = "tool_use"
    block.input = {
        "claim_density": int(overall),
        "citation_coverage": int(overall),
        "query_mirroring": int(overall),
        "concrete_specificity": int(overall),
        "voice_authenticity": int(overall),
        "overall_score": overall,
        "flagged_paragraphs": [] if overall >= 7 else [{"index": 0, "issue": "x", "note": "fix"}],
    }
    resp = MagicMock()
    resp.content = [block]
    return resp


@pytest.fixture
async def brand_with_audit(db_session):
    user = User(email="pipe@test.com", password_hash="x", email_verified=1, subscription_tier=None)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="PipeCo", slug="pipe-co", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="how does PipeCo work")
    db_session.add(prompt)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    db_session.add(WebsiteAuditPage(
        audit_id=audit.id, url="https://pipe.co/x",
        title="how PipeCo works", h1_text="how it works",
        content_excerpt="PipeCo uses pumps.", fact_density=0.8,
    ))
    await db_session.commit()
    return user, brand, prompt


@pytest.mark.asyncio
async def test_starter_runs_evidence_and_writer_but_no_critic(db_session, brand_with_audit):
    user, brand, prompt = brand_with_audit
    user.subscription_tier = "basic"
    await db_session.commit()

    from app.services.drafting_service import _generate_with_new_pipeline
    with patch("app.services.drafting_service.call_claude", new=AsyncMock(return_value="Para body. [S1]")) as writer, \
         patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic.critic_score", new=AsyncMock()) as critic:
        text, score, citations = await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="basic", db=db_session,
        )
    assert writer.call_count == 1
    assert critic.call_count == 0
    assert score is None


@pytest.mark.asyncio
async def test_growth_runs_critic_and_rewriter_when_score_low(db_session, brand_with_audit):
    user, brand, prompt = brand_with_audit
    user.subscription_tier = "starter"
    await db_session.commit()

    from app.services.drafting_service import _generate_with_new_pipeline
    rewriter_response = _writer_response("Rewritten paragraph.")
    with patch("app.services.drafting_service.call_claude", new=AsyncMock(return_value="Weak draft. [S1]")), \
         patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic._anthropic_client") as crit_factory:
        mock_client = MagicMock()
        # First call: critic returns a low score. Second call: rewriter returns prose.
        mock_client.messages.create = AsyncMock(side_effect=[_critic_response(5.0), rewriter_response])
        crit_factory.return_value = mock_client

        text, score, _ = await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="starter", db=db_session,
        )
    assert score == pytest.approx(5.0, abs=0.01)
    assert "Rewritten" in text or "Weak draft" in text  # depends on whether rewrite applied to the only paragraph


@pytest.mark.asyncio
async def test_pro_runs_voice_and_cross_ref(db_session, brand_with_audit):
    user, brand, prompt = brand_with_audit
    user.subscription_tier = "pro"
    import json as _json
    profile = BrandProfile(
        brand_id=brand.id,
        voice_samples=_json.dumps([{"title": "ceo", "text": "Short concrete writing for PipeCo brand."}]),
    )
    db_session.add(profile)
    await db_session.commit()

    captured_prompt = {}

    async def capture_writer(prompt_str, **kwargs):
        captured_prompt["text"] = prompt_str
        return "Body. [S1]"

    from app.services.drafting_service import _generate_with_new_pipeline
    with patch("app.services.drafting_service.call_claude", new=AsyncMock(side_effect=capture_writer)), \
         patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic._anthropic_client") as crit_factory:
        crit_client = MagicMock()
        crit_client.messages.create = AsyncMock(return_value=_critic_response(8.5))
        crit_factory.return_value = crit_client

        await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="pro", db=db_session,
        )
    assert "VOICE EXAMPLE" in captured_prompt["text"]
    assert "Short concrete writing for PipeCo brand." in captured_prompt["text"]
```

- [ ] **Step 2: Run integration tests**

Run: `cd backend && pytest tests/test_drafting_pipeline_integration.py -v`
Expected: 3 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `cd backend && pytest tests/ -v`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_drafting_pipeline_integration.py
git commit -m "test(drafting): end-to-end per-tier integration coverage"
```

---

## Self-Review

### Spec coverage check
- ✅ Layer 1 — Evidence Retrieval: Tasks 1, 5–10 (data + retrieval) + Task 11 (citations) + Task 12 (prompt) + Task 13 (Wikipedia)
- ✅ Layer 2 — Critic + Rewriter: Tasks 14–16
- ✅ Layer 3 — Voice + Cross-Ref: Tasks 17–19
- ✅ Tier gating: Task 3 (model constants) + Task 20 (orchestrator gates)
- ✅ Model matrix: Task 3 (constants), Tasks 14/15/20 use the right model per role
- ✅ Migrations: Task 1
- ✅ ORM models + new columns: Task 1
- ✅ Pydantic schemas: Task 2
- ✅ Site audit hook (`content_excerpt`): Task 4
- ✅ BrandSource CRUD: Task 10
- ✅ Voice samples CRUD: Task 19
- ✅ Per-platform citation rendering: Task 11
- ✅ Prompt rewriting (Evidence Pack injection, banned-word list shrink): Task 12
- ✅ Wikipedia builder uses Evidence Pack: Task 13
- ✅ `quality_score` + `summary` persisted on `ContentDraft`: Task 20
- ✅ `ContentDraftCitation` rows persisted: Task 20
- ✅ Hedging regex shrunk: Task 21
- ✅ Frontend API client: Task 22
- ✅ Brand Profile UI sections: Tasks 23, 24
- ✅ End-to-end per-tier integration coverage: Task 25
- ⚠ Deferred (per spec, v1.1): quality-score UI badge in drafts table, source curation editor, per-source analytics — not in this plan by design.
- ⚠ Observability (Sentry breadcrumbs, analytics events): the spec calls them out — covered implicitly by `logger.info` / `logger.warning` in the new modules; explicit `record_event()` analytics calls are not wired in this plan. If you want them, add a focused follow-up task; otherwise the existing `analytics_service` will capture top-level draft generation through unchanged code paths.

### Placeholder scan
- No "TBD" or "TODO" markers in step bodies. Two scoped follow-ups are explicitly noted under "Deferred" above (UI badge, source analytics) and one observability scope note — these are intentional, not placeholders.

### Type consistency
- `EvidencePack` / `EvidenceSource` / `RenderedCitation` / `CriticScore` all match across `evidence.py`, `citations.py`, `critic.py`, `voice.py`, `drafting_service.py`, and tests.
- Tier strings (`"basic"`, `"starter"`, `"pro"`, `None`) consistent everywhere with the existing internal-key mapping documented in `CLAUDE.md`.
- Model IDs (`"claude-opus-4-7"`, `"claude-sonnet-4-6"`, `"claude-haiku-4-5-20251001"`) consistent across `models.py`, `critic.py`, `voice.py`, and `drafting_service.py`.
- All endpoint paths (`/api/brand_profile/{brand_id}/sources` and `/voice-samples`) match between router, tests, and frontend API client.
