# Site Audit Fix-Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/site-audit/[brandId]` as a fix-factory: every recommendation becomes a draftable, paste-ready artifact. Match the app's design system. Expand audit coverage with four new check categories (E-E-A-T, internal linking, Q&A, stats density).

**Architecture:** Backend foundations first (migration + ORM + endpoints + dispatcher), then artifact generators (rule-based + LLM), then new parsers and recs registry updates, then frontend redesign component-by-component, then end-to-end verification.

**Tech Stack:** FastAPI / SQLAlchemy 2.0 (async) / SQLite / Anthropic SDK (Claude Haiku 4.5). Next.js 15 / React 18 / TypeScript strict / Tailwind / Radix / framer-motion / Recharts.

**Spec:** `docs/superpowers/specs/2026-05-12-site-audit-redesign-design.md`

---

## File Structure

**New backend:** `app/services/site_audit/artifact_generator.py`, `app/services/site_audit/prompts/artifact/*.md`, `app/services/site_audit/parsers/{eeat,linking,qa,agents_md}.py`, plus 8 new test files; `scripts/backfill_rec_metadata.py`.

**Modified backend:** `app/models.py` (+8 cols on `WebsiteAuditRecommendation`), `app/database.py` (+8 migration steps), `app/schemas.py` (+3 schemas, +cols on output), `app/routers/site_audit.py` (+2 endpoints), `app/services/site_audit/{auditor,recommendations}.py`, `app/services/site_audit/parsers/semantic.py`.

**New frontend:** ~21 components under `components/site-audit/`, `lib/grade.ts`.

**Modified frontend:** `components/site-audit/{SiteAuditView,PageDetail,AuditTriggerButton}.tsx`, `lib/api.ts`.

**Deleted frontend:** `components/site-audit/{BotAccessPanel,LlmsTxtPanel,GeneratorsCard,CitationDomainList,RecommendationsList,PageList}.tsx`.

---

## Phase 1 — Backend foundations

### Task 1: Migration + ORM columns

**Files:**
- Modify: `backend/app/models.py:792-806` (WebsiteAuditRecommendation)
- Modify: `backend/app/database.py:run_migrations` (append 8 ALTER TABLE)
- Test: `backend/tests/test_site_audit_migration.py` (new)

- [ ] **Step 1: Write failing test**

```python
# tests/test_site_audit_migration.py
import pytest
from sqlalchemy import inspect
from app.database import engine, run_migrations, create_tables

@pytest.mark.asyncio
async def test_recommendation_columns_present():
    await create_tables()
    await run_migrations()
    async with engine.connect() as conn:
        cols = await conn.run_sync(
            lambda sync_conn: [c["name"] for c in inspect(sync_conn).get_columns("website_audit_recommendations")]
        )
    expected = {"artifact","artifact_type","artifact_generated_at","artifact_regen_count",
                "status","expected_lift_pp","target_url","priority_score"}
    assert expected.issubset(set(cols)), f"missing: {expected - set(cols)}"
```

- [ ] **Step 2: Run — verify fail**

```bash
cd backend && source venv/bin/activate && pytest tests/test_site_audit_migration.py -v
```
Expected: FAIL — columns missing.

- [ ] **Step 3: Add ORM columns**

Edit `app/models.py` — in `WebsiteAuditRecommendation` after `llm_generated`:
```python
    artifact: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    artifact_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    artifact_regen_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    expected_lift_pp: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority_score: Mapped[float | None] = mapped_column(Float, nullable=True)
```

- [ ] **Step 4: Append migrations**

Edit `app/database.py:run_migrations` — append to `migrations` list (bottom):
```python
        # Site Audit Fix Factory — artifact columns
        "ALTER TABLE website_audit_recommendations ADD COLUMN artifact TEXT",
        "ALTER TABLE website_audit_recommendations ADD COLUMN artifact_type TEXT",
        "ALTER TABLE website_audit_recommendations ADD COLUMN artifact_generated_at DATETIME",
        "ALTER TABLE website_audit_recommendations ADD COLUMN artifact_regen_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE website_audit_recommendations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE website_audit_recommendations ADD COLUMN expected_lift_pp REAL",
        "ALTER TABLE website_audit_recommendations ADD COLUMN target_url TEXT",
        "ALTER TABLE website_audit_recommendations ADD COLUMN priority_score REAL",
```
Each ALTER TABLE statement is wrapped in try/except per the existing pattern (idempotent — duplicate column errors swallowed).

- [ ] **Step 5: Run test — verify pass**

```bash
rm -f clarity_ai.db && pytest tests/test_site_audit_migration.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/models.py app/database.py tests/test_site_audit_migration.py
git commit -m "feat(site-audit): add 8 artifact/status columns to recommendations"
```

### Task 2: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py:1022-1033` (WebsiteAuditRecommendationOut)
- Modify: `backend/app/schemas.py` end-of-file (add 3 new schemas)

- [ ] **Step 1: Extend output schema**

Replace `WebsiteAuditRecommendationOut` body with:
```python
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
    artifact: str | None = None
    artifact_type: str | None = None
    artifact_generated_at: datetime | None = None
    artifact_regen_count: int = 0
    status: str = "pending"
    expected_lift_pp: float | None = None
    target_url: str | None = None
    priority_score: float | None = None
```

- [ ] **Step 2: Add request/response schemas**

Append to `schemas.py`:
```python
class DraftArtifactRequest(BaseModel):
    regenerate_notes: str | None = None


class DraftArtifactResponse(BaseModel):
    artifact: str
    artifact_type: str
    generated_at: datetime
    regen_count: int


class UpdateRecStatusRequest(BaseModel):
    status: str  # 'pending' | 'applied' | 'dismissed'
```

- [ ] **Step 3: Commit**

```bash
git add app/schemas.py
git commit -m "feat(site-audit): schemas for artifact draft + status endpoints"
```

### Task 3: Artifact generator stub + tests

