# Content Clusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing per-prompt one-off draft generation with a coordinated `ContentCluster` system — 5 cross-affirming platform pieces (LinkedIn, Medium, Reddit, Quora, X) per prompt, generated from a shared `ContentBrief`, with an optional tone-gated own-site pillar. Wikipedia is carved out into its own placeholder tab.

**Architecture:** Brief-first parallel pipeline. Step 1: one LLM call produces a `ContentBrief` row (positioning, canonical phrasings, stats, narrative spine) from BrandProfile + prompt + recent TrackingRun + site-audit data. Step 2: five parallel piece-generation calls reuse the existing `drafting/prompts.py:build_prompt()` augmented with a brief context block. Step 3 (optional): pillar candidate proposal via site-audit page lookup + LLM tone gate, surfaced for explicit user acceptance.

**Tech Stack:** Python 3.11 / FastAPI 0.115 / SQLAlchemy 2.0 (async) / pytest-asyncio (backend). Next.js 15 / React 18 / TypeScript / Tailwind / Radix (frontend). All cluster LLM calls reuse the existing `app/services/drafting/client.py:call_claude(prompt, max_tokens, model)` helper (Claude-only). Brief + tone gate use `claude-haiku-4-5-20251001`. Piece generation uses haiku for all tiers except Pro, which gets `claude-sonnet-4-6`. Introducing a multi-provider draft client is out of scope for this plan.

**Reference:** [`docs/superpowers/specs/2026-05-11-content-clusters-design.md`](../specs/2026-05-11-content-clusters-design.md)

---

## Working Conventions

- **Branch:** `feat/content-quality-rebuild` (already checked out — spec lives here at commit `3dba722`).
- **Backend tests:** TDD, write failing test first, run with `cd backend && source venv/bin/activate && pytest tests/<file>.py::<test_name> -v`.
- **Frontend:** no test suite (per CLAUDE.md). Frontend tasks are: write component → manually verify in dev (`npm run dev` on port 3002, backend on port 3001) → commit.
- **Commits:** small and frequent. Use `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` footer.
- **Async-first:** every DB call uses `async/await` with `AsyncSessionLocal`.
- **Migrations:** new step appended to `database.py:run_migrations()` — never modify existing steps.

---

## File Structure

### Backend — created

| File | Responsibility |
|---|---|
| `backend/app/services/clustering_service.py` | Orchestrator: `regenerate_cluster()`, `regenerate_piece()`, `propose_pillar()` |
| `backend/app/services/cluster_brief.py` | Brief generation: `build_brief()` (1 LLM call, parses to `ContentBrief` row) |
| `backend/app/services/cluster_pillar.py` | Pillar candidate selection + LLM tone gate |
| `backend/app/routers/clusters.py` | 7 endpoints under `/api/clusters/*` |
| `backend/tests/test_cluster_models.py` | ORM model + migration tests |
| `backend/tests/test_cluster_brief.py` | Brief generation tests (mocked LLM) |
| `backend/tests/test_cluster_pillar.py` | Pillar gate tests |
| `backend/tests/test_clustering_service.py` | Orchestrator integration tests |
| `backend/tests/test_cluster_routes.py` | Router endpoint tests |

### Backend — modified

| File | What changes |
|---|---|
| `backend/app/models.py` | Add `ContentCluster`, `ContentBrief` classes; add `cluster_id` column to `ContentDraft` |
| `backend/app/database.py` | Append migration step (create 2 tables, add 1 column, clean-slate delete unposted drafts) |
| `backend/app/schemas.py` | Add Pydantic schemas: `ContentClusterSummary`, `ContentClusterDetail`, `ContentBriefSchema`, `PillarCandidateSchema`, `RegeneratePieceRequest`, `EditBriefRequest` |
| `backend/app/main.py` | Mount `clusters_router` |
| `backend/app/services/drafting/prompts.py` | Extend `build_prompt()` to accept optional `brief_context` block |
| `backend/app/routers/content.py` | `generate_now` endpoint routes through clustering service for non-Wikipedia platforms |

### Frontend — created

| File | Responsibility |
|---|---|
| `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` | Cluster detail route |
| `frontend/components/content/cluster/ClusterCard.tsx` | Card for cluster list |
| `frontend/components/content/cluster/ClusterDetailView.tsx` | Layout: BriefPanel + 5 PieceCards + optional PillarCard |
| `frontend/components/content/cluster/BriefPanel.tsx` | Collapsed/expandable brief view + inline edit |
| `frontend/components/content/cluster/PieceCard.tsx` | Per-platform piece card (Approve / Regenerate / Mark posted / Delete) |
| `frontend/components/content/cluster/PillarCard.tsx` | Pillar candidate card with Accept / Reject |
| `frontend/components/content/wikipedia/WikipediaTab.tsx` | Placeholder tab — list of topics + "coming soon" card |
| `frontend/components/content/wikipedia/TopicsList.tsx` | Topic list derived from BrandProfile + prompts |

### Frontend — modified

| File | What changes |
|---|---|
| `frontend/lib/api.ts` | Add `clusters` API group + types |
| `frontend/app/content/[brandId]/page.tsx` | Refactor into tabbed layout (Clusters default · Opportunities · Wikipedia · Gaps) |

### Docs — modified

| File | What changes |
|---|---|
| `CLAUDE.md` | Add ContentCluster/ContentBrief to models table; add cluster routes; note brief generation in LLM concurrency section |
| `CURRENT_STATE.md` | Update "Current Task / WIP" and "Recent Decisions" |

---

## Task 1: ORM models for ContentCluster and ContentBrief

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_cluster_models.py` (create)

- [ ] **Step 1.1: Write failing model test**

Create `backend/tests/test_cluster_models.py`:

```python
"""Tests for ContentCluster and ContentBrief models."""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
    User,
)


@pytest.mark.asyncio
async def test_content_cluster_creation(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-1", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    cluster = ContentCluster(
        brand_id=brand.id,
        prompt_id=prompt.id,
        status="pending",
        pillar_mode="none",
        version=1,
    )
    db_session.add(cluster)
    await db_session.flush()

    assert cluster.id is not None
    assert cluster.status == "pending"
    assert cluster.pillar_mode == "none"
    assert cluster.pillar_url is None
    assert cluster.last_brief_id is None
    assert cluster.version == 1


