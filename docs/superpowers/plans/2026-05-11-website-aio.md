# Website AIO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Website AI-Optimization module per `docs/superpowers/specs/2026-05-11-website-aio-design.md` — site crawler, per-page audit, AI-bot accessibility checks, citation extraction, page↔prompt linking, recommendations, generators, full frontend.

**Architecture:** New backend package `services/site_audit/` with focused parser/orchestrator modules. Five new SQLAlchemy tables + migrations. New FastAPI router at `/api/site-audit`. New frontend section under `/site-audit/[brandId]`. Citation extraction hooks into existing `tracking_service` post-run pipeline. Playwright for render-mode detection.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 (async), BeautifulSoup4 + lxml, Playwright (chromium), tldextract, httpx, pytest (asyncio_mode=auto), Next.js 15, TypeScript, Recharts.

---

## Conventions

- All new code follows the existing patterns: async `AsyncSessionLocal` for DB, `get_current_user` for auth, `AllowUnverifiedUser` not applicable here.
- Tests use the shared `client`, `db_session`, `register_and_login`, `create_brand` helpers in `tests/conftest.py`. Add `"website_audits"` and the other new tables to the `clean_tables` truncate list (see Task 3).
- Models use `Mapped[...]` + `mapped_column(...)` per SQLAlchemy 2.0 syntax.
- Migrations appended (never modified) at the bottom of `database.py:run_migrations()`.
- New parser HTML fixtures live in `backend/tests/fixtures/site_audit/`.
- Frontend uses existing components patterns from `components/site-audit/` (new dir) mirroring `components/agency/` style.

---

## File Structure

### Backend — new files

| Path | Responsibility |
|---|---|
| `backend/app/services/site_audit/__init__.py` | Package marker |
| `backend/app/services/site_audit/constants.py` | AI bot UAs, check IDs, tier limits, third-party allowlist, URL normaliser |
| `backend/app/services/site_audit/fetcher.py` | `fetch_raw(url)` httpx + `fetch_rendered(url)` Playwright + diff helper |
| `backend/app/services/site_audit/crawler.py` | Sitemap discovery, BFS, polite-fetch loop, queue/dedup |
| `backend/app/services/site_audit/page_classifier.py` | URL + DOM → `page_type` |
| `backend/app/services/site_audit/parsers/__init__.py` | Package marker |
| `backend/app/services/site_audit/parsers/semantic.py` | Heading hygiene, lists, tables, answer-first, fact density |
| `backend/app/services/site_audit/parsers/schema.py` | JSON-LD extraction + shape validation |
| `backend/app/services/site_audit/parsers/robots.py` | robots.txt → AI bot status map |
| `backend/app/services/site_audit/parsers/llms_txt.py` | llms.txt fetch + spec validation |
| `backend/app/services/site_audit/parsers/meta.py` | Title, meta description, byline, dates, alts |
| `backend/app/services/site_audit/scoring.py` | Per-page + audit sub-scores |
| `backend/app/services/site_audit/auditor.py` | Orchestrator: crawl → parse → score → link → recommend |
| `backend/app/services/site_audit/citations.py` | URL extraction + classification |
| `backend/app/services/site_audit/page_prompt_link.py` | Match own-domain pages to losing prompts |
| `backend/app/services/site_audit/recommendations.py` | Rule-based recs + LLM rewrites |
| `backend/app/services/site_audit/generators.py` | `llms.txt` + robots snippet builders |
| `backend/app/routers/site_audit.py` | API endpoints |
| `backend/scripts/backfill_citations.py` | One-shot citation backfill |

### Backend — modified

| Path | Reason |
|---|---|
| `backend/app/models.py` | +5 ORM models |
| `backend/app/database.py` | +migration steps for new tables/indexes |
| `backend/app/schemas.py` | +Pydantic response shapes |
| `backend/app/main.py` | Register `site_audit.router` |
| `backend/app/services/tracking_service.py` | Call `citations.extract_for_run` post-run |
| `backend/requirements.txt` | +beautifulsoup4, lxml, playwright, tldextract |
| `backend/tests/conftest.py` | Add new tables to truncate list |

### Frontend — new files

| Path | Responsibility |
|---|---|
| `frontend/app/site-audit/[brandId]/page.tsx` | Main audit dashboard (5 tabs) |
| `frontend/app/site-audit/[brandId]/audit/[auditId]/page.tsx` | Historical audit detail |
| `frontend/app/site-audit/[brandId]/audit/[auditId]/pages/[pageId]/page.tsx` | Per-page detail |
| `frontend/app/agency/clients/[id]/audit/page.tsx` | Agency staff view |
| `frontend/components/site-audit/AuditTriggerButton.tsx` | Run/cancel control |
| `frontend/components/site-audit/AuditOverviewCard.tsx` | Radar of 4 sub-scores |
| `frontend/components/site-audit/AuditScoreHeadline.tsx` | Big score + trend |
| `frontend/components/site-audit/CriticalFindingsList.tsx` | Top critical/high findings |
| `frontend/components/site-audit/BotAccessPanel.tsx` | 8-bot status grid |
| `frontend/components/site-audit/LlmsTxtPanel.tsx` | llms.txt status + regenerate |
| `frontend/components/site-audit/GeneratorsCard.tsx` | Download buttons |
| `frontend/components/site-audit/PageList.tsx` | Sortable page table |
| `frontend/components/site-audit/PageDetail.tsx` | Findings + recs for one page |
| `frontend/components/site-audit/CitationDomainList.tsx` | Bar chart of cited domains |
| `frontend/components/site-audit/RecommendationsList.tsx` | Priority-grouped recs |

### Frontend — modified

| Path | Reason |
|---|---|
| `frontend/lib/api.ts` | +`siteAudit.*` methods |
| `frontend/components/Sidebar.tsx` (or whatever the nav component is — verify in Task 30) | Add Site Audit nav item |

---

## Task Ordering Rationale

Tasks proceed bottom-up: foundation → fetcher → parsers (tested in isolation with HTML fixtures) → scoring → citation pipeline → linker → recommendations → generators → orchestrator → router → frontend. Each layer is testable before the next is built. Commit per task. Run `pytest` at the end of every task.

Phases:
1. **Foundation** (Tasks 1–4) — deps, constants, models, migrations
2. **Fetching + Crawling** (Tasks 5–8) — raw HTML, Playwright, sitemap, BFS
3. **Parsers** (Tasks 9–13) — semantic, schema, robots, llms.txt, meta
4. **Page classification + scoring** (Tasks 14–15)
5. **Citation pipeline** (Tasks 16–18) — extraction, classification, backfill
6. **Linking + Recommendations + Generators** (Tasks 19–21)
7. **Orchestrator + Router + Schemas** (Tasks 22–25)
8. **Frontend** (Tasks 26–34)
9. **Integration + Polish** (Tasks 35–37)

---

## Phase 1 — Foundation

### Task 1: Install dependencies & Playwright Chromium

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add new deps**

Append to `backend/requirements.txt`:

```
beautifulsoup4==4.12.3
lxml==5.3.0
playwright==1.49.1
tldextract==5.1.3
```

- [ ] **Step 2: Install**

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium
```

Expected: chromium download, no errors.

- [ ] **Step 3: Smoke-test Playwright**

```bash
python -c "from playwright.async_api import async_playwright; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "deps(site-audit): add bs4/lxml/playwright/tldextract"
```

---

### Task 2: Add ORM models for the 5 new tables

**Files:**
- Modify: `backend/app/models.py` (append after the last existing model)

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_site_audit_models.py`:

```python
"""Sanity tests that the new site_audit models register and persist."""
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, User, WebsiteAudit, WebsiteAuditPage,
    WebsiteAuditFinding, WebsiteAuditRecommendation, CitationSource,
    utcnow,
)


@pytest.mark.asyncio
async def test_website_audit_round_trip():
    async with AsyncSessionLocal() as db:
        user = User(email="a@x.com", password_hash="x", email_verified=True)
        db.add(user)
        await db.flush()
        brand = Brand(name="B", slug="b", user_id=user.id, website_url="https://b.com")
        db.add(brand)
        await db.flush()

        audit = WebsiteAudit(
            brand_id=brand.id, status="pending", triggered_by="user", started_at=utcnow()
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)

        assert audit.id is not None

        page = WebsiteAuditPage(
            audit_id=audit.id, url="https://b.com/", depth=0, page_type="homepage"
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        assert page.id is not None

        finding = WebsiteAuditFinding(
            audit_id=audit.id, page_id=page.id, check_id="missing_h1",
            severity="high", category="content", message="No H1 found", evidence="{}",
        )
        rec = WebsiteAuditRecommendation(
            audit_id=audit.id, page_id=page.id, priority="high", effort="low",
            category="content", title="Add an H1", body="...",
        )
        cite = CitationSource(
            brand_id=brand.id, tracking_run_id=None, prompt_id=None, query_result_id=None,
            model="chatgpt", url="https://x.com/a", domain="x.com", kind="competitor",
        )
        # NOTE: tracking_run_id / prompt_id / query_result_id are FK-nullable for this smoke
        db.add_all([finding, rec, cite])
        await db.commit()

        rows = (await db.execute(select(WebsiteAuditFinding))).scalars().all()
        assert len(rows) == 1
```

- [ ] **Step 2: Run test — expect failure**

```bash
pytest backend/tests/test_site_audit_models.py -v
```

Expected: ImportError — `WebsiteAudit` etc. not defined.

- [ ] **Step 3: Add the 5 models to `models.py`**

Append after the last existing model in `backend/app/models.py`:

```python
# ── Website AIO module ───────────────────────────────────────────────────────

class WebsiteAudit(Base):
    __tablename__ = "website_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    pages_failed: Mapped[int] = mapped_column(Integer, default=0)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    bot_access_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    schema_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    technical_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    render_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sitemap_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    robots_txt_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    llms_txt_present: Mapped[bool] = mapped_column(Boolean, default=False)
    llms_txt_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class WebsiteAuditPage(Base):
    __tablename__ = "website_audit_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetch_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_type: Mapped[str] = mapped_column(String(20), default="other")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    h1_text: Mapped[str | None] = mapped_column(String(512), nullable=True)
    h2_count: Mapped[int] = mapped_column(Integer, default=0)
    h3_count: Mapped[int] = mapped_column(Integer, default=0)
    table_count: Mapped[int] = mapped_column(Integer, default=0)
    list_count: Mapped[int] = mapped_column(Integer, default=0)
    fact_density: Mapped[float] = mapped_column(Float, default=0.0)
    outbound_links: Mapped[int] = mapped_column(Integer, default=0)
    internal_links: Mapped[int] = mapped_column(Integer, default=0)
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    image_alt_pct: Mapped[float] = mapped_column(Float, default=0.0)
    has_jsonld: Mapped[bool] = mapped_column(Boolean, default=False)
    schema_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_js_rendered: Mapped[bool] = mapped_column(Boolean, default=False)
    page_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    structure_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    schema_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_html_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rendered_html_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetch_error: Mapped[str | None] = mapped_column(String(255), nullable=True)


class WebsiteAuditFinding(Base):
    __tablename__ = "website_audit_findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    page_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("website_audit_pages.id", ondelete="CASCADE"), nullable=True, index=True)
    check_id: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class WebsiteAuditRecommendation(Base):
    __tablename__ = "website_audit_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    page_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("website_audit_pages.id", ondelete="CASCADE"), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(8), nullable=False)
    effort: Mapped[str] = mapped_column(String(8), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    linked_prompt_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_impact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    llm_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class CitationSource(Base):
    __tablename__ = "citation_sources"
    __table_args__ = (
        UniqueConstraint("query_result_id", "url", name="uq_citation_qr_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    tracking_run_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=True, index=True)
    prompt_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=True, index=True)
    query_result_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("query_results.id", ondelete="CASCADE"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    competitor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("competitors.id", ondelete="SET NULL"), nullable=True)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
```

- [ ] **Step 4: Run test — expect pass**

```bash
pytest backend/tests/test_site_audit_models.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_site_audit_models.py
git commit -m "feat(site-audit): ORM models for audits/pages/findings/recommendations/citations"
```

---

### Task 3: Add migrations + update test truncate list

**Files:**
- Modify: `backend/app/database.py` (append migration steps at the bottom of `run_migrations()`)
- Modify: `backend/tests/conftest.py` (add new table names to truncate list)

- [ ] **Step 1: Add migrations**

Open `backend/app/database.py` and locate the bottom of `run_migrations()`. Append:

```python
    # ── Website AIO module ─────────────────────────────────────────────────
    # (create_all in startup handles new tables; these are explicit indexes
    # for query patterns the ORM doesn't infer automatically.)
    try:
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_website_audit_brand_started "
            "ON website_audits(brand_id, started_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_finding_audit_severity "
            "ON website_audit_findings(audit_id, severity)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_citation_brand_domain "
            "ON citation_sources(brand_id, domain)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_citation_brand_prompt "
            "ON citation_sources(brand_id, prompt_id)"
        ))
        logger.info("migration: site_audit indexes ensured")
    except Exception as exc:
        logger.warning("site_audit indexes migration skipped: %s", exc)
```

- [ ] **Step 2: Update truncate list**

In `backend/tests/conftest.py`, inside `clean_tables`, add the five table names BEFORE `brands` (FK order matters):

```python
            "citation_sources",
            "website_audit_recommendations",
            "website_audit_findings",
            "website_audit_pages",
            "website_audits",
```

- [ ] **Step 3: Run the model test to confirm cleanup works**

```bash
pytest backend/tests/test_site_audit_models.py -v
```

Expected: 1 passed. Re-run to confirm no leftover-row failures:

```bash
pytest backend/tests/test_site_audit_models.py -v
```

Expected: still 1 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/app/database.py backend/tests/conftest.py
git commit -m "feat(site-audit): migrations + test truncate list"
```

---

### Task 4: Constants module + URL normaliser

**Files:**
- Create: `backend/app/services/site_audit/__init__.py` (empty)
- Create: `backend/app/services/site_audit/constants.py`
- Create: `backend/tests/test_site_audit_constants.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_site_audit_constants.py`:

```python
import pytest

from app.services.site_audit.constants import (
    AI_BOT_USER_AGENTS, THIRD_PARTY_AUTHORITY_DOMAINS,
    TIER_AUDIT_LIMITS, normalise_url,
)


def test_ai_bots_include_all_expected():
    expected = {
        "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai",
        "PerplexityBot", "Google-Extended", "Meta-ExternalAgent",
        "Applebot-Extended", "Amazonbot",
    }
    assert set(AI_BOT_USER_AGENTS) == expected


def test_third_party_allowlist_has_wikipedia_and_reddit():
    assert "wikipedia.org" in THIRD_PARTY_AUTHORITY_DOMAINS
    assert "reddit.com" in THIRD_PARTY_AUTHORITY_DOMAINS


def test_tier_limits_excludes_free():
    assert "basic" in TIER_AUDIT_LIMITS
    assert "starter" in TIER_AUDIT_LIMITS
    assert "pro" in TIER_AUDIT_LIMITS
    assert None not in TIER_AUDIT_LIMITS
    assert TIER_AUDIT_LIMITS["basic"]["max_pages"] == 50
    assert TIER_AUDIT_LIMITS["pro"]["max_pages"] == 250


@pytest.mark.parametrize("input_url,expected", [
    ("HTTPS://Example.COM/", "https://example.com/"),
    ("https://example.com/foo/", "https://example.com/foo"),
    ("https://example.com/foo#section", "https://example.com/foo"),
    ("https://example.com:443/foo", "https://example.com/foo"),
    ("http://example.com:80/", "http://example.com/"),
    ("https://example.com/foo?b=2&a=1", "https://example.com/foo?a=1&b=2"),
    ("example.com/foo", "https://example.com/foo"),
])
def test_normalise_url_canonical(input_url, expected):
    assert normalise_url(input_url) == expected


def test_normalise_url_invalid():
    with pytest.raises(ValueError):
        normalise_url("not a url at all")
```

- [ ] **Step 2: Run test — expect failure**

```bash
pytest backend/tests/test_site_audit_constants.py -v
```

Expected: ImportError.

- [ ] **Step 3: Create the package + constants module**

Create `backend/app/services/site_audit/__init__.py`:

```python
"""Website AIO audit module — see docs/superpowers/specs/2026-05-11-website-aio-design.md"""
```

Create `backend/app/services/site_audit/constants.py`:

```python
"""Constants for the Website AIO audit module."""
from __future__ import annotations

from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

# AI crawler user-agents we check for in robots.txt and report on.
AI_BOT_USER_AGENTS: list[str] = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "Meta-ExternalAgent",
    "Applebot-Extended",
    "Amazonbot",
]

# Registered domains we classify as 'third_party authority' citations
THIRD_PARTY_AUTHORITY_DOMAINS: set[str] = {
    "wikipedia.org", "g2.com", "capterra.com", "trustradius.com",
    "reddit.com", "linkedin.com", "youtube.com", "github.com",
    "medium.com", "stackoverflow.com", "quora.com",
    "producthunt.com", "crunchbase.com",
}

# Per-tier audit gating (internal tier keys: basic/starter/pro; Free=None excluded).
TIER_AUDIT_LIMITS: dict[str, dict] = {
    "basic":   {"max_pages": 50,  "monthly_audits": 4,   "llm_rewrites": 0},
    "starter": {"max_pages": 100, "monthly_audits": 8,   "llm_rewrites": 5},
    "pro":     {"max_pages": 250, "monthly_audits": 999, "llm_rewrites": 15},
}

# Crawler config
AUDIT_USER_AGENT = "LumidianAuditBot/1.0 (+https://lumidian.ai/bot)"
PER_PAGE_TIMEOUT_S = 10
PER_AUDIT_BUDGET_S = 300
PER_AUDIT_CONCURRENCY = 4
MAX_CONCURRENT_AUDITS = 3
HOST_REQUESTS_PER_SECOND = 1.0
RENDER_SAMPLE_SIZE = 5  # pages sent through Playwright per audit

# Scoring weights (used in scoring.py; defined here for centralisation)
PAGE_SCORE_WEIGHTS = {
    "structure": 0.30,
    "content":   0.35,
    "schema":    0.15,
    "technical": 0.20,
}

# Penalties used in bot_access_score (out of 100)
BOT_ACCESS_BLOCK_PENALTY = {
    "OAI-SearchBot":      40,
    "GPTBot":             15,
    "ClaudeBot":          15,
    "Google-Extended":    15,
    "PerplexityBot":       5,
    "ChatGPT-User":        5,
    "anthropic-ai":        5,
    "Meta-ExternalAgent":  5,
    "Applebot-Extended":   5,
    "Amazonbot":           5,
}


def _strip_default_port(netloc: str, scheme: str) -> str:
    if scheme == "http" and netloc.endswith(":80"):
        return netloc[:-3]
    if scheme == "https" and netloc.endswith(":443"):
        return netloc[:-4]
    return netloc


def normalise_url(url: str) -> str:
    """Canonical URL form for crawler-dedup, citation-matching, and storage.

    Rules:
      - Lowercase scheme + host
      - Default 'https://' if scheme missing
      - Strip fragment
      - Strip default port
      - Sort query params alphabetically
      - Trim trailing slash on non-root paths
      - Never decode percent-encoding
    """
    if not url or not isinstance(url, str):
        raise ValueError("url must be a non-empty string")

    raw = url.strip()
    if not raw:
        raise ValueError("url is empty")

    if "://" not in raw:
        raw = "https://" + raw

    p = urlparse(raw)
    if not p.netloc:
        raise ValueError(f"url has no host: {url!r}")
    if p.scheme not in ("http", "https"):
        raise ValueError(f"unsupported scheme: {p.scheme!r}")

    scheme = p.scheme.lower()
    netloc = _strip_default_port(p.netloc.lower(), scheme)

    path = p.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    qs = urlencode(sorted(parse_qsl(p.query, keep_blank_values=True))) if p.query else ""

    return urlunparse((scheme, netloc, path, "", qs, ""))
```

- [ ] **Step 4: Run test — expect pass**

```bash
pytest backend/tests/test_site_audit_constants.py -v
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/__init__.py backend/app/services/site_audit/constants.py backend/tests/test_site_audit_constants.py
git commit -m "feat(site-audit): constants module + URL normaliser"
```

---

## Phase 2 — Fetching & Crawling

### Task 5: Fetcher — raw HTML via httpx + rendered HTML via Playwright

**Files:**
- Create: `backend/app/services/site_audit/fetcher.py`
- Create: `backend/tests/test_site_audit_fetcher.py`
- Create: `backend/tests/fixtures/site_audit/__init__.py` (empty)
- Create: `backend/tests/fixtures/site_audit/static_server.py`

- [ ] **Step 1: Add a tiny local HTTP fixture server**

`backend/tests/fixtures/site_audit/static_server.py`:

```python
"""Local aiohttp server for site_audit tests — serves canned HTML by path."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from aiohttp import web


def make_app(routes: dict[str, tuple[int, str, str]]) -> web.Application:
    """routes: { path: (status, content_type, body) }"""
    app = web.Application()

    async def handler(request: web.Request) -> web.Response:
        entry = routes.get(request.path)
        if entry is None:
            return web.Response(status=404, text="not found")
        status, ctype, body = entry
        return web.Response(status=status, content_type=ctype, text=body)

    app.router.add_route("GET", "/{path:.*}", handler)
    return app


@asynccontextmanager
async def run_server(routes: dict[str, tuple[int, str, str]], port: int = 0):
    app = make_app(routes)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    actual_port = site._server.sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{actual_port}"
    finally:
        await runner.cleanup()
```

Add `aiohttp` to `backend/requirements-test.txt` if not present.

- [ ] **Step 2: Write failing tests**

`backend/tests/test_site_audit_fetcher.py`:

```python
import pytest

from app.services.site_audit.fetcher import (
    fetch_raw, fetch_rendered, classify_render_mode, FetchResult,
)
from tests.fixtures.site_audit.static_server import run_server

SSR_BODY = "<html><body><h1>Real Page</h1><p>Lots of server-side content here. " + ("blah " * 200) + "</p></body></html>"
SPA_SHELL = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'


@pytest.mark.asyncio
async def test_fetch_raw_returns_html():
    async with run_server({"/": (200, "text/html", SSR_BODY)}) as base:
        res = await fetch_raw(base + "/")
        assert isinstance(res, FetchResult)
        assert res.status == 200
        assert "Real Page" in res.html
        assert res.error is None


@pytest.mark.asyncio
async def test_fetch_raw_handles_404():
    async with run_server({}) as base:
        res = await fetch_raw(base + "/missing")
        assert res.status == 404
        assert res.error is None  # 404 is not an "error" — it's a status


@pytest.mark.asyncio
async def test_fetch_raw_timeout(monkeypatch):
    # set very small timeout to force trip
    res = await fetch_raw("http://10.255.255.1/", timeout_s=0.5)
    assert res.status is None
    assert res.error and "timeout" in res.error.lower() or "connect" in res.error.lower()


@pytest.mark.asyncio
async def test_classify_render_mode_ssr():
    assert classify_render_mode(SSR_BODY, SSR_BODY) == "ssr"


@pytest.mark.asyncio
async def test_classify_render_mode_csr():
    rendered = "<html><body><h1>After JS</h1>" + ("content " * 200) + "</body></html>"
    assert classify_render_mode(SPA_SHELL, rendered) == "csr"


@pytest.mark.asyncio
async def test_classify_render_mode_noscript_marker():
    raw = '<html><body><noscript>You need to enable JavaScript</noscript></body></html>'
    assert classify_render_mode(raw, raw) == "csr"


@pytest.mark.asyncio
async def test_fetch_rendered_against_static_server():
    async with run_server({"/": (200, "text/html", SSR_BODY)}) as base:
        res = await fetch_rendered(base + "/")
        assert res.status == 200
        assert "Real Page" in res.html
```

- [ ] **Step 3: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_fetcher.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement fetcher**

`backend/app/services/site_audit/fetcher.py`:

```python
"""Raw HTML (httpx) and rendered HTML (Playwright) fetchers + render-mode classifier."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from time import perf_counter