**Files:**
- Create: `backend/app/services/site_audit/artifact_generator.py`
- Create: `backend/tests/test_site_audit_artifact_generator.py`

- [ ] **Step 1: Failing test**

```python
# tests/test_site_audit_artifact_generator.py
import pytest
from app.services.site_audit.artifact_generator import (
    generate_artifact, ArtifactResult, ARTIFACT_TYPES,
)

def test_artifact_types_enum_complete():
    expected = {
        "jsonld_org","jsonld_faq","jsonld_article","jsonld_breadcrumb",
        "jsonld_product","jsonld_howto","meta_title","meta_description",
        "h1_text","og_tags","faq_section","section_rewrite",
        "new_page_draft","alt_text_batch","llms_txt","robots_snippet",
        "agents_md","internal_link_suggestions",
    }
    assert expected.issubset(ARTIFACT_TYPES)
```

- [ ] **Step 2: Run, verify fail**

```bash
pytest tests/test_site_audit_artifact_generator.py::test_artifact_types_enum_complete -v
```

- [ ] **Step 3: Create stub module**

```python
# app/services/site_audit/artifact_generator.py
"""Artifact generator: dispatch by artifact_type to per-type generators."""
from __future__ import annotations
from dataclasses import dataclass

ARTIFACT_TYPES: set[str] = {
    "jsonld_org","jsonld_faq","jsonld_article","jsonld_breadcrumb",
    "jsonld_product","jsonld_howto","meta_title","meta_description",
    "h1_text","og_tags","faq_section","section_rewrite",
    "new_page_draft","alt_text_batch","llms_txt","robots_snippet",
    "agents_md","internal_link_suggestions",
}

# Subset that uses LLM (others are pure rule-based templates).
LLM_ARTIFACT_TYPES: set[str] = {
    "jsonld_faq","jsonld_article","jsonld_product","jsonld_howto",
    "meta_title","meta_description","h1_text","og_tags",
    "faq_section","section_rewrite","new_page_draft","alt_text_batch",
    "internal_link_suggestions",
}


@dataclass
class ArtifactResult:
    artifact: str
    artifact_type: str


async def generate_artifact(
    rec_id: int, *, regenerate_notes: str | None = None,
) -> ArtifactResult:
    raise NotImplementedError("per-type generators land in subsequent tasks")
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_site_audit_artifact_generator.py -v
```

- [ ] **Step 5: Commit**

```bash
git add app/services/site_audit/artifact_generator.py tests/test_site_audit_artifact_generator.py
git commit -m "feat(site-audit): artifact generator stub + type registry"
```

### Task 4: POST /draft endpoint (returns 501 until generator wired)

**Files:**
- Modify: `backend/app/routers/site_audit.py` (append new endpoint)
- Create: `backend/tests/test_site_audit_draft_endpoint.py`

- [ ] **Step 1: Failing test**

```python
# tests/test_site_audit_draft_endpoint.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from tests.conftest import register_and_login, create_brand

@pytest.mark.asyncio
async def test_draft_endpoint_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/site-audit/recommendation/9999/draft")
    assert r.status_code == 401
```

- [ ] **Step 2: Verify fail** (`pytest tests/test_site_audit_draft_endpoint.py -v`)

- [ ] **Step 3: Add endpoint to router**

In `app/routers/site_audit.py`, after the last existing endpoint, append:
```python
from app.schemas import DraftArtifactRequest, DraftArtifactResponse, UpdateRecStatusRequest

@router.post("/recommendation/{rec_id}/draft", response_model=DraftArtifactResponse)
async def draft_recommendation_artifact(
    rec_id: int,
    body: DraftArtifactRequest = DraftArtifactRequest(),
    user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec:
            raise HTTPException(404, "recommendation not found")
        audit = await db.get(WebsiteAudit, rec.audit_id)
    brand = await _ensure_brand_access(audit.brand_id, user)
    _tier_or_403(brand, user)
    # generator integration in later task
    raise HTTPException(501, "draft generator not wired yet")
```

Import `WebsiteAuditRecommendation` into the file if not already.

- [ ] **Step 4: Verify pass** + commit

```bash
pytest tests/test_site_audit_draft_endpoint.py -v
git add app/routers/site_audit.py tests/test_site_audit_draft_endpoint.py
git commit -m "feat(site-audit): scaffold POST /recommendation/{id}/draft endpoint"
```

### Task 5: PATCH /status endpoint (full)

**Files:**
- Modify: `backend/app/routers/site_audit.py`
- Create: `backend/tests/test_site_audit_status_endpoint.py`

- [ ] **Step 1: Failing test**

```python
# tests/test_site_audit_status_endpoint.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_status_update_rejects_bad_value(client_with_audit_rec):
    client, rec_id = client_with_audit_rec
    r = await client.patch(f"/api/site-audit/recommendation/{rec_id}/status",
                            json={"status": "bogus"})
    assert r.status_code == 400

@pytest.mark.asyncio
async def test_status_update_applies(client_with_audit_rec):
    client, rec_id = client_with_audit_rec
    r = await client.patch(f"/api/site-audit/recommendation/{rec_id}/status",
                            json={"status": "applied"})
    assert r.status_code == 204
```

Use the existing `tests/conftest.py` helpers (`register_and_login`, `create_brand`) plus a new fixture that creates a fake `WebsiteAudit` + rec. Add this fixture to `conftest.py`:
```python
@pytest.fixture
async def client_with_audit_rec():
    """Authed client + a (brand, audit, recommendation) chain owned by the user."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, WebsiteAudit, WebsiteAuditRecommendation, utcnow
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        token = await register_and_login(ac, email="rec@test.com")
        ac.cookies.set("clarity_token", token)
        brand = await create_brand(ac, name="X", website_url="https://x.example.com")
        async with AsyncSessionLocal() as db:
            audit = WebsiteAudit(brand_id=brand["id"], status="completed",
                                  triggered_by="user", started_at=utcnow())
            db.add(audit); await db.commit(); await db.refresh(audit)
            rec = WebsiteAuditRecommendation(
                audit_id=audit.id, priority="high", effort="low",
                category="schema", title="Test", body="Body",
            )
            db.add(rec); await db.commit(); await db.refresh(rec)
        yield ac, rec.id
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement endpoint**

Append to `app/routers/site_audit.py`:
```python
_VALID_REC_STATUS = {"pending", "applied", "dismissed"}