@pytest.mark.asyncio
async def test_one_cluster_per_prompt_unique(db_session: AsyncSession, registered_user: User) -> None:
    """A prompt can only have one cluster."""
    brand = Brand(name="Acme", slug="acme-2", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    db_session.add(ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready"))
    await db_session.commit()

    db_session.add(ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready"))
    with pytest.raises(Exception):  # IntegrityError; SQLite raises generic
        await db_session.commit()


@pytest.mark.asyncio
async def test_content_brief_creation(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-3", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.flush()

    brief = ContentBrief(
        cluster_id=cluster.id,
        version=1,
        positioning="Position Acme as the leader in X",
        key_claims=["Claim 1", "Claim 2"],
        canonical_phrasings=["Acme tracks X across Y"],
        stats=[{"label": "users", "value": "10k", "source": "internal"}],
        competitor_context={"top": ["Foo", "Bar"]},
        narrative_spine="Through-line text",
        tone_notes="Confident, technical",
        created_by="system",
    )
    db_session.add(brief)
    await db_session.flush()

    assert brief.id is not None
    assert brief.key_claims == ["Claim 1", "Claim 2"]
    assert brief.stats[0]["label"] == "users"


@pytest.mark.asyncio
async def test_content_draft_cluster_id_nullable(db_session: AsyncSession, registered_user: User) -> None:
    """cluster_id is nullable so posted drafts can be retained after migration."""
    brand = Brand(name="Acme", slug="acme-4", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()

    draft = ContentDraft(
        brand_id=brand.id,
        prompt_id=prompt.id,
        platform="linkedin",
        status="draft",
        title="Title",
        content_text="Body",
        source="manual",
        cluster_id=None,
    )
    db_session.add(draft)
    await db_session.flush()
    assert draft.id is not None
    assert draft.cluster_id is None
```

- [ ] **Step 1.2: Run test, expect ImportError**

```bash
cd backend && source venv/bin/activate
pytest tests/test_cluster_models.py -v
```

Expected: 4 errors — `ImportError: cannot import name 'ContentCluster'` (and ContentBrief).

- [ ] **Step 1.3: Add models to `backend/app/models.py`**

Add after the `ContentDraft` class:

```python
class ContentCluster(Base):
    __tablename__ = "content_clusters"
    __table_args__ = (UniqueConstraint("prompt_id", name="uq_content_clusters_prompt_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    prompt_id: Mapped[int] = mapped_column(ForeignKey("prompts.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    pillar_mode: Mapped[str] = mapped_column(String(32), default="none")
    pillar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    last_brief_id: Mapped[int | None] = mapped_column(ForeignKey("content_briefs.id", ondelete="SET NULL"), nullable=True)
    version: Mapped[int] = mapped_column(default=1)
    last_generated_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))


class ContentBrief(Base):
    __tablename__ = "content_briefs"

    id: Mapped[int] = mapped_column(primary_key=True)
    cluster_id: Mapped[int] = mapped_column(ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(default=1)
    positioning: Mapped[str] = mapped_column(Text, default="")
    key_claims: Mapped[list] = mapped_column(JSON, default=list)
    canonical_phrasings: Mapped[list] = mapped_column(JSON, default=list)
    stats: Mapped[list] = mapped_column(JSON, default=list)
    competitor_context: Mapped[dict] = mapped_column(JSON, default=dict)
    narrative_spine: Mapped[str] = mapped_column(Text, default="")
    tone_notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
```

Add to the `ContentDraft` class, after the existing columns:

```python
    cluster_id: Mapped[int | None] = mapped_column(ForeignKey("content_clusters.id", ondelete="SET NULL"), nullable=True, index=True)
```

Ensure imports at the top include `UniqueConstraint`, `Text`, `JSON`, `ForeignKey`. They are already present — verify with grep.

- [ ] **Step 1.4: Run test, expect failure due to missing tables**

```bash
pytest tests/test_cluster_models.py -v
```

Expected: 4 failures — `sqlalchemy.exc.OperationalError: no such table: content_clusters`. Migration is needed next.

- [ ] **Step 1.5: Commit**

```bash
git add backend/app/models.py backend/tests/test_cluster_models.py
git commit -m "$(cat <<'EOF'
feat(clusters): add ContentCluster and ContentBrief ORM models

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Database migration step

**Files:**
- Modify: `backend/app/database.py`

- [ ] **Step 2.1: Read the bottom of `database.py` to find the migration anchor**

```bash
grep -n "MIGRATION\|run_migrations" backend/app/database.py | tail -5
```

The file already has a `run_migrations()` function. Migration steps are appended at the bottom.

- [ ] **Step 2.2: Append the migration step**

Add to `run_migrations()` after the last existing migration block:

```python
    # --- Migration: content clusters (2026-05-12) ---
    async with engine.begin() as conn:
        # Create content_clusters table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS content_clusters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                prompt_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                pillar_mode TEXT NOT NULL DEFAULT 'none',
                pillar_url TEXT,
                last_brief_id INTEGER,
                version INTEGER NOT NULL DEFAULT 1,
                last_generated_at DATETIME,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
                FOREIGN KEY (last_brief_id) REFERENCES content_briefs(id) ON DELETE SET NULL,
                UNIQUE (prompt_id)
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_clusters_brand_id ON content_clusters (brand_id)"))

        # Create content_briefs table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS content_briefs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                positioning TEXT NOT NULL DEFAULT '',
                key_claims JSON NOT NULL DEFAULT '[]',
                canonical_phrasings JSON NOT NULL DEFAULT '[]',
                stats JSON NOT NULL DEFAULT '[]',
                competitor_context JSON NOT NULL DEFAULT '{}',
                narrative_spine TEXT NOT NULL DEFAULT '',
                tone_notes TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT 'system',
                created_at DATETIME NOT NULL,
                FOREIGN KEY (cluster_id) REFERENCES content_clusters(id) ON DELETE CASCADE
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_briefs_cluster_id ON content_briefs (cluster_id)"))

        # Add cluster_id column to content_drafts (idempotent: PRAGMA check)
        result = await conn.execute(text("PRAGMA table_info(content_drafts)"))
        cols = {row[1] for row in result.fetchall()}
        if "cluster_id" not in cols:
            await conn.execute(text("ALTER TABLE content_drafts ADD COLUMN cluster_id INTEGER REFERENCES content_clusters(id) ON DELETE SET NULL"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_drafts_cluster_id ON content_drafts (cluster_id)"))

        # Clean-slate: delete all unposted ContentDraft rows.
        # Drafts referenced by ContentPost or DraftAttribution are retained with cluster_id NULL.
        await conn.execute(text("""
            DELETE FROM content_drafts
            WHERE id NOT IN (SELECT draft_id FROM content_posts)
              AND id NOT IN (SELECT draft_id FROM draft_attributions)
        """))
```

- [ ] **Step 2.3: Run the model tests again, expect pass**

```bash
pytest tests/test_cluster_models.py -v
```

Expected: 4 tests pass. The conftest test DB now sees the new tables and columns because `run_migrations()` runs in test setup.

- [ ] **Step 2.4: Commit**

```bash
git add backend/app/database.py
git commit -m "$(cat <<'EOF'
feat(clusters): migration — create cluster tables + clean-slate delete

Adds content_clusters and content_briefs tables, adds cluster_id to
content_drafts, and deletes all unposted drafts. Posted drafts (with
ContentPost or DraftAttribution refs) are retained with cluster_id null.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pydantic schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 3.1: Add schemas to `backend/app/schemas.py`**

Append at the bottom of the file:

```python
# ----- Content Clusters -----

class ContentBriefSchema(BaseModel):
    id: int
    cluster_id: int
    version: int
    positioning: str
    key_claims: list[str]
    canonical_phrasings: list[str]
    stats: list[dict]
    competitor_context: dict
    narrative_spine: str
    tone_notes: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClusterPieceSummary(BaseModel):
    platform: str
    draft_id: int | None
    status: str  # draft / approved / posted / failed / missing
    title: str | None
    excerpt: str | None  # first 140 chars of content_text


class ContentClusterSummary(BaseModel):
    """Compact representation for the cluster list view."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    pieces: list[ClusterPieceSummary]
    version: int
    last_generated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ContentClusterDetail(BaseModel):
    """Full cluster — brief + drafts (existing ContentDraftSchema)."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    brief: ContentBriefSchema | None
    drafts: list["ContentDraftSchema"]
    version: int
    last_generated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class PillarCandidateSchema(BaseModel):
    page_id: int
    url: str
    title: str | None
    tone_score: float  # 0..1, higher = less promotional
    tone_reasoning: str


class RegeneratePieceRequest(BaseModel):
    platform: str  # must be one of: linkedin, medium, reddit, quora, x


class EditBriefRequest(BaseModel):
    positioning: str | None = None
    key_claims: list[str] | None = None
    canonical_phrasings: list[str] | None = None
    stats: list[dict] | None = None
    narrative_spine: str | None = None
    tone_notes: str | None = None
```

- [ ] **Step 3.2: Verify schemas import cleanly**

```bash
cd backend && source venv/bin/activate
python -c "from app.schemas import ContentClusterDetail, ContentClusterSummary, ContentBriefSchema, PillarCandidateSchema, EditBriefRequest, RegeneratePieceRequest; print('ok')"
```

Expected output: `ok`

- [ ] **Step 3.3: Commit**

```bash
git add backend/app/schemas.py
git commit -m "$(cat <<'EOF'
feat(clusters): add cluster Pydantic schemas

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Brief generation service

**Files:**
- Create: `backend/app/services/cluster_brief.py`
- Test: `backend/tests/test_cluster_brief.py`

- [ ] **Step 4.1: Write failing brief test**

Create `backend/tests/test_cluster_brief.py`:

```python
"""Tests for cluster_brief service."""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, BrandProfile, ContentCluster, Prompt, User
from app.services.cluster_brief import build_brief

SAMPLE_LLM_JSON = """{
  "positioning": "Position Acme as the canonical source for brand-tracking-on-LLMs",
  "key_claims": ["Tracks 4 LLM providers", "Manual posting only"],
  "canonical_phrasings": ["Acme tracks brand visibility across ChatGPT, Claude, Perplexity, and Gemini"],
  "stats": [{"label": "models", "value": "4", "source": "internal"}],
  "narrative_spine": "Most brands don't know how they show up in AI answers.",
  "tone_notes": "Confident, technical, no hype."
}"""


@pytest.mark.asyncio
async def test_build_brief_writes_row_with_llm_output(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b1", user_id=registered_user.id, website_url="https://acme.example")
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLMs", tone_of_voice="confident"))
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="How is my brand cited by ChatGPT?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_LLM_JSON)):
        brief = await build_brief(db_session, cluster=cluster, tier=None)

    assert brief.cluster_id == cluster.id
    assert brief.positioning.startswith("Position Acme")
    assert "Acme tracks brand visibility" in brief.canonical_phrasings[0]
    assert brief.key_claims == ["Tracks 4 LLM providers", "Manual posting only"]
    assert brief.stats[0]["value"] == "4"
    assert brief.created_by == "system"


@pytest.mark.asyncio
async def test_build_brief_handles_malformed_llm_output(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b2", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value="not json at all")):
        brief = await build_brief(db_session, cluster=cluster, tier=None)

    # Falls back to a templated minimal brief — no crash, sane defaults.
    assert brief.positioning != ""
    assert isinstance(brief.key_claims, list)
    assert isinstance(brief.canonical_phrasings, list)


@pytest.mark.asyncio
async def test_build_brief_increments_version(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b3", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_LLM_JSON)):
        first = await build_brief(db_session, cluster=cluster, tier=None)
        second = await build_brief(db_session, cluster=cluster, tier=None)

    assert first.version == 1
    assert second.version == 2
```

- [ ] **Step 4.2: Run test, expect ImportError**

```bash
pytest tests/test_cluster_brief.py -v
```

Expected: 3 failures — `ImportError: cannot import name 'build_brief'`.

- [ ] **Step 4.3: Create `backend/app/services/cluster_brief.py`**

```python
"""Generate a ContentBrief from BrandProfile + prompt + recent run + site audit data."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BrandProfile,
    Competitor,
    CompetitorMention,
    ContentBrief,
    ContentCluster,
    Prompt,
    TrackingRun,
)
from app.services.drafting.client import call_claude

logger = logging.getLogger(__name__)

_BRIEF_TEMPLATE = """You are a senior content strategist producing a structured brief that powers cross-platform content. Output strict JSON only — no prose, no markdown fences.

Build a content brief for one tracked prompt.

BRAND: {brand_name}
PROMPT TO TARGET: "{prompt_text}"
CURRENT VISIBILITY: {visibility_pct:.1f}% of AI answers mention {brand_name} for this prompt.

BRAND PROFILE:
{profile_block}

COMPETITORS WINNING THIS PROMPT (mentions count, most recent run):
{competitor_block}

OUTPUT a single JSON object with these exact keys:
{{
  "positioning": "<1-2 sentences — the angle this cluster takes>",
  "key_claims": ["<3-6 short claims the cluster supports>"],
  "canonical_phrasings": ["<3-5 short phrases that should appear verbatim across pieces — these are the entity-binding strings>"],
  "stats": [{{"label": "<short>", "value": "<exact figure>", "source": "<where it comes from>"}}],
  "narrative_spine": "<1-3 sentences — the through-line that holds the cluster together>",
  "tone_notes": "<1-2 sentences derived from brand tone of voice + what not to say>"
}}

Rules:
- Use only facts present in BRAND PROFILE. Never invent stats or claims.
- canonical_phrasings must each be 6-14 words, neutral-voiced, must include {brand_name} or a clear noun phrase identifying it.
- key_claims must be defensible from BRAND PROFILE alone.
- Output strict JSON. No markdown fences. No commentary."""


async def _call_llm(prompt: str, tier: str | None) -> str:
    """Wrap the existing call_claude client. Returns raw string.

    The existing drafting client only supports Claude. We use haiku across all tiers
    for brief generation — it's a structured, low-creativity task and the cost
    delta vs gpt-4o-mini is small. Adding a multi-provider abstraction is out of
    scope for this plan.
    """
    return (await call_claude(prompt=prompt, max_tokens=1200, model="claude-haiku-4-5-20251001")).strip()


async def _build_profile_block(db: AsyncSession, brand_id: int) -> tuple[str, str]:
    """Returns (brand_name, formatted_profile_block)."""
    from app.models import Brand
    brand_row = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one()
    profile_row = (await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))).scalar_one_or_none()
    parts = [f"Name: {brand_row.name}"]
    if profile_row:
        if profile_row.company_description:
            parts.append(f"Description: {profile_row.company_description}")
        if profile_row.key_stats:
            parts.append(f"Key stats: {profile_row.key_stats}")
        if profile_row.tone_of_voice:
            parts.append(f"Tone of voice: {profile_row.tone_of_voice}")
        if profile_row.what_not_to_say:
            parts.append(f"What not to say: {profile_row.what_not_to_say}")
        if profile_row.approved_language:
            parts.append(f"Approved language: {profile_row.approved_language}")
        if profile_row.target_audience:
            parts.append(f"Target audience: {profile_row.target_audience}")
    return brand_row.name, "\n".join(parts)


async def _competitor_block(db: AsyncSession, brand_id: int, prompt_id: int) -> str:
    """Top 3 competitors winning this prompt across the most recent tracking run."""
    latest_run = (await db.execute(
        select(TrackingRun).where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed").order_by(desc(TrackingRun.id)).limit(1)
    )).scalar_one_or_none()
    if not latest_run:
        return "  (no recent run data)"
    rows = (await db.execute(
        select(Competitor.name, CompetitorMention.model)
        .join(CompetitorMention, CompetitorMention.competitor_id == Competitor.id)
        .where(CompetitorMention.tracking_run_id == latest_run.id, CompetitorMention.prompt_id == prompt_id, CompetitorMention.mentioned.is_(True))
    )).all()
    if not rows:
        return "  (no competitor mentions on this prompt)"
    from collections import Counter
    counts = Counter(name for name, _ in rows)
    return "\n".join(f"  - {name} ({n} model mentions)" for name, n in counts.most_common(3))


def _parse_llm_json(raw: str) -> dict:
    """Tolerant JSON parser — strips fences and extra prose."""
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s
        s = s.lstrip("json").strip()
        s = s.split("```")[0].strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        logger.warning("Brief LLM returned malformed JSON: %s", raw[:200])
        return {}


def _safe(data: dict, key: str, default):
    val = data.get(key)
    if val is None:
        return default
    if isinstance(default, list) and not isinstance(val, list):
        return default
    if isinstance(default, str) and not isinstance(val, str):
        return default
    return val


async def build_brief(db: AsyncSession, cluster: ContentCluster, tier: str | None) -> ContentBrief:
    """Produce a ContentBrief row for the given cluster. Persists and returns."""
    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_name, profile_block = await _build_profile_block(db, cluster.brand_id)
    competitor_block = await _competitor_block(db, cluster.brand_id, cluster.prompt_id)

    # Visibility for the prompt (existing helper would be more accurate; templated for plan)
    from app.services.drafting_service import _get_prompt_visibility
    visibility_pct = await _get_prompt_visibility(db, prompt_row.id)

    user_prompt = _BRIEF_TEMPLATE.format(
        brand_name=brand_name,
        prompt_text=prompt_row.text,
        visibility_pct=visibility_pct,
        profile_block=profile_block,
        competitor_block=competitor_block,
    )

    raw = await _call_llm(user_prompt, tier=tier)
    data = _parse_llm_json(raw)

    # Compute next version
    existing_versions = (await db.execute(
        select(ContentBrief.version).where(ContentBrief.cluster_id == cluster.id)
    )).scalars().all()
    next_version = (max(existing_versions) + 1) if existing_versions else 1

    brief = ContentBrief(
        cluster_id=cluster.id,
        version=next_version,
        positioning=_safe(data, "positioning", f"Position {brand_name} as the canonical source for: {prompt_row.text}"),
        key_claims=_safe(data, "key_claims", []),
        canonical_phrasings=_safe(data, "canonical_phrasings", [f"{brand_name} is known for accuracy in this space."]),
        stats=_safe(data, "stats", []),
        competitor_context={"raw": competitor_block},
        narrative_spine=_safe(data, "narrative_spine", ""),
        tone_notes=_safe(data, "tone_notes", ""),
        created_by="system",
        created_at=datetime.now(UTC),
    )
    db.add(brief)
    await db.flush()

    cluster.last_brief_id = brief.id
    await db.commit()
    return brief
```

- [ ] **Step 4.4: Run test, expect pass**

```bash
pytest tests/test_cluster_brief.py -v
```

Expected: 3 passes.

- [ ] **Step 4.5: Commit**

```bash
git add backend/app/services/cluster_brief.py backend/tests/test_cluster_brief.py
git commit -m "$(cat <<'EOF'
feat(clusters): brief generation service with tolerant JSON parsing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extend `build_prompt()` to accept a brief context block

**Files:**
- Modify: `backend/app/services/drafting/prompts.py`
- Test: `backend/tests/test_drafting_prompts_brief.py` (create)

- [ ] **Step 5.1: Write failing test**

Create `backend/tests/test_drafting_prompts_brief.py`:

```python
"""Tests for build_prompt() brief context block."""
from app.services.drafting.prompts import build_prompt


def _spec() -> dict:
    return {
        "format": "post",
        "tone": "professional",
        "word_range": (150, 300),
        "rules": ["Be concise.", "No CTAs."],
    }


def test_build_prompt_without_brief_context_unchanged() -> None:
    out = build_prompt(
        brand_name="Acme",
        platform="linkedin",
        prompt_text="What is X?",
        visibility_pct=42.0,
        profile_context="Name: Acme",
        response_analysis="Competitors win",
        platform_spec=_spec(),
    )
    assert "CLUSTER BRIEF" not in out


def test_build_prompt_with_brief_includes_cluster_section() -> None:
    brief_ctx = """POSITIONING: Acme is the leader.
CANONICAL PHRASINGS (use at least 1 verbatim):
  - Acme tracks X across Y
KEY CLAIMS:
  - Claim 1
SIBLING PLATFORMS in this cluster (reference by platform name, not URL):
  - medium, reddit, quora, x"""

    out = build_prompt(
        brand_name="Acme",
        platform="linkedin",
        prompt_text="What is X?",
        visibility_pct=42.0,
        profile_context="Name: Acme",
        response_analysis="Competitors win",
        platform_spec=_spec(),
        brief_context=brief_ctx,
    )
    assert "CLUSTER BRIEF" in out
    assert "Acme tracks X across Y" in out
    assert "SIBLING PLATFORMS" in out
```

- [ ] **Step 5.2: Run test, expect failure**

```bash
pytest tests/test_drafting_prompts_brief.py -v
```

Expected: 1 pass (without brief unchanged), 1 failure (build_prompt does not accept brief_context).

- [ ] **Step 5.3: Update `build_prompt()` signature in `backend/app/services/drafting/prompts.py`**

Find the signature at line 120 and add a new keyword arg + new section. Replace:

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
) -> str:
```

with:

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
    brief_context: str | None = None,
) -> str:
```

Then immediately before `return f"""You are a senior content strategist...` add:

```python
    cluster_section = ""
    if brief_context:
        cluster_section = f"""
CLUSTER BRIEF (this content is part of a coordinated cross-platform cluster — adhere strictly):
{brief_context}

CLUSTER RULES (in addition to all other rules below):
  - Include at least one CANONICAL PHRASING verbatim or near-verbatim.
  - Weave in 1-2 of the KEY CLAIMS, framed naturally for {platform}.
  - You may reference sibling platforms semantically (e.g. "we dug deeper on Medium"), but never invent URLs.
  - Maintain the narrative spine without restating it verbatim.
  - Do not open with the brand name. Do not include CTAs. Maintain practitioner voice — the brand is mentioned as a fact, not a pitch.
"""
```

Then insert `{cluster_section}` in the return f-string immediately before the `PLATFORM:` line:

```python
    return f"""You are a senior content strategist writing on behalf of a brand. ... (existing text)

WHAT AI SYSTEMS ARE CURRENTLY SAYING:
{response_analysis}
{opportunity_section}{existing_section}{cluster_section}
PLATFORM: {platform}
... (rest unchanged)
"""
```

- [ ] **Step 5.4: Run test, expect pass**

```bash
pytest tests/test_drafting_prompts_brief.py -v
```

Expected: 2 passes.

- [ ] **Step 5.5: Commit**

```bash
git add backend/app/services/drafting/prompts.py backend/tests/test_drafting_prompts_brief.py
git commit -m "$(cat <<'EOF'
feat(clusters): build_prompt() accepts optional cluster brief context

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pillar candidate proposal + tone gate

**Files:**
- Create: `backend/app/services/cluster_pillar.py`
- Test: `backend/tests/test_cluster_pillar.py`

- [ ] **Step 6.1: Write failing test**

Create `backend/tests/test_cluster_pillar.py`:

```python
"""Tests for cluster_pillar service."""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentCluster,
    Prompt,
    User,
    WebsiteAudit,
    WebsiteAuditPage,
)
from app.services.cluster_pillar import propose_pillar


async def _setup_cluster_with_audit_page(db: AsyncSession, user: User, prompt_text: str = "What is X?"):
    brand = Brand(name="Acme", slug=f"acme-p-{user.id}", user_id=user.id, website_url="https://acme.example")
    db.add(brand)
    await db.flush()
    prompt = Prompt(brand_id=brand.id, text=prompt_text, prompt_type="standard")
    db.add(prompt)
    await db.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db.add(cluster)
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db.add(audit)
    await db.flush()
    page = WebsiteAuditPage(
        audit_id=audit.id,
        url="https://acme.example/blog/x",
        title="A guide to X",
        page_type="blog",
        depth=1,
        http_status=200,
        word_count=900,
    )
    db.add(page)
    await db.commit()
    return cluster, page


@pytest.mark.asyncio
async def test_propose_pillar_returns_candidate_when_page_passes_tone_gate(db_session: AsyncSession, registered_user: User) -> None:
    cluster, page = await _setup_cluster_with_audit_page(db_session, registered_user)

    with patch(
        "app.services.cluster_pillar._score_tone",
        new=AsyncMock(return_value=(0.85, "Neutral and informative.")),
    ):
        candidate = await propose_pillar(db_session, cluster)

    assert candidate is not None
    assert candidate.page_id == page.id
    assert candidate.tone_score == 0.85
    assert "Neutral" in candidate.tone_reasoning


@pytest.mark.asyncio
async def test_propose_pillar_returns_none_when_no_pages(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-p-empty", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.commit()

    candidate = await propose_pillar(db_session, cluster)
    assert candidate is None


@pytest.mark.asyncio
async def test_propose_pillar_returns_none_when_tone_gate_fails(db_session: AsyncSession, registered_user: User) -> None:
    cluster, _page = await _setup_cluster_with_audit_page(db_session, registered_user)

    with patch(
        "app.services.cluster_pillar._score_tone",
        new=AsyncMock(return_value=(0.3, "Marketing-coded, promotional CTA in opening paragraph.")),
    ):
        candidate = await propose_pillar(db_session, cluster)

    assert candidate is None
```

- [ ] **Step 6.2: Run test, expect ImportError**

```bash
pytest tests/test_cluster_pillar.py -v
```

Expected: 3 failures — `cannot import name 'propose_pillar'`.

- [ ] **Step 6.3: Create `backend/app/services/cluster_pillar.py`**

```python
"""Propose an own-site pillar page for a cluster after tone-gating."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentCluster,
    Prompt,
    WebsiteAudit,
    WebsiteAuditPage,
)
from app.services.drafting.client import call_claude

logger = logging.getLogger(__name__)

_TONE_GATE_THRESHOLD = 0.6

_TONE_TEMPLATE = """You are a content reviewer evaluating whether a brand-owned page reads as neutral and informative (good for AI engine retrieval) versus marketing-coded (bad — AI engines downweight it).

Evaluate this page for tone.

URL: {url}
TITLE: {title}
EXCERPT: {excerpt}

Output strict JSON only:
{{
  "score": <float 0..1 — 1.0 = perfectly neutral, 0.0 = pure marketing copy>,
  "reasoning": "<1 sentence explaining the score>"
}}

Pages that pass (score >= 0.6) read like a knowledgeable practitioner wrote them — informative, no CTAs, no hard sell. Pages that fail open with the brand name as subject, use marketing register, push the reader to a product page, or contain CTAs."""


@dataclass
class PillarCandidate:
    page_id: int
    url: str
    title: str | None
    tone_score: float
    tone_reasoning: str


def _tokenize(s: str) -> set[str]:
    return {w.lower() for w in (s or "").split() if len(w) > 2}


async def _score_tone(url: str, title: str | None, excerpt: str) -> tuple[float, str]:
    """Run the LLM tone gate. Returns (score, reasoning)."""
    prompt = _TONE_TEMPLATE.format(url=url, title=title or "(no title)", excerpt=excerpt[:1000])
    raw = (await call_claude(prompt=prompt, max_tokens=200, model="claude-haiku-4-5-20251001")).strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].lstrip("json").strip() if len(parts) >= 2 else raw
    try:
        data = json.loads(raw)
        return float(data.get("score", 0.0)), str(data.get("reasoning", ""))
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning("Tone gate returned unparseable output: %s (%s)", raw[:120], e)
        return 0.0, "Unparseable tone-gate response."


async def propose_pillar(db: AsyncSession, cluster: ContentCluster) -> PillarCandidate | None:
    """Find and tone-gate an own-site pillar candidate. None if no candidates pass."""
    brand = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    if not brand.website_url:
        return None

    audit = (await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == cluster.brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.id)).limit(1)
    )).scalar_one_or_none()
    if not audit:
        return None

    prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    prompt_tokens = _tokenize(prompt.text)

    pages = (await db.execute(
        select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit.id, WebsiteAuditPage.http_status == 200)
    )).scalars().all()

    # Rank by simple token overlap with prompt text + title (Jaccard on title for now)
    ranked: list[tuple[float, WebsiteAuditPage]] = []
    for p in pages:
        title_tokens = _tokenize(p.title or "")
        if not title_tokens:
            continue
        overlap = len(prompt_tokens & title_tokens)
        if overlap == 0:
            continue
        denom = len(prompt_tokens | title_tokens) or 1
        ranked.append((overlap / denom, p))

    ranked.sort(reverse=True, key=lambda t: t[0])
    if not ranked:
        return None

    # Tone-gate the top candidate only (cheap, one LLM call)
    top_page = ranked[0][1]
    excerpt = (top_page.h1_text or top_page.title or "")
    score, reasoning = await _score_tone(top_page.url, top_page.title, excerpt)

    if score < _TONE_GATE_THRESHOLD:
        cluster.pillar_mode = "rejected_tone"
        cluster.pillar_url = top_page.url
        await db.commit()
        return None

    cluster.pillar_mode = "proposed"
    cluster.pillar_url = top_page.url
    await db.commit()

    return PillarCandidate(
        page_id=top_page.id,
        url=top_page.url,
        title=top_page.title,
        tone_score=score,
        tone_reasoning=reasoning,
    )
```

- [ ] **Step 6.4: Run test, expect pass**

```bash
pytest tests/test_cluster_pillar.py -v
```

Expected: 3 passes.

- [ ] **Step 6.5: Commit**

```bash
git add backend/app/services/cluster_pillar.py backend/tests/test_cluster_pillar.py
git commit -m "$(cat <<'EOF'
feat(clusters): pillar candidate selection with LLM tone gate

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Cluster orchestrator (clustering_service)

**Files:**
- Create: `backend/app/services/clustering_service.py`
- Test: `backend/tests/test_clustering_service.py`

- [ ] **Step 7.1: Write failing orchestrator test**

Create `backend/tests/test_clustering_service.py`:

```python
"""Tests for clustering_service orchestrator."""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandContentSettings,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
    User,
)
from app.services.clustering_service import (
    CLUSTER_PLATFORMS,
    get_or_create_cluster,
    regenerate_cluster,
    regenerate_piece,
)


SAMPLE_BRIEF_JSON = """{
  "positioning": "Pos",
  "key_claims": ["c1", "c2"],
  "canonical_phrasings": ["Acme tracks X across Y"],
  "stats": [{"label": "k", "value": "1", "source": "internal"}],
  "narrative_spine": "spine",
  "tone_notes": "neutral"
}"""


@pytest.mark.asyncio
async def test_cluster_platforms_excludes_wikipedia() -> None:
    assert "wikipedia" not in CLUSTER_PLATFORMS
    assert set(CLUSTER_PLATFORMS) == {"linkedin", "medium", "reddit", "quora", "x"}


@pytest.mark.asyncio
async def test_get_or_create_cluster_idempotent(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme1", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    c1 = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)
    c2 = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)
    assert c1.id == c2.id


@pytest.mark.asyncio
async def test_regenerate_cluster_produces_5_pieces(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme2", user_id=registered_user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Title", "Body content here."))):
        result = await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    assert result.status == "ready"
    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    assert len(drafts) == 5
    assert {d.platform for d in drafts} == {"linkedin", "medium", "reddit", "quora", "x"}
    assert all(d.cluster_id == cluster.id for d in drafts)


@pytest.mark.asyncio
async def test_regenerate_cluster_respects_disabled_platform(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme3", user_id=registered_user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    # Disable X for this brand
    db_session.add(BrandContentSettings(brand_id=brand.id, platform="x", enabled=False, auto_post=False))
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Title", "Body."))):
        await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    platforms = {d.platform for d in drafts}
    assert "x" not in platforms
    assert len(drafts) == 4


@pytest.mark.asyncio
async def test_regenerate_piece_replaces_only_target(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="c-acme4", user_id=registered_user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    cluster = await get_or_create_cluster(db_session, brand_id=brand.id, prompt_id=prompt.id)

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("First", "First body."))):
        await regenerate_cluster(db_session, cluster_id=cluster.id, tier="starter")

    with patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Updated", "Updated body."))):
        await regenerate_piece(db_session, cluster_id=cluster.id, platform="linkedin", tier="starter")

    drafts = (await db_session.execute(select(ContentDraft).where(ContentDraft.cluster_id == cluster.id))).scalars().all()
    li = next(d for d in drafts if d.platform == "linkedin")
    others = [d for d in drafts if d.platform != "linkedin"]
    assert li.title == "Updated"
    assert all(d.title == "First" for d in others)
```

- [ ] **Step 7.2: Run test, expect ImportError**

```bash
pytest tests/test_clustering_service.py -v
```

Expected: failures — `cannot import 'CLUSTER_PLATFORMS'` etc.

- [ ] **Step 7.3: Create `backend/app/services/clustering_service.py`**

```python
"""Cluster orchestrator: brief generation + parallel piece generation + pillar."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandContentSettings,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
)
from app.services.cluster_brief import build_brief
from app.services.cluster_pillar import propose_pillar
from app.services.drafting.client import call_claude
from app.services.drafting.platforms import PLATFORM_SPECS, resolve_platform_key
from app.services.drafting.prompts import build_prompt
from app.services.drafting_service import (
    _analyze_responses_for_prompt,
    _get_prompt_visibility,
    _load_profile_context,
)

logger = logging.getLogger(__name__)

CLUSTER_PLATFORMS: tuple[str, ...] = ("linkedin", "medium", "reddit", "quora", "x")


async def get_or_create_cluster(db: AsyncSession, *, brand_id: int, prompt_id: int) -> ContentCluster:
    existing = (await db.execute(
        select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
    )).scalar_one_or_none()
    if existing:
        return existing
    cluster = ContentCluster(
        brand_id=brand_id,
        prompt_id=prompt_id,
        status="pending",
        pillar_mode="none",
        version=1,
        created_at=datetime.now(UTC),
    )
    db.add(cluster)
    await db.commit()
    await db.refresh(cluster)
    return cluster


async def _enabled_platforms(db: AsyncSession, brand_id: int) -> list[str]:
    """Respect BrandContentSettings.enabled per platform. Default = enabled."""
    rows = (await db.execute(
        select(BrandContentSettings.platform, BrandContentSettings.enabled)
        .where(BrandContentSettings.brand_id == brand_id)
    )).all()
    disabled = {p for p, enabled in rows if not enabled}
    return [p for p in CLUSTER_PLATFORMS if p not in disabled]


def _build_brief_context(brief: ContentBrief, sibling_platforms: list[str]) -> str:
    lines = [f"POSITIONING: {brief.positioning}"]
    if brief.canonical_phrasings:
        lines.append("CANONICAL PHRASINGS (use at least 1 verbatim):")
        lines.extend(f"  - {p}" for p in brief.canonical_phrasings)
    if brief.key_claims:
        lines.append("KEY CLAIMS:")
        lines.extend(f"  - {c}" for c in brief.key_claims)
    if brief.stats:
        lines.append("STATS:")
        for s in brief.stats:
            lines.append(f"  - {s.get('label', '')}: {s.get('value', '')}")
    if brief.narrative_spine:
        lines.append(f"NARRATIVE SPINE: {brief.narrative_spine}")
    if brief.tone_notes:
        lines.append(f"TONE NOTES: {brief.tone_notes}")
    if sibling_platforms:
        lines.append("SIBLING PLATFORMS in this cluster (reference by platform name, not URL):")
        lines.append(f"  - {', '.join(sibling_platforms)}")
    return "\n".join(lines)


async def _generate_piece_text(
    *,
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    brief_context: str,
    tier: str | None,
) -> tuple[str, str]:
    """Call the LLM via build_prompt + call_claude. Returns (title, body)."""
    from app.services.drafting.pipeline import extract_title_and_body
    spec = PLATFORM_SPECS[resolve_platform_key(platform)]
    prompt = build_prompt(
        brand_name=brand_name,
        platform=platform,
        prompt_text=prompt_text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        platform_spec=spec,
        brief_context=brief_context,
    )
    # Pro tier gets sonnet for piece generation; everyone else gets haiku.
    model = "claude-sonnet-4-6" if tier == "pro" else "claude-haiku-4-5-20251001"
    raw = await call_claude(prompt=prompt, max_tokens=1500, model=model)
    title, body = extract_title_and_body(raw, platform)
    return (title or "(untitled)"), body


async def regenerate_cluster(
    db: AsyncSession,
    *,
    cluster_id: int,
    tier: str | None,
) -> ContentCluster:
    cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
    cluster.status = "briefing"
    await db.commit()

    brief = await build_brief(db, cluster=cluster, tier=tier)

    cluster.status = "generating"
    await db.commit()

    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_row = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    profile_context = await _load_profile_context(db, cluster.brand_id)
    response_analysis = await _analyze_responses_for_prompt(db, cluster.prompt_id)
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)

    # Delete existing cluster drafts before regenerating
    await db.execute(delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id))
    await db.commit()

    async def _gen(platform: str) -> tuple[str, str, str]:
        sibs = [p for p in enabled if p != platform]
        ctx = _build_brief_context(brief, sibs)
        title, body = await _generate_piece_text(
            brand_name=brand_row.name,
            platform=platform,
            prompt_text=prompt_row.text,
            visibility_pct=visibility_pct,
            profile_context=profile_context,
            response_analysis=response_analysis,
            brief_context=ctx,
            tier=tier,
        )
        return platform, title, body

    results = await asyncio.gather(*[_gen(p) for p in enabled], return_exceptions=True)

    any_failed = False
    for r in results:
        if isinstance(r, Exception):
            logger.exception("Piece generation failed: %s", r)
            any_failed = True
            continue
        platform, title, body = r
        db.add(ContentDraft(
            brand_id=cluster.brand_id,
            prompt_id=cluster.prompt_id,
            cluster_id=cluster.id,
            platform=platform,
            status="draft",
            title=title,
            content_text=body,
            source="cluster",
        ))

    cluster.status = "partial_failed" if any_failed else "ready"
    cluster.last_generated_at = datetime.now(UTC)
    cluster.version += 1
    await db.commit()

    # Pillar proposal is non-fatal
    try:
        await propose_pillar(db, cluster)
    except Exception:
        logger.exception("Pillar proposal failed for cluster %s", cluster.id)

    await db.refresh(cluster)
    return cluster


async def regenerate_piece(
    db: AsyncSession,
    *,
    cluster_id: int,
    platform: str,
    tier: str | None,
) -> ContentDraft:
    if platform not in CLUSTER_PLATFORMS:
        raise ValueError(f"Unsupported cluster platform: {platform}")

    cluster = (await db.execute(select(ContentCluster).where(ContentCluster.id == cluster_id))).scalar_one()
    brief_row = (await db.execute(
        select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id)
    )).scalar_one_or_none()
    if brief_row is None:
        # No brief yet — generate one
        brief_row = await build_brief(db, cluster=cluster, tier=tier)

    prompt_row = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brand_row = (await db.execute(select(Brand).where(Brand.id == cluster.brand_id))).scalar_one()
    profile_context = await _load_profile_context(db, cluster.brand_id)
    response_analysis = await _analyze_responses_for_prompt(db, cluster.prompt_id)
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)
    sibs = [p for p in enabled if p != platform]
    ctx = _build_brief_context(brief_row, sibs)

    title, body = await _generate_piece_text(
        brand_name=brand_row.name,
        platform=platform,
        prompt_text=prompt_row.text,
        visibility_pct=visibility_pct,
        profile_context=profile_context,
        response_analysis=response_analysis,
        brief_context=ctx,
        tier=tier,
    )

    existing = (await db.execute(
        select(ContentDraft).where(
            ContentDraft.cluster_id == cluster.id,
            ContentDraft.platform == platform,
        )
    )).scalar_one_or_none()

    if existing:
        existing.title = title
        existing.content_text = body
        existing.status = "draft"
        draft = existing
    else:
        draft = ContentDraft(
            brand_id=cluster.brand_id,
            prompt_id=cluster.prompt_id,
            cluster_id=cluster.id,
            platform=platform,
            status="draft",
            title=title,
            content_text=body,
            source="cluster",
        )
        db.add(draft)

    await db.commit()
    await db.refresh(draft)
    return draft