import httpx

from app.services.site_audit.constants import AUDIT_USER_AGENT, PER_PAGE_TIMEOUT_S

logger = logging.getLogger(__name__)

_SCRIPT_RE = re.compile(r"<(script|style|template)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_NOSCRIPT_JS_HINT_RE = re.compile(r"<noscript[^>]*>\s*[^<]*JavaScript[^<]*", re.IGNORECASE)


@dataclass
class FetchResult:
    url: str
    status: int | None
    html: str
    fetch_ms: int | None
    error: str | None = None


async def fetch_raw(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
    """Fetch raw HTML via httpx. No JS execution. Never raises."""
    started = perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers={"User-Agent": AUDIT_USER_AGENT, "Accept": "text/html,*/*"},
        ) as client:
            resp = await client.get(url)
            ms = int((perf_counter() - started) * 1000)
            text = ""
            ctype = resp.headers.get("content-type", "")
            if "html" in ctype or not ctype:
                text = resp.text
            return FetchResult(url=url, status=resp.status_code, html=text, fetch_ms=ms)
    except httpx.TimeoutException:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error="timeout")
    except httpx.HTTPError as exc:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"http_error: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_raw unexpected error for %s: %s", url, exc)
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"unexpected: {exc}")


async def fetch_rendered(url: str, timeout_s: float = PER_PAGE_TIMEOUT_S) -> FetchResult:
    """Fetch JS-rendered HTML via Playwright Chromium. Never raises."""
    try:
        from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    except ImportError as exc:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"playwright_missing: {exc}")

    started = perf_counter()
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page(user_agent=AUDIT_USER_AGENT)
                try:
                    resp = await page.goto(url, wait_until="networkidle", timeout=timeout_s * 1000)
                    html = await page.content()
                    status = resp.status if resp else None
                    ms = int((perf_counter() - started) * 1000)
                    return FetchResult(url=url, status=status, html=html, fetch_ms=ms)
                finally:
                    await page.close()
            finally:
                await browser.close()
    except PWTimeout:
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error="render_timeout")
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_rendered unexpected error for %s: %s", url, exc)
        return FetchResult(url=url, status=None, html="", fetch_ms=None, error=f"render_error: {exc}")


def _visible_text_length(html: str) -> int:
    """Length of visible text inside <body>, stripping scripts/styles/templates."""
    if not html:
        return 0
    no_scripts = _SCRIPT_RE.sub(" ", html)
    plain = _TAG_RE.sub(" ", no_scripts)
    collapsed = _WS_RE.sub(" ", plain).strip()
    return len(collapsed)


def classify_render_mode(raw_html: str, rendered_html: str) -> str:
    """Return 'ssr', 'csr', 'ssg', or 'unknown' for one page.

    Heuristics:
      - rendered > 1.5x raw AND raw < 500 chars → 'csr'
      - rendered ≈ raw (within 15%) → 'ssr' (treated as SSR; SSG indistinguishable without HTTP headers)
      - <noscript ...JavaScript...> marker → 'csr'
      - else 'unknown'
    """
    if _NOSCRIPT_JS_HINT_RE.search(raw_html or ""):
        return "csr"

    raw_len = _visible_text_length(raw_html)
    rendered_len = _visible_text_length(rendered_html)

    if rendered_len == 0 and raw_len == 0:
        return "unknown"
    if raw_len < 500 and rendered_len > raw_len * 1.5:
        return "csr"
    if raw_len == 0:
        return "csr"
    ratio = rendered_len / max(raw_len, 1)
    if 0.85 <= ratio <= 1.15:
        return "ssr"
    return "unknown"
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_fetcher.py -v
```

Expected: all 7 passed (Playwright test may take ~5s).

If the timeout test fails on your network setup (some networks return errors faster than `timeout`), it's still acceptable as long as `status is None and error is not None`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/site_audit/fetcher.py backend/tests/test_site_audit_fetcher.py backend/tests/fixtures/site_audit/__init__.py backend/tests/fixtures/site_audit/static_server.py backend/requirements-test.txt
git commit -m "feat(site-audit): raw + Playwright fetchers and render-mode classifier"
```

---

### Task 6: Sitemap discovery

**Files:**
- Create: `backend/app/services/site_audit/crawler.py` (sitemap-only piece first; BFS in Task 7)
- Create: `backend/tests/test_site_audit_crawler_sitemap.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_site_audit_crawler_sitemap.py`:

```python
import pytest

from app.services.site_audit.crawler import discover_sitemap_urls
from tests.fixtures.site_audit.static_server import run_server

FLAT_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/pricing</loc></url>
  <url><loc>https://example.com/blog/post-1</loc></url>
</urlset>
"""

INDEX_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>{base}/sitemap-1.xml</loc></sitemap>
</sitemapindex>
"""

SUB_SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{base}/a</loc></url>
  <url><loc>{base}/b</loc></url>
</urlset>
"""


@pytest.mark.asyncio
async def test_discover_sitemap_flat():
    async with run_server({"/sitemap.xml": (200, "application/xml", FLAT_SITEMAP)}) as base:
        urls, source = await discover_sitemap_urls(base + "/")
        assert source == f"{base}/sitemap.xml"
        assert "https://example.com/pricing" in urls
        assert len(urls) == 3


@pytest.mark.asyncio
async def test_discover_sitemap_index_follows_one_level():
    async def setup():
        return None
    # build routes referencing base via after-the-fact substitution
    routes_template = {
        "/sitemap.xml": (200, "application/xml", INDEX_SITEMAP),
        "/sitemap-1.xml": (200, "application/xml", SUB_SITEMAP),
    }
    async with run_server(routes_template) as base:
        routes_filled = {
            "/sitemap.xml": (200, "application/xml", INDEX_SITEMAP.format(base=base)),
            "/sitemap-1.xml": (200, "application/xml", SUB_SITEMAP.format(base=base)),
        }
        # restart with filled routes by using a fresh server
    async with run_server({
        "/sitemap.xml": (200, "application/xml", INDEX_SITEMAP.format(base="http://127.0.0.1:0")),
    }) as base2:
        # Use a deterministic setup instead: pass urls inline through the index referencing real base
        full_index = INDEX_SITEMAP.format(base=base2)
        full_sub = SUB_SITEMAP.format(base=base2)
        async with run_server({
            "/sitemap.xml": (200, "application/xml", full_index),
            "/sitemap-1.xml": (200, "application/xml", full_sub),
        }) as base3:
            urls, _ = await discover_sitemap_urls(base3 + "/")
            assert f"{base3}/a" in urls
            assert f"{base3}/b" in urls


@pytest.mark.asyncio
async def test_discover_sitemap_missing_returns_empty():
    async with run_server({}) as base:
        urls, source = await discover_sitemap_urls(base + "/")
        assert urls == []
        assert source is None
```

> Note for the implementer: the second test is intentionally simplified — if the multi-server scaffolding feels brittle, replace with a single `run_server` that returns the full index + sub-sitemap pair and assert `len(urls) == 2`.

- [ ] **Step 2: Run test — expect failure**

```bash
pytest backend/tests/test_site_audit_crawler_sitemap.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement sitemap discovery**

Create `backend/app/services/site_audit/crawler.py`:

```python
"""Site crawler — sitemap discovery + BFS (BFS added in Task 7)."""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin, urlparse

import httpx

from app.services.site_audit.constants import AUDIT_USER_AGENT, PER_PAGE_TIMEOUT_S
from app.services.site_audit.fetcher import fetch_raw

logger = logging.getLogger(__name__)

_LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>", re.IGNORECASE)


async def discover_sitemap_urls(root_url: str) -> tuple[list[str], str | None]:
    """Try root + common sitemap paths. Follow sitemap-index one level. Return (urls, source)."""
    root_url = root_url.rstrip("/") + "/"
    candidates = [
        urljoin(root_url, "sitemap.xml"),
        urljoin(root_url, "sitemap_index.xml"),
        urljoin(root_url, "sitemap-index.xml"),
    ]
    for sm_url in candidates:
        res = await fetch_raw(sm_url, timeout_s=PER_PAGE_TIMEOUT_S)
        if res.status == 200 and res.html.strip():
            urls = _parse_sitemap_or_index(res.html, sm_url)
            if urls:
                return urls, sm_url
    return [], None


def _parse_sitemap_or_index(body: str, source_url: str) -> list[str]:
    """If body is a sitemap-index, recursively pull child sitemaps' <loc>s.
    Otherwise return all <loc>s as page URLs.
    """
    locs = [m.strip() for m in _LOC_RE.findall(body)]
    if not locs:
        return []
    if "<sitemapindex" in body.lower():
        # fetch children synchronously-async; flatten one level
        # Caller can extend depth if needed.
        return _expand_index_locs(locs)
    return locs


def _expand_index_locs(child_sitemap_urls: list[str]) -> list[str]:
    """Synchronous wrapper to fetch child sitemaps; called from async context above."""
    import anyio

    async def _go():
        all_urls: list[str] = []
        for child in child_sitemap_urls[:50]:  # safety cap
            res = await fetch_raw(child)
            if res.status == 200 and res.html.strip():
                all_urls.extend(m.strip() for m in _LOC_RE.findall(res.html))
        return all_urls

    return anyio.from_thread.run(_go) if _in_thread() else _run_sync(_go())


def _in_thread() -> bool:
    try:
        import anyio
        anyio.from_thread.threadlocals  # noqa: B018
        return True
    except Exception:
        return False


def _run_sync(coro):
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # We're already inside an event loop; schedule and wait
            fut = asyncio.run_coroutine_threadsafe(coro, loop)
            return fut.result(timeout=PER_PAGE_TIMEOUT_S * 10)
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)
```

> **Implementer note:** the nested-async pattern above is awkward because `discover_sitemap_urls` is async but expansion of children needs another await. A cleaner refactor:

Replace the file's body with this cleaner async-only version:

```python
"""Site crawler — sitemap discovery + BFS (BFS added in Task 7)."""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

from app.services.site_audit.constants import PER_PAGE_TIMEOUT_S
from app.services.site_audit.fetcher import fetch_raw

logger = logging.getLogger(__name__)

_LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>", re.IGNORECASE)


async def discover_sitemap_urls(root_url: str) -> tuple[list[str], str | None]:
    root_url = root_url.rstrip("/") + "/"
    candidates = [
        urljoin(root_url, "sitemap.xml"),
        urljoin(root_url, "sitemap_index.xml"),
        urljoin(root_url, "sitemap-index.xml"),
    ]
    for sm_url in candidates:
        res = await fetch_raw(sm_url, timeout_s=PER_PAGE_TIMEOUT_S)
        if res.status == 200 and res.html.strip():
            urls = await _expand(res.html)
            if urls:
                return urls, sm_url
    return [], None


async def _expand(body: str) -> list[str]:
    locs = [m.strip() for m in _LOC_RE.findall(body)]
    if not locs:
        return []
    if "<sitemapindex" in body.lower():
        all_urls: list[str] = []
        for child in locs[:50]:
            res = await fetch_raw(child)
            if res.status == 200 and res.html.strip():
                all_urls.extend(m.strip() for m in _LOC_RE.findall(res.html))
        return all_urls
    return locs
```

Use this cleaner version. The earlier version is shown only to highlight the design tension.

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_crawler_sitemap.py -v
```

Expected: 2 passed, 1 may need adjustment per implementer note.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/crawler.py backend/tests/test_site_audit_crawler_sitemap.py
git commit -m "feat(site-audit): sitemap.xml discovery + sitemap-index expansion"
```

---

### Task 7: BFS crawler with polite-fetch and budget caps

**Files:**
- Modify: `backend/app/services/site_audit/crawler.py` (add `crawl_site()`)
- Create: `backend/tests/test_site_audit_crawler_bfs.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_site_audit_crawler_bfs.py`:

```python
import asyncio

import pytest

from app.services.site_audit.crawler import crawl_site, CrawlPage
from tests.fixtures.site_audit.static_server import run_server


HOME_HTML = '<html><body><a href="/a">A</a><a href="/b">B</a><a href="https://other.com/x">Other</a></body></html>'
A_HTML = '<html><body><a href="/c">C</a></body></html>'
B_HTML = '<html><body><h1>B</h1></body></html>'
C_HTML = '<html><body><h1>C</h1></body></html>'


@pytest.mark.asyncio
async def test_bfs_discovers_internal_links_only():
    routes = {
        "/": (200, "text/html", HOME_HTML),
        "/a": (200, "text/html", A_HTML),
        "/b": (200, "text/html", B_HTML),
        "/c": (200, "text/html", C_HTML),
    }
    async with run_server(routes) as base:
        pages = await crawl_site(base + "/", max_pages=10, max_depth=3, seed_urls=None)
        urls = {p.url for p in pages}
        assert any(u.endswith("/") for u in urls)
        assert any(u.endswith("/a") for u in urls)
        assert any(u.endswith("/b") for u in urls)
        assert any(u.endswith("/c") for u in urls)
        # cross-host link not followed
        assert not any("other.com" in u for u in urls)


@pytest.mark.asyncio
async def test_bfs_respects_max_pages():
    routes = {f"/p{i}": (200, "text/html", HOME_HTML) for i in range(20)}
    routes["/"] = (200, "text/html",
                   "".join(f'<a href="/p{i}">p</a>' for i in range(20)))
    async with run_server(routes) as base:
        pages = await crawl_site(base + "/", max_pages=5, max_depth=3, seed_urls=None)
        assert len(pages) <= 5


@pytest.mark.asyncio
async def test_bfs_uses_seed_urls_when_provided():
    routes = {
        "/": (200, "text/html", HOME_HTML),
        "/seeded": (200, "text/html", A_HTML),
    }
    async with run_server(routes) as base:
        seeds = [f"{base}/seeded"]
        pages = await crawl_site(base + "/", max_pages=10, max_depth=1, seed_urls=seeds)
        urls = {p.url for p in pages}
        assert any(u.endswith("/seeded") for u in urls)
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_crawler_bfs.py -v
```

Expected: ImportError (no `crawl_site`).

- [ ] **Step 3: Implement BFS + queue + dedup**

Append to `backend/app/services/site_audit/crawler.py`:

```python
import asyncio
import re as _re
from dataclasses import dataclass, field
from urllib.parse import urljoin as _urljoin, urlparse as _urlparse

from app.services.site_audit.constants import (
    HOST_REQUESTS_PER_SECOND, PER_AUDIT_CONCURRENCY, normalise_url,
)

_HREF_RE = _re.compile(r"<a[^>]+href=[\"']?([^\"'\s>]+)", _re.IGNORECASE)


@dataclass
class CrawlPage:
    url: str
    depth: int
    status: int | None
    html: str
    fetch_ms: int | None
    error: str | None = None


class _HostRateLimiter:
    """Simple per-host token-bucket. Crawler waits before issuing next request to same host."""

    def __init__(self, rps: float):
        self.delay = 1.0 / rps if rps > 0 else 0
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def wait(self, host: str) -> None:
        if not self.delay:
            return
        loop = asyncio.get_event_loop()
        async with self._lock:
            now = loop.time()
            last = self._last.get(host, 0)
            wait_for = max(0.0, (last + self.delay) - now)
            self._last[host] = now + wait_for
        if wait_for > 0:
            await asyncio.sleep(wait_for)