@router.patch("/recommendation/{rec_id}/status", status_code=204)
async def update_recommendation_status(
    rec_id: int,
    body: UpdateRecStatusRequest,
    user: User = Depends(get_current_user),
):
    if body.status not in _VALID_REC_STATUS:
        raise HTTPException(400, f"status must be one of {sorted(_VALID_REC_STATUS)}")
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec:
            raise HTTPException(404, "recommendation not found")
        audit = await db.get(WebsiteAudit, rec.audit_id)
    await _ensure_brand_access(audit.brand_id, user)
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        rec.status = body.status
        await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 4: Verify pass + commit**

```bash
pytest tests/test_site_audit_status_endpoint.py -v
git add app/routers/site_audit.py tests/test_site_audit_status_endpoint.py tests/conftest.py
git commit -m "feat(site-audit): PATCH /recommendation/{id}/status with valid-state guard"
```

---

## Phase 2 — Artifact generators

Each generator is its own task. All share the same dispatch signature returning `ArtifactResult`. Within `artifact_generator.py`, add a registry:

```python
_RULE_GENERATORS: dict[str, callable] = {}
_LLM_GENERATORS: dict[str, callable] = {}
```

And populate via decorators (`@_register_rule("jsonld_org")` etc.) as each task lands. The `generate_artifact` dispatcher reads the registries and calls the matching function with `(rec, audit, brand, profile, page, regenerate_notes)`.

### Task 6: Generator dispatch + context loader

**Files:** Modify `backend/app/services/site_audit/artifact_generator.py`.

- [ ] **Step 1: Failing test** — extend `test_site_audit_artifact_generator.py`:

```python
@pytest.mark.asyncio
async def test_generate_artifact_loads_context(monkeypatch):
    from app.services.site_audit import artifact_generator as ag
    captured = {}
    async def fake_gen(ctx, **kw):
        captured.update({"brand": ctx.brand.name, "rec_id": ctx.rec.id})
        return ag.ArtifactResult(artifact="x", artifact_type="jsonld_org")
    ag._RULE_GENERATORS["jsonld_org"] = fake_gen
    # … setup brand+audit+rec with artifact_type='jsonld_org' …
    res = await ag.generate_artifact(rec_id)
    assert captured["brand"]
    assert res.artifact == "x"
```

(See test file for the full fixture wiring — reuses `client_with_audit_rec` style.)

- [ ] **Step 2: Implement dispatcher**

```python
from app.database import AsyncSessionLocal
from app.models import Brand, BrandProfile, WebsiteAudit, WebsiteAuditPage, WebsiteAuditRecommendation, utcnow
from sqlalchemy import select

@dataclass
class GeneratorContext:
    rec: WebsiteAuditRecommendation
    audit: WebsiteAudit
    brand: Brand
    profile: BrandProfile | None
    page: WebsiteAuditPage | None
    regenerate_notes: str | None

async def generate_artifact(rec_id, *, regenerate_notes=None):
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec or not rec.artifact_type:
            raise ValueError("rec missing or has no artifact_type")
        audit = await db.get(WebsiteAudit, rec.audit_id)
        brand = await db.get(Brand, audit.brand_id)
        profile = (await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand.id)
        )).scalar_one_or_none()
        page = await db.get(WebsiteAuditPage, rec.page_id) if rec.page_id else None
    ctx = GeneratorContext(rec=rec, audit=audit, brand=brand, profile=profile,
                            page=page, regenerate_notes=regenerate_notes)
    gen = _RULE_GENERATORS.get(rec.artifact_type) or _LLM_GENERATORS.get(rec.artifact_type)
    if not gen:
        raise ValueError(f"no generator for artifact_type={rec.artifact_type}")
    result = await gen(ctx)
    # persist
    async with AsyncSessionLocal() as db:
        rec_fresh = await db.get(WebsiteAuditRecommendation, rec_id)
        rec_fresh.artifact = result.artifact
        rec_fresh.artifact_type = result.artifact_type
        rec_fresh.artifact_generated_at = utcnow()
        if regenerate_notes is not None:
            rec_fresh.artifact_regen_count = (rec_fresh.artifact_regen_count or 0) + 1
        await db.commit()
    return result
```

- [ ] **Step 3: Commit**

```bash
git add app/services/site_audit/artifact_generator.py tests/test_site_audit_artifact_generator.py
git commit -m "feat(site-audit): artifact generator dispatch + context loader"
```

### Task 7: Wire endpoint to generator + tier gate

**Files:** Modify `backend/app/routers/site_audit.py`.

- [ ] **Step 1: Failing test** — extend `test_site_audit_draft_endpoint.py`:

```python
@pytest.mark.asyncio
async def test_draft_endpoint_calls_generator(client_with_audit_rec, monkeypatch):
    client, rec_id = client_with_audit_rec
    # set artifact_type on the rec via DB direct
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        rec.artifact_type = "jsonld_org"
        await db.commit()
    from app.services.site_audit import artifact_generator as ag
    async def fake(ctx): return ag.ArtifactResult(artifact='{"@context":"x"}', artifact_type="jsonld_org")
    ag._RULE_GENERATORS["jsonld_org"] = fake
    r = await client.post(f"/api/site-audit/recommendation/{rec_id}/draft")
    assert r.status_code == 200
    assert r.json()["artifact_type"] == "jsonld_org"
```

- [ ] **Step 2: Replace the 501 stub** with:

```python
    # … access check & tier gate as before …
    from app.services.site_audit.artifact_generator import (
        generate_artifact, LLM_ARTIFACT_TYPES,
    )
    # Tier gate: LLM artifacts require starter+
    if rec.artifact_type in LLM_ARTIFACT_TYPES and (user.subscription_tier or "") not in ("starter","pro"):
        raise HTTPException(402, "LLM-backed artifacts require Growth tier or above")
    # Monthly LLM cap
    if rec.artifact_type in LLM_ARTIFACT_TYPES:
        async with AsyncSessionLocal() as db:
            month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            used = (await db.execute(
                select(func.count(WebsiteAuditRecommendation.id))
                .join(WebsiteAudit, WebsiteAudit.id == WebsiteAuditRecommendation.audit_id)
                .where(
                    WebsiteAudit.brand_id == brand.id,
                    WebsiteAuditRecommendation.artifact_generated_at >= month_start,
                    WebsiteAuditRecommendation.artifact_type.in_(LLM_ARTIFACT_TYPES),
                )
            )).scalar_one()
        from app.services.site_audit.constants import TIER_AUDIT_LIMITS
        cap = TIER_AUDIT_LIMITS.get(user.subscription_tier or "basic", {}).get("llm_rewrites", 0)
        if used >= cap:
            raise HTTPException(402, f"monthly LLM-draft cap reached ({cap})")
    try:
        result = await generate_artifact(rec_id, regenerate_notes=body.regenerate_notes)
    except Exception as exc:
        logger.exception("draft failed for rec %d", rec_id)
        raise HTTPException(503, f"draft generation failed: {exc}")
    async with AsyncSessionLocal() as db:
        rec_fresh = await db.get(WebsiteAuditRecommendation, rec_id)
        return DraftArtifactResponse(
            artifact=result.artifact,
            artifact_type=result.artifact_type,
            generated_at=rec_fresh.artifact_generated_at,
            regen_count=rec_fresh.artifact_regen_count,
        )
```

- [ ] **Step 3: Verify pass + commit**

```bash
pytest tests/test_site_audit_draft_endpoint.py -v
git add app/routers/site_audit.py tests/test_site_audit_draft_endpoint.py
git commit -m "feat(site-audit): wire /draft endpoint to generator with tier gating"
```

### Tasks 8-23 — per-type generators

Each task follows the same shape: write a per-type unit test, implement the generator, register it, run, commit. I'll list them with their pattern key points; the executing agent should follow the canonical TDD shape from earlier tasks.

| Task | Type | Kind | Inputs needed | Output shape |
|------|------|------|---------------|---------------|
| 8 | `jsonld_org` | rule | brand.name/website_url, profile.publications (sameAs) | JSON-LD `Organization` block |
| 9 | `jsonld_breadcrumb` | rule | page.url (split path) | JSON-LD `BreadcrumbList` |
| 10 | `llms_txt` | rule | reuse `generators.build_llms_txt` | text |
| 11 | `robots_snippet` | rule | reuse `generators.build_robots_snippet('allow_all')` | text |
| 12 | `agents_md` | rule | brand + 5 top key-pages (analog of llms.txt for agents) | markdown |
| 13 | `meta_title` | LLM | page content (first 1500 chars), brand voice | ≤60-char title |
| 14 | `meta_description` | LLM | page content, brand voice | 155-char description |
| 15 | `h1_text` | LLM | page content, page type | ≤80-char H1 |
| 16 | `og_tags` | LLM | page content, brand voice | HTML `<meta>` block (og:title/desc/image/url/type) |
| 17 | `jsonld_faq` | LLM | page content + brand context | JSON-LD `FAQPage` with 5-8 Q&A |
| 18 | `faq_section` | LLM | page content + brand FAQ angle | HTML section + paired JSON-LD |
| 19 | `section_rewrite` | LLM | target section markup + brand voice | rewritten HTML |
| 20 | `jsonld_article` | LLM | page content, byline if any | JSON-LD `Article` |
| 21 | `jsonld_product` | LLM | page content, price/availability | JSON-LD `Product` |
| 22 | `jsonld_howto` | LLM | page content | JSON-LD `HowTo` |
| 23 | `alt_text_batch` | LLM | image src list + page context | JSON `{src: alt}` map |
| 24 | `internal_link_suggestions` | LLM | this page + 20 sibling pages | JSON `[{from,to,anchor}]` |
| 25 | `new_page_draft` | LLM | brand + topic from rec.title | markdown long-form |

**Per-task structure for LLM generators (use task 13 as concrete example, repeat for 14-25 substituting type/prompt):**

#### Task 13 concrete (template for 14-25):

**Files:**
- Create: `backend/app/services/site_audit/prompts/artifact/meta_title.md`
- Modify: `backend/app/services/site_audit/artifact_generator.py`
- Test: `backend/tests/test_artifact_meta_title.py`

- [ ] **Step 1: Write prompt template**

`app/services/site_audit/prompts/artifact/meta_title.md`:
```
You are an AI-search optimization specialist. Generate a concise <title> tag for the page below.

REQUIREMENTS
- 50-60 characters
- Lead with the most extractable noun phrase (brand or product name)
- No "|" or "—" separators unless brand name fits cleanly after
- Match the brand's voice (see TONE)
- Plain text, no quotes, no HTML

BRAND: {brand_name}
TONE: {tone}
WHAT NOT TO SAY: {what_not_to_say}
PAGE URL: {page_url}
PAGE TYPE: {page_type}
CURRENT H1: {h1}
CONTENT (first 1500 chars):
{content}

{regenerate_notes_block}

Return only the title text, nothing else.
```

- [ ] **Step 2: Failing test**

```python
# tests/test_artifact_meta_title.py
import pytest
from unittest.mock import patch
from app.services.site_audit.artifact_generator import generate_artifact, ArtifactResult

@pytest.mark.asyncio
async def test_meta_title_calls_llm(monkeypatch, audit_rec_with_type):
    rec_id = audit_rec_with_type("meta_title")
    with patch("app.services.site_audit.artifact_generator._call_claude",
               return_value="Sustainable Swimwear — Rhythm Livin"):
        res = await generate_artifact(rec_id)
    assert res.artifact_type == "meta_title"
    assert "Rhythm" in res.artifact
    assert len(res.artifact) <= 70  # generous bound
```