```

- [ ] **Step 7.4: Run test, expect pass**

```bash
pytest tests/test_clustering_service.py -v
```

Expected: 5 passes.

- [ ] **Step 7.5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_clustering_service.py
git commit -m "$(cat <<'EOF'
feat(clusters): orchestrator — brief + parallel pieces + pillar

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: New `/api/clusters/*` router

**Files:**
- Create: `backend/app/routers/clusters.py`
- Modify: `backend/app/main.py` (mount router)
- Test: `backend/tests/test_cluster_routes.py`

- [ ] **Step 8.1: Write failing route tests**

Create `backend/tests/test_cluster_routes.py`:

```python
"""Tests for /api/clusters/* endpoints."""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, ContentCluster, Prompt, User
from tests.conftest import register_and_login

SAMPLE_BRIEF_JSON = '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],"stats":[],"narrative_spine":"n","tone_notes":"t"}'


@pytest.mark.asyncio
async def test_list_clusters_requires_auth(async_client: AsyncClient) -> None:
    r = await async_client.get("/api/clusters/1")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_clusters_returns_empty_for_new_brand(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-list@test.com")
    brand = Brand(name="Acme", slug="ck-list-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    r = await async_client.get(f"/api/clusters/{brand.id}", headers=headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_regenerate_cluster_endpoint_creates_pieces(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-regen@test.com")
    brand = Brand(name="Acme", slug="ck-regen-acme", user_id=user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("T", "Body."))):
        r = await async_client.post(
            f"/api/clusters/{brand.id}/by-prompt/{prompt.id}/regenerate",
            headers=headers,
        )

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert len(body["drafts"]) == 5


@pytest.mark.asyncio
async def test_regenerate_piece_endpoint(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-piece@test.com")
    brand = Brand(name="Acme", slug="ck-piece-acme", user_id=user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("T2", "B2"))):
        r = await async_client.post(
            f"/api/clusters/{brand.id}/{cluster.id}/regenerate-piece",
            headers=headers,
            json={"platform": "linkedin"},
        )

    assert r.status_code == 200
    assert r.json()["title"] == "T2"


@pytest.mark.asyncio
async def test_edit_brief_endpoint(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-edit@test.com")
    brand = Brand(name="Acme", slug="ck-edit-acme", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.flush()
    from app.models import ContentBrief
    brief = ContentBrief(cluster_id=cluster.id, version=1, positioning="old")
    db_session.add(brief)
    await db_session.flush()
    cluster.last_brief_id = brief.id
    await db_session.commit()

    r = await async_client.patch(
        f"/api/clusters/{brand.id}/{cluster.id}/brief",
        headers=headers,
        json={"positioning": "new positioning"},
    )
    assert r.status_code == 200
    assert r.json()["positioning"] == "new positioning"


@pytest.mark.asyncio
async def test_cross_user_isolation_404(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """User A cannot access User B's cluster."""
    headers_a, user_a = await register_and_login(async_client, "ck-iso-a@test.com")
    headers_b, user_b = await register_and_login(async_client, "ck-iso-b@test.com")
    brand_b = Brand(name="B", slug="ck-iso-b-brand", user_id=user_b.id)
    db_session.add(brand_b)
    await db_session.commit()

    r = await async_client.get(f"/api/clusters/{brand_b.id}", headers=headers_a)
    assert r.status_code == 404
```

- [ ] **Step 8.2: Run, expect failures (no router yet)**

```bash
pytest tests/test_cluster_routes.py -v
```

Expected: all fail with 404 (no `/api/clusters/*` registered).

- [ ] **Step 8.3: Create `backend/app/routers/clusters.py`**

```python
"""Cluster API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, DbDep
from app.models import (
    Brand,
    ContentBrief,
    ContentCluster,
    ContentDraft,
    Prompt,
)
from app.schemas import (
    ContentBriefSchema,
    ContentClusterDetail,
    ContentClusterSummary,
    ContentDraftSchema,
    EditBriefRequest,
    PillarCandidateSchema,
    RegeneratePieceRequest,
)
from app.services.cluster_pillar import propose_pillar
from app.services.clustering_service import (
    CLUSTER_PLATFORMS,
    get_or_create_cluster,
    regenerate_cluster,
    regenerate_piece,
)
from app.services.drafting_service import _get_prompt_visibility

router = APIRouter(prefix="/clusters", tags=["clusters"])


async def _ensure_brand_owned(db: AsyncSession, brand_id: int, user_id: int) -> Brand:
    brand = (await db.execute(
        select(Brand).where(Brand.id == brand_id, Brand.user_id == user_id)
    )).scalar_one_or_none()
    if brand is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Brand not found")
    return brand


def _summarize_pieces(drafts: list[ContentDraft]) -> list[dict]:
    out = []
    for d in drafts:
        out.append({
            "platform": d.platform,
            "draft_id": d.id,
            "status": d.status,
            "title": d.title,
            "excerpt": (d.content_text or "")[:140],
        })
    return out


@router.get("/{brand_id}", response_model=list[ContentClusterSummary])
async def list_clusters(brand_id: int, db: DbDep, user: CurrentUser) -> list[dict]:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    rows = (await db.execute(
        select(ContentCluster).where(ContentCluster.brand_id == brand.id)
    )).scalars().all()

    out: list[dict] = []
    for cluster in rows:
        prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
        )).scalars().all()
        out.append({
            "id": cluster.id,
            "brand_id": cluster.brand_id,
            "prompt_id": cluster.prompt_id,
            "prompt_text": prompt.text,
            "status": cluster.status,
            "pillar_mode": cluster.pillar_mode,
            "pillar_url": cluster.pillar_url,
            "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
            "pieces": _summarize_pieces(drafts),
            "version": cluster.version,
            "last_generated_at": cluster.last_generated_at,
        })
    # Sort by visibility ascending (lowest needs most attention)
    out.sort(key=lambda c: c["visibility_pct"])
    return out


@router.get("/{brand_id}/{cluster_id}", response_model=ContentClusterDetail)
async def get_cluster(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")

    prompt = (await db.execute(select(Prompt).where(Prompt.id == cluster.prompt_id))).scalar_one()
    brief = None
    if cluster.last_brief_id:
        brief = (await db.execute(select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id))).scalar_one_or_none()
    drafts = (await db.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )).scalars().all()

    return {
        "id": cluster.id,
        "brand_id": cluster.brand_id,
        "prompt_id": cluster.prompt_id,
        "prompt_text": prompt.text,
        "status": cluster.status,
        "pillar_mode": cluster.pillar_mode,
        "pillar_url": cluster.pillar_url,
        "visibility_pct": await _get_prompt_visibility(db, cluster.prompt_id),
        "brief": ContentBriefSchema.model_validate(brief) if brief else None,
        "drafts": [ContentDraftSchema.model_validate(d) for d in drafts],
        "version": cluster.version,
        "last_generated_at": cluster.last_generated_at,
    }


@router.post("/{brand_id}/by-prompt/{prompt_id}/regenerate", response_model=ContentClusterDetail)
async def regenerate_by_prompt(brand_id: int, prompt_id: int, db: DbDep, user: CurrentUser) -> dict:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    prompt = (await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand.id)
    )).scalar_one_or_none()
    if prompt is None:
        raise HTTPException(404, "Prompt not found")
    cluster = await get_or_create_cluster(db, brand_id=brand.id, prompt_id=prompt.id)
    await regenerate_cluster(db, cluster_id=cluster.id, tier=brand.subscription_tier or user.subscription_tier)
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/regenerate-piece", response_model=ContentDraftSchema)
async def regenerate_piece_endpoint(
    brand_id: int,
    cluster_id: int,
    request: RegeneratePieceRequest,
    db: DbDep,
    user: CurrentUser,
) -> ContentDraft:
    brand = await _ensure_brand_owned(db, brand_id, user.id)
    if request.platform not in CLUSTER_PLATFORMS:
        raise HTTPException(400, f"Platform {request.platform} not in cluster set")
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand.id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    return await regenerate_piece(
        db,
        cluster_id=cluster.id,
        platform=request.platform,
        tier=brand.subscription_tier or user.subscription_tier,
    )


@router.patch("/{brand_id}/{cluster_id}/brief", response_model=ContentBriefSchema)
async def edit_brief(
    brand_id: int,
    cluster_id: int,
    request: EditBriefRequest,
    db: DbDep,
    user: CurrentUser,
) -> ContentBrief:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None or cluster.last_brief_id is None:
        raise HTTPException(404, "Cluster or brief not found")
    brief = (await db.execute(select(ContentBrief).where(ContentBrief.id == cluster.last_brief_id))).scalar_one()

    for field in ("positioning", "key_claims", "canonical_phrasings", "stats", "narrative_spine", "tone_notes"):
        val = getattr(request, field)
        if val is not None:
            setattr(brief, field, val)

    await db.commit()
    await db.refresh(brief)
    return brief


@router.post("/{brand_id}/{cluster_id}/pillar/accept", response_model=ContentClusterDetail)
async def accept_pillar(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    if cluster.pillar_mode != "proposed":
        raise HTTPException(400, "No pillar proposal to accept")
    cluster.pillar_mode = "attached"
    await db.commit()
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/pillar/reject", response_model=ContentClusterDetail)
async def reject_pillar(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> dict:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    cluster.pillar_mode = "none"
    cluster.pillar_url = None
    await db.commit()
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/pillar/propose", response_model=PillarCandidateSchema | None)
async def propose_pillar_endpoint(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser) -> PillarCandidateSchema | None:
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id)
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    cand = await propose_pillar(db, cluster)
    if cand is None:
        return None
    return PillarCandidateSchema(
        page_id=cand.page_id,
        url=cand.url,
        title=cand.title,
        tone_score=cand.tone_score,
        tone_reasoning=cand.tone_reasoning,
    )
```

- [ ] **Step 8.4: Mount the router in `backend/app/main.py`**

In the imports block (with the other router imports), add:

```python
from app.routers import clusters as clusters_router
```

In the mount section near line 213:

```python
app.include_router(clusters_router.router, prefix="/api")
```

- [ ] **Step 8.5: Run route tests, expect pass**

```bash
pytest tests/test_cluster_routes.py -v
```

Expected: 6 passes.

- [ ] **Step 8.6: Commit**

```bash
git add backend/app/routers/clusters.py backend/app/main.py backend/tests/test_cluster_routes.py
git commit -m "$(cat <<'EOF'
feat(clusters): cluster API endpoints + ownership isolation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend API client — `clusters` group

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 9.1: Add cluster types and methods**

In `frontend/lib/api.ts`, add types near other content types:

```typescript
export interface ContentBrief {
  id: number;
  cluster_id: number;
  version: number;
  positioning: string;
  key_claims: string[];
  canonical_phrasings: string[];
  stats: { label: string; value: string; source: string }[];
  competitor_context: Record<string, unknown>;
  narrative_spine: string;
  tone_notes: string;
  created_by: string;
  created_at: string;
}

export interface ClusterPieceSummary {
  platform: string;
  draft_id: number | null;
  status: string;
  title: string | null;
  excerpt: string | null;
}

export interface ContentClusterSummary {
  id: number;
  brand_id: number;
  prompt_id: number;
  prompt_text: string;
  status: string;
  pillar_mode: string;
  pillar_url: string | null;
  visibility_pct: number;
  pieces: ClusterPieceSummary[];
  version: number;
  last_generated_at: string | null;
}

export interface ContentClusterDetail {
  id: number;
  brand_id: number;
  prompt_id: number;
  prompt_text: string;
  status: string;
  pillar_mode: string;
  pillar_url: string | null;
  visibility_pct: number;
  brief: ContentBrief | null;
  drafts: ContentDraft[];
  version: number;
  last_generated_at: string | null;
}

export interface PillarCandidate {
  page_id: number;
  url: string;
  title: string | null;
  tone_score: number;
  tone_reasoning: string;
}
```

Then add a `clusters` group near the existing API groups:

```typescript
export const clusters = {
  list: (brandId: number) =>
    apiClient.get<ContentClusterSummary[]>(`/clusters/${brandId}`).then((r) => r.data),

  get: (brandId: number, clusterId: number) =>
    apiClient.get<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}`).then((r) => r.data),

  regenerateByPrompt: (brandId: number, promptId: number) =>
    apiClient
      .post<ContentClusterDetail>(`/clusters/${brandId}/by-prompt/${promptId}/regenerate`)
      .then((r) => r.data),

  regeneratePiece: (brandId: number, clusterId: number, platform: string) =>
    apiClient
      .post<ContentDraft>(`/clusters/${brandId}/${clusterId}/regenerate-piece`, { platform })
      .then((r) => r.data),

  editBrief: (
    brandId: number,
    clusterId: number,
    patch: Partial<Pick<ContentBrief, "positioning" | "key_claims" | "canonical_phrasings" | "stats" | "narrative_spine" | "tone_notes">>,
  ) =>
    apiClient
      .patch<ContentBrief>(`/clusters/${brandId}/${clusterId}/brief`, patch)
      .then((r) => r.data),

  proposePillar: (brandId: number, clusterId: number) =>
    apiClient
      .post<PillarCandidate | null>(`/clusters/${brandId}/${clusterId}/pillar/propose`)
      .then((r) => r.data),

  acceptPillar: (brandId: number, clusterId: number) =>
    apiClient
      .post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/pillar/accept`)
      .then((r) => r.data),

  rejectPillar: (brandId: number, clusterId: number) =>
    apiClient
      .post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/pillar/reject`)
      .then((r) => r.data),
};
```

- [ ] **Step 9.2: Verify build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds (TypeScript errors will surface here if types are wrong).

- [ ] **Step 9.3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(clusters): frontend API client cluster group + types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `ClusterCard` component

**Files:**
- Create: `frontend/components/content/cluster/ClusterCard.tsx`

- [ ] **Step 10.1: Create the component**

```tsx
"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { ContentClusterSummary } from "@/lib/api";

interface Props {
  cluster: ContentClusterSummary;
  brandId: number;
  onRegenerate: (clusterId: number) => void;
  regenerating: boolean;
}

const PIECE_BADGE_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-800",
  posted: "bg-sky-100 text-sky-800",
  failed: "bg-rose-100 text-rose-800",
  missing: "bg-slate-50 text-slate-400 border border-dashed border-slate-300",
};

export function ClusterCard({ cluster, brandId, onRegenerate, regenerating }: Props) {
  const totalEnabled = cluster.pieces.length || 5;
  const completed = cluster.pieces.filter((p) => p.status !== "missing").length;
  const visibility = Math.round(cluster.visibility_pct);
  const visibilityTone = visibility >= 60 ? "text-emerald-700" : visibility >= 30 ? "text-amber-700" : "text-rose-700";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 line-clamp-2">{cluster.prompt_text}</h3>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <span>Status: <span className="font-medium text-slate-700 capitalize">{cluster.status.replace("_", " ")}</span></span>
            <span>·</span>
            <span>{completed} of {totalEnabled} pieces</span>
            {cluster.pillar_mode === "attached" && (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-medium">Pillar attached</span>
              </>
            )}
            {cluster.pillar_mode === "proposed" && (
              <>
                <span>·</span>
                <span className="text-amber-700 font-medium">Pillar proposed</span>
              </>
            )}
          </div>
        </div>
        <div className={`shrink-0 flex items-center gap-1 text-2xl font-bold ${visibilityTone}`}>
          {visibility >= 50 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          {visibility}%
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {cluster.pieces.map((piece) => (
          <span
            key={piece.platform}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${PIECE_BADGE_STYLES[piece.status] ?? PIECE_BADGE_STYLES.missing}`}
          >
            {piece.platform} · {piece.status}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Link
          href={`/content/${brandId}/cluster/${cluster.id}`}
          className="text-sm font-medium text-sky-700 hover:text-sky-900"
        >
          View cluster →
        </Link>
        <button
          type="button"
          onClick={() => onRegenerate(cluster.id)}
          disabled={regenerating}
          className="px-3 py-1.5 rounded-md border border-slate-200 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 10.3: Commit**

```bash
git add frontend/components/content/cluster/ClusterCard.tsx
git commit -m "$(cat <<'EOF'
feat(clusters): ClusterCard component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `BriefPanel`, `PieceCard`, `PillarCard` components

**Files:**
- Create: `frontend/components/content/cluster/BriefPanel.tsx`
- Create: `frontend/components/content/cluster/PieceCard.tsx`
- Create: `frontend/components/content/cluster/PillarCard.tsx`

- [ ] **Step 11.1: Create `BriefPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ContentBrief } from "@/lib/api";
import { clusters } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  brief: ContentBrief | null;
  onUpdated: (b: ContentBrief) => void;
}

export function BriefPanel({ brandId, clusterId, brief, onUpdated }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [positioning, setPositioning] = useState(brief?.positioning ?? "");
  const [keyClaims, setKeyClaims] = useState((brief?.key_claims ?? []).join("\n"));
  const [phrasings, setPhrasings] = useState((brief?.canonical_phrasings ?? []).join("\n"));
  const [narrative, setNarrative] = useState(brief?.narrative_spine ?? "");
  const [saving, setSaving] = useState(false);

  if (!brief) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        No brief yet. Regenerate this cluster to produce one.
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await clusters.editBrief(brandId, clusterId, {
        positioning,
        key_claims: keyClaims.split("\n").map((s) => s.trim()).filter(Boolean),
        canonical_phrasings: phrasings.split("\n").map((s) => s.trim()).filter(Boolean),
        narrative_spine: narrative,
      });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2 font-semibold text-slate-900">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Brief · v{brief.version}
        </span>
        <span className="text-xs text-slate-500">Generated {new Date(brief.created_at).toLocaleString()}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-4 text-sm">
          {!editing ? (
            <>
              <Field label="Positioning">{brief.positioning}</Field>
              <Field label="Canonical phrasings (appear verbatim across pieces)">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.canonical_phrasings.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </Field>
              <Field label="Key claims">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.key_claims.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </Field>
              <Field label="Stats">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.stats.map((s, i) => <li key={i}>{s.label}: {s.value}</li>)}
                </ul>
              </Field>
              <Field label="Narrative spine">{brief.narrative_spine}</Field>
              <Field label="Tone notes">{brief.tone_notes}</Field>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sky-700 hover:text-sky-900 font-medium"
              >
                Edit brief
              </button>
            </>
          ) : (
            <>
              <Field label="Positioning">
                <textarea value={positioning} onChange={(e) => setPositioning(e.target.value)} className="w-full border rounded p-2" rows={2} />
              </Field>
              <Field label="Canonical phrasings (one per line)">
                <textarea value={phrasings} onChange={(e) => setPhrasings(e.target.value)} className="w-full border rounded p-2 font-mono text-xs" rows={4} />
              </Field>
              <Field label="Key claims (one per line)">
                <textarea value={keyClaims} onChange={(e) => setKeyClaims(e.target.value)} className="w-full border rounded p-2" rows={4} />
              </Field>
              <Field label="Narrative spine">
                <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} className="w-full border rounded p-2" rows={2} />
              </Field>
              <div className="flex gap-2">
                <button type="button" onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded border text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-slate-900">{children}</div>
    </div>
  );
}
```

- [ ] **Step 11.2: Create `PieceCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ContentDraft } from "@/lib/api";
import { clusters as clustersApi } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  platform: string;
  draft: ContentDraft | null;
  onUpdated: (draft: ContentDraft) => void;
}

export function PieceCard({ brandId, clusterId, platform, draft, onUpdated }: Props) {
  const [regenerating, setRegenerating] = useState(false);

  async function regenerate() {
    setRegenerating(true);
    try {
      const updated = await clustersApi.regeneratePiece(brandId, clusterId, platform);
      onUpdated(updated);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 min-h-[200px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{platform}</span>
        {draft && <span className="text-xs text-slate-500 capitalize">{draft.status}</span>}
      </div>
      {draft ? (
        <>
          {draft.title && <h4 className="font-semibold text-slate-900 mb-1 line-clamp-1">{draft.title}</h4>}
          <p className="text-sm text-slate-600 line-clamp-5 flex-1">{draft.content_text}</p>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic flex-1">Not generated yet.</p>
      )}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="text-sm text-sky-700 hover:text-sky-900 disabled:opacity-50 flex items-center gap-1"
        >
          {regenerating && <Loader2 className="h-3 w-3 animate-spin" />}
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.3: Create `PillarCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ContentClusterDetail, PillarCandidate } from "@/lib/api";
import { clusters as clustersApi } from "@/lib/api";

interface Props {
  brandId: number;
  cluster: ContentClusterDetail;
  candidate: PillarCandidate | null;
  onClusterUpdated: (c: ContentClusterDetail) => void;
}

export function PillarCard({ brandId, cluster, candidate, onClusterUpdated }: Props) {
  const [busy, setBusy] = useState(false);

  if (cluster.pillar_mode === "attached" && cluster.pillar_url) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="font-semibold text-emerald-900 mb-1">Pillar attached</div>
        <a href={cluster.pillar_url} target="_blank" rel="noopener noreferrer" className="text-emerald-800 underline">
          {cluster.pillar_url}
        </a>
      </div>
    );
  }

  if (cluster.pillar_mode !== "proposed" || !candidate) return null;

  async function accept() {
    setBusy(true);
    try {
      const c = await clustersApi.acceptPillar(brandId, cluster.id);
      onClusterUpdated(c);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      const c = await clustersApi.rejectPillar(brandId, cluster.id);
      onClusterUpdated(c);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="font-semibold text-amber-900">Pillar proposal</div>
      <p className="mt-1 text-sm text-amber-800">
        We found an own-site page that targets this prompt and passed the tone gate.
      </p>
      <div className="mt-3 text-sm">
        <div className="font-medium text-slate-900">{candidate.title ?? candidate.url}</div>
        <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline text-xs">
          {candidate.url}
        </a>
        <div className="mt-2 text-xs text-slate-600">
          Tone score: <span className="font-mono">{candidate.tone_score.toFixed(2)}</span> · {candidate.tone_reasoning}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={accept} disabled={busy} className="px-3 py-1.5 rounded bg-emerald-700 text-white text-sm disabled:opacity-50">
          Accept pillar
        </button>
        <button type="button" onClick={reject} disabled={busy} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">
          Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.4: Verify build**

```bash
cd frontend && npm run build
```

Expected: builds clean.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/components/content/cluster/
git commit -m "$(cat <<'EOF'
feat(clusters): BriefPanel, PieceCard, PillarCard components

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Cluster detail page route

**Files:**
- Create: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 12.1: Create the route**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { ContentClusterDetail, ContentDraft, PillarCandidate } from "@/lib/api";
import { clusters } from "@/lib/api";
import { BriefPanel } from "@/components/content/cluster/BriefPanel";
import { PieceCard } from "@/components/content/cluster/PieceCard";
import { PillarCard } from "@/components/content/cluster/PillarCard";

const PLATFORMS = ["linkedin", "medium", "reddit", "quora", "x"] as const;

export default function ClusterDetailPage() {
  const router = useRouter();
  const params = useParams<{ brandId: string; clusterId: string }>();
  const brandId = Number(params.brandId);
  const clusterId = Number(params.clusterId);

  const [cluster, setCluster] = useState<ContentClusterDetail | null>(null);
  const [candidate, setCandidate] = useState<PillarCandidate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [c, cand] = await Promise.all([
        clusters.get(brandId, clusterId),
        clusters.proposePillar(brandId, clusterId).catch(() => null),
      ]);
      if (!cancelled) {
        setCluster(c);
        setCandidate(cand);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId, clusterId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cluster…
      </div>
    );
  }
  if (!cluster) {
    return <div className="p-8 text-rose-700">Cluster not found.</div>;
  }

  const draftsByPlatform = new Map(cluster.drafts.map((d) => [d.platform, d]));

  function updateDraft(updated: ContentDraft) {
    setCluster((prev) => {
      if (!prev) return prev;
      const drafts = prev.drafts.filter((d) => d.platform !== updated.platform).concat(updated);
      return { ...prev, drafts };
    });
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <button onClick={() => router.push(`/content/${brandId}`)} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Back to content
      </button>

      <header>
        <h1 className="text-2xl font-bold text-slate-900">{cluster.prompt_text}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Status: <span className="font-medium capitalize">{cluster.status.replace("_", " ")}</span>
          {" · "}Visibility: <span className="font-medium">{Math.round(cluster.visibility_pct)}%</span>
        </p>
      </header>

      <BriefPanel
        brandId={brandId}
        clusterId={cluster.id}
        brief={cluster.brief}
        onUpdated={(b) => setCluster((c) => (c ? { ...c, brief: b } : c))}
      />

      <PillarCard
        brandId={brandId}
        cluster={cluster}
        candidate={candidate}
        onClusterUpdated={(c) => setCluster(c)}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLATFORMS.map((platform) => (
          <PieceCard
            key={platform}
            brandId={brandId}
            clusterId={cluster.id}
            platform={platform}
            draft={draftsByPlatform.get(platform) ?? null}
            onUpdated={updateDraft}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 12.2: Verify build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 12.3: Commit**

```bash
git add frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx
git commit -m "$(cat <<'EOF'
feat(clusters): cluster detail page route

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Refactor `/content/[brandId]` page into tabbed layout

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`
- Create: `frontend/components/content/wikipedia/WikipediaTab.tsx`

- [ ] **Step 13.1: Read the current page to understand wrapper structure**

```bash
wc -l "frontend/app/content/[brandId]/page.tsx"
```

The current file is ~33 lines — likely a Server Component that loads a Client Component. Inspect it before editing.

- [ ] **Step 13.2: Replace with tabbed layout**

Replace the contents of `frontend/app/content/[brandId]/page.tsx` (or its child client component, whichever holds the existing UI) with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { clusters, type ContentClusterSummary } from "@/lib/api";
import { ClusterCard } from "@/components/content/cluster/ClusterCard";
import { WikipediaTab } from "@/components/content/wikipedia/WikipediaTab";

type Tab = "clusters" | "opportunities" | "wikipedia" | "gaps";

export default function ContentBrandPage() {
  const params = useParams<{ brandId: string }>();
  const brandId = Number(params.brandId);
  const [tab, setTab] = useState<Tab>("clusters");
  const [clusterList, setClusterList] = useState<ContentClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await clusters.list(brandId);
      if (!cancelled) {
        setClusterList(data);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  async function handleRegenerate(clusterId: number) {
    const cluster = clusterList.find((c) => c.id === clusterId);
    if (!cluster) return;
    setRegeneratingId(clusterId);
    try {
      await clusters.regenerateByPrompt(brandId, cluster.prompt_id);
      const refreshed = await clusters.list(brandId);
      setClusterList(refreshed);
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-2">
          {(["clusters", "opportunities", "wikipedia", "gaps"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
                tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "clusters" && (
        <ClustersTab
          loading={loading}
          clusters={clusterList}
          brandId={brandId}
          regeneratingId={regeneratingId}
          onRegenerate={handleRegenerate}
        />
      )}
      {tab === "opportunities" && <OpportunitiesPlaceholder brandId={brandId} />}
      {tab === "wikipedia" && <WikipediaTab brandId={brandId} />}
      {tab === "gaps" && <GapsPlaceholder brandId={brandId} />}
    </div>
  );
}

function ClustersTab({
  loading,
  clusters: list,
  brandId,
  regeneratingId,
  onRegenerate,
}: {
  loading: boolean;
  clusters: ContentClusterSummary[];
  brandId: number;
  regeneratingId: number | null;
  onRegenerate: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading clusters…
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-slate-700">No clusters yet for this brand.</p>
        <p className="mt-1 text-sm text-slate-500">Each tracked prompt becomes a cluster. Add prompts in the brand settings, then come back and regenerate.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {list.map((c) => (
        <ClusterCard
          key={c.id}
          cluster={c}
          brandId={brandId}
          onRegenerate={onRegenerate}
          regenerating={regeneratingId === c.id}
        />
      ))}
    </div>
  );
}

function OpportunitiesPlaceholder({ brandId: _brandId }: { brandId: number }) {
  // TODO Task 14: wire existing OpportunitiesList component here.
  return <div className="text-sm text-slate-500">Opportunities tab — wiring existing component in next task.</div>;
}

function GapsPlaceholder({ brandId: _brandId }: { brandId: number }) {
  // TODO Task 14: wire existing GapsList component here.
  return <div className="text-sm text-slate-500">Gaps tab — wiring existing component in next task.</div>;
}
```

- [ ] **Step 13.3: Create the Wikipedia tab component**

`frontend/components/content/wikipedia/WikipediaTab.tsx`:

```tsx
"use client";

import { AlertCircle } from "lucide-react";

export function WikipediaTab({ brandId: _brandId }: { brandId: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-900">Wikipedia requires different handling</h3>
            <p className="mt-1 text-sm text-amber-800">
              Wikipedia content requires neutral, citation-backed, non-promotional tone — not the same approach as marketing drafts.
              We've carved Wikipedia out of the cluster generator. A proper Wikipedia workflow is coming.
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h4 className="font-semibold text-slate-900 mb-2">Topics for future Wikipedia coverage</h4>
        <p className="text-sm text-slate-500">
          We'll surface candidate Wikipedia topics from your brand profile and tracked prompts here once the workflow ships.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.4: Verify build + manually verify in dev**

```bash
cd frontend && npm run build
```

Then in two terminals:
```bash
# Terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001
# Terminal 2
cd frontend && PORT=3002 npm run dev
```

Browse to `http://localhost:3002/content/<brandId>` and:
- Verify tabs render
- Verify Clusters tab shows empty state for a brand with no clusters
- Verify Wikipedia tab shows the placeholder

- [ ] **Step 13.5: Commit**

```bash
git add "frontend/app/content/[brandId]/page.tsx" frontend/components/content/wikipedia/
git commit -m "$(cat <<'EOF'
feat(clusters): tabbed content hub with Clusters default and Wikipedia placeholder

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Wire existing Opportunities + Gaps panels into tabs

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`

- [ ] **Step 14.1: Locate the existing Opportunities and Gaps components**

```bash
grep -rn "OpportunitiesList\|GapsList\|OpportunityList\|GapList\|<Opportunities\|<Gaps" frontend/ --include="*.tsx" | head -10
```

Note the actual component names + import paths from the legacy `/content/[brandId]/page.tsx`.

- [ ] **Step 14.2: Replace placeholders with real components**

In `frontend/app/content/[brandId]/page.tsx`, replace `OpportunitiesPlaceholder` and `GapsPlaceholder` with the real components found in Step 14.1. Keep their existing props/contract — no behavior change, just relocation.

- [ ] **Step 14.3: Manually verify all 4 tabs in dev**

Browse each tab; verify Opportunities and Gaps behave identically to before this change.

- [ ] **Step 14.4: Commit**

```bash
git add "frontend/app/content/[brandId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(clusters): wire existing Opportunities + Gaps panels into tabs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Hook onboarding + "Regenerate Drafts" into cluster generation

**Files:**
- Modify: `backend/app/routers/content.py` (the `generate_now` endpoint and `_bg_generate_drafts` background function)

- [ ] **Step 15.1: Inspect the existing background flow**

```bash
grep -n "_bg_generate_drafts\|generate_now\|auto_draft_top_gaps" backend/app/routers/content.py | head -10
```

- [ ] **Step 15.2: Update `_bg_generate_drafts` to iterate prompts → clusters**

Find `_bg_generate_drafts` at line 79 in `backend/app/routers/content.py`. Replace its body so that instead of calling the legacy `auto_draft_top_gaps`, it iterates the brand's prompts and calls `regenerate_cluster` per prompt:

```python
async def _bg_generate_drafts(brand_id: int, max_gaps: int, source: str) -> None:
    """Background job: generate clusters for every prompt on the brand."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt
    from app.services.clustering_service import get_or_create_cluster, regenerate_cluster

    async with AsyncSessionLocal() as db:
        brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one_or_none()
        if brand is None:
            return
        prompts = (await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id, Prompt.prompt_type == "standard")
        )).scalars().all()
        tier = brand.subscription_tier

        for prompt in prompts[:max_gaps]:  # max_gaps interpreted as max prompts for cluster mode
            try:
                cluster = await get_or_create_cluster(db, brand_id=brand_id, prompt_id=prompt.id)
                await regenerate_cluster(db, cluster_id=cluster.id, tier=tier)
            except Exception as e:
                import logging
                logging.getLogger(__name__).exception("Cluster regen failed for prompt %s: %s", prompt.id, e)
                continue
```

- [ ] **Step 15.3: Add a regression test**

Append to `backend/tests/test_cluster_routes.py`:

```python
@pytest.mark.asyncio
async def test_generate_now_uses_cluster_pipeline(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-genow@test.com")
    brand = Brand(name="Acme", slug="ck-genow-acme", user_id=user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q1", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("T", "B"))):
        r = await async_client.post(
            f"/api/content/{brand.id}/generate-now",
            headers=headers,
            json={},
        )
    assert r.status_code in (200, 202)

    # Background completes — verify cluster exists
    from app.models import ContentCluster
    clusters_in_db = (await db_session.execute(
        select(ContentCluster).where(ContentCluster.brand_id == brand.id)
    )).scalars().all()
    assert len(clusters_in_db) == 1
```

- [ ] **Step 15.4: Run tests**

```bash
cd backend && source venv/bin/activate
pytest tests/test_cluster_routes.py -v
```

Expected: all pass.

- [ ] **Step 15.5: Commit**

```bash
git add backend/app/routers/content.py backend/tests/test_cluster_routes.py
git commit -m "$(cat <<'EOF'
feat(clusters): wire generate_now to cluster pipeline

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: End-to-end smoke test

**Files:**
- Create: `backend/tests/test_cluster_e2e.py`

- [ ] **Step 16.1: Write the smoke test**

```python
"""End-to-end smoke test for content clusters."""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, ContentCluster, ContentDraft, Prompt
from tests.conftest import register_and_login

BRIEF_JSON = '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],"stats":[],"narrative_spine":"n","tone_notes":"t"}'


@pytest.mark.asyncio
async def test_full_cluster_lifecycle(async_client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await register_and_login(async_client, "ck-e2e@test.com")
    brand = Brand(name="Acme", slug="ck-e2e-acme", user_id=user.id, subscription_tier="starter")
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=BRIEF_JSON)), \
         patch("app.services.clustering_service._generate_piece_text", new=AsyncMock(return_value=("Title", "Body."))):
        # 1. Trigger cluster regeneration
        r1 = await async_client.post(
            f"/api/clusters/{brand.id}/by-prompt/{prompt.id}/regenerate",
            headers=headers,
        )
        assert r1.status_code == 200
        cluster_id = r1.json()["id"]

        # 2. List shows the cluster
        r2 = await async_client.get(f"/api/clusters/{brand.id}", headers=headers)
        assert r2.status_code == 200
        body = r2.json()
        assert len(body) == 1
        assert body[0]["status"] == "ready"
        assert len(body[0]["pieces"]) == 5

        # 3. Detail returns brief + drafts
        r3 = await async_client.get(f"/api/clusters/{brand.id}/{cluster_id}", headers=headers)
        assert r3.status_code == 200
        detail = r3.json()
        assert detail["brief"] is not None
        assert detail["brief"]["positioning"] == "P"
        assert len(detail["drafts"]) == 5

        # 4. Edit brief
        r4 = await async_client.patch(
            f"/api/clusters/{brand.id}/{cluster_id}/brief",
            headers=headers,
            json={"positioning": "Updated positioning"},
        )
        assert r4.status_code == 200
        assert r4.json()["positioning"] == "Updated positioning"

        # 5. Regenerate one piece
        r5 = await async_client.post(
            f"/api/clusters/{brand.id}/{cluster_id}/regenerate-piece",
            headers=headers,
            json={"platform": "linkedin"},
        )
        assert r5.status_code == 200
```

- [ ] **Step 16.2: Run the smoke test**

```bash
cd backend && source venv/bin/activate
pytest tests/test_cluster_e2e.py -v
```

Expected: 1 pass.

- [ ] **Step 16.3: Run the full cluster test suite as a regression check**

```bash
pytest tests/test_cluster_models.py tests/test_cluster_brief.py tests/test_cluster_pillar.py tests/test_clustering_service.py tests/test_cluster_routes.py tests/test_cluster_e2e.py tests/test_drafting_prompts_brief.py -v
```

Expected: all pass.

- [ ] **Step 16.4: Run the wider draft test suite to verify no regressions**

```bash
pytest tests/test_content.py -v
```

Expected: all existing tests still pass. If any fail because they assumed the old single-draft-per-prompt flow, update them to reflect cluster behavior.

- [ ] **Step 16.5: Commit**

```bash
git add backend/tests/test_cluster_e2e.py
git commit -m "$(cat <<'EOF'
test(clusters): end-to-end smoke test for full cluster lifecycle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Update CLAUDE.md and CURRENT_STATE.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CURRENT_STATE.md`

- [ ] **Step 17.1: Update CLAUDE.md**

Add two rows to the "Model Summary" table after `ContentDraft`:

```
| `ContentCluster` | id, brand_id FK, prompt_id FK (unique), status, pillar_mode, pillar_url, last_brief_id FK, version, last_generated_at |
| `ContentBrief` | id, cluster_id FK, version, positioning, key_claims (JSON), canonical_phrasings (JSON), stats (JSON), competitor_context (JSON), narrative_spine, tone_notes, created_by |
```

Add `cluster_id` to the `ContentDraft` row.

Add a row to the "Router Mounts" table:

```
| clusters.py | /api/clusters | Cluster lifecycle: list, detail, regenerate, edit brief, pillar accept/reject |
```

Under "Key Patterns" → "Content Drafting Flow", append:

> **Clusters.** Each prompt has a `ContentCluster` with a shared `ContentBrief` (positioning, canonical phrasings, stats, narrative spine). Drafts within a cluster are generated in parallel from the brief and cross-reference siblings semantically. Wikipedia is excluded from clusters; clusters cover linkedin, medium, reddit, quora, x. Pillar pages (own-site) are optional, tone-gated, and proposed only when an audit page passes a neutral-voice check.

- [ ] **Step 17.2: Update CURRENT_STATE.md**

Replace the "Current Task / WIP" → "Most recent work" entry with:

```markdown
- **Most recent work:** **Content Clusters module shipped on branch `feat/content-quality-rebuild`** (built directly on the branch). Replaces per-prompt one-off drafts with coordinated 5-piece cross-affirming clusters (LinkedIn, Medium, Reddit, Quora, X) generated from a shared ContentBrief. Wikipedia carved into its own placeholder tab. Optional own-site pillar with LLM tone gate. 2 new tables + 1 column, 7 new endpoints, new tabbed `/content/[brandId]` UX + cluster detail page. Clean-slate migration (deletes unposted drafts; preserves posted ones with cluster_id null). Specs: `docs/superpowers/specs/2026-05-11-content-clusters-design.md`. Plan: `docs/superpowers/plans/2026-05-12-content-clusters.md`.
- **Branch:** `feat/content-quality-rebuild`
- **Next concrete step:** Merge to main; communicate clean-slate migration to existing users; monitor first wave of cluster regenerations for brief quality.
- **Blockers / waiting on:** None known.
```

Append a new entry to "Recent Decisions" at the top:

```markdown
- **2026-05-12** — Shipped **Content Clusters** on `feat/content-quality-rebuild`. Each prompt → one cluster of 5 cross-affirming platform pieces generated from a persisted ContentBrief. Wikipedia carved out into its own tab (no more marketing-coded Wiki drafts). Optional own-site pillar gated by LLM tone check (default off — promotional pillars hurt AIO). Clean-slate migration: unposted drafts deleted, posted drafts retained with cluster_id null.
```

- [ ] **Step 17.3: Commit**

```bash
git add CLAUDE.md CURRENT_STATE.md
git commit -m "$(cat <<'EOF'
docs(clusters): update CLAUDE.md and CURRENT_STATE.md for content clusters

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

- [ ] **Run the whole backend suite**

```bash
cd backend && source venv/bin/activate
pytest -v
```

Expected: all green. Investigate any failures before merging.

- [ ] **Frontend build**

```bash
cd frontend && npm run build && npm run lint
```

Expected: no errors.

- [ ] **Manual smoke in dev**

Backend on 3001, frontend on 3002. Steps:
1. Log in to an existing test account with at least one brand and prompts.
2. Navigate to `/content/<brandId>`.
3. Verify clusters tab shows cluster cards (or empty state if first run).
4. Click "Regenerate" on a cluster → verify pieces populate (with mocks off, this hits real LLMs).
5. Open cluster detail → verify brief panel + 5 piece cards render.
6. Edit brief inline → verify update sticks.
7. Regenerate a single piece → verify only that piece updates.
8. Switch to Wikipedia tab → verify placeholder renders.
9. Switch to Opportunities + Gaps → verify they behave as before.

If anything is off, fix in a follow-up commit.

---

## Notes for the implementing engineer

- **DRY:** the `_generate_piece_text` helper in `clustering_service.py` is the *only* place that should call `build_prompt` + `call_claude` for cluster pieces. Don't duplicate this logic anywhere else.
- **YAGNI:** the `competitor_context` JSON field on `ContentBrief` is intentionally permissive — we're not validating its shape. We may extend it later, but for v1 just stash the competitor block string as-is.
- **TDD:** the test for each backend task must be written *before* the implementation. Run it, confirm it fails, then implement. Do not skip this.
- **Tests use the existing `tests/conftest.py` fixtures.** `register_and_login(async_client, email)` returns `(headers, User)`. `db_session` is the test session. `async_client` is the HTTPX test client.
- **Pillar workflow is opt-in.** The propose endpoint is called explicitly from the cluster detail page; pillar attachment happens only via the accept endpoint. Never auto-attach.
- **Cost discipline:** brief generation is one LLM call per cluster regeneration. Don't loop it inside piece generation. If a user regenerates a single piece via `regenerate-piece`, reuse `cluster.last_brief_id` — don't regenerate the brief.