async def crawl_site(
    root_url: str,
    *,
    max_pages: int,
    max_depth: int = 3,
    seed_urls: list[str] | None = None,
    cancel_event: asyncio.Event | None = None,
) -> list[CrawlPage]:
    """BFS internal-only crawl. Returns CrawlPage list (one per fetched URL)."""
    root = normalise_url(root_url)
    host = _urlparse(root).netloc

    queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
    seen: set[str] = set()
    pages: list[CrawlPage] = []
    sem = asyncio.Semaphore(PER_AUDIT_CONCURRENCY)
    limiter = _HostRateLimiter(HOST_REQUESTS_PER_SECOND)

    starting = seed_urls if seed_urls else [root]
    for u in starting:
        try:
            n = normalise_url(u)
        except ValueError:
            continue
        if _urlparse(n).netloc != host:
            continue
        if n not in seen:
            seen.add(n)
            await queue.put((n, 0))

    async def _worker():
        while True:
            try:
                url, depth = await asyncio.wait_for(queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if queue.empty():
                    return
                continue
            try:
                if cancel_event and cancel_event.is_set():
                    return
                if len(pages) >= max_pages:
                    return
                async with sem:
                    await limiter.wait(host)
                    res = await fetch_raw(url)
                pages.append(CrawlPage(
                    url=url, depth=depth, status=res.status, html=res.html,
                    fetch_ms=res.fetch_ms, error=res.error,
                ))
                if depth < max_depth and res.html:
                    for link in _extract_internal_links(res.html, url, host):
                        if link not in seen and len(seen) < max_pages * 3:
                            seen.add(link)
                            await queue.put((link, depth + 1))
            finally:
                queue.task_done()

    workers = [asyncio.create_task(_worker()) for _ in range(PER_AUDIT_CONCURRENCY)]
    await asyncio.gather(*workers, return_exceptions=True)
    return pages[:max_pages]


def _extract_internal_links(html: str, base_url: str, host: str) -> list[str]:
    out: list[str] = []
    for raw in _HREF_RE.findall(html):
        if raw.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = _urljoin(base_url, raw)
        try:
            n = normalise_url(absolute)
        except ValueError:
            continue
        if _urlparse(n).netloc != host:
            continue
        out.append(n)
    return out
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_crawler_bfs.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/crawler.py backend/tests/test_site_audit_crawler_bfs.py
git commit -m "feat(site-audit): BFS crawler with per-host rate limiting + dedup"
```

---

### Task 8: Page classifier

**Files:**
- Create: `backend/app/services/site_audit/page_classifier.py`
- Create: `backend/tests/test_site_audit_page_classifier.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_site_audit_page_classifier.py`:

```python
import pytest

from app.services.site_audit.page_classifier import classify_page


@pytest.mark.parametrize("url,html,expected", [
    ("https://x.com/",         "<html></html>",                       "homepage"),
    ("https://x.com",          "<html></html>",                       "homepage"),
    ("https://x.com/pricing",  "<html></html>",                       "pricing"),
    ("https://x.com/Pricing/", "<html></html>",                       "pricing"),
    ("https://x.com/foo",      "<html><title>Pricing FAQ</title></html>",  "pricing"),
    ("https://x.com/about",    "<html></html>",                       "about"),
    ("https://x.com/team",     "<html></html>",                       "about"),
    ("https://x.com/docs/api", "<html></html>",                       "docs"),
    ("https://x.com/help",     "<html></html>",                       "docs"),
    ("https://x.com/blog/p1",  "<html></html>",                       "article"),
    ("https://x.com/news/foo", "<html></html>",                       "article"),
    ("https://x.com/post",     "<html><article>...</article></html>", "article"),
    ("https://x.com/features", "<html></html>",                       "product"),
    ("https://x.com/products", "<html></html>",                       "product"),
    ("https://x.com/random",   "<html></html>",                       "other"),
])
def test_classify_page(url, html, expected):
    assert classify_page(url, html) == expected
```

- [ ] **Step 2: Run test — expect failure**

```bash
pytest backend/tests/test_site_audit_page_classifier.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

`backend/app/services/site_audit/page_classifier.py`:

```python
"""URL + DOM → page_type classifier."""
from __future__ import annotations

import re
from urllib.parse import urlparse

_TITLE_RE = re.compile(r"<title[^>]*>([^<]*)</title>", re.IGNORECASE)
_ARTICLE_TAG_RE = re.compile(r"<article[\s>]", re.IGNORECASE)


def classify_page(url: str, html: str) -> str:
    path = (urlparse(url).path or "/").lower().rstrip("/")
    if path == "":
        return "homepage"

    title = ""
    m = _TITLE_RE.search(html or "")
    if m:
        title = m.group(1).strip().lower()

    if _matches(path, ["/pricing"]) or "pricing" in title:
        return "pricing"
    if _matches(path, ["/about", "/team", "/company"]):
        return "about"
    if _matches(path, ["/docs", "/documentation", "/api", "/help", "/support", "/guides"]):
        return "docs"
    if _matches(path, ["/blog", "/articles", "/posts", "/news", "/insights"]):
        return "article"
    if _ARTICLE_TAG_RE.search(html or ""):
        # only call it article if the DOM has a single dominant <article>
        if (html or "").lower().count("<article") <= 2:
            return "article"
    if _matches(path, ["/product", "/products", "/features", "/solutions", "/use-cases"]):
        return "product"
    return "other"


def _matches(path: str, prefixes: list[str]) -> bool:
    return any(prefix in path for prefix in prefixes)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_page_classifier.py -v
```

Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/page_classifier.py backend/tests/test_site_audit_page_classifier.py
git commit -m "feat(site-audit): page-type classifier"
```

---

## Phase 3 — Parsers

Each parser is a pure function returning `(measurements: dict, findings: list[Finding])`.

A shared `Finding` dataclass lives in `parsers/__init__.py`:

### Task 9: Parser package + Finding dataclass

**Files:**
- Create: `backend/app/services/site_audit/parsers/__init__.py`

- [ ] **Step 1: Create package + dataclass**

`backend/app/services/site_audit/parsers/__init__.py`:

```python
"""Parsers — pure functions returning (measurements, findings)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Finding:
    check_id: str
    severity: str       # 'critical' | 'high' | 'medium' | 'low' | 'info'
    category: str       # 'bot_access' | 'content' | 'schema' | 'technical' | 'authority'
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParseOutput:
    measurements: dict[str, Any]
    findings: list[Finding]
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/site_audit/parsers/__init__.py
git commit -m "feat(site-audit): parser Finding/ParseOutput dataclasses"
```

---

### Task 10: Semantic-HTML parser

**Files:**
- Create: `backend/app/services/site_audit/parsers/semantic.py`
- Create: `backend/tests/test_site_audit_parsers_semantic.py`
- Create: `backend/tests/fixtures/site_audit/well_structured.html`
- Create: `backend/tests/fixtures/site_audit/no_h1.html`
- Create: `backend/tests/fixtures/site_audit/fake_lists.html`

- [ ] **Step 1: Add fixture HTML files**

`backend/tests/fixtures/site_audit/well_structured.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Well Structured</title></head>
<body>
  <h1>Main Heading</h1>
  <h2>How much does Acme cost?</h2>
  <p>Acme costs $99 per month for the Pro plan, billed annually. Volume discounts start at 50 seats.</p>
  <ul>
    <li>Feature A</li>
    <li>Feature B</li>
  </ul>
  <h2>What integrations are supported?</h2>
  <table>
    <thead><tr><th>Tool</th><th>Status</th></tr></thead>
    <tbody><tr><td>Slack</td><td>Yes</td></tr></tbody>
  </table>
  <p>According to the 2025 report by Foo, 73% of teams use Slack daily.</p>
  <p>See <a href="https://example.org">Example</a> for more.</p>
</body>
</html>
```

`backend/tests/fixtures/site_audit/no_h1.html`:

```html
<!DOCTYPE html>
<html>
<head><title>No H1</title></head>
<body>
  <h2>Subheading</h2>
  <p>Body content without an H1 anywhere on the page.</p>
</body>
</html>
```

`backend/tests/fixtures/site_audit/fake_lists.html`:

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Fake Lists</h1>
  <p>• Item one as a fake bullet</p>
  <p>- Item two as a fake bullet</p>
  <p>• Item three as a fake bullet</p>
</body>
</html>
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_site_audit_parsers_semantic.py`:

```python
from pathlib import Path

import pytest

from app.services.site_audit.parsers.semantic import parse_semantic

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "site_audit"


def _load(name: str) -> str:
    return (FIXTURE_DIR / name).read_text()


def test_well_structured_emits_no_critical_findings():
    out = parse_semantic(_load("well_structured.html"), "https://example.com/")
    critical = [f for f in out.findings if f.severity == "critical"]
    assert critical == []
    assert out.measurements["h1_text"] == "Main Heading"
    assert out.measurements["h2_count"] == 2
    assert out.measurements["table_count"] == 1
    assert out.measurements["list_count"] >= 1
    assert out.measurements["outbound_links"] == 1
    assert out.measurements["word_count"] > 30


def test_no_h1_emits_missing_h1():
    out = parse_semantic(_load("no_h1.html"), "https://example.com/")
    ids = {f.check_id for f in out.findings}
    assert "missing_h1" in ids


def test_fake_lists_detected():
    out = parse_semantic(_load("fake_lists.html"), "https://example.com/")
    ids = {f.check_id for f in out.findings}
    assert "fake_lists" in ids


def test_fact_density_present_on_well_structured():
    out = parse_semantic(_load("well_structured.html"), "https://example.com/")
    assert out.measurements["fact_density"] > 0


def test_pronoun_overuse_detection():
    html = "<html><body><h1>X</h1>" + ("<p>It is great.</p>" * 50) + "</body></html>"
    out = parse_semantic(html, "https://example.com/a")
    ids = {f.check_id for f in out.findings}
    assert "pronoun_overuse" in ids
```

- [ ] **Step 3: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_parsers_semantic.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement parser**

`backend/app/services/site_audit/parsers/semantic.py`:

```python
"""Semantic-HTML parser. Detects heading hygiene, lists/tables, fact density, etc."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding, ParseOutput

_NUMBER_RE = re.compile(r"\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b")
_DATE_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
_FAKE_BULLET_RE = re.compile(r"^\s*[•\-\*]\s")
_PRONOUN_LEADING_RE = re.compile(r"^\s*(It|They|This|That|These|Those|He|She|We)\b", re.IGNORECASE)


def parse_semantic(html: str, url: str) -> ParseOutput:
    soup = BeautifulSoup(html or "", "lxml")
    body = soup.body or soup
    findings: list[Finding] = []

    # Heading inventory
    h1s = body.find_all("h1")
    h2s = body.find_all("h2")
    h3s = body.find_all("h3")

    if not h1s:
        findings.append(Finding("missing_h1", "high", "content", "Page has no <h1> heading.",
                                {"h2_count": len(h2s)}))
    elif len(h1s) > 1:
        findings.append(Finding("multiple_h1", "medium", "content",
                                f"Page has {len(h1s)} <h1> tags; expected exactly one.",
                                {"count": len(h1s)}))

    if not h2s and h1s:
        findings.append(Finding("no_h2", "medium", "content",
                                "Page has H1 but no H2 sections — content isn't chunkable.",
                                {}))

    # Heading skip: h3 before any h2 in document order
    seen_h2 = False
    for tag in body.find_all(["h2", "h3"]):
        if tag.name == "h2":
            seen_h2 = True
        elif tag.name == "h3" and not seen_h2:
            findings.append(Finding("heading_hierarchy_skip", "low", "content",
                                    "An <h3> appears before any <h2>.", {}))
            break

    # Lists, tables
    tables = body.find_all("table")
    lists = body.find_all(["ul", "ol"])
    list_count = len(lists)
    table_count = len(tables)

    paragraphs = body.find_all("p")
    fake_bullet_paras = [p for p in paragraphs if p.get_text(strip=True) and _FAKE_BULLET_RE.match(p.get_text())]
    if len(fake_bullet_paras) >= 3:
        findings.append(Finding("fake_lists", "low", "content",
                                "Detected multiple paragraphs starting with bullet characters; use <ul>/<ol>.",
                                {"count": len(fake_bullet_paras)}))

    # Word count + fact density
    text = body.get_text(" ", strip=True)
    word_count = len(text.split())
    numbers = len(_NUMBER_RE.findall(text))
    dates = len(_DATE_RE.findall(text))
    propers = len(_PROPER_NOUN_RE.findall(text))
    fact_density = ((numbers + dates + propers) / max(word_count, 1)) * 1000.0

    if word_count >= 200 and fact_density < 5:
        findings.append(Finding("fact_density_low", "medium", "content",
                                f"Fact density {fact_density:.1f}/1k words is low; add specific numbers, dates, or named entities.",
                                {"fact_density": fact_density, "word_count": word_count}))

    # Pronoun overuse
    leading_pronouns = sum(1 for p in paragraphs if _PRONOUN_LEADING_RE.match(p.get_text() or ""))
    if word_count > 0 and leading_pronouns / max(word_count, 1) * 1000 > 8:
        findings.append(Finding("pronoun_overuse", "low", "content",
                                "Many paragraphs start with pronouns — passages lose context when extracted.",
                                {"leading_pronouns": leading_pronouns, "word_count": word_count}))

    # Outbound vs internal links
    host = urlparse(url).netloc
    outbound = 0
    internal = 0
    for a in body.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        if host in href or href.startswith("/"):
            internal += 1
        else:
            outbound += 1

    if outbound == 0 and word_count > 200:
        findings.append(Finding("no_outbound_citations", "low", "authority",
                                "Page has zero outbound links — add citations to sources.",
                                {"word_count": word_count}))

    # Answer-first: each H2 section should start with a substantive paragraph (no leading pronoun)
    failed_h2 = 0
    for h2 in h2s:
        # Find the first <p> sibling
        p = h2.find_next_sibling()
        while p is not None and p.name != "p":
            p = p.find_next_sibling()
        first_words = (p.get_text(" ", strip=True).split()[:75] if p else [])
        if not first_words:
            failed_h2 += 1
            continue
        snippet = " ".join(first_words)
        if _PRONOUN_LEADING_RE.match(snippet):
            failed_h2 += 1
    if h2s and failed_h2 / len(h2s) > 0.5:
        findings.append(Finding("answer_first_failed", "medium", "content",
                                "More than half of <h2> sections don't start with a self-contained answer.",
                                {"failed": failed_h2, "total": len(h2s)}))

    measurements = {
        "word_count": word_count,
        "h1_text": h1s[0].get_text(strip=True) if h1s else None,
        "h2_count": len(h2s),
        "h3_count": len(h3s),
        "table_count": table_count,
        "list_count": list_count,
        "fact_density": round(fact_density, 2),
        "outbound_links": outbound,
        "internal_links": internal,
    }
    return ParseOutput(measurements=measurements, findings=findings)
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_parsers_semantic.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/site_audit/parsers/semantic.py backend/tests/test_site_audit_parsers_semantic.py backend/tests/fixtures/site_audit/
git commit -m "feat(site-audit): semantic-HTML parser (headings, lists, fact density, answer-first)"
```

---

### Task 11: JSON-LD schema parser

**Files:**
- Create: `backend/app/services/site_audit/parsers/schema.py`
- Create: `backend/tests/test_site_audit_parsers_schema.py`
- Create: `backend/tests/fixtures/site_audit/good_organization_schema.html`
- Create: `backend/tests/fixtures/site_audit/malformed_jsonld.html`

- [ ] **Step 1: Fixtures**

`backend/tests/fixtures/site_audit/good_organization_schema.html`:

```html
<!DOCTYPE html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Acme",
  "url": "https://acme.com",
  "logo": "https://acme.com/logo.png",
  "sameAs": ["https://linkedin.com/company/acme"]
}
</script>
</head><body></body></html>
```

`backend/tests/fixtures/site_audit/malformed_jsonld.html`:

```html
<!DOCTYPE html>
<html><head>
<script type="application/ld+json">
{ "name": "Acme",  -- broken JSON
</script>
</head><body></body></html>
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_site_audit_parsers_schema.py`:

```python
from pathlib import Path

import pytest

from app.services.site_audit.parsers.schema import parse_schema

F = Path(__file__).parent / "fixtures" / "site_audit"


def test_good_organization_passes(tmp_path):
    html = (F / "good_organization_schema.html").read_text()
    out = parse_schema(html, "https://acme.com/", page_type="homepage")
    assert out.measurements["has_jsonld"] is True
    assert "Organization" in out.measurements["schema_types"]
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" not in ids
    assert "incomplete_organization_schema" not in ids


def test_malformed_jsonld_detected():
    html = (F / "malformed_jsonld.html").read_text()
    out = parse_schema(html, "https://acme.com/", page_type="homepage")
    ids = {f.check_id for f in out.findings}
    assert "malformed_jsonld" in ids


def test_homepage_without_org_schema_flagged():
    out = parse_schema("<html><body>No schema</body></html>", "https://acme.com/", page_type="homepage")
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" in ids


def test_non_homepage_no_org_schema_not_flagged():
    out = parse_schema("<html><body></body></html>", "https://acme.com/blog/x", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "missing_organization_schema" not in ids


def test_article_missing_author_and_dates():
    html = """<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"Foo"}
    </script>
    </head><body></body></html>"""
    out = parse_schema(html, "https://x.com/blog/foo", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "article_missing_author" in ids
    assert "article_missing_dates" in ids
```

- [ ] **Step 3: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_parsers_schema.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement schema parser**

`backend/app/services/site_audit/parsers/schema.py`:

```python
"""JSON-LD schema parser."""
from __future__ import annotations

import json
import re
from typing import Any

from app.services.site_audit.parsers import Finding, ParseOutput

_LD_BLOCK_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def parse_schema(html: str, url: str, page_type: str) -> ParseOutput:
    findings: list[Finding] = []
    types_found: list[str] = []
    nodes_by_type: dict[str, list[dict]] = {}

    blocks = _LD_BLOCK_RE.findall(html or "")
    has_blocks = bool(blocks)
    any_parsed = False

    for raw in blocks:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            findings.append(Finding("malformed_jsonld", "high", "schema",
                                    f"JSON-LD block could not be parsed: {exc}",
                                    {"snippet": raw[:300]}))
            continue
        any_parsed = True
        for node in _iter_nodes(data):
            t = node.get("@type")
            if isinstance(t, list):
                t = next((x for x in t if isinstance(x, str)), None)
            if isinstance(t, str):
                types_found.append(t)
                nodes_by_type.setdefault(t, []).append(node)

    if not has_blocks:
        findings.append(Finding("no_jsonld", "medium", "schema",
                                "Page has no JSON-LD schema blocks.", {}))

    # Organization (homepage only)
    if page_type == "homepage":
        org_nodes = nodes_by_type.get("Organization", [])
        if not org_nodes:
            findings.append(Finding("missing_organization_schema", "high", "schema",
                                    "Homepage is missing Organization JSON-LD.", {}))
        else:
            org = org_nodes[0]
            missing = [k for k in ("name", "url", "logo", "sameAs") if not org.get(k)]
            if missing:
                findings.append(Finding("incomplete_organization_schema", "medium", "schema",
                                        f"Organization schema is missing: {', '.join(missing)}",
                                        {"missing": missing}))

    # Article / BlogPosting
    if page_type == "article":
        article_nodes = nodes_by_type.get("Article", []) + nodes_by_type.get("BlogPosting", [])
        if article_nodes:
            a = article_nodes[0]
            author = a.get("author")
            if not author or (isinstance(author, dict) and not author.get("@type") == "Person"):
                findings.append(Finding("article_missing_author", "medium", "schema",
                                        "Article schema lacks Person-typed author.", {}))
            if not (a.get("datePublished") or a.get("dateModified")):
                findings.append(Finding("article_missing_dates", "medium", "schema",
                                        "Article schema lacks datePublished/dateModified.", {}))

    # Product
    if nodes_by_type.get("Product"):
        p = nodes_by_type["Product"][0]
        missing = [k for k in ("name", "description", "offers") if not p.get(k)]
        if missing:
            findings.append(Finding("product_missing_required", "medium", "schema",
                                    f"Product schema missing: {', '.join(missing)}",
                                    {"missing": missing}))

    # FAQPage with no questions
    for f in nodes_by_type.get("FAQPage", []):
        if not f.get("mainEntity"):
            findings.append(Finding("faqpage_no_questions", "high", "schema",
                                    "FAQPage schema declared but has no Q&A entries.", {}))
            break

    measurements = {
        "has_jsonld": any_parsed,
        "schema_types": sorted(set(types_found)),
    }
    return ParseOutput(measurements=measurements, findings=findings)


def _iter_nodes(data: Any) -> list[dict]:
    """Yield all JSON-LD nodes; handles @graph + lists."""
    out: list[dict] = []
    if isinstance(data, list):
        for item in data:
            out.extend(_iter_nodes(item))
    elif isinstance(data, dict):
        if "@graph" in data and isinstance(data["@graph"], list):
            for item in data["@graph"]:
                out.extend(_iter_nodes(item))
        else:
            out.append(data)
    return out
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_parsers_schema.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/site_audit/parsers/schema.py backend/tests/test_site_audit_parsers_schema.py backend/tests/fixtures/site_audit/
git commit -m "feat(site-audit): JSON-LD schema parser with Organization/Article/Product/FAQ shape checks"
```

---

### Task 12: robots.txt parser

**Files:**
- Create: `backend/app/services/site_audit/parsers/robots.py`
- Create: `backend/tests/test_site_audit_parsers_robots.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_site_audit_parsers_robots.py`:

```python
import pytest

from app.services.site_audit.parsers.robots import parse_robots

ROBOTS_ALLOW_ALL = """User-agent: *
Allow: /
"""

ROBOTS_BLOCK_GPTBOT_AND_OAI = """User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Disallow: /
"""

ROBOTS_BLOCK_GOOGLE_EXTENDED = """User-agent: Google-Extended
Disallow: /
"""


def test_allow_all_no_critical_findings():
    out = parse_robots(ROBOTS_ALLOW_ALL, "https://x.com/")
    ids = {f.check_id for f in out.findings}
    assert "blocked_oai_searchbot" not in ids
    assert out.measurements["bot_status"]["GPTBot"] == "unspecified"


def test_block_oai_searchbot_is_critical():
    out = parse_robots(ROBOTS_BLOCK_GPTBOT_AND_OAI, "https://x.com/")
    crit = [f for f in out.findings if f.severity == "critical"]
    ids = {f.check_id for f in crit}
    assert "blocked_oai_searchbot" in ids
    assert out.measurements["bot_status"]["OAI-SearchBot"] == "disallowed_all"
    assert out.measurements["bot_status"]["GPTBot"] == "disallowed_all"


def test_block_google_extended_high():
    out = parse_robots(ROBOTS_BLOCK_GOOGLE_EXTENDED, "https://x.com/")
    ids = {f.check_id for f in out.findings if f.severity == "high"}
    assert "blocked_google_extended" in ids


def test_no_robots_emits_info():
    out = parse_robots(None, "https://x.com/")
    ids = {f.check_id for f in out.findings}
    assert "no_robots_txt" in ids
    # all bots default to allowed (no robots = no rules)
    assert all(v == "allowed_all" for v in out.measurements["bot_status"].values())
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_parsers_robots.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement parser**

`backend/app/services/site_audit/parsers/robots.py`:

```python
"""robots.txt parser → per-AI-bot status map + findings."""
from __future__ import annotations

import re

from app.services.site_audit.constants import AI_BOT_USER_AGENTS
from app.services.site_audit.parsers import Finding, ParseOutput

_LINE_RE = re.compile(r"^([A-Za-z\-]+)\s*:\s*(.+?)\s*$")


def parse_robots(content: str | None, root_url: str) -> ParseOutput:
    findings: list[Finding] = []
    bot_status: dict[str, str] = {bot: "unspecified" for bot in AI_BOT_USER_AGENTS}

    if not content:
        findings.append(Finding("no_robots_txt", "info", "bot_access",
                                "No robots.txt file found; all bots default to allowed.",
                                {}))
        for bot in AI_BOT_USER_AGENTS:
            bot_status[bot] = "allowed_all"
        return ParseOutput(measurements={"bot_status": bot_status}, findings=findings)

    # Parse into groups by User-agent
    groups: list[tuple[set[str], list[tuple[str, str]]]] = []
    current_uas: set[str] = set()
    current_rules: list[tuple[str, str]] = []

    for raw_line in content.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            if current_uas:
                groups.append((current_uas, current_rules))
                current_uas, current_rules = set(), []
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        directive, value = m.group(1).lower(), m.group(2)
        if directive == "user-agent":
            if current_rules:
                groups.append((current_uas, current_rules))
                current_uas, current_rules = set(), []
            current_uas.add(value.strip())
        elif directive in ("allow", "disallow"):
            current_rules.append((directive, value))
    if current_uas:
        groups.append((current_uas, current_rules))

    # Resolve each AI bot
    for bot in AI_BOT_USER_AGENTS:
        rules = _rules_for_bot(bot, groups)
        bot_status[bot] = _classify(rules)

    severity_map = {
        "OAI-SearchBot": ("blocked_oai_searchbot", "critical"),
        "GPTBot": ("blocked_gptbot", "high"),
        "ClaudeBot": ("blocked_claudebot", "high"),
        "Google-Extended": ("blocked_google_extended", "high"),
        "PerplexityBot": ("blocked_perplexitybot", "high"),
    }
    for bot, status in bot_status.items():
        if status == "disallowed_all" and bot in severity_map:
            cid, sev = severity_map[bot]
            findings.append(Finding(cid, sev, "bot_access",
                                    f"robots.txt disallows {bot} from all paths.",
                                    {"bot": bot, "status": status}))

    if all(s == "unspecified" for s in bot_status.values()):
        findings.append(Finding("unspecified_ai_bots", "info", "bot_access",
                                "No directives for any AI bot user-agent — bots default to allowed but consider an explicit Allow.",
                                {}))

    return ParseOutput(measurements={"bot_status": bot_status}, findings=findings)


def _rules_for_bot(bot: str, groups: list[tuple[set[str], list[tuple[str, str]]]]) -> list[tuple[str, str]]:
    # Specific groups win over '*'. Case-insensitive UA match.
    bot_lower = bot.lower()
    specific: list[tuple[str, str]] = []
    wildcard: list[tuple[str, str]] = []
    for uas, rules in groups:
        ua_lowers = {u.lower() for u in uas}
        if bot_lower in ua_lowers:
            specific.extend(rules)
        elif "*" in ua_lowers:
            wildcard.extend(rules)
    return specific if specific else wildcard


def _classify(rules: list[tuple[str, str]]) -> str:
    if not rules:
        return "unspecified"
    has_disallow_all = any(d == "disallow" and v.strip() == "/" for d, v in rules)
    has_allow_all = any(d == "allow" and v.strip() == "/" for d, v in rules)
    has_partial_disallow = any(d == "disallow" and v.strip() not in ("", "/") for d, v in rules)
    if has_disallow_all and not has_allow_all:
        return "disallowed_all"
    if has_partial_disallow:
        return "allowed_partial"
    return "allowed_all"
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_parsers_robots.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/parsers/robots.py backend/tests/test_site_audit_parsers_robots.py
git commit -m "feat(site-audit): robots.txt parser with per-AI-bot status map"
```

---

### Task 13: llms.txt + meta parsers

**Files:**
- Create: `backend/app/services/site_audit/parsers/llms_txt.py`
- Create: `backend/app/services/site_audit/parsers/meta.py`
- Create: `backend/tests/test_site_audit_parsers_llms_txt.py`
- Create: `backend/tests/test_site_audit_parsers_meta.py`

- [ ] **Step 1: Write llms.txt tests**

`backend/tests/test_site_audit_parsers_llms_txt.py`:

```python
from app.services.site_audit.parsers.llms_txt import parse_llms_txt

VALID = """# Acme

> Acme makes widgets.

## Key resources

- [Homepage](https://acme.com/)
- [Pricing](https://acme.com/pricing)
"""


def test_valid_llms_txt():
    out = parse_llms_txt(VALID)
    assert out.measurements["present"] is True
    assert out.measurements["valid"] is True
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_present_valid" in ids


def test_missing_returns_info_finding():
    out = parse_llms_txt(None)
    assert out.measurements["present"] is False
    assert out.measurements["valid"] is False
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_missing" in ids


def test_malformed_no_h1():
    out = parse_llms_txt("Random text without an H1 first.")
    assert out.measurements["valid"] is False
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_malformed" in ids
```

- [ ] **Step 2: Implement llms_txt parser**

`backend/app/services/site_audit/parsers/llms_txt.py`:

```python
"""llms.txt fetch+validation per the proposed spec (https://llmstxt.org)."""
from __future__ import annotations

from app.services.site_audit.parsers import Finding, ParseOutput


def parse_llms_txt(content: str | None) -> ParseOutput:
    if content is None:
        return ParseOutput(
            measurements={"present": False, "valid": False},
            findings=[Finding("llms_txt_missing", "low", "bot_access",
                              "No /llms.txt file found.", {})],
        )

    text = content.strip()
    if not text or not text.lstrip().startswith("# "):
        return ParseOutput(
            measurements={"present": True, "valid": False},
            findings=[Finding("llms_txt_malformed", "low", "bot_access",
                              "llms.txt should start with an H1 site name (`# Site`).",
                              {"first_line": (text.splitlines() or [""])[0][:100]})],
        )

    return ParseOutput(
        measurements={"present": True, "valid": True},
        findings=[Finding("llms_txt_present_valid", "info", "bot_access",
                          "llms.txt is present and well-formed.", {})],
    )
```

- [ ] **Step 3: Run llms.txt tests — expect pass**

```bash
pytest backend/tests/test_site_audit_parsers_llms_txt.py -v
```

- [ ] **Step 4: Write meta parser tests**

`backend/tests/test_site_audit_parsers_meta.py`:

```python
from app.services.site_audit.parsers.meta import parse_meta


def test_well_formed_meta():
    html = """<html><head>
    <title>How much does Acme cost?</title>
    <meta name="description" content="Acme costs $99/month for the Pro plan, billed annually. Volume discounts available.">
    </head><body>
    <article><div class="byline">By Jane Doe, published 2025-09-12</div></article>
    <img src="/x.png" alt="A diagram of widget assembly steps">
    </body></html>"""
    out = parse_meta(html, "https://acme.com/pricing", page_type="pricing")
    assert out.measurements["title"]
    assert out.measurements["meta_description"]
    ids = {f.check_id for f in out.findings}
    assert "missing_title" not in ids
    assert "missing_meta_description" not in ids


def test_missing_title_and_description():
    out = parse_meta("<html><head></head><body></body></html>",
                     "https://acme.com/foo", page_type="other")
    ids = {f.check_id for f in out.findings}
    assert "missing_title" in ids
    assert "missing_meta_description" in ids