- [ ] **Step 3: Implement helper + generator**

In `artifact_generator.py`:
```python
import os
from pathlib import Path
from anthropic import AsyncAnthropic

_PROMPTS_DIR = Path(__file__).parent / "prompts" / "artifact"
_LLM_TIMEOUT_S = 30

async def _call_claude(prompt: str) -> str:
    client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    resp = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
        timeout=_LLM_TIMEOUT_S,
    )
    return resp.content[0].text.strip()

def _render_prompt(name: str, **kw) -> str:
    raw = (_PROMPTS_DIR / f"{name}.md").read_text()
    return raw.format(**kw)

def _register_llm(artifact_type):
    def decorator(fn):
        _LLM_GENERATORS[artifact_type] = fn
        return fn
    return decorator

@_register_llm("meta_title")
async def _gen_meta_title(ctx: GeneratorContext) -> ArtifactResult:
    p = ctx.page
    profile = ctx.profile
    prompt = _render_prompt(
        "meta_title",
        brand_name=ctx.brand.name,
        tone=(profile.tone_of_voice if profile else "") or "professional",
        what_not_to_say=(profile.what_not_to_say if profile else "") or "—",
        page_url=p.url if p else "—",
        page_type=p.page_type if p else "other",
        h1=(p.h1_text if p else "") or "—",
        content=(p.title or "") + "\n\n" + ("…" if not p else "")[:1500],
        regenerate_notes_block=(f"\nUSER FEEDBACK: {ctx.regenerate_notes}\n" if ctx.regenerate_notes else ""),
    )
    title = await _call_claude(prompt)
    return ArtifactResult(artifact=title, artifact_type="meta_title")
```

- [ ] **Step 4: Verify pass + commit**

```bash
pytest tests/test_artifact_meta_title.py -v
git add app/services/site_audit/prompts/artifact/meta_title.md app/services/site_audit/artifact_generator.py tests/test_artifact_meta_title.py
git commit -m "feat(site-audit): meta_title artifact generator"
```

**Tasks 14-25 follow the same shape.** For each, write a prompt template matching the table above, add a `@_register_llm` generator function (rule generators use `@_register_rule`), and a unit test that mocks `_call_claude`. Commit each individually.

Rule-based tasks 8-12 use the same shape but skip `_call_claude`. Example for `jsonld_org`:
```python
@_register_rule("jsonld_org")
async def _gen_jsonld_org(ctx: GeneratorContext) -> ArtifactResult:
    import json
    sameAs = []
    if ctx.profile and ctx.profile.publications:
        sameAs = [u.strip() for u in ctx.profile.publications.splitlines() if u.strip()]
    block = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": ctx.brand.name,
        "url": ctx.brand.website_url or "",
        "logo": f"{(ctx.brand.website_url or '').rstrip('/')}/logo.png",
    }
    if sameAs:
        block["sameAs"] = sameAs
    if ctx.profile and ctx.profile.company_description:
        block["description"] = ctx.profile.company_description
    return ArtifactResult(
        artifact=f'<script type="application/ld+json">\n{json.dumps(block, indent=2)}\n</script>',
        artifact_type="jsonld_org",
    )
```

---

## Phase 3 — Parsers, recs registry, priority score

### Task 26: priority_score computation

**Files:** Modify `backend/app/services/site_audit/recommendations.py` + `auditor.py`.

- [ ] **Step 1: Failing test** — `tests/test_site_audit_priority_score.py`:

```python
from app.services.site_audit.recommendations import compute_priority_score

def test_priority_score_high_lift_low_effort_wins():
    a = compute_priority_score(expected_lift_pp=20.0, pages_affected=10, effort_minutes=5)
    b = compute_priority_score(expected_lift_pp=2.0,  pages_affected=1,  effort_minutes=60)
    assert a > b * 10
```

- [ ] **Step 2: Implement**

```python
# recommendations.py
import math

def compute_priority_score(*, expected_lift_pp: float, pages_affected: int, effort_minutes: int) -> float:
    return (expected_lift_pp * max(pages_affected, 1)) / math.sqrt(effort_minutes + 1)
```

Wire into the rec-building flow: after a rec is created, compute and set `priority_score` from the matching `_RECS` registry entry + the number of pages this rec applies to. Persist in the existing rec-write step in `auditor.py`.

- [ ] **Step 3: Commit**

### Task 27: Recs registry — add expected_lift_pp, artifact_type, impl_steps

**Files:** Modify `backend/app/services/site_audit/recommendations.py`.

For each entry in `_RECS`, append three fields:
- `expected_lift_pp`: float — magnitude on the relevant scoring axis
- `artifact_type`: str | None — matches `ARTIFACT_TYPES`
- `impl_steps`: list[str] — numbered steps shown under the drafted artifact

Example update to `blocked_oai_searchbot`:
```python
"blocked_oai_searchbot": {
    "title": "Unblock OAI-SearchBot (ChatGPT live search)",
    "body": "…",
    "category": "bot_access",
    "priority": "high",
    "effort": "low",
    "expected_impact": "Restores ChatGPT live-search visibility",
    "expected_lift_pp": 40.0,
    "artifact_type": "robots_snippet",
    "impl_steps": [
        "Open your robots.txt at the site root.",
        "Replace any `Disallow: /` block for OAI-SearchBot with `Allow: /` from the snippet.",
        "Deploy and verify at https://yoursite.com/robots.txt.",
        "Allow 24-48 hours for ChatGPT live-search re-crawl.",
    ],
},
```

Do this for every existing entry. Walk the file end-to-end. Tests: extend `tests/test_site_audit_recommendations.py` with a coverage check:
```python
def test_all_recs_have_artifact_fields():
    from app.services.site_audit.recommendations import _RECS
    for cid, r in _RECS.items():
        assert "expected_lift_pp" in r, cid
        assert "impl_steps" in r, cid
        assert "artifact_type" in r, cid
```