def test_article_missing_byline_and_date():
    out = parse_meta("<html><body><h1>Article</h1></body></html>",
                     "https://acme.com/blog/x", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "missing_byline" in ids
    assert "missing_update_date" in ids


def test_image_alt_coverage():
    html = """<html><body>
    <img src="a.png">
    <img src="b.png" alt="">
    <img src="c.png" alt="image">
    <img src="d.png" alt="A diagram of the architecture">
    </body></html>"""
    out = parse_meta(html, "https://acme.com/x", page_type="other")
    ids = {f.check_id for f in out.findings}
    assert "low_alt_text_coverage" in ids
    assert out.measurements["image_count"] == 4
    assert out.measurements["image_alt_pct"] == 25.0
```

- [ ] **Step 5: Implement meta parser**

`backend/app/services/site_audit/parsers/meta.py`:

```python
"""Title, meta description, byline, dates, image alt coverage."""
from __future__ import annotations

import re
from datetime import datetime, UTC

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding, ParseOutput

_DATE_TEXT_RE = re.compile(r"\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b")
_BYLINE_TEXT_RE = re.compile(r"\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+", re.IGNORECASE)


def parse_meta(html: str, url: str, page_type: str) -> ParseOutput:
    findings: list[Finding] = []
    soup = BeautifulSoup(html or "", "lxml")

    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None
    desc_tag = soup.find("meta", attrs={"name": "description"})
    desc = (desc_tag.get("content") if desc_tag else None) or None

    if not title:
        findings.append(Finding("missing_title", "high", "content",
                                "Page has no <title> or it is empty.", {}))
    else:
        if len(title) > 70:
            findings.append(Finding("title_too_long", "low", "content",
                                    f"<title> is {len(title)} chars; aim for ≤ 70.",
                                    {"length": len(title)}))
        if page_type != "homepage" and len(title) < 20:
            findings.append(Finding("title_too_short", "low", "content",
                                    f"<title> is {len(title)} chars; consider expanding.",
                                    {"length": len(title)}))

    if not desc:
        findings.append(Finding("missing_meta_description", "medium", "content",
                                "Page has no meta description.", {}))
    else:
        if len(desc) < 70 or len(desc) > 160:
            findings.append(Finding("meta_description_length", "low", "content",
                                    f"Meta description is {len(desc)} chars; aim for 70–160.",
                                    {"length": len(desc)}))

    if page_type == "article":
        text = soup.get_text(" ", strip=True)
        if not _BYLINE_TEXT_RE.search(text) and not soup.find(attrs={"itemprop": "author"}):
            findings.append(Finding("missing_byline", "medium", "authority",
                                    "Article page lacks a visible byline.", {}))
        if not _DATE_TEXT_RE.search(text) and not soup.find("time"):
            findings.append(Finding("missing_update_date", "medium", "authority",
                                    "Article page lacks a visible publication/update date.", {}))
        # Stale-content check based on first ISO date found
        m = _DATE_TEXT_RE.search(text)
        if m:
            try:
                d = datetime.strptime(m.group(0), "%Y-%m-%d").replace(tzinfo=UTC)
                if (datetime.now(UTC) - d).days > 18 * 30:
                    findings.append(Finding("stale_content", "medium", "content",
                                            f"Most recent visible date is {m.group(0)}; content may be stale.",
                                            {"date": m.group(0)}))
            except ValueError:
                pass

    # Image alts
    imgs = soup.find_all("img")
    img_count = len(imgs)
    if img_count:
        good = sum(1 for i in imgs if (i.get("alt") or "").strip() and (i.get("alt") or "").strip().lower() != "image" and len(i.get("alt", "")) > 5)
        pct = good / img_count * 100.0
        if pct < 70:
            findings.append(Finding("low_alt_text_coverage", "low", "content",
                                    f"Only {pct:.0f}% of images have descriptive alt text.",
                                    {"image_count": img_count, "good": good}))
    else:
        pct = 0.0

    measurements = {
        "title": title,
        "meta_description": desc,
        "image_count": img_count,
        "image_alt_pct": round(pct, 1),
    }
    return ParseOutput(measurements=measurements, findings=findings)
```

- [ ] **Step 6: Run meta tests — expect pass**

```bash
pytest backend/tests/test_site_audit_parsers_meta.py -v
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/site_audit/parsers/llms_txt.py backend/app/services/site_audit/parsers/meta.py backend/tests/test_site_audit_parsers_llms_txt.py backend/tests/test_site_audit_parsers_meta.py
git commit -m "feat(site-audit): llms.txt + meta parsers"
```

---

## Phase 4 — Scoring

### Task 14: Scoring module

**Files:**
- Create: `backend/app/services/site_audit/scoring.py`
- Create: `backend/tests/test_site_audit_scoring.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_scoring.py`:

```python
from app.services.site_audit.scoring import (
    score_page, score_bot_access, score_audit, PageScoreInputs,
)


def test_score_page_high_quality():
    inputs = PageScoreInputs(
        word_count=800, h2_count=4, table_count=1, list_count=2,
        fact_density=12.0, outbound_links=3, internal_links=8,
        image_alt_pct=85.0, has_jsonld=True, schema_types_count=3,
        is_js_rendered=False, http_status=200, fetch_ms=400,
        findings_by_severity={"critical": 0, "high": 0, "medium": 1, "low": 1},
    )
    s = score_page(inputs)
    assert s["page_score"] >= 75
    assert 0 <= s["content_score"] <= 100
    assert 0 <= s["structure_score"] <= 100


def test_score_page_low_quality_js_rendered():
    inputs = PageScoreInputs(
        word_count=20, h2_count=0, table_count=0, list_count=0,
        fact_density=0.0, outbound_links=0, internal_links=0,
        image_alt_pct=0.0, has_jsonld=False, schema_types_count=0,
        is_js_rendered=True, http_status=200, fetch_ms=400,
        findings_by_severity={"critical": 1, "high": 2, "medium": 0, "low": 0},
    )
    s = score_page(inputs)
    assert s["page_score"] < 30


def test_bot_access_score_penalises_oai_block_hardest():
    s_oai = score_bot_access({"OAI-SearchBot": "disallowed_all"})
    s_gpt = score_bot_access({"GPTBot": "disallowed_all"})
    assert s_oai < s_gpt


def test_score_audit_aggregates_sub_scores():
    out = score_audit(
        bot_access=80.0, content=70.0, schema=60.0, technical=90.0,
    )
    assert out["overall_score"] == 75.0
    assert out["bot_access_score"] == 80.0
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_scoring.py -v
```

- [ ] **Step 3: Implement scoring**

`backend/app/services/site_audit/scoring.py`:

```python
"""Per-page + audit-level scoring."""
from __future__ import annotations

from dataclasses import dataclass

from app.services.site_audit.constants import (
    BOT_ACCESS_BLOCK_PENALTY, PAGE_SCORE_WEIGHTS,
)


@dataclass
class PageScoreInputs:
    word_count: int
    h2_count: int
    table_count: int
    list_count: int
    fact_density: float
    outbound_links: int
    internal_links: int
    image_alt_pct: float
    has_jsonld: bool
    schema_types_count: int
    is_js_rendered: bool
    http_status: int | None
    fetch_ms: int | None
    findings_by_severity: dict[str, int]


def _structure_score(p: PageScoreInputs) -> float:
    s = 50.0
    s += 15 if p.h2_count >= 2 else (5 if p.h2_count == 1 else -15)
    s += 10 if p.list_count >= 1 else 0
    s += 10 if p.table_count >= 1 else 0
    s += min(15.0, p.internal_links * 1.5)
    return max(0.0, min(100.0, s))


def _content_score(p: PageScoreInputs) -> float:
    s = 40.0
    if p.word_count >= 600:
        s += 25
    elif p.word_count >= 300:
        s += 15
    elif p.word_count >= 100:
        s += 5
    s += min(20.0, p.fact_density * 1.5)
    s += min(10.0, p.outbound_links * 2.0)
    crit = p.findings_by_severity.get("critical", 0)
    high = p.findings_by_severity.get("high", 0)
    medium = p.findings_by_severity.get("medium", 0)
    s -= crit * 25 + high * 10 + medium * 3
    return max(0.0, min(100.0, s))


def _schema_score(p: PageScoreInputs) -> float:
    if not p.has_jsonld:
        return 20.0
    return min(100.0, 50.0 + p.schema_types_count * 10)


def _technical_score(p: PageScoreInputs) -> float:
    s = 50.0
    if p.http_status == 200:
        s += 25
    elif p.http_status is None or p.http_status >= 400:
        s -= 20
    if p.fetch_ms is not None and p.fetch_ms < 1500:
        s += 10
    elif p.fetch_ms is not None and p.fetch_ms > 5000:
        s -= 10
    s += 15 if not p.is_js_rendered else -25
    s += 10 if p.image_alt_pct >= 70 else 0
    return max(0.0, min(100.0, s))


def score_page(inputs: PageScoreInputs) -> dict:
    structure = _structure_score(inputs)
    content = _content_score(inputs)
    schema = _schema_score(inputs)
    technical = _technical_score(inputs)
    page = (
        structure * PAGE_SCORE_WEIGHTS["structure"]
        + content * PAGE_SCORE_WEIGHTS["content"]
        + schema * PAGE_SCORE_WEIGHTS["schema"]
        + technical * PAGE_SCORE_WEIGHTS["technical"]
    )
    return {
        "page_score": round(page, 2),
        "structure_score": round(structure, 2),
        "content_score": round(content, 2),
        "schema_score": round(schema, 2),
        "technical_score": round(technical, 2),
    }


def score_bot_access(bot_status: dict[str, str]) -> float:
    score = 100.0
    for bot, status in bot_status.items():
        if status == "disallowed_all":
            score -= BOT_ACCESS_BLOCK_PENALTY.get(bot, 5)
    return max(0.0, min(100.0, score))


def score_audit(*, bot_access: float, content: float, schema: float, technical: float) -> dict:
    overall = (bot_access + content + schema + technical) / 4.0
    return {
        "overall_score": round(overall, 2),
        "bot_access_score": round(bot_access, 2),
        "content_score": round(content, 2),
        "schema_score": round(schema, 2),
        "technical_score": round(technical, 2),
    }
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_scoring.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/scoring.py backend/tests/test_site_audit_scoring.py
git commit -m "feat(site-audit): page + audit scoring formulas"
```

---

## Phase 5 — Citation Pipeline

### Task 15: Citation URL extractor + classifier

**Files:**
- Create: `backend/app/services/site_audit/citations.py`
- Create: `backend/tests/test_site_audit_citations_extract.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_citations_extract.py`:

```python
import pytest

from app.services.site_audit.citations import (
    extract_urls, classify_url, ClassifyResult, registered_domain,
)


def test_markdown_link_extraction():
    text = "See [the docs](https://acme.com/docs) and [other](https://x.com/y)."
    urls = extract_urls(text)
    assert "https://acme.com/docs" in urls
    assert "https://x.com/y" in urls


def test_bare_url_extraction():
    text = "Cited at https://example.com/article and also at https://other.com/page!"
    urls = extract_urls(text)
    assert "https://example.com/article" in urls
    assert "https://other.com/page" in urls


def test_dedup_within_one_response():
    text = "[a](https://x.com/a) https://x.com/a [b](https://x.com/a)"
    urls = extract_urls(text)
    assert urls.count("https://x.com/a") == 1


def test_classify_own_competitor_third_party_unknown():
    own = "acme.com"
    competitors = {"rival.com": 7}
    assert classify_url("https://acme.com/x", own, competitors).kind == "own"
    res = classify_url("https://rival.com/y", own, competitors)
    assert res.kind == "competitor" and res.competitor_id == 7
    assert classify_url("https://wikipedia.org/x", own, competitors).kind == "third_party"
    assert classify_url("https://random.com/x", own, competitors).kind == "unknown"


def test_registered_domain():
    assert registered_domain("https://docs.acme.co.uk/foo") == "acme.co.uk"
    assert registered_domain("https://acme.com/") == "acme.com"
    assert registered_domain("not a url") is None
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest backend/tests/test_site_audit_citations_extract.py -v
```

- [ ] **Step 3: Implement**

`backend/app/services/site_audit/citations.py`:

```python
"""URL extraction from QueryResult response text + classification."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import tldextract

from app.services.site_audit.constants import THIRD_PARTY_AUTHORITY_DOMAINS, normalise_url

logger = logging.getLogger(__name__)

_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_BARE_URL_RE = re.compile(r"(?<![\[\(])(https?://[^\s\]\)\}\"']+)")
_TRAILING_PUNCT = ".,;:!?"


@dataclass
class ClassifyResult:
    kind: str
    domain: str
    competitor_id: int | None = None


def extract_urls(text: str | None) -> list[str]:
    if not text:
        return []
    raw: list[str] = []
    for m in _MD_LINK_RE.finditer(text):
        raw.append(m.group(2))
    for m in _BARE_URL_RE.finditer(text):
        raw.append(m.group(1))
    out: list[str] = []
    seen: set[str] = set()
    for u in raw:
        u = u.rstrip(_TRAILING_PUNCT)
        if "#" in u:
            u = u.split("#", 1)[0]
        if not u or u in seen:
            continue
        try:
            normalised = normalise_url(u)
        except ValueError:
            continue
        if normalised in seen:
            continue
        seen.add(normalised)
        out.append(normalised)
    return out


def registered_domain(url: str) -> str | None:
    try:
        ext = tldextract.extract(url)
    except Exception:
        return None
    if not ext.domain or not ext.suffix:
        return None
    return f"{ext.domain}.{ext.suffix}".lower()


def classify_url(url: str, own_domain: str | None, competitors_by_domain: dict[str, int]) -> ClassifyResult:
    domain = registered_domain(url) or ""
    if own_domain and domain == own_domain.lower():
        return ClassifyResult("own", domain)
    if domain in competitors_by_domain:
        return ClassifyResult("competitor", domain, competitor_id=competitors_by_domain[domain])
    if domain in THIRD_PARTY_AUTHORITY_DOMAINS:
        return ClassifyResult("third_party", domain)
    return ClassifyResult("unknown", domain)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_citations_extract.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/citations.py backend/tests/test_site_audit_citations_extract.py
git commit -m "feat(site-audit): citation URL extraction + own/competitor/third-party classification"
```

---

### Task 16: Citation persistence + hook into tracking_service

**Files:**
- Modify: `backend/app/services/site_audit/citations.py` (add `extract_for_run`)
- Modify: `backend/app/services/tracking_service.py` (call after gap analysis)
- Create: `backend/tests/test_site_audit_citations_persist.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_site_audit_citations_persist.py`:

```python
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, Competitor, Prompt, QueryResult, TrackingRun, User, CitationSource, utcnow,
)
from app.services.site_audit.citations import extract_for_run


@pytest.mark.asyncio
async def test_extract_for_run_inserts_classified_citations():
    async with AsyncSessionLocal() as db:
        u = User(email="t@x.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="Brand", slug="brand", user_id=u.id, website_url="https://acme.com")
        db.add(b); await db.flush()
        c = Competitor(brand_id=b.id, name="Rival", website_url="https://rival.com")
        db.add(c); await db.flush()
        p = Prompt(brand_id=b.id, text="best widgets")
        db.add(p); await db.flush()
        run = TrackingRun(brand_id=b.id, status="completed", started_at=utcnow())
        db.add(run); await db.flush()
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=p.id, model="chatgpt", run_number=1,
            response_text="See [rival pricing](https://rival.com/pricing) and https://wikipedia.org/widgets.",
            mentioned=False,
        )
        db.add(qr); await db.commit()

        n = await extract_for_run(run.id)
        assert n == 2

        rows = (await db.execute(select(CitationSource).where(CitationSource.brand_id == b.id))).scalars().all()
        kinds = {r.kind for r in rows}
        assert kinds == {"competitor", "third_party"}


@pytest.mark.asyncio
async def test_extract_for_run_is_idempotent():
    async with AsyncSessionLocal() as db:
        u = User(email="t2@x.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="B2", slug="b2", user_id=u.id, website_url="https://acme.com")
        db.add(b); await db.flush()
        p = Prompt(brand_id=b.id, text="x")
        db.add(p); await db.flush()
        run = TrackingRun(brand_id=b.id, status="completed", started_at=utcnow())
        db.add(run); await db.flush()
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=p.id, model="chatgpt", run_number=1,
            response_text="https://wikipedia.org/x",
            mentioned=False,
        )
        db.add(qr); await db.commit()

        n1 = await extract_for_run(run.id)
        n2 = await extract_for_run(run.id)
        rows = (await db.execute(select(CitationSource))).scalars().all()
        assert n1 == 1
        assert n2 == 0  # idempotent
        assert len(rows) == 1
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_citations_persist.py -v
```

- [ ] **Step 3: Add `extract_for_run`**

Append to `backend/app/services/site_audit/citations.py`:

```python
async def extract_for_run(tracking_run_id: int) -> int:
    """Extract+classify citations for one completed tracking run.

    Idempotent via UNIQUE(query_result_id, url) — re-runs insert 0 rows.
    Returns the number of NEW rows inserted.
    """
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from app.database import AsyncSessionLocal
    from app.models import (
        Brand, CitationSource, Competitor, QueryResult, TrackingRun,
    )

    inserted = 0
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, tracking_run_id)
        if run is None:
            return 0
        brand = await db.get(Brand, run.brand_id)
        if brand is None:
            return 0
        own = registered_domain(brand.website_url or "") if brand.website_url else None

        comp_rows = (await db.execute(
            select(Competitor).where(Competitor.brand_id == brand.id)
        )).scalars().all()
        competitors_by_domain: dict[str, int] = {}
        for c in comp_rows:
            d = registered_domain(c.website_url or "") if c.website_url else None
            if d:
                competitors_by_domain[d] = c.id

        qrs = (await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == tracking_run_id)
        )).scalars().all()

        for qr in qrs:
            if not qr.response_text:
                continue
            urls = extract_urls(qr.response_text)
            for url in urls:
                cls = classify_url(url, own, competitors_by_domain)
                row = CitationSource(
                    brand_id=brand.id,
                    tracking_run_id=run.id,
                    prompt_id=qr.prompt_id,
                    query_result_id=qr.id,
                    model=qr.model,
                    url=url,
                    domain=cls.domain,
                    kind=cls.kind,
                    competitor_id=cls.competitor_id,
                )
                db.add(row)
                try:
                    await db.flush()
                    inserted += 1
                except IntegrityError:
                    await db.rollback()
                    continue

        await db.commit()
    return inserted
```

- [ ] **Step 4: Run — expect pass**

```bash
pytest backend/tests/test_site_audit_citations_persist.py -v
```

- [ ] **Step 5: Wire into tracking_service**

Locate the section of `backend/app/services/tracking_service.py` where `gap_analysis_service.run_gap_analysis(...)` is invoked. Add a call to `extract_for_run` immediately after, inside the same try/except non-fatal wrapper:

```python
        try:
            from app.services.site_audit.citations import extract_for_run
            await extract_for_run(run.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("citation extraction failed for run %d: %s", run.id, exc)
```

- [ ] **Step 6: Run full test file plus existing tracking tests**

```bash
pytest backend/tests/test_site_audit_citations_persist.py backend/tests/test_tracking.py -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/site_audit/citations.py backend/app/services/tracking_service.py backend/tests/test_site_audit_citations_persist.py
git commit -m "feat(site-audit): persist citations post-run + idempotent extract_for_run"
```

---

### Task 17: Backfill citations script

**Files:**
- Create: `backend/scripts/backfill_citations.py`

- [ ] **Step 1: Implement script**

`backend/scripts/backfill_citations.py`:

```python
"""One-shot backfill of CitationSource rows from all completed TrackingRun history.

Safe to re-run: extract_for_run is idempotent via UNIQUE(query_result_id, url).

Usage:
    python -m backend.scripts.backfill_citations
    python -m backend.scripts.backfill_citations --brand-id 42
    python -m backend.scripts.backfill_citations --since 2026-01-01
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import datetime, UTC

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import TrackingRun
from app.services.site_audit.citations import extract_for_run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main(brand_id: int | None, since: datetime | None) -> None:
    async with AsyncSessionLocal() as db:
        q = select(TrackingRun.id, TrackingRun.brand_id).where(
            TrackingRun.status == "completed"
        )
        if brand_id is not None:
            q = q.where(TrackingRun.brand_id == brand_id)
        if since is not None:
            q = q.where(TrackingRun.started_at >= since)
        q = q.order_by(TrackingRun.started_at)
        rows = (await db.execute(q)).all()

    total = 0
    runs = 0
    for run_id, _brand_id in rows:
        try:
            n = await extract_for_run(run_id)
        except Exception:  # noqa: BLE001
            logger.exception("extract_for_run failed for run %d", run_id)
            continue
        total += n
        runs += 1
        if runs % 100 == 0:
            logger.info("Backfilled %d runs, %d citations so far", runs, total)
    logger.info("Backfill complete: %d runs processed, %d citations inserted", runs, total)


def _parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand-id", type=int, default=None)
    ap.add_argument("--since", type=str, default=None,
                    help="ISO date — only runs started on/after this date")
    return ap.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    since = None
    if args.since:
        since = datetime.fromisoformat(args.since).replace(tzinfo=UTC)
    asyncio.run(main(args.brand_id, since))
```

- [ ] **Step 2: Smoke-test that the script imports**

```bash
cd backend
python -m scripts.backfill_citations --help
```

Expected: argparse help output.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfill_citations.py
git commit -m "feat(site-audit): one-shot citation backfill script"
```

---

## Phase 6 — Linking, Recommendations, Generators

### Task 18: Page ↔ prompt linking

**Files:**
- Create: `backend/app/services/site_audit/page_prompt_link.py`
- Create: `backend/tests/test_site_audit_page_prompt_link.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_page_prompt_link.py`:

```python
import pytest

from app.services.site_audit.page_prompt_link import (
    score_url_match, link_pages_to_prompts, PageLinkInput, PromptLinkInput,
)


def test_score_url_match_slug_overlap():
    assert score_url_match(
        own_url="https://acme.com/pricing",
        own_title="Pricing",
        own_page_type="pricing",
        cited_url="https://rival.com/pricing-guide",
        prompt_text="What is the pricing for widget tools?",
    ) > 0.3


def test_low_score_for_unrelated():
    s = score_url_match(
        own_url="https://acme.com/about",
        own_title="About Us",
        own_page_type="about",
        cited_url="https://rival.com/pricing",
        prompt_text="What does it cost?",
    )
    assert s < 0.3


def test_link_pages_to_prompts_picks_best_page():
    pages = [
        PageLinkInput(id=1, url="https://acme.com/pricing", title="Pricing", page_type="pricing"),
        PageLinkInput(id=2, url="https://acme.com/about", title="About Us", page_type="about"),
    ]
    prompts = [
        PromptLinkInput(id=10, text="What does Acme pricing look like?",
                        cited_urls=["https://rival.com/pricing-guide"]),
    ]
    result = link_pages_to_prompts(pages, prompts)
    assert 10 in result[1]
    assert 10 not in result.get(2, [])
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_page_prompt_link.py -v
```

- [ ] **Step 3: Implement**

`backend/app/services/site_audit/page_prompt_link.py`:

```python
"""Match own-domain pages to losing prompts via slug + title token overlap."""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


@dataclass
class PageLinkInput:
    id: int
    url: str
    title: str | None
    page_type: str


@dataclass
class PromptLinkInput:
    id: int
    text: str
    cited_urls: list[str]  # competitor/third-party URLs cited for this prompt


def _tokens(s: str | None) -> set[str]:
    if not s:
        return set()
    return {t.lower() for t in _TOKEN_RE.findall(s) if len(t) > 2}


def _slug(url: str) -> set[str]:
    path = urlparse(url).path
    return _tokens(path.replace("/", " ").replace("-", " ").replace("_", " "))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _page_type_for_cited(url: str) -> str:
    p = urlparse(url).path.lower()
    if "pricing" in p:
        return "pricing"
    if "about" in p or "team" in p:
        return "about"
    if "docs" in p or "api" in p or "help" in p:
        return "docs"
    if "blog" in p or "article" in p:
        return "article"
    return "other"


def score_url_match(*, own_url: str, own_title: str | None, own_page_type: str,
                    cited_url: str, prompt_text: str) -> float:
    slug_overlap = _jaccard(_slug(own_url), _slug(cited_url))
    title_overlap = _jaccard(_tokens(own_title), _tokens(prompt_text))
    page_type_match = 1.0 if own_page_type == _page_type_for_cited(cited_url) else 0.0
    return 0.5 * slug_overlap + 0.3 * title_overlap + 0.2 * page_type_match


def link_pages_to_prompts(
    pages: list[PageLinkInput],
    prompts: list[PromptLinkInput],
    *,
    threshold: float = 0.3,
) -> dict[int, list[int]]:
    """Return {page_id: [prompt_id, ...]}."""
    result: dict[int, list[int]] = {}
    for prompt in prompts:
        best_page_id: int | None = None
        best_score = threshold
        for cited in prompt.cited_urls:
            for page in pages:
                s = score_url_match(
                    own_url=page.url, own_title=page.title, own_page_type=page.page_type,
                    cited_url=cited, prompt_text=prompt.text,
                )
                if s > best_score:
                    best_score = s
                    best_page_id = page.id
        if best_page_id is not None:
            result.setdefault(best_page_id, []).append(prompt.id)
        else:
            # Fallback: top-1 page by title-token overlap with the prompt
            ranked = sorted(
                pages,
                key=lambda p: _jaccard(_tokens(p.title), _tokens(prompt.text)),
                reverse=True,
            )
            if ranked and _jaccard(_tokens(ranked[0].title), _tokens(prompt.text)) > 0.1:
                result.setdefault(ranked[0].id, []).append(prompt.id)
    return result
```

- [ ] **Step 4: Run — expect pass**

```bash
pytest backend/tests/test_site_audit_page_prompt_link.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/page_prompt_link.py backend/tests/test_site_audit_page_prompt_link.py
git commit -m "feat(site-audit): page↔prompt linking via slug+title overlap"
```

---

### Task 19: Rule-based recommendations engine

**Files:**
- Create: `backend/app/services/site_audit/recommendations.py`
- Create: `backend/tests/test_site_audit_recommendations.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_recommendations.py`:

```python
from app.services.site_audit.parsers import Finding
from app.services.site_audit.recommendations import (
    build_rule_based_recs, RecInput,
)


def test_blocked_oai_searchbot_produces_high_priority_rec():
    findings = [Finding("blocked_oai_searchbot", "critical", "bot_access",
                        "OAI-SearchBot blocked", {})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert len(recs) == 1
    assert recs[0].priority == "high"
    assert recs[0].effort == "low"
    assert "OAI-SearchBot" in recs[0].body


def test_low_severity_findings_dont_produce_critical_recs():
    findings = [Finding("title_too_long", "low", "content",
                        "Title is long", {"length": 80})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert len(recs) == 1
    assert recs[0].priority == "low"


def test_page_link_map_propagates_prompt_ids():
    findings = [Finding("answer_first_failed", "medium", "content", "...", {})]
    recs = build_rule_based_recs(findings, page_link_map={5: [101, 102]}, page_id=5)
    assert recs[0].linked_prompt_ids == [101, 102]


def test_unknown_check_id_produces_no_rec():
    findings = [Finding("not_in_catalog", "high", "content", "...", {})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert recs == []
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_recommendations.py -v
```

- [ ] **Step 3: Implement**

`backend/app/services/site_audit/recommendations.py`:

```python
"""Rule-based recommendation engine + LLM rewrite helper."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.services.site_audit.parsers import Finding

logger = logging.getLogger(__name__)


@dataclass
class Recommendation:
    check_id: str
    title: str
    body: str
    category: str
    priority: str
    effort: str
    linked_prompt_ids: list[int] = field(default_factory=list)
    expected_impact: str | None = None
    llm_generated: bool = False


@dataclass
class RecInput:
    findings: list[Finding]
    page_link_map: dict[int, list[int]]
    page_id: int | None


# (check_id) → (title, body, category, priority, effort, expected_impact)
_RECS: dict[str, dict] = {
    "blocked_oai_searchbot": {
        "title": "Unblock OAI-SearchBot (ChatGPT live search)",
        "body": (
            "Your robots.txt disallows `OAI-SearchBot`. This is the user-agent ChatGPT uses to "
            "fetch pages in real time when answering user questions about your brand. While "
            "you're blocking it, ChatGPT cannot read your site.\n\n"
            "Add to robots.txt:\n\n"
            "```\nUser-agent: OAI-SearchBot\nAllow: /\n```\n\n"
            "Use the robots.txt snippet generator on this page for a complete AI-bot allow block."
        ),
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
        "expected_impact": "Restores ChatGPT live-search visibility",
    },
    "blocked_gptbot": {
        "title": "Allow GPTBot",
        "body": "GPTBot is blocked. This excludes your content from OpenAI training. If you want to also block OAI-SearchBot, do it explicitly — they're separate user-agents.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_claudebot": {
        "title": "Allow ClaudeBot",
        "body": "ClaudeBot is blocked from your site. This excludes your content from Claude's training and retrieval.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_google_extended": {
        "title": "Allow Google-Extended",
        "body": "Google-Extended is blocked. This is what Gemini and Google AI Overviews use to read your content.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "blocked_perplexitybot": {
        "title": "Allow PerplexityBot",
        "body": "PerplexityBot is blocked. Perplexity is heavily citation-driven; blocking it removes you from a significant share of AI search.",
        "category": "bot_access",
        "priority": "high",
        "effort": "low",
    },
    "no_robots_txt": {
        "title": "Add a robots.txt with an AI-bot allow block",
        "body": "Your site has no robots.txt. While the default is allow-all, an explicit `Allow: /` per AI bot signals intent.",
        "category": "bot_access",
        "priority": "low",
        "effort": "low",
    },
    "llms_txt_missing": {
        "title": "Add an llms.txt",
        "body": "Add a `/llms.txt` summarising your key pages for AI agents. Use the generator on this page. Adoption is early but cost is zero.",
        "category": "bot_access",
        "priority": "low",
        "effort": "low",
    },
    "missing_h1": {
        "title": "Add a single H1 heading",
        "body": "Pages without an H1 lose structural anchoring for AI extraction. Add one descriptive H1 at the top.",
        "category": "content",
        "priority": "high",
        "effort": "low",
    },
    "no_h2": {
        "title": "Break the page into H2 sections",
        "body": "AI passages are extracted at section granularity. Without H2s, the entire page is one blob — nothing extracts cleanly.",
        "category": "content",
        "priority": "medium",
        "effort": "medium",
    },
    "answer_first_failed": {
        "title": "Lead each H2 section with a self-contained answer",
        "body": (
            "AI engines extract the first 40–75 words of each section. If those words "
            "rely on pronouns or context from elsewhere, the passage gets dropped. "
            "Rewrite the opening paragraph of each H2 to stand alone with the brand name explicit."
        ),
        "category": "content",
        "priority": "medium",
        "effort": "medium",
        "expected_impact": "Up to +3.1× citation rate on passage-level extraction (KIME 2026)",
    },
    "fact_density_low": {
        "title": "Add specific facts and numbers",
        "body": (
            "Statistics Addition was +33% citations in the Aggarwal 2024 GEO paper. "
            "Add 3–5 specific stats with year + source inline."
        ),
        "category": "content",
        "priority": "medium",
        "effort": "medium",
        "expected_impact": "Aggarwal 2024: +33% citations from Statistics Addition",
    },
    "no_outbound_citations": {
        "title": "Cite your sources",
        "body": "Pages with zero outbound links read as marketing copy to AI engines. Cite at least 2–3 third-party sources.",
        "category": "authority",
        "priority": "low",
        "effort": "low",
        "expected_impact": "Aggarwal 2024: +28% citations from Cite Sources",
    },
    "pronoun_overuse": {
        "title": "Replace leading pronouns with the brand or concept name",
        "body": "Sentences that begin with 'It' or 'They' lose context when extracted independently. Use explicit names.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
    "fake_lists": {
        "title": "Use real <ul>/<ol> instead of paragraphs with bullet characters",
        "body": "AI engines read the underlying HTML. Bullet-prefixed paragraphs are not lists. Convert to `<ul>` / `<ol>`.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
    "missing_organization_schema": {
        "title": "Add Organization JSON-LD on the homepage",
        "body": (
            "Add a JSON-LD `Organization` block with `name`, `url`, `logo`, and `sameAs` pointing "
            "to LinkedIn / X / etc. This is the entity-anchor for the rest of the schema graph."
        ),
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "incomplete_organization_schema": {
        "title": "Complete Organization schema fields",
        "body": "Organization schema is present but missing required fields. Add the missing keys (see finding evidence).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "article_missing_author": {
        "title": "Add a Person-typed author to Article schema",
        "body": "Articles without identified authors are weaker E-E-A-T signals. Add `author` as `{\"@type\":\"Person\",\"name\":\"...\",\"sameAs\":[\"https://linkedin.com/in/...\"]}`.",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "article_missing_dates": {
        "title": "Add datePublished and dateModified",
        "body": "AI engines weight recency — 50% of cited content is <13 weeks old. Always include both dates.",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "product_missing_required": {
        "title": "Complete Product schema",
        "body": "Product schema is missing required fields (see finding evidence).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "faqpage_no_questions": {
        "title": "Remove or populate FAQPage schema",
        "body": "FAQPage schema with no `mainEntity` is misuse and may incur penalties. Either remove it or add real Q&A entries that match what's visible on the page.",
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "malformed_jsonld": {
        "title": "Fix malformed JSON-LD",
        "body": "A `<script type=application/ld+json>` block fails to parse. AI engines skip invalid schema entirely.",
        "category": "schema",
        "priority": "high",
        "effort": "low",
    },
    "no_jsonld": {
        "title": "Add JSON-LD schema",
        "body": "No JSON-LD on this page. Start with the schema type that fits (`Article`, `Product`, `Service`, etc.).",
        "category": "schema",
        "priority": "medium",
        "effort": "low",
    },
    "missing_title": {
        "title": "Add a <title>",
        "body": "Pages without `<title>` are invisible to AI extraction.",
        "category": "content",
        "priority": "high",
        "effort": "low",
    },
    "missing_meta_description": {
        "title": "Add a meta description",
        "body": "Add a 70–160 character description summarising the page in answer form.",
        "category": "content",
        "priority": "medium",
        "effort": "low",
    },
    "missing_byline": {
        "title": "Add a visible author byline",
        "body": "Article pages without an author byline are weaker E-E-A-T signals.",
        "category": "authority",
        "priority": "medium",
        "effort": "low",
    },
    "missing_update_date": {
        "title": "Show a publication or update date on article pages",
        "body": "AI engines prefer recently-updated content. Make the date visible AND include `dateModified` in JSON-LD.",
        "category": "authority",
        "priority": "medium",
        "effort": "low",
    },
    "stale_content": {
        "title": "Refresh stale content",
        "body": "This page hasn't been updated in over 18 months. Pages not refreshed quarterly lose AI citations at ~3× the normal rate.",
        "category": "content",
        "priority": "medium",
        "effort": "medium",
    },
    "low_alt_text_coverage": {
        "title": "Add descriptive alt text",
        "body": "Most images lack descriptive `alt`. Claude treats 35% of its fetches as image-content per Vercel's study; descriptive alts help.",
        "category": "content",
        "priority": "low",
        "effort": "low",
    },
}

_RENDER_REC = {
    "title": "Render this page server-side",
    "body": (
        "AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) **do not execute "
        "JavaScript** — Vercel's 1B-fetch study found zero JS execution. This page's content "
        "is only present after JS runs, so it's invisible to all four major LLMs.\n\n"
        "Switch the page to SSR / SSG (Next.js getServerSideProps, Nuxt asyncData, etc.) or "
        "use a pre-render proxy."
    ),
    "category": "technical",
    "priority": "high",
    "effort": "high",
    "expected_impact": "Restores AI crawler visibility from zero",
}


def build_rule_based_recs(
    findings: list[Finding],
    page_link_map: dict[int, list[int]],
    page_id: int | None,
) -> list[Recommendation]:
    out: list[Recommendation] = []
    for f in findings:
        spec = _RECS.get(f.check_id)
        if spec is None:
            continue
        priority = spec.get("priority", "low")
        # Boost priority from severity if higher
        if f.severity == "critical" and priority != "high":
            priority = "high"
        prompt_ids = page_link_map.get(page_id, []) if page_id is not None else []
        out.append(Recommendation(
            check_id=f.check_id,
            title=spec["title"],
            body=spec["body"],
            category=spec["category"],
            priority=priority,
            effort=spec.get("effort", "medium"),
            linked_prompt_ids=prompt_ids,
            expected_impact=spec.get("expected_impact"),
        ))
    return out


def render_rec_for_csr_page(page_id: int, linked_prompt_ids: list[int]) -> Recommendation:
    """Build the 'render server-side' recommendation when is_js_rendered=True."""
    return Recommendation(
        check_id="js_rendered_page",
        title=_RENDER_REC["title"],
        body=_RENDER_REC["body"],
        category=_RENDER_REC["category"],
        priority=_RENDER_REC["priority"],
        effort=_RENDER_REC["effort"],
        linked_prompt_ids=linked_prompt_ids,
        expected_impact=_RENDER_REC["expected_impact"],
    )


async def generate_llm_rewrite(
    page_excerpt: str,
    findings: list[Finding],
    brand_profile: dict,
    linked_prompts: list[str],
    *,
    timeout_s: int = 30,
) -> str | None:
    """Generate an answer-first rewrite for the first H2 section. Returns None on any failure."""
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        return None

    try:
        prompt_text = _build_llm_rewrite_prompt(page_excerpt, findings, brand_profile, linked_prompts)
        client = AsyncAnthropic()
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1500,
            timeout=timeout_s,
            messages=[{"role": "user", "content": prompt_text}],
        )
        content = "".join(block.text for block in msg.content if hasattr(block, "text"))
        return content.strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM rewrite failed: %s", exc)
        return None


def _build_llm_rewrite_prompt(page_excerpt: str, findings: list[Finding],
                              brand_profile: dict, linked_prompts: list[str]) -> str:
    findings_summary = "\n".join(f"- {f.check_id}: {f.message}" for f in findings if f.severity in ("critical", "high", "medium"))
    prompts_summary = "\n".join(f"- {p}" for p in linked_prompts[:5])
    return f"""You are rewriting a page section for AI-search visibility. The goal: the first 40–75 words must be a self-contained answer that explicitly names the brand and addresses the query.

Brand: {brand_profile.get('name', 'this brand')}
Tone: {brand_profile.get('tone_of_voice', 'professional, factual')}
Do not say: {brand_profile.get('what_not_to_say', '')}

AI prompts this page should win:
{prompts_summary or '(none specified)'}

Findings to address:
{findings_summary or '(none)'}

Current first section of the page:
---
{page_excerpt[:4000]}
---

Output a rewrite of the FIRST H2 section only:
- Lead with a 40–75-word answer-first paragraph (no leading pronouns, brand name explicit)
- Follow with one comparison table OR a numbered list if relevant
- Include at least one specific statistic with year + source

Output only the rewritten HTML — no commentary."""
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_recommendations.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/recommendations.py backend/tests/test_site_audit_recommendations.py
git commit -m "feat(site-audit): rule-based recommendations + LLM rewrite helper"
```

---

### Task 20: Generators (llms.txt + robots snippet)

**Files:**
- Create: `backend/app/services/site_audit/generators.py`
- Create: `backend/tests/test_site_audit_generators.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_generators.py`:

```python
from app.services.site_audit.generators import (
    build_llms_txt, build_robots_snippet, BrandSummary, KeyPage,
)


def test_build_llms_txt_with_key_pages():
    brand = BrandSummary(
        name="Acme",
        website_url="https://acme.com",
        description="Acme makes B2B widgets that help small SaaS teams scale.",
    )
    pages = [
        KeyPage(url="https://acme.com/", title="Home", page_type="homepage", score=92),
        KeyPage(url="https://acme.com/pricing", title="Pricing", page_type="pricing", score=88),
        KeyPage(url="https://acme.com/docs", title="Docs", page_type="docs", score=80),
    ]
    txt = build_llms_txt(brand, pages)
    assert txt.startswith("# Acme")
    assert "Acme makes B2B widgets" in txt
    assert "[Pricing](https://acme.com/pricing)" in txt
    assert "## Key resources" in txt


def test_build_llms_txt_skeleton_when_no_pages():
    brand = BrandSummary(name="X", website_url="https://x.com", description=None)
    txt = build_llms_txt(brand, [])
    assert "# X" in txt
    assert "[Homepage](https://x.com" in txt


def test_robots_snippet_allow_all():
    out = build_robots_snippet("allow_all")
    assert "GPTBot" in out
    assert "OAI-SearchBot" in out
    assert "Allow: /" in out


def test_robots_snippet_search_only():
    out = build_robots_snippet("search_only")
    assert "OAI-SearchBot" in out
    assert "User-agent: GPTBot" in out
    assert "Disallow: /" in out  # training blocked
    # OAI-SearchBot still allowed
    assert "User-agent: OAI-SearchBot\nAllow: /" in out
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_generators.py -v
```

- [ ] **Step 3: Implement**

`backend/app/services/site_audit/generators.py`:

```python
"""Generators for llms.txt and robots.txt AI-bot snippets."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BrandSummary:
    name: str
    website_url: str
    description: str | None


@dataclass
class KeyPage:
    url: str
    title: str
    page_type: str
    score: float


def build_llms_txt(brand: BrandSummary, key_pages: list[KeyPage]) -> str:
    """Build a spec-compliant llms.txt for a brand."""
    lines: list[str] = []
    lines.append(f"# {brand.name}")
    lines.append("")
    if brand.description:
        lines.append(f"> {brand.description}")
        lines.append("")
        lines.append("## About")
        lines.append("")
        lines.append(brand.description)
        lines.append("")

    lines.append("## Key resources")
    lines.append("")
    primary_types = {"homepage", "pricing", "product", "docs"}
    primary = [p for p in key_pages if p.page_type in primary_types]
    optional = [p for p in key_pages if p.page_type not in primary_types]

    if not primary:
        # Skeleton
        root = brand.website_url.rstrip("/")
        lines.append(f"- [Homepage]({root}/) — what {brand.name} is")
        lines.append(f"- [Pricing]({root}/pricing) — what it costs")
        lines.append(f"- [Docs]({root}/docs) — technical detail")
    else:
        # Sort by score desc, dedup by page_type with highest score
        seen_types: set[str] = set()
        for page in sorted(primary, key=lambda p: -p.score):
            if page.page_type in seen_types:
                continue
            seen_types.add(page.page_type)
            blurb = _blurb_for(page.page_type, brand.name)
            lines.append(f"- [{page.title}]({page.url}) — {blurb}")

    if optional:
        lines.append("")
        lines.append("## Optional")
        lines.append("")
        for page in sorted(optional, key=lambda p: -p.score)[:5]:
            lines.append(f"- [{page.title}]({page.url})")

    return "\n".join(lines) + "\n"


def _blurb_for(page_type: str, brand_name: str) -> str:
    return {
        "homepage": f"what {brand_name} is",
        "pricing": "pricing and plans",
        "product": "product details",
        "docs": "documentation",
    }.get(page_type, "")


_ALL_BOTS_ALLOW = [
    "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot",
    "Google-Extended", "Meta-ExternalAgent",
]


def build_robots_snippet(mode: str) -> str:
    if mode == "allow_all":
        lines: list[str] = ["# AI crawler access (managed by Lumidian)"]
        for bot in _ALL_BOTS_ALLOW:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Allow: /")
        return "\n".join(lines) + "\n"

    if mode == "search_only":
        # Block training, allow live-search bots
        train_block = ["GPTBot", "ClaudeBot", "Google-Extended"]
        search_allow = ["OAI-SearchBot", "PerplexityBot"]
        lines = ["# Block AI training, allow AI live search (managed by Lumidian)"]
        for bot in train_block:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Disallow: /")
        for bot in search_allow:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Allow: /")
        return "\n".join(lines) + "\n"

    raise ValueError(f"unknown mode: {mode}")
```

- [ ] **Step 4: Run — expect pass**

```bash
pytest backend/tests/test_site_audit_generators.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/generators.py backend/tests/test_site_audit_generators.py
git commit -m "feat(site-audit): llms.txt + robots.txt snippet generators"
```

---

## Phase 7 — Orchestrator + Router

### Task 21: Auditor orchestrator

**Files:**
- Create: `backend/app/services/site_audit/auditor.py`
- Create: `backend/tests/test_site_audit_auditor.py`

- [ ] **Step 1: Failing test (end-to-end with local static server)**

`backend/tests/test_site_audit_auditor.py`:

```python
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, User, WebsiteAudit, WebsiteAuditFinding, WebsiteAuditPage
from app.services.site_audit.auditor import run_audit
from tests.fixtures.site_audit.static_server import run_server


GOOD_HTML = """<html><head>
<title>Acme Pricing</title>
<meta name="description" content="Acme costs $99/month for the Pro plan. Volume discounts at 50+ seats.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.com","logo":"x","sameAs":["https://linkedin.com/company/acme"]}
</script>
</head><body>
<h1>Acme Pricing</h1>
<h2>How much does Acme cost?</h2>
<p>Acme costs $99 per month for the Pro plan as of 2025. Volume discounts start at 50 seats. According to a 2025 study by Forrester, 73% of teams using Acme save over 12 hours per week.</p>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$99</td></tr></table>
<p>See <a href="https://forrester.com">Forrester</a> for context.</p>
</body></html>"""

ROBOTS_OK = "User-agent: *\nAllow: /\n"
LLMS_OK = "# Acme\n\n> Acme makes B2B widgets.\n\n## Key resources\n- [Home](http://example.com/)\n"


@pytest.mark.asyncio
async def test_run_audit_completes_with_scores():
    async with AsyncSessionLocal() as db:
        u = User(email="auditor@test.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()

    routes = {
        "/": (200, "text/html", GOOD_HTML),
        "/robots.txt": (200, "text/plain", ROBOTS_OK),
        "/llms.txt": (200, "text/plain", LLMS_OK),
    }
    async with run_server(routes) as base:
        async with AsyncSessionLocal() as db:
            b = Brand(name="Acme", slug="acme", user_id=u.id, website_url=base, tier="basic")
            db.add(b); await db.commit()
            brand_id = b.id

        audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)

        async with AsyncSessionLocal() as db:
            audit = await db.get(WebsiteAudit, audit_id)
            assert audit is not None
            assert audit.status == "completed"
            assert audit.overall_score is not None
            assert audit.total_pages >= 1
            pages = (await db.execute(select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id))).scalars().all()
            assert pages
            findings = (await db.execute(select(WebsiteAuditFinding).where(WebsiteAuditFinding.audit_id == audit_id))).scalars().all()
            # Should have at least the positive llms_txt finding
            ids = {f.check_id for f in findings}
            assert "llms_txt_present_valid" in ids


@pytest.mark.asyncio
async def test_run_audit_marks_failed_on_unreachable_host():
    async with AsyncSessionLocal() as db:
        u = User(email="u2@test.com", password_hash="x", email_verified=True)
        db.add(u); await db.flush()
        b = Brand(name="X", slug="x2", user_id=u.id, website_url="http://10.255.255.1", tier="basic")
        db.add(b); await db.commit()
        brand_id = b.id

    audit_id = await run_audit(brand_id=brand_id, triggered_by="user", max_pages=5)
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        assert audit.status in ("failed", "completed")
        # If completed, total_pages may be 0; if failed, error_message is set
        if audit.status == "failed":
            assert audit.error_message
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest backend/tests/test_site_audit_auditor.py -v
```

- [ ] **Step 3: Implement orchestrator**

`backend/app/services/site_audit/auditor.py`:

```python
"""Audit orchestrator: crawl → parse → score → link → recommend → persist."""
from __future__ import annotations

import asyncio
import json
import logging
import random
from urllib.parse import urljoin

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, CitationSource, Prompt, WebsiteAudit, WebsiteAuditFinding,
    WebsiteAuditPage, WebsiteAuditRecommendation, utcnow,
)
from app.services.site_audit.citations import registered_domain
from app.services.site_audit.constants import (
    PER_AUDIT_BUDGET_S, RENDER_SAMPLE_SIZE, normalise_url,
)
from app.services.site_audit.crawler import crawl_site, discover_sitemap_urls
from app.services.site_audit.fetcher import (
    classify_render_mode, fetch_raw, fetch_rendered,
)
from app.services.site_audit.page_classifier import classify_page
from app.services.site_audit.page_prompt_link import (
    PageLinkInput, PromptLinkInput, link_pages_to_prompts,
)
from app.services.site_audit.parsers import Finding
from app.services.site_audit.parsers.llms_txt import parse_llms_txt
from app.services.site_audit.parsers.meta import parse_meta
from app.services.site_audit.parsers.robots import parse_robots
from app.services.site_audit.parsers.schema import parse_schema
from app.services.site_audit.parsers.semantic import parse_semantic
from app.services.site_audit.recommendations import (
    build_rule_based_recs, render_rec_for_csr_page,
)
from app.services.site_audit.scoring import (
    PageScoreInputs, score_audit, score_bot_access, score_page,
)

logger = logging.getLogger(__name__)


async def run_audit(*, brand_id: int, triggered_by: str, max_pages: int) -> int:
    """Top-level entry. Creates a WebsiteAudit row and runs to completion.

    Returns the audit_id. Never raises; on failure, audit.status='failed'
    and error_message is set.
    """
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if brand is None or not brand.website_url:
            raise ValueError("brand not found or has no website_url")

        audit = WebsiteAudit(
            brand_id=brand_id, status="pending", triggered_by=triggered_by,
            started_at=utcnow(),
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        audit_id = audit.id

    try:
        await asyncio.wait_for(_run_audit_inner(audit_id, brand_id, max_pages),
                                timeout=PER_AUDIT_BUDGET_S + 30)
    except asyncio.TimeoutError:
        await _mark_failed(audit_id, "audit budget exceeded")
    except Exception as exc:  # noqa: BLE001
        logger.exception("audit %d failed", audit_id)
        await _mark_failed(audit_id, f"unexpected error: {exc}")
    return audit_id


async def _mark_failed(audit_id: int, msg: str) -> None:
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit:
            audit.status = "failed"
            audit.error_message = msg
            audit.completed_at = utcnow()
            await db.commit()


async def _run_audit_inner(audit_id: int, brand_id: int, max_pages: int) -> None:
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        root = (brand.website_url or "").rstrip("/") + "/"

    # ── crawling phase ────────────────────────────────────────────────────
    await _set_status(audit_id, "crawling")

    sitemap_urls, sitemap_src = await discover_sitemap_urls(root)
    seed_urls = sitemap_urls[:max_pages] if sitemap_urls else None
    pages_crawled = await crawl_site(root, max_pages=max_pages, max_depth=3, seed_urls=seed_urls)

    # robots.txt + llms.txt
    robots_res = await fetch_raw(urljoin(root, "robots.txt"))
    robots_content = robots_res.html if robots_res.status == 200 else None
    llms_res = await fetch_raw(urljoin(root, "llms.txt"))
    llms_content = llms_res.html if llms_res.status == 200 else None

    # Render-mode detection on a sample
    sample_indexes = _sample_indexes(len(pages_crawled), RENDER_SAMPLE_SIZE)
    rendered_modes: list[str] = []
    is_js_rendered_by_url: dict[str, bool] = {}
    for i in sample_indexes:
        if i >= len(pages_crawled):
            continue
        page = pages_crawled[i]
        if not page.html:
            continue
        rendered = await fetch_rendered(page.url)
        mode = classify_render_mode(page.html, rendered.html or "")
        rendered_modes.append(mode)
        is_js_rendered_by_url[page.url] = (mode == "csr")

    site_render_mode = _majority(rendered_modes) if rendered_modes else "unknown"

    # ── analyzing phase ──────────────────────────────────────────────────
    await _set_status(audit_id, "analyzing")

    site_findings: list[Finding] = []
    robots_out = parse_robots(robots_content, root)
    site_findings.extend(robots_out.findings)
    bot_status = robots_out.measurements.get("bot_status", {})

    llms_out = parse_llms_txt(llms_content)
    site_findings.extend(llms_out.findings)

    # Per-page parsing
    page_records: list[dict] = []
    all_findings: list[tuple[Finding, int | None]] = [(f, None) for f in site_findings]  # (finding, page_id placeholder)

    for crawl_page in pages_crawled:
        page_type = classify_page(crawl_page.url, crawl_page.html)
        sem = parse_semantic(crawl_page.html or "", crawl_page.url)
        sch = parse_schema(crawl_page.html or "", crawl_page.url, page_type)
        mta = parse_meta(crawl_page.html or "", crawl_page.url, page_type)

        per_page_findings = sem.findings + sch.findings + mta.findings
        is_js = is_js_rendered_by_url.get(crawl_page.url, False)

        # Severity counts for scoring
        sev_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for f in per_page_findings:
            sev_counts[f.severity] = sev_counts.get(f.severity, 0) + 1

        inputs = PageScoreInputs(
            word_count=sem.measurements["word_count"],
            h2_count=sem.measurements["h2_count"],
            table_count=sem.measurements["table_count"],
            list_count=sem.measurements["list_count"],
            fact_density=sem.measurements["fact_density"],
            outbound_links=sem.measurements["outbound_links"],
            internal_links=sem.measurements["internal_links"],
            image_alt_pct=mta.measurements["image_alt_pct"],
            has_jsonld=sch.measurements["has_jsonld"],
            schema_types_count=len(sch.measurements["schema_types"]),
            is_js_rendered=is_js,
            http_status=crawl_page.status,
            fetch_ms=crawl_page.fetch_ms,
            findings_by_severity=sev_counts,
        )
        scores = score_page(inputs)
        page_records.append({
            "url": crawl_page.url,
            "depth": crawl_page.depth,
            "http_status": crawl_page.status,
            "fetch_ms": crawl_page.fetch_ms,
            "fetch_error": crawl_page.error,
            "page_type": page_type,
            "measurements": {**sem.measurements, **sch.measurements, **mta.measurements,
                             "is_js_rendered": is_js,
                             "raw_html_size": len(crawl_page.html or ""),
                             "rendered_html_size": None},
            "findings": per_page_findings,
            "scores": scores,
        })

    # ── persist ───────────────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        for rec in page_records:
            m = rec["measurements"]
            page_row = WebsiteAuditPage(
                audit_id=audit_id,
                url=normalise_url(rec["url"]),
                depth=rec["depth"],
                http_status=rec["http_status"],
                fetch_ms=rec["fetch_ms"],
                page_type=rec["page_type"],
                word_count=m.get("word_count", 0),
                title=m.get("title"),
                meta_description=m.get("meta_description"),
                h1_text=m.get("h1_text"),
                h2_count=m.get("h2_count", 0),
                h3_count=m.get("h3_count", 0),
                table_count=m.get("table_count", 0),
                list_count=m.get("list_count", 0),
                fact_density=m.get("fact_density", 0.0),
                outbound_links=m.get("outbound_links", 0),
                internal_links=m.get("internal_links", 0),
                image_count=m.get("image_count", 0),
                image_alt_pct=m.get("image_alt_pct", 0.0),
                has_jsonld=m.get("has_jsonld", False),
                schema_types=json.dumps(m.get("schema_types") or []),
                is_js_rendered=m.get("is_js_rendered", False),
                page_score=rec["scores"]["page_score"],
                content_score=rec["scores"]["content_score"],
                structure_score=rec["scores"]["structure_score"],
                schema_score=rec["scores"]["schema_score"],
                raw_html_size=m.get("raw_html_size"),
                fetch_error=rec.get("fetch_error"),
            )
            db.add(page_row)
            await db.flush()
            rec["page_id"] = page_row.id
            for f in rec["findings"]:
                db.add(WebsiteAuditFinding(
                    audit_id=audit_id, page_id=page_row.id,
                    check_id=f.check_id, severity=f.severity, category=f.category,
                    message=f.message, evidence=json.dumps(f.evidence),
                ))

        # Site-level findings
        for f in site_findings:
            db.add(WebsiteAuditFinding(
                audit_id=audit_id, page_id=None,
                check_id=f.check_id, severity=f.severity, category=f.category,
                message=f.message, evidence=json.dumps(f.evidence),
            ))

        await db.commit()

    # ── page↔prompt linking ──────────────────────────────────────────────
    own_domain = registered_domain((await _get_brand_url(brand_id)) or "")
    page_link_inputs = [
        PageLinkInput(id=rec["page_id"], url=rec["url"],
                       title=rec["measurements"].get("title"),
                       page_type=rec["page_type"])
        for rec in page_records
    ]
    prompt_link_inputs = await _build_prompt_link_inputs(brand_id)
    page_link_map = link_pages_to_prompts(page_link_inputs, prompt_link_inputs)

    # ── recommendations ───────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        # Per-page recs from per-page findings
        for rec in page_records:
            recs = build_rule_based_recs(
                findings=rec["findings"],
                page_link_map=page_link_map,
                page_id=rec["page_id"],
            )
            if rec["measurements"].get("is_js_rendered"):
                recs.append(render_rec_for_csr_page(
                    rec["page_id"], page_link_map.get(rec["page_id"], [])
                ))
            for r in recs:
                db.add(WebsiteAuditRecommendation(
                    audit_id=audit_id, page_id=rec["page_id"],
                    priority=r.priority, effort=r.effort, category=r.category,
                    title=r.title, body=r.body,
                    linked_prompt_ids=json.dumps(r.linked_prompt_ids) if r.linked_prompt_ids else None,
                    expected_impact=r.expected_impact,
                    llm_generated=r.llm_generated,
                ))

        # Site-level recs from site-level findings (no page_id)
        site_recs = build_rule_based_recs(site_findings, page_link_map={}, page_id=None)
        for r in site_recs:
            db.add(WebsiteAuditRecommendation(
                audit_id=audit_id, page_id=None,
                priority=r.priority, effort=r.effort, category=r.category,
                title=r.title, body=r.body,
                linked_prompt_ids=None, expected_impact=r.expected_impact,
                llm_generated=False,
            ))

        # Scores
        bot_score = score_bot_access(bot_status)
        page_scores = [rec["scores"]["page_score"] for rec in page_records if rec["scores"]["page_score"] is not None]
        content_avg = sum(rec["scores"]["content_score"] for rec in page_records) / max(len(page_records), 1)
        schema_avg = sum(rec["scores"]["schema_score"] for rec in page_records) / max(len(page_records), 1)
        technical_avg = sum(rec["scores"]["page_score"] for rec in page_records) / max(len(page_records), 1)

        audit = await db.get(WebsiteAudit, audit_id)
        scores = score_audit(
            bot_access=bot_score, content=content_avg, schema=schema_avg, technical=technical_avg,
        )
        audit.overall_score = scores["overall_score"]
        audit.bot_access_score = scores["bot_access_score"]
        audit.content_score = scores["content_score"]
        audit.schema_score = scores["schema_score"]
        audit.technical_score = scores["technical_score"]
        audit.total_pages = len(page_records)
        audit.pages_failed = sum(1 for r in page_records if r.get("fetch_error"))
        audit.render_mode = site_render_mode
        audit.sitemap_url = sitemap_src
        audit.robots_txt_raw = (robots_content or "")[:8192] if robots_content else None
        audit.llms_txt_present = llms_out.measurements["present"]
        audit.llms_txt_valid = llms_out.measurements["valid"]
        audit.status = "completed"
        audit.completed_at = utcnow()
        await db.commit()


async def _set_status(audit_id: int, status: str) -> None:
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit:
            audit.status = status
            await db.commit()


async def _get_brand_url(brand_id: int) -> str | None:
    async with AsyncSessionLocal() as db:
        b = await db.get(Brand, brand_id)
        return b.website_url if b else None


async def _build_prompt_link_inputs(brand_id: int) -> list[PromptLinkInput]:
    async with AsyncSessionLocal() as db:
        prompts = (await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )).scalars().all()
        out: list[PromptLinkInput] = []
        for p in prompts:
            cites = (await db.execute(
                select(CitationSource.url).where(
                    CitationSource.brand_id == brand_id,
                    CitationSource.prompt_id == p.id,
                    CitationSource.kind.in_(["competitor", "third_party"]),
                )
            )).all()
            out.append(PromptLinkInput(id=p.id, text=p.text, cited_urls=[r[0] for r in cites]))
        return out


def _majority(values: list[str]) -> str:
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _sample_indexes(total: int, k: int) -> list[int]:
    if total <= k:
        return list(range(total))
    return [0, total // 4, total // 2, (3 * total) // 4, total - 1][:k]
```

- [ ] **Step 4: Run — expect pass**

```bash
pytest backend/tests/test_site_audit_auditor.py -v
```

Expected: 2 passed (the auditor test may take 30–60s due to Playwright).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/site_audit/auditor.py backend/tests/test_site_audit_auditor.py
git commit -m "feat(site-audit): end-to-end orchestrator (crawl → parse → score → link → recommend)"
```

---

### Task 22: Pydantic schemas for API

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Append schemas**

Append to `backend/app/schemas.py`:

```python
# ── Website AIO ──────────────────────────────────────────────────────────────

class WebsiteAuditSummary(BaseModel):
    id: int
    brand_id: int
    status: str
    started_at: datetime
    completed_at: datetime | None
    total_pages: int
    pages_failed: int
    overall_score: float | None
    bot_access_score: float | None
    content_score: float | None
    schema_score: float | None
    technical_score: float | None
    render_mode: str | None
    llms_txt_present: bool
    llms_txt_valid: bool
    robots_txt_raw: str | None
    error_message: str | None


class WebsiteAuditPageOut(BaseModel):
    id: int
    audit_id: int
    url: str
    page_type: str
    http_status: int | None
    title: str | None
    h1_text: str | None
    word_count: int
    fact_density: float
    is_js_rendered: bool
    page_score: float | None
    content_score: float | None
    structure_score: float | None
    schema_score: float | None
    schema_types: list[str] = []


class WebsiteAuditFindingOut(BaseModel):
    id: int
    audit_id: int
    page_id: int | None
    check_id: str
    severity: str
    category: str
    message: str
    evidence: dict | None


class WebsiteAuditRecommendationOut(BaseModel):
    id: int
    audit_id: int
    page_id: int | None
    priority: str
    effort: str
    category: str
    title: str
    body: str
    linked_prompt_ids: list[int] = []
    expected_impact: str | None
    llm_generated: bool


class CitationSourceOut(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None
    model: str
    url: str
    domain: str
    kind: str
    competitor_id: int | None
    extracted_at: datetime


class CitationDomainAgg(BaseModel):
    domain: str
    kind: str
    count: int


class TriggerAuditOut(BaseModel):
    audit_id: int
    status: str
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(site-audit): Pydantic response schemas"
```

---

### Task 23: Router with 13 endpoints

**Files:**
- Create: `backend/app/routers/site_audit.py`
- Modify: `backend/app/main.py` (register router)
- Create: `backend/tests/test_site_audit_endpoints.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_site_audit_endpoints.py`:

```python
import pytest
from unittest.mock import patch, AsyncMock

from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_trigger_audit_requires_tier(client):
    await register_and_login(client, subscription_tier=None)  # Free
    brand = await create_brand(client)
    r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_trigger_audit_basic_tier(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    with patch("app.routers.site_audit.run_audit", new=AsyncMock(return_value=42)):
        r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
    assert r.status_code == 202
    assert r.json()["audit_id"] == 42


@pytest.mark.asyncio
async def test_latest_audit_returns_404_when_none(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/latest")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_ownership_enforced(client):
    await register_and_login(client, email="owner@x.com", subscription_tier="basic")
    brand = await create_brand(client)
    # Different user tries to read
    await register_and_login(client, email="intruder@x.com", subscription_tier="basic")
    r = await client.get(f"/api/site-audit/{brand['id']}/latest")
    assert r.status_code in (403, 404)


@pytest.mark.asyncio
async def test_llms_txt_endpoint(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/llms-txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "# Test Brand" in r.text or "# " in r.text


@pytest.mark.asyncio
async def test_robots_snippet_endpoint(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    r = await client.get(f"/api/site-audit/{brand['id']}/robots-snippet?mode=allow_all")
    assert r.status_code == 200
    assert "GPTBot" in r.text
```

- [ ] **Step 2: Implement router**

Create `backend/app/routers/site_audit.py`:

```python
"""Website AIO API router."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import desc, func, select

from app.auth import get_current_user
from app.database import AsyncSessionLocal
from app.models import (
    AgencyClient, AgencyStaff, Brand, CitationSource, Prompt, User,
    WebsiteAudit, WebsiteAuditFinding, WebsiteAuditPage,
    WebsiteAuditRecommendation, utcnow,
)
from app.schemas import (
    CitationDomainAgg, CitationSourceOut, TriggerAuditOut,
    WebsiteAuditFindingOut, WebsiteAuditPageOut,
    WebsiteAuditRecommendationOut, WebsiteAuditSummary,
)
from app.services.site_audit.auditor import run_audit
from app.services.site_audit.constants import TIER_AUDIT_LIMITS
from app.services.site_audit.generators import (
    BrandSummary, KeyPage, build_llms_txt, build_robots_snippet,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/site-audit", tags=["site-audit"])


async def _ensure_brand_access(brand_id: int, user: User) -> Brand:
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if brand is None:
            raise HTTPException(404, "brand not found")
        if brand.user_id == user.id:
            return brand
        # Agency staff: brand must belong to one of their clients
        if user.is_agency_staff:
            staff = (await db.execute(
                select(AgencyStaff).where(AgencyStaff.user_id == user.id)
            )).scalar_one_or_none()
            if staff:
                client = (await db.execute(
                    select(AgencyClient).where(
                        AgencyClient.brand_id == brand_id,
                    )
                )).scalar_one_or_none()
                if client:
                    return brand
        raise HTTPException(403, "forbidden")


def _tier_or_403(brand: Brand, user: User) -> dict:
    """Gate audits to paid tiers. Pitch brands and Free users are blocked.

    Note on agency staff: when triggering on behalf of a client, the staff user
    may not have a personal subscription. We fall back to 'basic' limits since
    agency clients are assumed paid (validated at AgencyClient creation).
    """
    if getattr(brand, "brand_type", None) == "pitch":
        raise HTTPException(403, "site audits not available for pitch brands")
    sub_tier: str | None = user.subscription_tier
    if not sub_tier and user.is_agency_staff:
        sub_tier = "basic"
    if not sub_tier:
        raise HTTPException(403, "site audits require a paid plan (Starter or above)")
    limits = TIER_AUDIT_LIMITS.get(sub_tier)
    if not limits:
        raise HTTPException(403, "site audits require a paid plan (Starter or above)")
    return limits


@router.post("/{brand_id}/trigger", response_model=TriggerAuditOut, status_code=202)
async def trigger_audit(brand_id: int, background: BackgroundTasks,
                        user: User = Depends(get_current_user)):
    brand = await _ensure_brand_access(brand_id, user)
    if not brand.website_url:
        raise HTTPException(400, "brand has no website_url")
    limits = _tier_or_403(brand, user)

    async with AsyncSessionLocal() as db:
        # In-progress check
        running = (await db.execute(
            select(WebsiteAudit).where(
                WebsiteAudit.brand_id == brand_id,
                WebsiteAudit.status.in_(["pending", "crawling", "analyzing"]),
            )
        )).scalar_one_or_none()
        if running:
            raise HTTPException(409, "an audit is already in progress")

        # Monthly cap
        cutoff = utcnow() - timedelta(days=30)
        recent_count = (await db.execute(
            select(func.count()).select_from(WebsiteAudit).where(
                WebsiteAudit.brand_id == brand_id,
                WebsiteAudit.started_at >= cutoff,
            )
        )).scalar_one()
        if recent_count >= limits["monthly_audits"]:
            raise HTTPException(403, f"monthly audit cap reached ({limits['monthly_audits']})")

    # Spawn audit task; capture audit_id by waiting for the row to be created
    audit_id = await _create_pending_audit(brand_id)
    background.add_task(_run_audit_safe, brand_id=brand_id, max_pages=limits["max_pages"], audit_id=audit_id)
    return TriggerAuditOut(audit_id=audit_id, status="pending")


async def _create_pending_audit(brand_id: int) -> int:
    async with AsyncSessionLocal() as db:
        audit = WebsiteAudit(brand_id=brand_id, status="pending",
                             triggered_by="user", started_at=utcnow())
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        return audit.id


async def _run_audit_safe(*, brand_id: int, max_pages: int, audit_id: int) -> None:
    """Wrapper so background-task exceptions don't bubble; auditor handles its own errors too."""
    try:
        # The auditor creates its own WebsiteAudit row in current design; we reused the pending
        # row above. Trigger the inner function directly to avoid double-row.
        from app.services.site_audit.auditor import _run_audit_inner, _mark_failed
        await _run_audit_inner(audit_id, brand_id, max_pages)
    except Exception as exc:  # noqa: BLE001
        logger.exception("background audit failed")
        from app.services.site_audit.auditor import _mark_failed
        await _mark_failed(audit_id, f"unexpected error: {exc}")


@router.get("/{brand_id}/latest", response_model=WebsiteAuditSummary)
async def latest_audit(brand_id: int, user: User = Depends(get_current_user)):
    await _ensure_brand_access(brand_id, user)
    async with AsyncSessionLocal() as db:
        audit = (await db.execute(
            select(WebsiteAudit).where(WebsiteAudit.brand_id == brand_id)
            .order_by(desc(WebsiteAudit.started_at)).limit(1)
        )).scalar_one_or_none()
        if not audit:
            raise HTTPException(404, "no audit yet")
        return WebsiteAuditSummary.model_validate(audit, from_attributes=True)


@router.get("/{brand_id}/history", response_model=list[WebsiteAuditSummary])
async def audit_history(brand_id: int, limit: int = Query(10, le=50),
                        user: User = Depends(get_current_user)):
    await _ensure_brand_access(brand_id, user)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(WebsiteAudit).where(WebsiteAudit.brand_id == brand_id)
            .order_by(desc(WebsiteAudit.started_at)).limit(limit)
        )).scalars().all()
        return [WebsiteAuditSummary.model_validate(a, from_attributes=True) for a in rows]


@router.get("/audit/{audit_id}", response_model=WebsiteAuditSummary)
async def audit_detail(audit_id: int, user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)
    return WebsiteAuditSummary.model_validate(audit, from_attributes=True)


@router.get("/audit/{audit_id}/pages", response_model=list[WebsiteAuditPageOut])
async def audit_pages(audit_id: int, page: int = 1, per_page: int = 50, sort: str = "score",
                      user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit_id)
        if sort == "score":
            q = q.order_by(WebsiteAuditPage.page_score.asc().nulls_last())
        else:
            q = q.order_by(WebsiteAuditPage.url)
        offset = (page - 1) * per_page
        rows = (await db.execute(q.offset(offset).limit(per_page))).scalars().all()
        out: list[WebsiteAuditPageOut] = []
        for r in rows:
            d = WebsiteAuditPageOut.model_validate(r, from_attributes=True)
            try:
                d.schema_types = json.loads(r.schema_types) if r.schema_types else []
            except json.JSONDecodeError:
                d.schema_types = []
            out.append(d)
        return out


@router.get("/audit/{audit_id}/page/{page_id}", response_model=dict)
async def page_detail(audit_id: int, page_id: int, user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        page = await db.get(WebsiteAuditPage, page_id)
        if not page or page.audit_id != audit_id:
            raise HTTPException(404)
        findings = (await db.execute(
            select(WebsiteAuditFinding).where(
                WebsiteAuditFinding.audit_id == audit_id,
                WebsiteAuditFinding.page_id == page_id,
            )
        )).scalars().all()
        recs = (await db.execute(
            select(WebsiteAuditRecommendation).where(
                WebsiteAuditRecommendation.audit_id == audit_id,
                WebsiteAuditRecommendation.page_id == page_id,
            )
        )).scalars().all()
        return {
            "page": WebsiteAuditPageOut.model_validate(page, from_attributes=True).model_dump(),
            "findings": [_finding_out(f).model_dump() for f in findings],
            "recommendations": [_rec_out(r).model_dump() for r in recs],
        }


def _finding_out(f: WebsiteAuditFinding) -> WebsiteAuditFindingOut:
    try:
        ev = json.loads(f.evidence) if f.evidence else {}
    except json.JSONDecodeError:
        ev = {}
    return WebsiteAuditFindingOut(
        id=f.id, audit_id=f.audit_id, page_id=f.page_id, check_id=f.check_id,
        severity=f.severity, category=f.category, message=f.message, evidence=ev,
    )


def _rec_out(r: WebsiteAuditRecommendation) -> WebsiteAuditRecommendationOut:
    try:
        ids = json.loads(r.linked_prompt_ids) if r.linked_prompt_ids else []
    except json.JSONDecodeError:
        ids = []
    return WebsiteAuditRecommendationOut(
        id=r.id, audit_id=r.audit_id, page_id=r.page_id,
        priority=r.priority, effort=r.effort, category=r.category,
        title=r.title, body=r.body, linked_prompt_ids=ids,
        expected_impact=r.expected_impact, llm_generated=r.llm_generated,
    )


@router.get("/audit/{audit_id}/findings", response_model=list[WebsiteAuditFindingOut])
async def audit_findings(audit_id: int, severity: str | None = None,
                         user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditFinding).where(WebsiteAuditFinding.audit_id == audit_id)
        if severity:
            q = q.where(WebsiteAuditFinding.severity == severity)
        rows = (await db.execute(q)).scalars().all()
        return [_finding_out(f) for f in rows]


@router.get("/audit/{audit_id}/recommendations", response_model=list[WebsiteAuditRecommendationOut])
async def audit_recommendations(audit_id: int, priority: str | None = None,
                                user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)

    async with AsyncSessionLocal() as db:
        q = select(WebsiteAuditRecommendation).where(WebsiteAuditRecommendation.audit_id == audit_id)
        if priority:
            q = q.where(WebsiteAuditRecommendation.priority == priority)
        rows = (await db.execute(q)).scalars().all()
        return [_rec_out(r) for r in rows]


@router.get("/{brand_id}/citations", response_model=dict)
async def citations_overview(brand_id: int, days: int = 30,
                             user: User = Depends(get_current_user)):
    await _ensure_brand_access(brand_id, user)
    cutoff = utcnow() - timedelta(days=days)

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(CitationSource.domain, CitationSource.kind, func.count())
            .where(CitationSource.brand_id == brand_id, CitationSource.extracted_at >= cutoff)
            .group_by(CitationSource.domain, CitationSource.kind)
            .order_by(desc(func.count()))
            .limit(50)
        )).all()
        by_domain = [
            CitationDomainAgg(domain=d, kind=k, count=c).model_dump()
            for d, k, c in rows
        ]
        # Own vs competitor pct
        total = sum(r["count"] for r in by_domain)
        own = sum(r["count"] for r in by_domain if r["kind"] == "own")
        comp = sum(r["count"] for r in by_domain if r["kind"] == "competitor")
        own_pct = (own / total * 100) if total else 0
        comp_pct = (comp / total * 100) if total else 0
        top_competitors = [r for r in by_domain if r["kind"] == "competitor"][:10]
        return {
            "by_domain": by_domain,
            "own_pct": round(own_pct, 1),
            "competitor_pct": round(comp_pct, 1),
            "top_competitor_domains": top_competitors,
        }