Commit.

### Task 28: parsers/eeat.py

**Files:** Create `backend/app/services/site_audit/parsers/eeat.py` + `tests/test_site_audit_parsers_eeat.py`.

- [ ] **Step 1: Failing test**

```python
from bs4 import BeautifulSoup
from app.services.site_audit.parsers.eeat import parse_eeat

def test_article_missing_author_byline_emits_finding():
    soup = BeautifulSoup("<html><body><article><h1>X</h1><p>…</p></article></body></html>", "lxml")
    findings = parse_eeat(soup=soup, url="https://x/blog/y", page_type="article")
    ids = [f.check_id for f in findings]
    assert "missing_author_byline" in ids

def test_homepage_not_flagged_for_missing_author():
    soup = BeautifulSoup("<html><body><h1>X</h1></body></html>", "lxml")
    findings = parse_eeat(soup=soup, url="https://x/", page_type="homepage")
    ids = [f.check_id for f in findings]
    assert "missing_author_byline" not in ids
```

- [ ] **Step 2: Implement**

```python
# parsers/eeat.py
from __future__ import annotations
from bs4 import BeautifulSoup
from app.services.site_audit.parsers import Finding

_ARTICLE_TYPES = {"article", "post", "blog"}

def parse_eeat(*, soup: BeautifulSoup, url: str, page_type: str) -> list[Finding]:
    findings: list[Finding] = []
    if page_type not in _ARTICLE_TYPES:
        return findings
    text = soup.get_text(" ", strip=True)
    has_author = (
        soup.find(attrs={"rel": "author"}) is not None
        or soup.find(class_=lambda c: c and "byline" in c.lower()) is not None
        or soup.find("meta", attrs={"name": "author"}) is not None
    )
    if not has_author:
        findings.append(Finding(
            check_id="missing_author_byline",
            severity="medium",
            category="content",
            message="Article page has no author byline (rel='author', .byline, or <meta name='author'>).",
            evidence={},
        ))
    has_date = soup.find("time") is not None or soup.find("meta", attrs={"property": "article:published_time"}) is not None
    if not has_date:
        findings.append(Finding(
            check_id="missing_published_date",
            severity="high",
            category="content",
            message="Article has no <time> or article:published_time meta.",
            evidence={},
        ))
    word_count = len(text.split())
    if word_count >= 500:
        outbound = [a for a in soup.find_all("a", href=True) if a["href"].startswith("http") and url.split("/")[2] not in a["href"]]
        if not outbound:
            findings.append(Finding(
                check_id="missing_outbound_citations",
                severity="medium",
                category="content",
                message="Long-form article (≥500 words) has zero outbound links to other domains.",
                evidence={"word_count": word_count},
            ))
    return findings
```

- [ ] **Step 3: Verify pass + commit.**

### Task 29: parsers/linking.py

**Files:** Create `backend/app/services/site_audit/parsers/linking.py` + tests.

Operates on the full crawl result (not a single page). Signature:
```python
def parse_linking(*, pages: list[WebsiteAuditPage], root_url: str) -> dict[int, list[Finding]]:
    """Returns {page_id: [findings]}."""
```

Implementation: build adjacency from `page.links` (JSON-serialized list of in-domain URLs), compute inbound counts per URL, BFS depth from root. Emit `orphan_page`, `deep_page`, `weak_hub` findings.

Test: pages with no inbound links → `orphan_page` finding.

Commit.

### Task 30: parsers/qa.py

Similar shape — detect `<dl>/<dt>/<dd>`, FAQ schema, question H2/H3. Emit `no_qa_format`, `qa_without_schema`, `qa_thin`. Test + commit.

### Task 31: semantic.py — two new check_ids

Append to `parse_semantic` in `parsers/semantic.py`:
- `no_tables_or_lists` when long content with zero `<table>/<ol>/<ul>` (excluding nav siblings).
- `low_stats_density` when article-type page with `fact_density < 0.4 per 100 words`.

Extend `tests/test_site_audit_parsers_semantic.py`. Commit.

### Task 32: parsers/agents_md.py

Mirror `parsers/llms_txt.py` — fetch `/agents.md`, validate basic structure, emit finding when missing. Add to `auditor._run_audit_inner` alongside the existing llms.txt fetch. Test + commit.

### Task 33: Auditor calls new parsers

Modify `backend/app/services/site_audit/auditor.py:_run_audit_inner`:

After existing parser calls, add:
```python
from app.services.site_audit.parsers.eeat import parse_eeat
from app.services.site_audit.parsers.qa import parse_qa
from app.services.site_audit.parsers.linking import parse_linking
# After per-page parsing loop:
linking_findings_map = parse_linking(pages=audit_pages, root_url=root)
# Merge with per-page findings before persist:
for pid, fs in linking_findings_map.items():
    page_findings.setdefault(pid, []).extend(fs)
# Inside per-page loop, append:
findings.extend(parse_eeat(soup=soup, url=page_url, page_type=page_type))
findings.extend(parse_qa(soup=soup, url=page_url, page_type=page_type))
```

Verify integration test still passes: `pytest tests/test_site_audit_integration.py -v`.

Commit.

### Task 34: scripts/backfill_rec_metadata.py

**Files:** Create `backend/scripts/backfill_rec_metadata.py`.

```python
"""Backfill expected_lift_pp / artifact_type / priority_score on existing recs.

Idempotent: only writes when fields are NULL.
"""
import asyncio, logging
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import WebsiteAuditRecommendation
from app.services.site_audit.recommendations import _RECS, compute_priority_score

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

async def main():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(WebsiteAuditRecommendation))).scalars().all()
    n_written = 0
    for r in rows:
        # We don't store check_id on the row; infer from title→check_id via a reverse map.
        # Build reverse map keyed by exact title.
        pass
    log.info("backfill done: %d rows updated", n_written)

if __name__ == "__main__":
    asyncio.run(main())
```

Then add a reverse map (title → check_id) built from `_RECS`. The full implementation:

```python
TITLE_TO_CHECK = {meta["title"]: cid for cid, meta in _RECS.items()}

# in main:
for r in rows:
    if r.expected_lift_pp is not None and r.priority_score is not None:
        continue
    cid = TITLE_TO_CHECK.get(r.title)
    if not cid:
        continue
    meta = _RECS[cid]
    async with AsyncSessionLocal() as db:
        fresh = await db.get(WebsiteAuditRecommendation, r.id)
        if fresh.expected_lift_pp is None and "expected_lift_pp" in meta:
            fresh.expected_lift_pp = float(meta["expected_lift_pp"])
        if fresh.artifact_type is None and meta.get("artifact_type"):
            fresh.artifact_type = meta["artifact_type"]
        if fresh.priority_score is None and meta.get("expected_lift_pp") is not None:
            fresh.priority_score = compute_priority_score(
                expected_lift_pp=meta["expected_lift_pp"],
                pages_affected=1,
                effort_minutes={"low":5,"medium":20,"high":60}.get(meta.get("effort","low"),5),
            )
        await db.commit()
        n_written += 1
```

Run once: `python -m scripts.backfill_rec_metadata`. Verify counts. Commit.

---

## Phase 4 — Frontend redesign

Each task creates one component, hooks it into the page, runs `tsc --noEmit`, verifies visually in Playwright when the surface is mounted.

### Task 35: lib/grade.ts + lib/api.ts extensions

**Files:** Create `frontend/lib/grade.ts`. Modify `frontend/lib/api.ts`.

- [ ] **Step 1: Create grade helper**

```ts
// lib/grade.ts
export type GradeBand = "A"|"B+"|"B"|"B-"|"C+"|"C"|"C-"|"D"|"F";

export function scoreToGrade(score: number | null | undefined): GradeBand | "—" {
  if (score == null) return "—";
  if (score >= 90) return "A";
  if (score >= 85) return "B+";
  if (score >= 80) return "B";
  if (score >= 75) return "B-";
  if (score >= 70) return "C+";
  if (score >= 65) return "C";
  if (score >= 60) return "C-";
  if (score >= 50) return "D";
  return "F";
}

export function gradeColor(g: GradeBand | "—"): string {
  switch (g) {
    case "A":
    case "B+": return "var(--success)";
    case "B":
    case "B-": return "var(--success-text)";
    case "C+":
    case "C": return "var(--warning-text)";
    case "C-": return "var(--warning)";
    case "D": return "var(--danger-text)";
    case "F": return "var(--danger)";
    default: return "var(--text-muted)";
  }
}
```

- [ ] **Step 2: Extend api.ts**

Update `WebsiteAuditRecommendationOut` type (add 8 new fields). Extend `siteAudit` object:
```ts
draftRec: (recId: number, body?: { regenerate_notes?: string }) =>
  api.post<{artifact: string; artifact_type: string; generated_at: string; regen_count: number}>(
    `/site-audit/recommendation/${recId}/draft`, body ?? {}).then(r => r.data),
setRecStatus: (recId: number, status: 'pending'|'applied'|'dismissed') =>
  api.patch(`/site-audit/recommendation/${recId}/status`, { status }),
```

- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit `feat(site-audit): grade helper + draft/status API methods`.

### Task 36: AuditHeader component

**Files:** Create `frontend/components/site-audit/AuditHeader.tsx`.

Pure presentational. Props:
```ts
interface Props {
  audit: WebsiteAuditSummary;
  brandUrl: string;
  inFlight: boolean;
  onRunNewAudit: () => void;
}
```

Markup:
```tsx
<header className="card-elevated mb-6 flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Site Audit</h1>
    <p className="text-sm text-[var(--text-muted)] mt-1">
      {brandUrl} · Last run {formatDistanceToNow(new Date(audit.started_at))} ago
      {audit.total_pages != null && ` · ${audit.total_pages} pages`}
    </p>
  </div>
  <button
    onClick={onRunNewAudit} disabled={inFlight}
    className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium disabled:opacity-50">
    {inFlight ? 'Running…' : 'Run new audit'}
  </button>
</header>
```

Commit.

### Task 37: ScoreCard + ScoreStrip

**Files:** Create `frontend/components/site-audit/ScoreCard.tsx`, `ScoreStrip.tsx`.

ScoreCard renders one card: large grade letter, numeric below, tooltip with definition, optional sparkline. ScoreStrip arranges 5 ScoreCards (overall + 4 categories) in a grid.

```tsx
// ScoreCard.tsx
'use client';
import { motion } from 'framer-motion';
import { useCountUp } from '@/lib/motion';
import { scoreToGrade, gradeColor } from '@/lib/grade';
import HelpTooltip from '@/components/dashboard/HelpTooltip';

interface Props { label: string; score: number | null; explanation: string; emphasis?: boolean; }
export function ScoreCard({ label, score, explanation, emphasis }: Props) {
  const grade = scoreToGrade(score);
  const numeric = useCountUp(score ?? 0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`${emphasis ? 'card-elevated' : 'card card-hover'} flex flex-col items-center justify-center`}>
      <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] flex items-center">
        {label} <HelpTooltip text={explanation} />
      </p>
      <p className={`mt-2 font-bold tabular-nums leading-none ${emphasis ? 'text-5xl' : 'text-3xl'}`}
         style={{ color: gradeColor(grade) }}>
        {grade}
      </p>
      <p className="text-xs text-[var(--text-faint)] mt-1 tabular-nums">{score != null ? numeric : '—'}/100</p>
    </motion.div>
  );
}
```

ScoreStrip wraps 5 of them. Commit.

### Tasks 38-58 (frontend)

Follow the same shape as 35-37: per component, write the TSX matching the spec's mockups, run `tsc --noEmit`, commit. Skipping verbatim listing because each is short and follows the pattern. The exact list (in build order):