@router.get("/{brand_id}/llms-txt", response_class=Response)
async def llms_txt(brand_id: int, user: User = Depends(get_current_user)):
    brand = await _ensure_brand_access(brand_id, user)

    async with AsyncSessionLocal() as db:
        from app.models import BrandProfile
        profile = (await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )).scalar_one_or_none()
        # Pull top-scoring pages from latest completed audit
        latest = (await db.execute(
            select(WebsiteAudit).where(
                WebsiteAudit.brand_id == brand_id,
                WebsiteAudit.status == "completed",
            ).order_by(desc(WebsiteAudit.started_at)).limit(1)
        )).scalar_one_or_none()
        pages: list[KeyPage] = []
        if latest:
            page_rows = (await db.execute(
                select(WebsiteAuditPage).where(
                    WebsiteAuditPage.audit_id == latest.id,
                    WebsiteAuditPage.http_status == 200,
                ).order_by(desc(WebsiteAuditPage.page_score)).limit(10)
            )).scalars().all()
            for p in page_rows:
                pages.append(KeyPage(
                    url=p.url, title=p.title or p.url, page_type=p.page_type,
                    score=p.page_score or 0.0,
                ))

    summary = BrandSummary(
        name=brand.name,
        website_url=brand.website_url or "https://example.com",
        description=(profile.company_description if profile else None),
    )
    txt = build_llms_txt(summary, pages)
    return Response(content=txt, media_type="text/plain")