| Task | Component | Notes |
|------|-----------|-------|
| 38 | `FixCard.tsx` (state A) | Collapsed card, framer-motion `layout` |
| 39 | `FixCard.tsx` (state B) | Drafting skeleton with shimmer; calls `siteAudit.draftRec` |
| 40 | `FixCard.tsx` (state C) | Drafted artifact display; embeds `FixCardCodeBlock` |
| 41 | `FixCardCodeBlock.tsx` | Monospace `<pre>`, copy button, syntax highlight (Shiki dynamic import) |
| 42 | `FixCardImplSteps.tsx` | Numbered ol from `rec.impl_steps` (new field from registry; needs API to expose it) |
| 43 | `RegenPopover.tsx` | Inline popover with textarea + cancel/regenerate buttons |
| 44 | `FixCard` actions | Mark applied / dismiss → PATCH status + slide-out animation |
| 45 | `OverviewHero.tsx` | Top 5 ranked FixCards w/ stagger animation; "See all" deep-link |
| 46 | `HistorySparkline.tsx` | Sparkline of last 5 audits' overall_score |
| 47 | `RenderModeBanner.tsx` | Conditional warning banner if homepage is JS-rendered |
| 48 | `FixFilters.tsx` | Category / priority / status chips + search input; URL-state |
| 49 | `FixGrid.tsx` | List of FixCards under Fixes tab w/ filters |
| 50 | `PageTable.tsx` | Sortable page table — replaces `PageList.tsx` |
| 51 | `PageDetail.tsx` (re-skin) | Replace generic borders with `.card` classes; embed FixCards |
| 52 | `SchemaMatrix.tsx` | Recharts heatmap: page-type × schema-type |
| 53 | `BotGrid.tsx` | 10 bot rows w/ status + tooltip |
| 54 | `FilesStatusRow.tsx` | llms.txt / robots.txt / agents.md status + "Generate" CTA |
| 55 | `SchemaAndBotsTab.tsx` | Stacks SchemaMatrix + BotGrid + FilesStatusRow |
| 56 | `CitationStackedBar.tsx` | Recharts horizontal stacked bar |
| 57 | `CitationTopDomains.tsx` | Top 10 list w/ model chips |
| 58 | `AuditHistoryList.tsx` | Per-audit row w/ delta arrows |
| 59 | `CitationsTab.tsx` | Stacks the 3 above |
| 60 | `SiteAuditView.tsx` (refactor) | Orchestrator only; uses new tab IDs; URL-driven |
| 61 | `AuditTriggerButton.tsx` (restyle) | Match new design language |

For each: TSX inline (don't read parent first if not editing it), `tsc --noEmit` clean, commit with `feat(site-audit): <component>`.

---

## Phase 5 — Verification + cleanup

### Task 62: Delete obsolete components

```bash
cd frontend && rm components/site-audit/{BotAccessPanel,LlmsTxtPanel,GeneratorsCard,CitationDomainList,RecommendationsList,PageList}.tsx
npx tsc --noEmit  # must pass
git add -u components/site-audit
git commit -m "chore(site-audit): drop components replaced by fix-factory redesign"
```

### Task 63: Backend test suite

```bash
cd backend && source venv/bin/activate && pytest tests/test_site_audit_* -v
```

Expected: all green. Fix any regressions.

### Task 64: Playwright smoke test

Add `tests/test_site_audit_integration.py::test_draft_flow_endtoend`:
- Trigger audit on a fixture (existing test pattern)
- Wait for completed
- Pick the highest-priority rec with `artifact_type=jsonld_org`
- POST `/draft` with mocked Claude
- Assert artifact persisted on the row
- PATCH `/status` to "applied"
- Assert subsequent `latest` summary doesn't include this rec in top-5

Commit.

### Task 65: Manual UI verification

1. Start backend (port 3001) + frontend (port 3002).
2. Login as ken@lumidian.ai.
3. Open `/site-audit/4` (Rhythm). Verify:
   - Header strip shows "Last run …"
   - Overview hero shows 5 FixCards
   - Score strip shows 5 letter grades
   - Click "Draft this" on a JSON-LD rec → artifact renders → Copy works → Mark applied removes it
   - Tab through Fixes / Pages / Schema & Bots / Citations — each renders w/ new styling
4. No console errors. No `border rounded-md` plain Tailwind on any surface.

### Task 66: CURRENT_STATE.md + commit

Update CURRENT_STATE.md sections: bump "Last updated", replace "Recently Changed" with the site-audit redesign summary, add a 2026-05-12 Recent Decisions entry.

Commit + tag the branch tip for review.

---

## Self-Review

**1. Spec coverage:**
- Architecture diagrams → Phase 1 (backend) + Phase 4 (frontend) tasks
- Fix card 3 states → Tasks 38-44
- Score contextualization → Tasks 35-37
- 4 new parsers → Tasks 28-31
- Artifact types (16 total) → Tasks 8-25
- Tier gating → Task 7
- Motion (table in spec) → distributed across Tasks 37, 38, 44, 45
- Acceptance criteria → Task 65 (manual) + Task 64 (Playwright)
- Migration → Task 1
- Backfill script → Task 34

**2. Placeholder scan:** Tasks 8-25 (artifact generators) are batched with one fully-spelled example (Task 13) + a table of variations. Per the writing-plans rule, the executor must write each prompt + generator + test individually — the example shows the exact pattern. No "TBD" / "TODO" anywhere; every step has commands.

**3. Type consistency:** `WebsiteAuditRecommendationOut` extended consistently across schemas.py (Task 2), api.ts (Task 35), and FixCard usage (Task 38+). `GeneratorContext` defined in Task 6 used by all generator tasks. `ArtifactResult` defined in Task 3, used everywhere.

---

## Execution Handoff

The user has explicitly asked for thorough execution without further questions. Proceeding with **subagent-driven execution** (recommended) — fresh subagent per task with review between tasks. Plan is too large for inline batch execution to remain coherent.