@router.get("/{brand_id}/robots-snippet", response_class=Response)
async def robots_snippet(brand_id: int, mode: str = Query("allow_all"),
                         user: User = Depends(get_current_user)):
    await _ensure_brand_access(brand_id, user)
    if mode not in ("allow_all", "search_only"):
        raise HTTPException(400, "mode must be 'allow_all' or 'search_only'")
    return Response(content=build_robots_snippet(mode), media_type="text/plain")


@router.post("/audit/{audit_id}/cancel", status_code=204)
async def cancel_audit(audit_id: int, user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if not audit:
            raise HTTPException(404)
    await _ensure_brand_access(audit.brand_id, user)
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit.status in ("completed", "failed", "cancelled"):
            return Response(status_code=204)
        audit.status = "cancelled"
        audit.completed_at = utcnow()
        await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 3: Register router**

Open `backend/app/main.py`, find the router-mounting block, and add:

```python
from app.routers import site_audit
app.include_router(site_audit.router)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest backend/tests/test_site_audit_endpoints.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/site_audit.py backend/app/main.py backend/tests/test_site_audit_endpoints.py
git commit -m "feat(site-audit): API router with 13 endpoints + ownership/tier checks"
```

---

## Phase 8 — Frontend

> The frontend codebase is Next.js 15 App Router. Verify the actual nav component path before starting Task 24 — look for `frontend/components/Sidebar.tsx`, `frontend/components/Navigation.tsx`, or wherever the existing nav lives. Wire to that file. The tests for frontend are not part of this codebase (no FE tests exist) — verify manually in browser per existing project convention (CLAUDE.md: "test the golden path and edge cases").

### Task 24: API client methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Append types**

Add to `frontend/lib/api.ts` (at the appropriate location — after existing type definitions):

```typescript
export type WebsiteAuditSummary = {
  id: number
  brand_id: number
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at: string | null
  total_pages: number
  pages_failed: number
  overall_score: number | null
  bot_access_score: number | null
  content_score: number | null
  schema_score: number | null
  technical_score: number | null
  render_mode: string | null
  llms_txt_present: boolean
  llms_txt_valid: boolean
  robots_txt_raw: string | null
  error_message: string | null
}

export type WebsiteAuditPageOut = {
  id: number
  audit_id: number
  url: string
  page_type: string
  http_status: number | null
  title: string | null
  h1_text: string | null
  word_count: number
  fact_density: number
  is_js_rendered: boolean
  page_score: number | null
  content_score: number | null
  structure_score: number | null
  schema_score: number | null
  schema_types: string[]
}

export type WebsiteAuditFindingOut = {
  id: number
  audit_id: number
  page_id: number | null
  check_id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: 'bot_access' | 'content' | 'schema' | 'technical' | 'authority'
  message: string
  evidence: Record<string, unknown> | null
}

export type WebsiteAuditRecommendationOut = {
  id: number
  audit_id: number
  page_id: number | null
  priority: 'high' | 'medium' | 'low'
  effort: 'low' | 'medium' | 'high'
  category: string
  title: string
  body: string
  linked_prompt_ids: number[]
  expected_impact: string | null
  llm_generated: boolean
}

export type CitationDomainAgg = { domain: string; kind: string; count: number }
export type CitationsOverview = {
  by_domain: CitationDomainAgg[]
  own_pct: number
  competitor_pct: number
  top_competitor_domains: CitationDomainAgg[]
}
```

- [ ] **Step 2: Append `siteAudit` methods**

Add inside the existing axios client wrapper:

```typescript
export const siteAudit = {
  trigger: (brandId: number) =>
    api.post<{ audit_id: number; status: string }>(`/api/site-audit/${brandId}/trigger`).then(r => r.data),
  latest: (brandId: number) =>
    api.get<WebsiteAuditSummary>(`/api/site-audit/${brandId}/latest`).then(r => r.data),
  history: (brandId: number, limit = 10) =>
    api.get<WebsiteAuditSummary[]>(`/api/site-audit/${brandId}/history`, { params: { limit } }).then(r => r.data),
  audit: (auditId: number) =>
    api.get<WebsiteAuditSummary>(`/api/site-audit/audit/${auditId}`).then(r => r.data),
  pages: (auditId: number, opts?: { page?: number; per_page?: number; sort?: string }) =>
    api.get<WebsiteAuditPageOut[]>(`/api/site-audit/audit/${auditId}/pages`, { params: opts }).then(r => r.data),
  pageDetail: (auditId: number, pageId: number) =>
    api.get<{ page: WebsiteAuditPageOut; findings: WebsiteAuditFindingOut[]; recommendations: WebsiteAuditRecommendationOut[] }>(
      `/api/site-audit/audit/${auditId}/page/${pageId}`,
    ).then(r => r.data),
  findings: (auditId: number, severity?: string) =>
    api.get<WebsiteAuditFindingOut[]>(`/api/site-audit/audit/${auditId}/findings`, { params: { severity } }).then(r => r.data),
  recommendations: (auditId: number, priority?: string) =>
    api.get<WebsiteAuditRecommendationOut[]>(`/api/site-audit/audit/${auditId}/recommendations`, { params: { priority } }).then(r => r.data),
  citations: (brandId: number, days = 30) =>
    api.get<CitationsOverview>(`/api/site-audit/${brandId}/citations`, { params: { days } }).then(r => r.data),
  llmsTxt: (brandId: number) =>
    api.get<string>(`/api/site-audit/${brandId}/llms-txt`, { responseType: 'text' }).then(r => r.data),
  robotsSnippet: (brandId: number, mode: 'allow_all' | 'search_only' = 'allow_all') =>
    api.get<string>(`/api/site-audit/${brandId}/robots-snippet`, {
      params: { mode }, responseType: 'text',
    }).then(r => r.data),
  cancel: (auditId: number) =>
    api.post(`/api/site-audit/audit/${auditId}/cancel`),
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend
npm run lint
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(site-audit): frontend API client methods + types"
```

---

### Task 25: Navigation — add Site Audit nav item

**Files:**
- Modify: the nav component (verify path first)

- [ ] **Step 1: Find the nav component**

```bash
grep -l "Dashboard" frontend/components/*.tsx frontend/components/**/*.tsx 2>/dev/null | head -5
```

- [ ] **Step 2: Add Site Audit nav item**

Open the nav file. Add an entry between **Content** and **Reports**:

```tsx
{ name: 'Site Audit', href: '/site-audit', icon: ShieldCheck }, // or whatever icon import the file uses
```

Ensure the item is hidden on Free tier — use the existing tier gating helper. Find an existing pattern in the file (e.g., `if (!user?.subscription_tier) return false`) and apply it. If no such helper exists, gate inline with the user's `subscription_tier` field from `AuthContext`.

- [ ] **Step 3: Verify visually**

Start the dev servers (per memory: backend 3001, frontend 3002):

```bash
# Terminal A
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
# Terminal B
cd frontend && npm run dev -- -p 3002
```

Open `http://localhost:3002`, log in as a paid-tier user, confirm "Site Audit" appears in nav.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/<the-nav-file>.tsx
git commit -m "feat(site-audit): Site Audit nav item"
```

---

### Task 26: Main `/site-audit/[brandId]` page — empty state + trigger

**Files:**
- Create: `frontend/app/site-audit/[brandId]/page.tsx`
- Create: `frontend/components/site-audit/AuditTriggerButton.tsx`

- [ ] **Step 1: Create the page (Overview tab placeholder for now)**

`frontend/app/site-audit/[brandId]/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

import { siteAudit, brands, type WebsiteAuditSummary } from '@/lib/api'
import { AuditTriggerButton } from '@/components/site-audit/AuditTriggerButton'

export default function SiteAuditPage() {
  const params = useParams<{ brandId: string }>()
  const brandId = Number(params.brandId)
  const [audit, setAudit] = useState<WebsiteAuditSummary | null | undefined>(undefined)
  const [tab, setTab] = useState<'overview' | 'pages' | 'bots' | 'citations' | 'recs'>('overview')

  async function loadLatest() {
    try {
      const a = await siteAudit.latest(brandId)
      setAudit(a)
    } catch (e: any) {
      if (e?.response?.status === 404) setAudit(null)
      else throw e
    }
  }

  useEffect(() => { loadLatest() }, [brandId])

  // Poll while audit is in flight
  useEffect(() => {
    if (!audit || ['completed', 'failed', 'cancelled'].includes(audit.status)) return
    const t = setInterval(loadLatest, 4000)
    return () => clearInterval(t)
  }, [audit?.status])

  if (audit === undefined) return <div className="p-8">Loading…</div>

  if (audit === null) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Site Audit</h1>
        <p className="text-muted-foreground mb-6">
          Audit your site for AI-search visibility — semantic structure, schema, AI-bot accessibility,
          and which competitor pages are winning the prompts you lose on.
        </p>
        <AuditTriggerButton brandId={brandId} onTriggered={loadLatest} />
      </div>
    )
  }

  return (
    <div className="p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Site Audit</h1>
          <p className="text-sm text-muted-foreground">
            Latest audit: {new Date(audit.started_at).toLocaleString()} · status: {audit.status}
            {audit.overall_score !== null && ` · overall score ${audit.overall_score.toFixed(0)}`}
          </p>
        </div>
        <AuditTriggerButton brandId={brandId} onTriggered={loadLatest} disabled={audit.status !== 'completed' && audit.status !== 'failed' && audit.status !== 'cancelled'} />
      </header>

      <nav className="flex gap-4 border-b mb-6">
        {(['overview', 'pages', 'bots', 'citations', 'recs'] as const).map(t => (
          <button key={t}
            className={`pb-2 ${tab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' :
             t === 'pages'   ? 'Pages' :
             t === 'bots'    ? 'AI Bots & Files' :
             t === 'citations' ? 'Citations' : 'Recommendations'}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTabPlaceholder audit={audit} />}
      {tab === 'pages' && <div>Pages tab (Task 27)</div>}
      {tab === 'bots' && <div>Bots tab (Task 28)</div>}
      {tab === 'citations' && <div>Citations tab (Task 29)</div>}
      {tab === 'recs' && <div>Recommendations tab (Task 30)</div>}
    </div>
  )
}

function OverviewTabPlaceholder({ audit }: { audit: WebsiteAuditSummary }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {[
        { label: 'Bot access', v: audit.bot_access_score },
        { label: 'Content',    v: audit.content_score },
        { label: 'Schema',     v: audit.schema_score },
        { label: 'Technical',  v: audit.technical_score },
      ].map(({ label, v }) => (
        <div key={label} className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase">{label}</div>
          <div className="text-3xl font-semibold mt-2">
            {v !== null ? v.toFixed(0) : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create the trigger button**

`frontend/components/site-audit/AuditTriggerButton.tsx`:

```tsx
'use client'

import { useState } from 'react'

import { siteAudit } from '@/lib/api'

export function AuditTriggerButton({
  brandId, onTriggered, disabled = false,
}: { brandId: number; onTriggered: () => void; disabled?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      await siteAudit.trigger(brandId)
      onTriggered()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to trigger audit')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={run}
        disabled={loading || disabled}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">
        {loading ? 'Starting…' : 'Run audit'}
      </button>
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Verify visually**

Run dev servers; navigate to `/site-audit/<brandId>` for a brand you own; click "Run audit"; confirm the page transitions through crawling → analyzing → completed and the four sub-score cards populate.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/site-audit/[brandId]/page.tsx frontend/components/site-audit/AuditTriggerButton.tsx
git commit -m "feat(site-audit): main page shell, trigger button, overview placeholder"
```

---

### Task 27: Pages tab — sortable list + drilldown

**Files:**
- Create: `frontend/components/site-audit/PageList.tsx`
- Create: `frontend/components/site-audit/PageDetail.tsx`
- Modify: `frontend/app/site-audit/[brandId]/page.tsx` (wire Pages tab)

- [ ] **Step 1: PageList component**

`frontend/components/site-audit/PageList.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditPageOut } from '@/lib/api'

export function PageList({ auditId, onSelect }:
  { auditId: number; onSelect: (pageId: number) => void }) {
  const [rows, setRows] = useState<WebsiteAuditPageOut[] | null>(null)
  const [sort, setSort] = useState<'score' | 'url'>('score')

  useEffect(() => {
    siteAudit.pages(auditId, { sort, per_page: 100 }).then(setRows)
  }, [auditId, sort])

  if (!rows) return <div>Loading…</div>
  if (!rows.length) return <div className="text-muted-foreground">No pages crawled.</div>

  return (
    <table className="w-full text-sm">
      <thead className="border-b text-muted-foreground">
        <tr>
          <th className="text-left py-2 cursor-pointer" onClick={() => setSort('url')}>URL</th>
          <th className="text-left">Type</th>
          <th className="text-right">Words</th>
          <th className="text-right">JS?</th>
          <th className="text-right cursor-pointer" onClick={() => setSort('score')}>Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => (
          <tr key={p.id} className="border-b hover:bg-muted/50 cursor-pointer"
              onClick={() => onSelect(p.id)}>
            <td className="py-2 truncate max-w-[28rem]">{p.url}</td>
            <td>{p.page_type}</td>
            <td className="text-right">{p.word_count}</td>
            <td className="text-right">{p.is_js_rendered ? 'CSR' : 'SSR'}</td>
            <td className="text-right font-mono">{p.page_score?.toFixed(0) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: PageDetail component**

`frontend/components/site-audit/PageDetail.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

import { siteAudit } from '@/lib/api'

export function PageDetail({ auditId, pageId, onBack }:
  { auditId: number; pageId: number; onBack: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof siteAudit.pageDetail>> | null>(null)

  useEffect(() => {
    siteAudit.pageDetail(auditId, pageId).then(setData)
  }, [auditId, pageId])

  if (!data) return <div>Loading…</div>

  return (
    <div>
      <button onClick={onBack} className="text-sm text-muted-foreground mb-4">← Back to pages</button>
      <h2 className="text-xl font-semibold mb-1 truncate">{data.page.title || data.page.url}</h2>
      <div className="text-sm text-muted-foreground mb-6">{data.page.url}</div>

      <section className="mb-6">
        <h3 className="font-medium mb-2">Findings ({data.findings.length})</h3>
        <ul className="space-y-2">
          {data.findings.map(f => (
            <li key={f.id} className="text-sm">
              <span className={`inline-block px-2 py-0.5 rounded mr-2 text-xs ${
                f.severity === 'critical' ? 'bg-red-600 text-white' :
                f.severity === 'high'     ? 'bg-orange-500 text-white' :
                f.severity === 'medium'   ? 'bg-yellow-400'  :
                                            'bg-muted'
              }`}>{f.severity}</span>
              {f.message}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-medium mb-2">Recommendations ({data.recommendations.length})</h3>
        <ul className="space-y-3">
          {data.recommendations.map(r => (
            <li key={r.id} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <strong>{r.title}</strong>
                <span className="text-xs text-muted-foreground">
                  {r.priority} priority · {r.effort} effort
                </span>
              </div>
              <div className="text-sm mt-2 whitespace-pre-line">{r.body}</div>
              {r.linked_prompt_ids.length > 0 && (
                <div className="text-xs mt-2 text-muted-foreground">
                  Fixes prompts: {r.linked_prompt_ids.join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Wire Pages tab**

Modify the main page from Task 26: replace `{tab === 'pages' && <div>Pages tab (Task 27)</div>}` with:

```tsx
{tab === 'pages' && (
  selectedPageId === null
    ? <PageList auditId={audit.id} onSelect={setSelectedPageId} />
    : <PageDetail auditId={audit.id} pageId={selectedPageId} onBack={() => setSelectedPageId(null)} />
)}
```

Add `const [selectedPageId, setSelectedPageId] = useState<number | null>(null)` near the top of the component. Add imports for `PageList`, `PageDetail`.

- [ ] **Step 4: Verify in browser**

Click into Pages tab → see list → click a row → see detail → click back. Findings render with colored severity badges.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/site-audit/ frontend/app/site-audit/
git commit -m "feat(site-audit): Pages tab with list + per-page findings/recs detail"
```

---

### Task 28: AI Bots & Files tab — robots/llms + generators

**Files:**
- Create: `frontend/components/site-audit/BotAccessPanel.tsx`
- Create: `frontend/components/site-audit/LlmsTxtPanel.tsx`
- Create: `frontend/components/site-audit/GeneratorsCard.tsx`
- Modify: `frontend/app/site-audit/[brandId]/page.tsx` (wire Bots tab)

- [ ] **Step 1: BotAccessPanel**

`frontend/components/site-audit/BotAccessPanel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditFindingOut } from '@/lib/api'

const BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai',
  'PerplexityBot', 'Google-Extended', 'Meta-ExternalAgent',
  'Applebot-Extended', 'Amazonbot',
]

export function BotAccessPanel({ auditId, robotsTxtRaw }:
  { auditId: number; robotsTxtRaw: string | null }) {
  const [findings, setFindings] = useState<WebsiteAuditFindingOut[]>([])
  useEffect(() => {
    siteAudit.findings(auditId).then(fs =>
      setFindings(fs.filter(f => f.category === 'bot_access')))
  }, [auditId])

  const status = (bot: string): { kind: string; level: 'ok' | 'warn' | 'bad' } => {
    const f = findings.find(f => f.check_id === `blocked_${bot.toLowerCase().replace('-', '_')}`)
    if (f) return { kind: 'disallowed_all', level: 'bad' }
    return { kind: 'allowed', level: 'ok' }
  }

  return (
    <div className="grid gap-6">
      <section>
        <h3 className="font-medium mb-3">AI bot access</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {BOTS.map(bot => {
            const s = status(bot)
            return (
              <div key={bot} className="flex items-center justify-between border rounded px-3 py-2">
                <code>{bot}</code>
                <span className={
                  s.level === 'ok'   ? 'text-green-600' :
                  s.level === 'warn' ? 'text-yellow-600' : 'text-red-600'
                }>
                  {s.level === 'ok' ? 'allowed' : s.kind}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {robotsTxtRaw && (
        <section>
          <h3 className="font-medium mb-2">robots.txt</h3>
          <pre className="bg-muted p-3 rounded text-xs max-h-64 overflow-auto">{robotsTxtRaw}</pre>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: LlmsTxtPanel**

```tsx
'use client'

import { siteAudit } from '@/lib/api'

export function LlmsTxtPanel({ brandId, present, valid }:
  { brandId: number; present: boolean; valid: boolean }) {
  async function downloadLlmsTxt() {
    const txt = await siteAudit.llmsTxt(brandId)
    const blob = new Blob([txt], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'llms.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section>
      <h3 className="font-medium mb-2">llms.txt</h3>
      <div className="text-sm mb-3">
        Status: {!present ? <span className="text-yellow-600">not present</span>
              : valid ? <span className="text-green-600">present and valid</span>
              : <span className="text-red-600">present but malformed</span>}
      </div>
      <button onClick={downloadLlmsTxt}
              className="px-3 py-2 rounded border text-sm">
        Generate &amp; download llms.txt
      </button>
    </section>
  )
}
```

- [ ] **Step 3: GeneratorsCard**

```tsx
'use client'

import { useState } from 'react'

import { siteAudit } from '@/lib/api'

export function GeneratorsCard({ brandId }: { brandId: number }) {
  const [snippet, setSnippet] = useState<string | null>(null)
  const [mode, setMode] = useState<'allow_all' | 'search_only'>('allow_all')

  async function load() {
    setSnippet(await siteAudit.robotsSnippet(brandId, mode))
  }

  return (
    <section>
      <h3 className="font-medium mb-2">robots.txt snippet</h3>
      <div className="flex items-center gap-3 mb-3 text-sm">
        <label>
          <input type="radio" checked={mode === 'allow_all'} onChange={() => setMode('allow_all')} />
          {' '}Allow all AI bots
        </label>
        <label>
          <input type="radio" checked={mode === 'search_only'} onChange={() => setMode('search_only')} />
          {' '}Allow live search, block training
        </label>
        <button onClick={load} className="ml-auto px-2 py-1 border rounded text-xs">Generate</button>
      </div>
      {snippet && (
        <pre className="bg-muted p-3 rounded text-xs max-h-64 overflow-auto">{snippet}</pre>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Wire into Bots tab**

In `frontend/app/site-audit/[brandId]/page.tsx`, replace the bots placeholder:

```tsx
{tab === 'bots' && (
  <div className="space-y-8 max-w-3xl">
    <BotAccessPanel auditId={audit.id} robotsTxtRaw={audit.robots_txt_raw} />
    <LlmsTxtPanel brandId={brandId} present={audit.llms_txt_present} valid={audit.llms_txt_valid} />
    <GeneratorsCard brandId={brandId} />
  </div>
)}
```

- [ ] **Step 5: Verify visually**

Browser: navigate to AI Bots & Files tab → see 10 bot rows colour-coded → click Generate → see snippet → click "Generate & download llms.txt" → file downloads.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/site-audit/ frontend/app/site-audit/
git commit -m "feat(site-audit): AI Bots & Files tab with status grid + generators"
```

---

### Task 29: Citations tab — domain breakdown

**Files:**
- Create: `frontend/components/site-audit/CitationDomainList.tsx`
- Modify: `frontend/app/site-audit/[brandId]/page.tsx` (wire Citations tab)

- [ ] **Step 1: CitationDomainList**

```tsx
'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type CitationsOverview } from '@/lib/api'

export function CitationDomainList({ brandId }: { brandId: number }) {
  const [data, setData] = useState<CitationsOverview | null>(null)
  useEffect(() => { siteAudit.citations(brandId, 30).then(setData) }, [brandId])
  if (!data) return <div>Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        <div className="border rounded p-4">
          <div className="text-xs text-muted-foreground uppercase">Own pages</div>
          <div className="text-2xl font-semibold">{data.own_pct.toFixed(0)}%</div>
        </div>
        <div className="border rounded p-4">
          <div className="text-xs text-muted-foreground uppercase">Competitor pages</div>
          <div className="text-2xl font-semibold">{data.competitor_pct.toFixed(0)}%</div>
        </div>
      </div>

      <section>
        <h3 className="font-medium mb-2">Top cited domains (last 30 days)</h3>
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground">
            <tr><th className="text-left py-2">Domain</th><th>Kind</th><th className="text-right">Citations</th></tr>
          </thead>
          <tbody>
            {data.by_domain.map(d => (
              <tr key={d.domain + d.kind} className="border-b">
                <td className="py-2 font-mono text-xs">{d.domain}</td>
                <td><span className={`text-xs ${
                  d.kind === 'own' ? 'text-green-600' :
                  d.kind === 'competitor' ? 'text-red-600' :
                  d.kind === 'third_party' ? 'text-blue-600' : 'text-muted-foreground'
                }`}>{d.kind}</span></td>
                <td className="text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Wire**

Replace `{tab === 'citations' && <div>...</div>}` with `<CitationDomainList brandId={brandId} />`.

- [ ] **Step 3: Verify visually + commit**

```bash
git add frontend/components/site-audit/CitationDomainList.tsx frontend/app/site-audit/[brandId]/page.tsx
git commit -m "feat(site-audit): Citations tab — own/competitor mix + top domains"
```

---

### Task 30: Recommendations tab

**Files:**
- Create: `frontend/components/site-audit/RecommendationsList.tsx`
- Modify: `frontend/app/site-audit/[brandId]/page.tsx`

- [ ] **Step 1: RecommendationsList**

```tsx
'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditRecommendationOut } from '@/lib/api'

export function RecommendationsList({ auditId }: { auditId: number }) {
  const [recs, setRecs] = useState<WebsiteAuditRecommendationOut[] | null>(null)
  useEffect(() => { siteAudit.recommendations(auditId).then(setRecs) }, [auditId])
  if (!recs) return <div>Loading…</div>

  const grouped: Record<string, WebsiteAuditRecommendationOut[]> = { high: [], medium: [], low: [] }
  for (const r of recs) grouped[r.priority]?.push(r)

  return (
    <div className="space-y-6">
      {(['high', 'medium', 'low'] as const).map(prio => (
        <section key={prio}>
          <h3 className="font-medium mb-3 capitalize">{prio} priority ({grouped[prio].length})</h3>
          <ul className="space-y-3">
            {grouped[prio].map(r => (
              <li key={r.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <strong>{r.title}</strong>
                  <span className="text-xs text-muted-foreground">
                    {r.effort} effort · {r.category}
                  </span>
                </div>
                <div className="text-sm mt-2 whitespace-pre-line">{r.body}</div>
                {r.linked_prompt_ids.length > 0 && (
                  <div className="text-xs mt-2 inline-block bg-primary/10 text-primary px-2 py-0.5 rounded">
                    Fixes {r.linked_prompt_ids.length} prompts
                  </div>
                )}
                {r.expected_impact && (
                  <div className="text-xs mt-2 text-muted-foreground">
                    Expected impact: {r.expected_impact}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire**

```tsx
{tab === 'recs' && <RecommendationsList auditId={audit.id} />}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/site-audit/RecommendationsList.tsx frontend/app/site-audit/[brandId]/page.tsx
git commit -m "feat(site-audit): Recommendations tab with priority grouping + linked-prompt badges"
```

---

### Task 31: Agency portal — staff view of audit

**Files:**
- Create: `frontend/app/agency/clients/[id]/audit/page.tsx`

- [ ] **Step 1: Implement (reuses the same page component)**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// Reuse the main page logic by fetching client → brand_id then redirecting
// (Simplest path: import the SiteAuditPage component and inject brand_id via context.)
import SiteAuditPage from '../../../../site-audit/[brandId]/page'

export default function AgencyAuditPage() {
  const params = useParams<{ id: string }>()
  const [brandId, setBrandId] = useState<number | null>(null)

  useEffect(() => {
    // GET /api/agency/clients/:id → { brand_id } (use existing agency API client)
    import('@/lib/api').then(({ agency }) =>
      agency.getClient(Number(params.id)).then((c: any) => setBrandId(c.brand_id))
    )
  }, [params.id])

  if (!brandId) return <div className="p-8">Loading…</div>
  // Wrap: emulate the brandId param dynamic route by rendering SiteAuditPage in a sub-tree.
  // Simpler approach: <iframe src={`/site-audit/${brandId}`} /> if the in-app nav allows it,
  // but cleaner: copy the page logic into a shared component and import it here.
  return (
    <div data-brand-id={brandId}>
      {/* Inline equivalent of SiteAuditPage — see implementer note */}
      Loading audit for brand {brandId}…
    </div>
  )
}
```

> **Implementer note:** the cleanest refactor is to extract the body of `frontend/app/site-audit/[brandId]/page.tsx` into a reusable `<SiteAuditView brandId={brandId} />` component in `frontend/components/site-audit/SiteAuditView.tsx`, then have both `/site-audit/[brandId]/page.tsx` and `/agency/clients/[id]/audit/page.tsx` render `<SiteAuditView />` with the right brandId. Do this refactor as part of this task. If `agency.getClient` doesn't exist yet in `lib/api.ts`, add it now per the existing agency API patterns.

- [ ] **Step 2: Verify**

Login as agency staff (`ken@lumidian.ai`), navigate to agency client detail, click Audit tab — see the same UI as customer view, scoped to the client's brand.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/agency/clients/[id]/audit/page.tsx frontend/components/site-audit/SiteAuditView.tsx
git commit -m "feat(site-audit): agency portal audit view"
```

---

## Phase 9 — Integration & Polish

### Task 32: Integration test — full stack happy path

**Files:**
- Create: `backend/tests/test_site_audit_integration.py`

- [ ] **Step 1: Write end-to-end test against the local static server**

`backend/tests/test_site_audit_integration.py`:

```python
import asyncio

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, WebsiteAudit, WebsiteAuditPage
from tests.conftest import register_and_login, create_brand
from tests.fixtures.site_audit.static_server import run_server


HOME = """<html><head><title>X</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"X","url":"http://x","logo":"x","sameAs":["https://linkedin.com/x"]}
</script></head>
<body><h1>X</h1><h2>Pricing</h2><p>X costs $99/month as of 2025. Source: Forrester.</p></body></html>"""
ROBOTS = "User-agent: *\nAllow: /\n"


@pytest.mark.asyncio
async def test_full_audit_flow_via_api(client):
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)
    # Override website_url to the local server
    async with run_server({"/": (200, "text/html", HOME), "/robots.txt": (200, "text/plain", ROBOTS)}) as base:
        async with AsyncSessionLocal() as db:
            b = await db.get(Brand, brand["id"])
            b.website_url = base
            await db.commit()

        r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
        assert r.status_code == 202
        audit_id = r.json()["audit_id"]

        # Poll until completed or 30s timeout
        for _ in range(60):
            r = await client.get(f"/api/site-audit/audit/{audit_id}")
            if r.status_code == 200 and r.json()["status"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.5)

        detail = r.json()
        assert detail["status"] == "completed", detail
        assert detail["total_pages"] >= 1

        r = await client.get(f"/api/site-audit/audit/{audit_id}/pages")
        pages = r.json()
        assert pages

        r = await client.get(f"/api/site-audit/audit/{audit_id}/findings")
        assert r.status_code == 200

        r = await client.get(f"/api/site-audit/audit/{audit_id}/recommendations")
        assert r.status_code == 200

        r = await client.get(f"/api/site-audit/{brand['id']}/llms-txt")
        assert r.status_code == 200
        assert "# Test Brand" in r.text or "# " in r.text

        r = await client.get(f"/api/site-audit/{brand['id']}/robots-snippet?mode=allow_all")
        assert "GPTBot" in r.text
```

- [ ] **Step 2: Run integration test**

```bash
pytest backend/tests/test_site_audit_integration.py -v
```

Expected: passes (may take 30–60s due to Playwright).

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

```bash
cd backend && pytest tests/ -q
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_site_audit_integration.py
git commit -m "test(site-audit): full-stack integration test against local static server"
```

---

### Task 33: Run citation backfill on the local DB

- [ ] **Step 1: Execute backfill**

```bash
cd backend && source venv/bin/activate
python -m scripts.backfill_citations
```

Expected: logs show "Backfill complete: N runs processed, M citations inserted." Should not raise.

- [ ] **Step 2: Spot-check**

```bash
sqlite3 backend/clarity_ai.db "SELECT kind, COUNT(*) FROM citation_sources GROUP BY kind;"
```

Expected: at least one row, ideally a mix of `own`, `competitor`, `third_party`, `unknown`.

- [ ] **Step 3: (No commit — this is a data-only operation)**

If running against production via Railway CLI, do it at low-traffic time. The constraint `UNIQUE(query_result_id, url)` makes it safe to re-run.

---

### Task 34: Update CLAUDE.md + CURRENT_STATE.md

**Files:**
- Modify: `CLAUDE.md` (add router + service + tables to existing tables)
- Modify: `CURRENT_STATE.md` (note the new feature in Recent Decisions + Recently Changed)

- [ ] **Step 1: Update CLAUDE.md**

In the "Router Mounts" table, add a row:

```
| site_audit.py | /api/site-audit | Trigger audits; surface findings/recommendations/citations; generate llms.txt + robots.txt |
```

In the "Database Models" section, add the 5 new model summary rows in their own group.

Update the Scheduled Jobs note: "No scheduled job for site audits — manual trigger only."

- [ ] **Step 2: Update CURRENT_STATE.md**

Add a "Recent Decisions" entry dated today:

```
- **2026-05-11** — Shipped Website AIO module. Backend: services/site_audit/* with crawler, 5 parsers, scoring, citation extraction + backfill, page↔prompt linking, rule-based + LLM recommendations, llms.txt and robots.txt generators. 5 new tables; 13 API endpoints. Frontend: /site-audit/[brandId] with 5 tabs + agency portal view. Manual trigger; Free tier excluded.
```

Update "Recently Changed":

```
- **Website AIO module:** see `docs/superpowers/specs/2026-05-11-website-aio-design.md` + `docs/superpowers/plans/2026-05-11-website-aio.md`. New backend package, router, models, frontend section.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CURRENT_STATE.md
git commit -m "docs(site-audit): update CLAUDE.md + CURRENT_STATE.md with new module"
```

---

### Task 35: Final verification — golden path in browser

Per CLAUDE.md: "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."

- [ ] **Step 1: Start dev servers**

```bash
# Terminal A
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
# Terminal B
cd frontend && npm run dev -- -p 3002
```

- [ ] **Step 2: Verify Free-tier gate**

Log in as a Free-tier user → confirm "Site Audit" nav item is hidden OR `/site-audit/<id>` redirects/shows upgrade CTA.

- [ ] **Step 3: Verify happy path on a real brand**

Log in as a paid user with a brand that has `website_url` set. Click Site Audit → Run audit → wait for completion → verify all 5 tabs render data:

- Overview: 4 sub-scores numeric
- Pages: list sorted by score; click a page → detail loads with findings + recs
- AI Bots & Files: 10 bot statuses; robots.txt raw shown if present; generators work
- Citations: own % / competitor % shown; top domains table populated
- Recommendations: priority-grouped list; high/medium/low

- [ ] **Step 4: Verify agency view**

Log in as `ken@lumidian.ai`, navigate to agency client detail → Audit tab → same UI scoped to client's brand.

- [ ] **Step 5: Verify error paths**

- Trigger an audit on a brand with no `website_url` → expect 400.
- Trigger an audit while one is running → expect 409.
- Hit monthly cap (manually set the brand's tier to basic and create 4 completed audits, or just verify the count query in code) → 403.

- [ ] **Step 6: No commit (manual verification)**

If anything failed: file an issue in this branch and address before merging.

---

## Self-Review

After all tasks complete:

1. **Spec coverage check:**
   - §3 5 tables → Tasks 2 + 3 ✓
   - §4 backend layout → Tasks 4–22 ✓
   - §5 crawler → Tasks 5–7 ✓
   - §6 parsers (5) → Tasks 9–13 ✓
   - §7 citation pipeline → Tasks 15–17 ✓
   - §8 page↔prompt linking → Task 18 ✓
   - §9 recommendations + LLM rewrites → Task 19 ✓
   - §10 tier gating → Task 23 ✓
   - §11 API endpoints (13) → Task 23 ✓
   - §12 frontend (routes + components + nav + tabs) → Tasks 24–31 ✓
   - §13 lifecycle / cancel → Task 23 ✓
   - §14 scoring → Task 14 ✓
   - §15 generators → Task 20 ✓
   - §16 backfill → Task 17 + Task 33 ✓
   - §17 error handling → embedded across crawler/auditor ✓
   - §18 testing → embedded across each task ✓
   - §19 deps → Task 1 ✓
   - §21 URL normalisation → Task 4 ✓

2. **LLM rewrite tier gating not yet wired into orchestrator** — `recommendations.generate_llm_rewrite` exists but `auditor.py` does not call it. **Add a follow-up step:** after Task 19, before Task 21 lands, the orchestrator should call `generate_llm_rewrite` for the top N pages (N from `TIER_AUDIT_LIMITS[tier]['llm_rewrites']`). This is a gap — record as Task 36.

3. **Schema sanity check finding `schema_content_mismatch`** mentioned in spec §6b is not implemented in `parsers/schema.py`. Add as Task 37.

---

### Task 36: Wire LLM rewrites into orchestrator

**Files:**
- Modify: `backend/app/services/site_audit/auditor.py`

- [ ] **Step 1: Read tier limit at audit start**

In `_run_audit_inner`, after fetching the brand, fetch the User's `subscription_tier` and look up `TIER_AUDIT_LIMITS[tier]['llm_rewrites']` to get N.

- [ ] **Step 2: Select top N pages**

After per-page recommendations are persisted, select the top N pages by `(len(linked_prompts) DESC, page_score ASC)` from the in-memory `page_records`.

- [ ] **Step 3: Call generator and persist**

```python
from app.services.site_audit.recommendations import generate_llm_rewrite, Recommendation

if N > 0:
    profile = ...  # fetch BrandProfile
    for rec in selected[:N]:
        excerpt = rec["measurements"].get("h1_text", "") + "\n" + ... # build excerpt from raw HTML
        rewrite = await generate_llm_rewrite(
            page_excerpt=excerpt,
            findings=rec["findings"],
            brand_profile={"name": brand.name, ...},
            linked_prompts=[],  # could fetch prompt texts via page_link_map
        )
        if rewrite:
            async with AsyncSessionLocal() as db:
                db.add(WebsiteAuditRecommendation(
                    audit_id=audit_id, page_id=rec["page_id"],
                    priority="high", effort="medium", category="content",
                    title="Rewrite this page's first section",
                    body=rewrite,
                    linked_prompt_ids=json.dumps(page_link_map.get(rec["page_id"], [])),
                    llm_generated=True,
                ))
                await db.commit()
```

- [ ] **Step 4: Add a test**

`backend/tests/test_site_audit_llm_rewrite.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

from app.services.site_audit.recommendations import generate_llm_rewrite


@pytest.mark.asyncio
async def test_generate_llm_rewrite_returns_none_on_failure():
    with patch("anthropic.AsyncAnthropic") as MockAnth:
        instance = MockAnth.return_value
        instance.messages.create = AsyncMock(side_effect=RuntimeError("boom"))
        out = await generate_llm_rewrite("page", [], {"name": "x"}, ["prompt"])
    assert out is None
```

- [ ] **Step 5: Run + commit**

```bash
pytest backend/tests/test_site_audit_llm_rewrite.py -v
git add backend/app/services/site_audit/auditor.py backend/tests/test_site_audit_llm_rewrite.py
git commit -m "feat(site-audit): wire LLM rewrites into orchestrator gated by tier"
```

---

### Task 37: Add `schema_content_mismatch` check

**Files:**
- Modify: `backend/app/services/site_audit/parsers/schema.py`
- Modify: `backend/tests/test_site_audit_parsers_schema.py`

- [ ] **Step 1: Add finding emission**

In `parse_schema`, after extracting Organisation/Article/etc.:

```python
# Sanity: if any node has 'headline' or 'name', compare to <title> presence
import re
title_match = re.search(r"<title[^>]*>([^<]*)</title>", html or "", re.IGNORECASE)
title_text = title_match.group(1).strip() if title_match else ""
if title_text:
    for node in (nodes_by_type.get("Article", []) +
                 nodes_by_type.get("BlogPosting", []) +
                 nodes_by_type.get("WebPage", [])):
        headline = (node.get("headline") or node.get("name") or "").strip()
        if headline and headline not in title_text and title_text not in headline:
            findings.append(Finding("schema_content_mismatch", "low", "schema",
                                    "JSON-LD headline/name doesn't match the page <title>.",
                                    {"title": title_text[:120], "schema_headline": headline[:120]}))
            break
```

- [ ] **Step 2: Add test**

```python
def test_schema_content_mismatch_detected():
    html = """<html><head><title>Real Title</title>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"Totally Different"}
    </script></head><body></body></html>"""
    out = parse_schema(html, "https://x.com/a", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "schema_content_mismatch" in ids
```

- [ ] **Step 3: Run + commit**

```bash
pytest backend/tests/test_site_audit_parsers_schema.py -v
git add backend/app/services/site_audit/parsers/schema.py backend/tests/test_site_audit_parsers_schema.py
git commit -m "feat(site-audit): schema_content_mismatch sanity check"
```

---

## Done

All 37 tasks complete. Repository state at this point:
- 5 new tables, 19 new backend files, 1 backfill script, 14 new test files, 1 modified service (tracking)
- 13 new frontend files (4 routes + 9 components), 2 modified (lib/api, nav)
- 1 modified spec doc (CLAUDE.md), CURRENT_STATE.md updated
- 13 new API endpoints under `/api/site-audit/*`
- Manual-trigger audits; Free tier excluded; rule-based + LLM-rewrite recs; llms.txt + robots.txt generators; citation extraction + backfill complete

Run `pytest backend/tests/ -q` for the final green check. Verify in browser per Task 35.
