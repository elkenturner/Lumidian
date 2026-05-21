# Content Cluster Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reground the Content Cluster feature on a shared, tiered, third-party-authority-first evidence pipeline and make the cluster the single home for all content work on a tracked prompt — including post-publish lifecycle.

**Architecture:** Replace per-piece evidence retrieval with a single cluster-level evidence pack that is built once, gated by domain authority tiers (T1/T2/T3), shared across all 5 pieces. Add a Pro-tier citation-critic LLM pass that validates marker→claim support. Refactor cluster statuses to distinguish briefing failures from generation partials, with per-piece micro-state and failure reasons. Frontend collapses tabs on `/content/[brandId]` to a single cluster list; cluster pieces never appear in any generic drafts list.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, SQLite, APScheduler, Next.js 15 / React 18 / TypeScript / Tailwind, Axios.

**Spec:** `docs/superpowers/specs/2026-05-20-content-cluster-redesign-design.md`

---

## File structure

### Backend — new files
- `backend/app/services/source_authority.py` — T1/T2 domain registry, `classify_domain()`
- `backend/app/services/cluster_evidence.py` — cluster-level evidence pack builder + persistence
- `backend/app/services/citation_critic.py` — Pro-tier LLM marker validation pass
- `backend/tests/test_source_authority.py`
- `backend/tests/test_cluster_evidence.py`
- `backend/tests/test_citation_critic.py`
- `backend/tests/test_cluster_pipeline.py`

### Backend — modified files
- `backend/app/models.py` — new tables (`ContentEvidencePack`, `ContentClusterSource`), new fields on `ContentCluster`, `ContentBrief`, `ContentDraft`
- `backend/app/database.py` — migrations for the above
- `backend/app/schemas.py` — Pydantic for new shapes (status payload, sources payload, brief history)
- `backend/app/services/clustering_service.py` — shared pack flow, new statuses, micro-state, critic, asymmetric cluster ref
- `backend/app/services/cluster_brief.py` — brief versioning rules (always new row; no auto-promote of `last_brief_id`)
- `backend/app/services/drafting/citations.py` — LinkedIn end-of-post Sources block, Reddit conversational sources, asymmetric cluster reference appender
- `backend/app/services/drafting/prompts.py` — writer prompt now requires verbatim canonical phrasings and shows tier badges
- `backend/app/routers/clusters.py` — new endpoints (status, regenerate-pieces, rebuild, brief history, revert, sources); brief PATCH now saves a draft brief without promoting it
- `backend/app/scheduler.py` — extend stale-run job to flip stuck clusters
- `backend/tests/test_clusters.py` — assertions updated to new status names and lifecycle

### Frontend — new files
- `frontend/components/content/cluster/SourceSpinePanel.tsx`
- `frontend/components/content/cluster/BriefVersionHistory.tsx`
- `frontend/components/content/cluster/CitationsSubpanel.tsx`
- `frontend/components/content/cluster/CriticNotesSubpanel.tsx`
- `frontend/components/content/cluster/InputsZone.tsx`
- `frontend/hooks/useClusterStatus.ts` — polling hook
- `frontend/app/content/[brandId]/archive/page.tsx` — legacy posted drafts archive

### Frontend — modified files
- `frontend/app/content/[brandId]/page.tsx` — tabs removed; cluster list only
- `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` — 3-zone layout
- `frontend/components/content/cluster/ClusterCard.tsx` — brief version, pack health, attribution delta
- `frontend/components/content/cluster/BriefPanel.tsx` — current vs draft, version history banner
- `frontend/components/content/cluster/PieceCard.tsx` — micro-state, inline attribution, failure badge
- `frontend/lib/api.ts` — new methods

---

## Task list

### Task 1: Source authority registry — scaffold + classify_domain

**Files:**
- Create: `backend/app/services/source_authority.py`
- Test: `backend/tests/test_source_authority.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_source_authority.py
from app.services.source_authority import classify_domain


def test_t1_includes_nytimes():
    assert classify_domain("nytimes.com") == "T1"


def test_t1_strips_www():
    assert classify_domain("www.nytimes.com") == "T1"


def test_gov_heuristic_to_t1():
    assert classify_domain("cdc.gov") == "T1"


def test_edu_heuristic_to_t1():
    assert classify_domain("stanford.edu") == "T1"


def test_t2_known_trade_press():
    assert classify_domain("techcrunch.com") == "T2"


def test_t3_default_for_unknown():
    assert classify_domain("randomblog.example.com") == "T3"


def test_t3_for_empty():
    assert classify_domain("") == "T3"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/test_source_authority.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.source_authority'`

- [ ] **Step 3: Implement the registry + classifier**

```python
# backend/app/services/source_authority.py
"""T1/T2/T3 domain authority classification for cluster evidence packs.

T1: established press, major wire services, peer-reviewed, .gov, .edu
T2: trade press, recognized industry publications
T3: everything else (default — long tail, marketing blogs, etc.)

The T1/T2 sets are curated by hand and live in code so they're version-
controlled. Add a domain via PR.
"""
from __future__ import annotations

from typing import Literal

Tier = Literal["T1", "T2", "T3"]

T1_DOMAINS: set[str] = {
    # Wire services & global press
    "nytimes.com", "reuters.com", "bloomberg.com", "wsj.com", "ap.org",
    "ft.com", "economist.com", "washingtonpost.com", "bbc.com", "bbc.co.uk",
    "theguardian.com", "npr.org",
    # Peer-reviewed / scientific
    "nature.com", "science.org", "thelancet.com", "nejm.org", "pnas.org",
    # Top-tier business / policy
    "hbr.org", "mckinsey.com", "brookings.edu",
}

T2_DOMAINS: set[str] = {
    # Tech trade press
    "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
    "venturebeat.com", "theinformation.com", "404media.co",
    # Business trade press
    "forbes.com", "fortune.com", "businessinsider.com", "fastcompany.com",
    "cnbc.com", "axios.com",
    # SaaS / marketing trade
    "saastr.com", "a16z.com", "stratechery.com", "firstround.com",
}


def _normalize(domain: str) -> str:
    d = (domain or "").strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d


def classify_domain(domain: str) -> Tier:
    """Classify a bare domain (e.g. 'nytimes.com') into T1/T2/T3."""
    d = _normalize(domain)
    if not d:
        return "T3"
    if d in T1_DOMAINS:
        return "T1"
    if d in T2_DOMAINS:
        return "T2"
    # Heuristics for the long tail
    if d.endswith(".gov") or d.endswith(".gov.uk"):
        return "T1"
    if d.endswith(".edu"):
        return "T1"
    return "T3"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_source_authority.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/source_authority.py backend/tests/test_source_authority.py
git commit -m "feat(clusters): source authority T1/T2/T3 classifier"
```

---

### Task 2: Expand T1/T2 registry seed

**Files:**
- Modify: `backend/app/services/source_authority.py`
- Test: `backend/tests/test_source_authority.py` (extend)

- [ ] **Step 1: Add coverage assertions**

```python
# Append to backend/tests/test_source_authority.py
def test_t1_registry_minimum_size():
    from app.services.source_authority import T1_DOMAINS
    assert len(T1_DOMAINS) >= 40, "T1 seed too small; add more entries"


def test_t2_registry_minimum_size():
    from app.services.source_authority import T2_DOMAINS
    assert len(T2_DOMAINS) >= 60, "T2 seed too small; add more entries"


def test_t1_covers_major_categories():
    from app.services.source_authority import T1_DOMAINS
    # Must include at least one entry from each major category bucket
    wire = {"reuters.com", "ap.org", "afp.com"}
    science = {"nature.com", "science.org", "thelancet.com", "nejm.org", "pnas.org"}
    policy = {"brookings.edu", "rand.org", "cfr.org", "imf.org", "worldbank.org", "oecd.org"}
    assert wire & T1_DOMAINS
    assert science & T1_DOMAINS
    assert policy & T1_DOMAINS
```

- [ ] **Step 2: Run tests, see them fail**

Run: `pytest tests/test_source_authority.py -v -k "size or covers"`
Expected: FAIL on minimum size and category coverage.

- [ ] **Step 3: Expand seeds**

Extend `T1_DOMAINS` to include (at minimum):
- Additional wire/press: `afp.com`, `time.com`, `newyorker.com`, `theatlantic.com`, `politico.com`, `propublica.org`, `aljazeera.com`, `dw.com`
- Additional science: `cell.com`, `jamanetwork.com`, `bmj.com`, `arxiv.org`
- Policy/research: `rand.org`, `cfr.org`, `imf.org`, `worldbank.org`, `oecd.org`, `pewresearch.org`, `cbo.gov` (will already hit `.gov` heuristic but explicit is fine), `nber.org`, `iea.org`
- Standards bodies: `w3.org`, `ietf.org`, `iso.org`

Extend `T2_DOMAINS` with at least 40 more (tech, business, sector trades). Examples to add:
- Tech: `engadget.com`, `protocol.com`, `restofworld.org`, `theregister.com`, `zdnet.com`, `cnet.com`, `techradar.com`, `tomshardware.com`, `anandtech.com`, `phoronix.com`
- Business: `marketwatch.com`, `barrons.com`, `qz.com`, `pitchbook.com`, `crunchbase.com` (news arm), `inc.com`, `entrepreneur.com`
- Industry/SaaS: `producthunt.com`, `theverge.com` (already), `niemanlab.org`, `cjr.org`, `digiday.com`, `adage.com`, `marketingbrew.com`, `morningbrew.com`, `axios.com` (already), `puck.news`
- Sector trade: `statnews.com`, `medscape.com`, `endpts.com` (biotech); `automotivenews.com`, `electrek.co` (auto); `retaildive.com`, `glossy.co` (retail); `bankingdive.com`, `american-banker.com` (finance); `eweek.com`, `infoworld.com` (IT)

Final counts should be ≥ 40 in T1 and ≥ 60 in T2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_source_authority.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/source_authority.py backend/tests/test_source_authority.py
git commit -m "feat(clusters): expand T1/T2 source authority registry seed"
```

---

### Task 3: Data model — new tables + new fields

**Files:**
- Modify: `backend/app/models.py` (add `ContentEvidencePack`, `ContentClusterSource`; extend `ContentCluster`, `ContentBrief`, `ContentDraft`)

- [ ] **Step 1: Write a failing model-level test**

```python
# backend/tests/test_cluster_models.py
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, ContentBrief, ContentCluster, ContentClusterSource,
    ContentDraft, ContentEvidencePack, Prompt, User,
)


@pytest.mark.asyncio
async def test_evidence_pack_persists():
    async with AsyncSessionLocal() as db:
        user = User(email="e@example.com", password_hash="x", name="t")
        db.add(user)
        await db.flush()
        brand = Brand(name="Acme", slug="acme-test-modelchk", user_id=user.id)
        db.add(brand)
        await db.flush()
        prompt = Prompt(brand_id=brand.id, text="best CRM")
        db.add(prompt)
        await db.flush()
        cluster = ContentCluster(
            brand_id=brand.id, prompt_id=prompt.id, status="pending",
        )
        db.add(cluster)
        await db.flush()
        pack = ContentEvidencePack(
            cluster_id=cluster.id, version=1,
            sources=[{"url": "https://reuters.com/x", "tier": "T1"}],
            total_t1=1, total_t2=0, total_t3=0,
        )
        db.add(pack)
        await db.flush()
        src = ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://reuters.com/x", domain="reuters.com",
            tier="T1", title="X", times_cited=0,
        )
        db.add(src)
        await db.commit()

        # Re-fetch and verify
        loaded = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster.id)
        )).scalar_one()
        assert loaded.total_t1 == 1
        assert loaded.sources[0]["url"] == "https://reuters.com/x"


@pytest.mark.asyncio
async def test_cluster_failure_reason_field():
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(
            brand_id=1, prompt_id=1, status="briefing_failed",
            failure_reason="insufficient_t1_sources",
        )
        # Just construct; ensure attribute exists
        assert cluster.failure_reason == "insufficient_t1_sources"


@pytest.mark.asyncio
async def test_draft_generation_state_default():
    draft = ContentDraft(
        brand_id=1, platform="medium", content_text="x", source="cluster",
    )
    # default kicked in only after flush; here just assert the column is present
    from app.models import ContentDraft as M
    assert hasattr(M, "generation_state")
    assert hasattr(M, "failure_reason")
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_cluster_models.py -v`
Expected: FAIL with `ImportError: cannot import name 'ContentEvidencePack'` (and/or attribute errors on the new fields).

- [ ] **Step 3: Add new models + fields**

In `backend/app/models.py`, modify `ContentCluster` to add `failure_reason`:

```python
# inside class ContentCluster, after last_generated_at
failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

Modify `ContentBrief` to add `evidence_pack_id`:

```python
# inside class ContentBrief, after created_at (or anywhere before relationships)
evidence_pack_id: Mapped[int | None] = mapped_column(
    Integer,
    ForeignKey("content_evidence_packs.id", ondelete="SET NULL", use_alter=True,
               name="fk_content_briefs_evidence_pack_id"),
    nullable=True,
)
```

Modify `ContentDraft` to add `failure_reason` and `generation_state`:

```python
# inside class ContentDraft, after `cluster_id`
failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
generation_state: Mapped[str] = mapped_column(String(20), nullable=False, default="done")
```

Add two new model classes near the existing `ContentBrief` (after it):

```python
class ContentEvidencePack(Base):
    """A cluster-level evidence pack, versioned alongside ContentBrief."""
    __tablename__ = "content_evidence_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cluster_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    total_t1: Mapped[int] = mapped_column(Integer, default=0)
    total_t2: Mapped[int] = mapped_column(Integer, default=0)
    total_t3: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContentClusterSource(Base):
    """Dedup'd source spine for a cluster — one row per unique URL per cluster."""
    __tablename__ = "content_cluster_sources"
    __table_args__ = (
        UniqueConstraint("cluster_id", "url", name="uq_cluster_source_cluster_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cluster_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True
    )
    evidence_pack_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_evidence_packs.id", ondelete="CASCADE")
    )
    url: Mapped[str] = mapped_column(String(2048))
    domain: Mapped[str] = mapped_column(String(255), index=True)
    tier: Mapped[str] = mapped_column(String(2))  # "T1"/"T2"/"T3"
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    times_cited: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_cluster_models.py -v`
Expected: all tests PASS. `create_all()` (triggered by the conftest fixture) creates the new tables.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_cluster_models.py
git commit -m "feat(clusters): add evidence pack + source spine tables + new fields"
```

---

### Task 4: Migrations in database.py

**Files:**
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add a migration test**

```python
# backend/tests/test_cluster_migrations.py
import pytest
from sqlalchemy import text

from app.database import AsyncSessionLocal, run_migrations


@pytest.mark.asyncio
async def test_migrations_idempotent_for_new_fields():
    # Run migrations twice — must not raise. The fresh test DB will not have
    # the legacy `partial_failed` rows, but the migration should be a no-op then.
    await run_migrations()
    await run_migrations()
    async with AsyncSessionLocal() as db:
        # New columns are present
        row = await db.execute(text("PRAGMA table_info(content_clusters)"))
        cols = {r[1] for r in row.fetchall()}
        assert "failure_reason" in cols

        row = await db.execute(text("PRAGMA table_info(content_drafts)"))
        cols = {r[1] for r in row.fetchall()}
        assert "failure_reason" in cols
        assert "generation_state" in cols

        row = await db.execute(text("PRAGMA table_info(content_briefs)"))
        cols = {r[1] for r in row.fetchall()}
        assert "evidence_pack_id" in cols
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_cluster_migrations.py -v`
Expected: FAIL on `failure_reason` not present (migrations haven't been added yet).

- [ ] **Step 3: Append migrations**

In `backend/app/database.py`, find the `migrations` list inside `run_migrations()`. Append at the very end (before the closing `]`):

```python
        # 2026-05-20: Content cluster redesign — new fields + status rename
        "ALTER TABLE content_clusters ADD COLUMN failure_reason TEXT",
        "UPDATE content_clusters SET status='generation_partial' WHERE status='partial_failed'",
        "ALTER TABLE content_briefs ADD COLUMN evidence_pack_id INTEGER",
        "ALTER TABLE content_drafts ADD COLUMN failure_reason TEXT",
        "ALTER TABLE content_drafts ADD COLUMN generation_state TEXT NOT NULL DEFAULT 'done'",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_cluster_migrations.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py backend/tests/test_cluster_migrations.py
git commit -m "feat(clusters): migrations for evidence pack tables + new fields"
```

---

### Task 5: Cluster evidence pack — query expansion + Serper fetch + dedup

**Files:**
- Create: `backend/app/services/cluster_evidence.py`
- Test: `backend/tests/test_cluster_evidence.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cluster_evidence.py
from unittest.mock import patch

import pytest

from app.services.cluster_evidence import expand_queries, fetch_and_dedupe


def test_expand_queries_uses_prompt_and_claims():
    queries = expand_queries(
        prompt_text="best CRM for solo founders",
        key_claims=["Notion bundles tasks and docs", "HubSpot has a free tier"],
    )
    assert "best CRM for solo founders" in queries
    # Each claim becomes its own search query
    assert any("Notion bundles" in q for q in queries)
    assert any("HubSpot" in q for q in queries)
    # Capped at 5
    assert 1 <= len(queries) <= 5


def test_expand_queries_dedupes():
    queries = expand_queries(
        prompt_text="best CRM",
        key_claims=["best CRM", "best CRM"],
    )
    assert len(queries) == 1


@pytest.mark.asyncio
async def test_fetch_and_dedupe_drops_dupes_across_queries():
    fake_results = {
        "q1": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        ],
        "q2": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},  # dup
            {"url": "https://oecd.org/c", "title": "C", "snippet": "..."},
        ],
    }

    async def fake_serper(query: str, num: int = 10):
        return fake_results[query]

    with patch("app.services.cluster_evidence._serper_search", side_effect=fake_serper):
        merged = await fetch_and_dedupe(["q1", "q2"])

    urls = [m["url"] for m in merged]
    assert urls.count("https://reuters.com/a") == 1
    assert "https://nytimes.com/b" in urls
    assert "https://oecd.org/c" in urls
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_cluster_evidence.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement scaffolding for query expansion + Serper fetch + dedupe**

```python
# backend/app/services/cluster_evidence.py
"""Cluster-level evidence pack builder.

Builds one evidence pack per cluster (not per piece). Pack is gated by domain
authority tier counts and persisted to ContentEvidencePack + ContentClusterSource.

Public entry points:
    build_cluster_pack(...)    — top-level: build + tier + gate + persist
    expand_queries(...)        — derive search queries from prompt + claims
    fetch_and_dedupe(...)      — call Serper across queries, dedupe by URL
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from app.services.drafting.evidence import _serper_search  # reuse existing client

logger = logging.getLogger(__name__)

MAX_QUERIES = 5
PER_QUERY_LIMIT = 10


def expand_queries(*, prompt_text: str, key_claims: list[str]) -> list[str]:
    """Derive up to MAX_QUERIES distinct search queries from prompt + claims."""
    queries: list[str] = []
    seen: set[str] = set()
    def _add(q: str) -> None:
        norm = q.strip().lower()
        if norm and norm not in seen:
            seen.add(norm)
            queries.append(q.strip())
    _add(prompt_text)
    for claim in key_claims:
        _add(claim)
        if len(queries) >= MAX_QUERIES:
            break
    return queries[:MAX_QUERIES]


def _normalize_url(url: str) -> str:
    """Canonical form for dedup: scheme + netloc + path; strip query/fragment."""
    try:
        p = urlparse(url)
        host = p.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return f"{p.scheme}://{host}{p.path.rstrip('/')}"
    except Exception:
        return url


async def fetch_and_dedupe(queries: list[str]) -> list[dict[str, Any]]:
    """Run Serper for each query, merge, dedup by normalized URL."""
    seen: dict[str, dict[str, Any]] = {}
    for q in queries:
        try:
            results = await _serper_search(q, num=PER_QUERY_LIMIT)
        except Exception as exc:
            logger.warning("Serper failed for cluster query %r: %s", q, exc)
            continue
        for r in results:
            url = r.get("link") or r.get("url")
            if not url:
                continue
            key = _normalize_url(url)
            if key in seen:
                continue
            seen[key] = {
                "url": url,
                "title": r.get("title") or "",
                "snippet": r.get("snippet") or "",
            }
    return list(seen.values())
```

(Note: `_serper_search` in `app.services.drafting.evidence` returns dicts with `"link"` or `"url"` keys depending on Serper response format — we handle both. Read `evidence.py:185+` to confirm shape if needed.)

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_cluster_evidence.py::test_expand_queries_uses_prompt_and_claims tests/test_cluster_evidence.py::test_expand_queries_dedupes tests/test_cluster_evidence.py::test_fetch_and_dedupe_drops_dupes_across_queries -v`
Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/cluster_evidence.py backend/tests/test_cluster_evidence.py
git commit -m "feat(clusters): cluster-level query expansion + dedup'd Serper fetch"
```

---

### Task 6: Cluster evidence pack — authority tiering + ranking + cap + gate

**Files:**
- Modify: `backend/app/services/cluster_evidence.py`
- Modify: `backend/tests/test_cluster_evidence.py`

- [ ] **Step 1: Write failing tests**

```python
# Append to backend/tests/test_cluster_evidence.py
import pytest

from app.services.cluster_evidence import (
    PackGateError, rank_and_tier, gate_pack,
)


def _src(url: str, title: str = "t", snippet: str = "s") -> dict:
    return {"url": url, "title": title, "snippet": snippet}


def test_rank_prefers_t1_then_t2_then_t3():
    raw = [
        _src("https://randomblog.example.com/a"),  # T3
        _src("https://reuters.com/x"),              # T1
        _src("https://techcrunch.com/y"),           # T2
    ]
    ranked = rank_and_tier(raw)
    assert ranked[0]["tier"] == "T1"
    assert ranked[1]["tier"] == "T2"
    assert ranked[2]["tier"] == "T3"


def test_rank_attaches_tier_and_domain():
    raw = [_src("https://www.nytimes.com/path")]
    ranked = rank_and_tier(raw)
    assert ranked[0]["domain"] == "nytimes.com"
    assert ranked[0]["tier"] == "T1"


def test_gate_passes_with_two_t1():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://nytimes.com/b") | {"tier": "T1", "domain": "nytimes.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
    ]
    gate_pack(pack)  # should not raise


def test_gate_fails_with_one_t1():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
        _src("https://axios.com/e") | {"tier": "T2", "domain": "axios.com"},
    ]
    with pytest.raises(PackGateError) as exc:
        gate_pack(pack)
    assert "T1" in str(exc.value)


def test_gate_fails_when_t1_plus_t2_under_4():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://nytimes.com/b") | {"tier": "T1", "domain": "nytimes.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
    ]
    with pytest.raises(PackGateError):
        gate_pack(pack)
```

- [ ] **Step 2: Run, see failures**

Run: `pytest tests/test_cluster_evidence.py -v -k "rank or gate"`
Expected: FAIL — `rank_and_tier`, `gate_pack`, `PackGateError` don't exist.

- [ ] **Step 3: Implement ranking + gating**

Append to `backend/app/services/cluster_evidence.py`:

```python
from app.services.source_authority import classify_domain

PACK_CAP = 10
MIN_T1 = 2
MIN_T1_PLUS_T2 = 4

_TIER_ORDER = {"T1": 0, "T2": 1, "T3": 2}


class PackGateError(Exception):
    """Raised when the cluster pack doesn't meet authority requirements."""


def _domain_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def rank_and_tier(raw_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Classify each source and sort T1 → T2 → T3. Returns enriched dicts."""
    enriched = []
    for s in raw_sources:
        domain = _domain_of(s["url"])
        tier = classify_domain(domain)
        enriched.append({**s, "domain": domain, "tier": tier})
    enriched.sort(key=lambda x: _TIER_ORDER[x["tier"]])
    return enriched


def gate_pack(pack: list[dict[str, Any]]) -> None:
    """Raise PackGateError if pack doesn't have enough authoritative sources."""
    t1 = sum(1 for s in pack if s["tier"] == "T1")
    t2 = sum(1 for s in pack if s["tier"] == "T2")
    if t1 < MIN_T1:
        raise PackGateError(
            f"insufficient_t1_sources: found {t1}, need at least {MIN_T1}"
        )
    if t1 + t2 < MIN_T1_PLUS_T2:
        raise PackGateError(
            f"insufficient_authority: T1+T2 = {t1 + t2}, need at least {MIN_T1_PLUS_T2}"
        )
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_cluster_evidence.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/cluster_evidence.py backend/tests/test_cluster_evidence.py
git commit -m "feat(clusters): authority tiering + pack-gate enforcement"
```

---

### Task 7: Cluster evidence pack — full builder + persistence

**Files:**
- Modify: `backend/app/services/cluster_evidence.py`
- Modify: `backend/tests/test_cluster_evidence.py`

- [ ] **Step 1: Write the failing integration test**

```python
# Append to backend/tests/test_cluster_evidence.py
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, ContentCluster, ContentClusterSource, ContentEvidencePack,
    Prompt, User,
)
from app.services.cluster_evidence import build_cluster_pack


@pytest.mark.asyncio
async def test_build_cluster_pack_persists_and_dedups(monkeypatch):
    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
            {"url": "https://randomblog.example.com/e", "title": "E", "snippet": "..."},
        ]
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="pack@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-pack-test", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="best CRM for solo founders")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        pack = await build_cluster_pack(
            db,
            cluster=cluster,
            prompt_text="best CRM for solo founders",
            key_claims=["Notion bundles tasks and docs"],
            version=1,
        )

        assert pack.total_t1 == 2
        assert pack.total_t2 == 2
        assert pack.total_t3 == 1
        assert len(pack.sources) == 5

        rows = (await db.execute(
            select(ContentClusterSource).where(ContentClusterSource.cluster_id == cluster.id)
        )).scalars().all()
        assert len(rows) == 5
        assert {r.tier for r in rows} == {"T1", "T2", "T3"}


@pytest.mark.asyncio
async def test_build_cluster_pack_raises_when_authority_too_low(monkeypatch):
    async def fake_fetch(queries):
        # Only one T1, rest T3
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://randomblog.example.com/b", "title": "B", "snippet": "..."},
            {"url": "https://otherblog.example.com/c", "title": "C", "snippet": "..."},
        ]
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="pack2@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-pack-test-2", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        from app.services.cluster_evidence import PackGateError
        with pytest.raises(PackGateError):
            await build_cluster_pack(
                db,
                cluster=cluster,
                prompt_text="q",
                key_claims=[],
                version=1,
            )

        # Nothing persisted on failure
        rows = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster.id)
        )).scalars().all()
        assert rows == []
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_cluster_evidence.py -v -k "persist or raises_when_authority"`
Expected: FAIL — `build_cluster_pack` not implemented.

- [ ] **Step 3: Implement the top-level builder + persistence**

Append to `backend/app/services/cluster_evidence.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import (
    ContentCluster, ContentClusterSource, ContentEvidencePack,
)


async def build_cluster_pack(
    db: AsyncSession,
    *,
    cluster: ContentCluster,
    prompt_text: str,
    key_claims: list[str],
    version: int,
) -> ContentEvidencePack:
    """Build, tier, gate, and persist a cluster-level evidence pack.

    Raises PackGateError if authority gates fail. On failure, nothing is
    persisted; caller should set cluster.status = 'briefing_failed' with
    failure_reason = str(exc).
    """
    queries = expand_queries(prompt_text=prompt_text, key_claims=key_claims)
    raw = await fetch_and_dedupe(queries)
    ranked = rank_and_tier(raw)
    pack_sources = ranked[:PACK_CAP]
    gate_pack(pack_sources)  # raises on failure

    pack = ContentEvidencePack(
        cluster_id=cluster.id,
        version=version,
        sources=pack_sources,
        total_t1=sum(1 for s in pack_sources if s["tier"] == "T1"),
        total_t2=sum(1 for s in pack_sources if s["tier"] == "T2"),
        total_t3=sum(1 for s in pack_sources if s["tier"] == "T3"),
    )
    db.add(pack)
    await db.flush()

    for s in pack_sources:
        db.add(ContentClusterSource(
            cluster_id=cluster.id,
            evidence_pack_id=pack.id,
            url=s["url"],
            domain=s["domain"],
            tier=s["tier"],
            title=s.get("title"),
            times_cited=0,
        ))
    await db.commit()
    await db.refresh(pack)
    return pack
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_cluster_evidence.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/cluster_evidence.py backend/tests/test_cluster_evidence.py
git commit -m "feat(clusters): persist cluster evidence pack + source spine rows"
```

---

### Task 8: Citation critic — LLM marker validation

**Files:**
- Create: `backend/app/services/citation_critic.py`
- Test: `backend/tests/test_citation_critic.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_citation_critic.py
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.citation_critic import critique_citations


@pytest.mark.asyncio
async def test_keeps_supported_markers():
    fake_response = json.dumps({"markers": [
        {"original": "S1", "action": "keep"},
        {"original": "S2", "action": "keep"},
    ]})
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value=fake_response)):
        out = await critique_citations(
            text="The widget grew 47% [S1] and the market doubled [S2].",
            pack_sources=[
                {"url": "https://reuters.com/a", "tier": "T1", "snippet": "widget grew 47%"},
                {"url": "https://nytimes.com/b", "tier": "T1", "snippet": "market doubled"},
            ],
        )
    assert "[S1]" in out
    assert "[S2]" in out


@pytest.mark.asyncio
async def test_drops_unsupported_marker():
    fake_response = json.dumps({"markers": [
        {"original": "S1", "action": "drop", "reason": "snippet does not support claim"},
        {"original": "S2", "action": "keep"},
    ]})
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value=fake_response)):
        out = await critique_citations(
            text="The widget grew 47% [S1] and the market doubled [S2].",
            pack_sources=[
                {"url": "https://reuters.com/a", "tier": "T1", "snippet": "unrelated content"},
                {"url": "https://nytimes.com/b", "tier": "T1", "snippet": "market doubled"},
            ],
        )
    assert "[S1]" not in out
    assert "[S2]" in out


@pytest.mark.asyncio
async def test_returns_original_on_malformed_response():
    with patch("app.services.citation_critic._call_critic", new=AsyncMock(return_value="garbage")):
        out = await critique_citations(
            text="X [S1] Y [S2]",
            pack_sources=[{"url": "u", "tier": "T1", "snippet": "..."}] * 2,
        )
    # Conservative fallback: original text returned unmodified
    assert out == "X [S1] Y [S2]"
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_citation_critic.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the critic**

```python
# backend/app/services/citation_critic.py
"""Pro-tier post-generation pass that validates citation markers against sources.

For each [Sn] in the draft, the critic compares the claim around the marker to
the source's snippet and decides keep / drop. We conservatively return the
original text on any parse failure or LLM error.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services.drafting.client import call_claude
from app.services.drafting.models import CROSS_REF_SUMMARY_MODEL

logger = logging.getLogger(__name__)

_MARKER_RE = re.compile(r"\[S(\d+)\]")

_CRITIC_TEMPLATE = """You are validating citation markers in a draft article.

DRAFT TEXT (citation markers are [S1], [S2], ...):
\"\"\"{text}\"\"\"

SOURCES:
{sources_block}

For each marker that appears in the draft, decide:
- "keep" — the cited source's snippet actually supports the surrounding claim
- "drop" — it does not

Be strict. If you cannot verify support from the snippet alone, choose "drop".

Output strict JSON, no markdown fences:
{{"markers": [{{"original": "S1", "action": "keep" | "drop", "reason": "<one short sentence>"}}, ...]}}"""


def _build_sources_block(sources: list[dict[str, Any]]) -> str:
    lines = []
    for i, s in enumerate(sources, start=1):
        snippet = (s.get("snippet") or "")[:300]
        lines.append(f"[S{i}] ({s.get('tier', '?')}) {s.get('url', '')} — {snippet}")
    return "\n".join(lines)


async def _call_critic(prompt: str) -> str:
    return (await call_claude(prompt=prompt, max_tokens=800, model=CROSS_REF_SUMMARY_MODEL)).strip()


def _parse_json(raw: str) -> dict | None:
    s = raw.strip()
    if s.startswith("```"):
        parts = s.split("```")
        s = parts[1] if len(parts) >= 2 else s
        s = s.lstrip("json").strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


async def critique_citations(
    *,
    text: str,
    pack_sources: list[dict[str, Any]],
) -> str:
    """Run the critic and return the text with bad markers stripped.

    On any failure path returns the original text unmodified (conservative —
    we never make the draft worse than the writer produced).
    """
    if not _MARKER_RE.search(text):
        return text

    prompt = _CRITIC_TEMPLATE.format(
        text=text, sources_block=_build_sources_block(pack_sources),
    )
    try:
        raw = await _call_critic(prompt)
    except Exception as exc:
        logger.warning("Citation critic LLM call failed: %s", exc)
        return text

    data = _parse_json(raw)
    if not data or "markers" not in data:
        return text

    drop_refs: set[str] = set()
    for m in data["markers"]:
        if isinstance(m, dict) and m.get("action") == "drop" and m.get("original"):
            drop_refs.add(m["original"])

    if not drop_refs:
        return text

    def _replace(match: re.Match) -> str:
        ref = f"S{match.group(1)}"
        return "" if ref in drop_refs else match.group(0)

    return _MARKER_RE.sub(_replace, text)
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_citation_critic.py -v`
Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/citation_critic.py backend/tests/test_citation_critic.py
git commit -m "feat(clusters): L3 citation critic for Pro tier"
```

---

### Task 9: Writer prompt — require verbatim canonical phrasings + tier badges

**Files:**
- Modify: `backend/app/services/clustering_service.py` (the `_build_brief_context` function)
- Modify: `backend/tests/test_clusters.py` (if there's an assertion on brief context shape; otherwise add one)

- [ ] **Step 1: Write a failing test for the brief-context format**

```python
# backend/tests/test_brief_context.py (new file)
from app.models import ContentBrief
from app.services.clustering_service import _build_brief_context


def test_brief_context_requires_verbatim_phrasings():
    brief = ContentBrief(
        positioning="x",
        canonical_phrasings=["Acme is the fastest", "Acme uses ML for matching"],
        key_claims=["fast"],
        stats=[], narrative_spine="", tone_notes="",
        competitor_context={},
    )
    ctx = _build_brief_context(brief, sibling_platforms=["medium"])
    # "verbatim required" phrasing must be stronger than the previous "at least 1"
    assert "VERBATIM" in ctx.upper()
    assert "Acme is the fastest" in ctx
    assert "Acme uses ML for matching" in ctx


def test_brief_context_no_sibling_platform_references_in_writer():
    # Sibling platforms are no longer dangled in the writer prompt — they
    # invite hallucinated cross-references.
    brief = ContentBrief(
        positioning="x", canonical_phrasings=[], key_claims=[],
        stats=[], narrative_spine="", tone_notes="",
        competitor_context={},
    )
    ctx = _build_brief_context(brief, sibling_platforms=["medium", "reddit"])
    assert "SIBLING" not in ctx.upper()
```

- [ ] **Step 2: Run, see it fail**

Run: `pytest tests/test_brief_context.py -v`
Expected: FAIL — current text says "use at least 1 verbatim" (not "VERBATIM REQUIRED") and includes SIBLING PLATFORMS section.

- [ ] **Step 3: Update `_build_brief_context`**

In `backend/app/services/clustering_service.py`, replace the function:

```python
def _build_brief_context(brief: ContentBrief, sibling_platforms: list[str]) -> str:
    """Brief context fed to every piece in the cluster.

    Note: sibling_platforms is intentionally NOT included in the writer prompt.
    Dangling sibling platform names invites the LLM to fabricate
    cross-references it can't possibly know (the sibling text doesn't exist
    yet when this piece is being generated). Cross-references are inserted
    deterministically post-generation, see `_append_pillar_reference`.
    The parameter is retained in the signature for call-site compatibility.
    """
    _ = sibling_platforms  # explicitly unused
    lines = [f"POSITIONING: {brief.positioning}"]
    if brief.canonical_phrasings:
        lines.append("CANONICAL PHRASINGS — VERBATIM REQUIRED (include each at least once, word-for-word):")
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
    return "\n".join(lines)
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_brief_context.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_brief_context.py
git commit -m "feat(clusters): require verbatim canonical phrasings; drop sibling refs from writer prompt"
```

---

### Task 10: Citation rendering — LinkedIn end-of-post Sources block + Reddit conversational

**Files:**
- Modify: `backend/app/services/drafting/citations.py`
- Create: `backend/tests/test_citation_rendering.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_citation_rendering.py
from app.services.drafting.citations import render_citations
from app.services.drafting.evidence import EvidencePack, EvidenceSource


def _pack(*sources):
    return EvidencePack(
        sources=[EvidenceSource(ref=f"S{i+1}", kind="web", url=u, title=t, snippet="")
                 for i, (u, t) in enumerate(sources)],
        query="q", brand_name="b",
    )


def test_linkedin_post_now_uses_end_block_not_inline_domain():
    pack = _pack(
        ("https://reuters.com/a", "Reuters story"),
        ("https://nytimes.com/b", "NYT story"),
    )
    rendered, used = render_citations(
        text="Claim one [S1]. Claim two [S2].",
        pack=pack,
        platform="linkedin_post",
    )
    # Inline parenthetical removed
    assert "(source:" not in rendered
    # End-of-post Sources block present
    assert "Sources" in rendered
    assert "Reuters story" in rendered or "reuters.com" in rendered
    assert len(used) == 2


def test_reddit_uses_conversational_woven_block_not_inline_domain():
    pack = _pack(
        ("https://reuters.com/a", "Reuters story"),
        ("https://nytimes.com/b", "NYT story"),
    )
    rendered, used = render_citations(
        text="Claim one [S1]. Claim two [S2].",
        pack=pack,
        platform="reddit",
    )
    # No inline parenthetical
    assert "(source:" not in rendered
    # Trailing conversational line
    assert "More on this:" in rendered or "Sources:" in rendered
    # Both domains surface in the trailing block
    assert "reuters.com" in rendered
    assert "nytimes.com" in rendered


def test_medium_footer_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, used = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="medium",
    )
    assert "Sources" in rendered
    assert "Reuters story" in rendered


def test_x_strips_markers_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, _ = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="x_post",
    )
    assert "[S1]" not in rendered
    assert "(source:" not in rendered


def test_wikipedia_ref_tag_unchanged():
    pack = _pack(("https://reuters.com/a", "Reuters story"))
    rendered, _ = render_citations(
        text="Claim [S1]",
        pack=pack,
        platform="wikipedia",
    )
    assert "<ref>" in rendered
```

- [ ] **Step 2: Run, see failures**

Run: `pytest tests/test_citation_rendering.py -v`
Expected: FAIL on LinkedIn and Reddit assertions (current code uses inline `(source:domain)`).

- [ ] **Step 3: Update `render_citations`**

In `backend/app/services/drafting/citations.py`, replace the platform constants and the renderer body:

```python
# Replace platform sets at module top
_PLATFORMS_WITH_FOOTER = {"medium", "linkedin_article", "quora"}
_LINKEDIN_POST_PLATFORMS = {"linkedin_post", "linkedin_reply"}
_REDDIT_PLATFORMS = {"reddit", "reddit_reply"}
_STRIP_PLATFORMS = {"x_post", "x_thread", "x_reply"}
```

Replace `render_citations` with:

```python
def render_citations(
    text: str,
    pack: EvidencePack,
    platform: str,
) -> tuple[str, list[RenderedCitation]]:
    """Render [SN] markers into platform-native citation forms.

    Per the 2026-05-20 cluster redesign:
      - Medium / linkedin_article / quora: numbered footer block
      - linkedin_post: end-of-post "Sources" numbered block (NOT inline)
      - reddit:        conversational "More on this:" trailing block
      - wikipedia:     <ref>{{cite web}}</ref> inline
      - x_*:           strip markers entirely

    Unmatched markers are stripped silently.
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
        if platform in _LINKEDIN_POST_PLATFORMS or platform in _REDDIT_PLATFORMS:
            # Marker removed inline; references aggregate into trailing block
            return ""
        if platform == "wikipedia":
            return f"<ref>{{{{cite web|url={src.url}|title={src.title}}}}}</ref>"
        display = ref_to_display[ref]
        return f"[{display}]({src.url})"

    rendered = _MARKER_RE.sub(_replace, text).strip()

    if not used:
        return rendered, used

    if platform in _PLATFORMS_WITH_FOOTER:
        footer = ["", "", "Sources"]
        for ref, n in ref_to_display.items():
            src = by_ref[ref]
            footer.append(f"{n}. [{src.title}]({src.url})")
        rendered = rendered + "\n".join(footer)
    elif platform in _LINKEDIN_POST_PLATFORMS:
        footer = ["", "", "Sources:"]
        for ref, n in ref_to_display.items():
            src = by_ref[ref]
            footer.append(f"{n}. {src.title} — {src.url}")
        rendered = rendered + "\n".join(footer)
    elif platform in _REDDIT_PLATFORMS:
        # Reddit native: conversational trailing line, plain markdown
        parts = ["", "", "More on this:"]
        for ref in ref_to_display:
            src = by_ref[ref]
            domain = _domain(src.url)
            parts.append(f"- {domain} — [{src.title}]({src.url})")
        rendered = rendered + "\n".join(parts)

    return rendered, used
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_citation_rendering.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/citations.py backend/tests/test_citation_rendering.py
git commit -m "feat(clusters): platform-native citation rendering for LinkedIn + Reddit"
```

---

### Task 11: Asymmetric cluster reference appender

**Files:**
- Modify: `backend/app/services/clustering_service.py`
- Create: `backend/tests/test_cluster_reference.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cluster_reference.py
from app.services.clustering_service import append_pillar_reference


def test_linkedin_post_appends_further_reading():
    out = append_pillar_reference(
        text="Post body.", platform="linkedin_post",
        pillar_url="https://example.com/medium-post",
    )
    assert "Further reading on Medium" in out
    assert "https://example.com/medium-post" in out


def test_reddit_appends_softly():
    out = append_pillar_reference(
        text="Post body.", platform="reddit",
        pillar_url="https://example.com/medium-post",
    )
    assert "Medium" in out and "https://example.com/medium-post" in out


def test_x_inserts_url_only_no_label():
    out = append_pillar_reference(
        text="A tweet.", platform="x_post",
        pillar_url="https://example.com/m",
    )
    assert "https://example.com/m" in out
    # X is space-constrained — no leading marketing label
    assert "Further reading" not in out


def test_medium_appends_nothing():
    out = append_pillar_reference(
        text="Long article.", platform="medium",
        pillar_url="https://example.com/m",
    )
    assert out == "Long article."


def test_wikipedia_appends_nothing():
    out = append_pillar_reference(
        text="Article.", platform="wikipedia",
        pillar_url="https://example.com/m",
    )
    assert out == "Article."


def test_quora_appends_further_reading():
    out = append_pillar_reference(
        text="Answer.", platform="quora",
        pillar_url="https://example.com/m",
    )
    assert "Further reading on Medium" in out


def test_no_url_returns_unchanged():
    out = append_pillar_reference(text="x", platform="linkedin_post", pillar_url=None)
    assert out == "x"
```

- [ ] **Step 2: Run, see fail**

Run: `pytest tests/test_cluster_reference.py -v`
Expected: FAIL — `append_pillar_reference` does not exist.

- [ ] **Step 3: Implement the appender**

In `backend/app/services/clustering_service.py`, add (near the top, after `CLUSTER_PLATFORMS`):

```python
# Platforms that get a soft "further reading" reference to the cluster's
# Medium piece (or own-site pillar). Asymmetric — Medium/Wikipedia get nothing.
_APPENDS_PILLAR_REF = {
    "linkedin_post", "linkedin_reply", "linkedin_article",
    "reddit", "reddit_reply",
    "quora",
    "x_post", "x_thread", "x_reply",
}


def append_pillar_reference(
    *,
    text: str,
    platform: str,
    pillar_url: str | None,
) -> str:
    """Append an idiomatic 'further reading' link to the cluster's pillar.

    Deterministic — no LLM. Medium and Wikipedia receive nothing.
    """
    if not pillar_url:
        return text
    if platform not in _APPENDS_PILLAR_REF:
        return text

    if platform.startswith("x_"):
        # Space-constrained — bare URL, no label
        return text.rstrip() + f"\n{pillar_url}"
    if platform.startswith("reddit"):
        return text.rstrip() + f"\n\nI wrote a longer version on Medium: {pillar_url}"
    # linkedin_*, quora
    return text.rstrip() + f"\n\nFurther reading on Medium: {pillar_url}"
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_cluster_reference.py -v`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_cluster_reference.py
git commit -m "feat(clusters): asymmetric pillar-ref appender (deterministic, post-gen)"
```

---

### Task 12: Brief versioning — every edit creates a new row; last_brief_id only on regen

**Files:**
- Modify: `backend/app/routers/clusters.py` (the `edit_brief` endpoint)
- Modify: `backend/tests/test_clusters.py` (or new file)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_brief_versioning.py
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ContentBrief, ContentCluster
from tests.conftest import register_and_login, create_brand  # existing helpers


@pytest.mark.asyncio
async def test_edit_brief_creates_new_version_does_not_promote(client):
    headers, _user = await register_and_login(client, "brief@v.com")
    brand = await create_brand(client, headers, "BV")
    # Create a prompt
    r = await client.post(
        f"/api/brands/{brand['id']}/prompts", json={"text": "best CRM"}, headers=headers,
    )
    prompt_id = r.json()["id"]

    # Seed a cluster with an initial brief manually
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster); await db.flush()
        brief_v1 = ContentBrief(
            cluster_id=cluster.id, version=1, positioning="v1", canonical_phrasings=[],
            key_claims=[], stats=[], competitor_context={}, narrative_spine="", tone_notes="",
        )
        db.add(brief_v1); await db.flush()
        cluster.last_brief_id = brief_v1.id
        await db.commit()
        cluster_id = cluster.id

    # PATCH brief — edits must create v2, leave last_brief_id pointing at v1
    r = await client.patch(
        f"/api/clusters/{brand['id']}/{cluster_id}/brief",
        json={"positioning": "v2"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["positioning"] == "v2"
    assert body["version"] == 2

    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.id == cluster_id)
        )).scalar_one()
        # last_brief_id still v1 (pieces were generated from v1; not auto-promoted)
        v1 = (await db.execute(
            select(ContentBrief).where(
                ContentBrief.cluster_id == cluster_id, ContentBrief.version == 1
            )
        )).scalar_one()
        assert cluster.last_brief_id == v1.id

        all_briefs = (await db.execute(
            select(ContentBrief).where(ContentBrief.cluster_id == cluster_id)
        )).scalars().all()
        assert len(all_briefs) == 2
        assert {b.version for b in all_briefs} == {1, 2}
```

- [ ] **Step 2: Run, see fail**

Run: `pytest tests/test_brief_versioning.py -v`
Expected: FAIL — current `edit_brief` mutates the existing brief in place.

- [ ] **Step 3: Replace `edit_brief`**

In `backend/app/routers/clusters.py`, replace the `edit_brief` function:

```python
@router.patch("/{brand_id}/{cluster_id}/brief", response_model=ContentBriefSchema)
async def edit_brief(
    brand_id: int,
    cluster_id: int,
    request: EditBriefRequest,
    db: DbDep,
    user: CurrentUser,
) -> ContentBrief:
    """Save brief edits as a NEW version. Does NOT update last_brief_id —
    that field only moves when pieces are actually regenerated from the brief
    (see regenerate_cluster). This is the 'draft brief' semantics: edits are
    persisted, but the cluster still reflects pieces generated from an earlier
    version until the user explicitly regenerates."""
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")

    # Find the current head version (highest)
    head = (await db.execute(
        select(ContentBrief).where(ContentBrief.cluster_id == cluster.id)
        .order_by(ContentBrief.version.desc())
    )).scalars().first()
    if head is None:
        raise HTTPException(404, "No brief to edit")

    new = ContentBrief(
        cluster_id=cluster.id,
        version=head.version + 1,
        positioning=request.positioning if request.positioning is not None else head.positioning,
        key_claims=request.key_claims if request.key_claims is not None else head.key_claims,
        canonical_phrasings=request.canonical_phrasings if request.canonical_phrasings is not None else head.canonical_phrasings,
        stats=request.stats if request.stats is not None else head.stats,
        competitor_context=head.competitor_context,
        narrative_spine=request.narrative_spine if request.narrative_spine is not None else head.narrative_spine,
        tone_notes=request.tone_notes if request.tone_notes is not None else head.tone_notes,
        created_by=f"user:{user.id}",
    )
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return new
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_brief_versioning.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/clusters.py backend/tests/test_brief_versioning.py
git commit -m "feat(clusters): brief edits create new version; last_brief_id only on regen"
```

---

### Task 13: Refactor regenerate_cluster — shared pack + critic + status machine + asymmetric ref

**Files:**
- Modify: `backend/app/services/clustering_service.py` (the `regenerate_cluster` and helpers)
- Modify: `backend/tests/test_clusters.py` (status name updates)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cluster_pipeline.py
import pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    ContentBrief, ContentCluster, ContentDraft, ContentEvidencePack, Prompt,
)
from app.services.clustering_service import regenerate_cluster


@pytest.mark.asyncio
async def test_regenerate_uses_shared_pack_and_sets_last_brief_id(monkeypatch):
    """Pack is built once and shared; last_brief_id is updated on success."""
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    # Mock the per-piece writer to return a fixed body.
    async def fake_gen(*args, **kwargs):
        return "Piece title", "Piece body [S1]", 0.9, []
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )
    # Mock brief LLM to return valid JSON
    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({
            "positioning": "p", "key_claims": ["k1"], "canonical_phrasings": ["Acme leads X"],
            "stats": [], "narrative_spine": "", "tone_notes": "",
        })
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-x")

    await regenerate_cluster(
        AsyncSessionLocal(), cluster_id=cluster_id, tier="pro",
    )

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        packs = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster_id)
        )).scalars().all()
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster_id)
        )).scalars().all()
        assert cluster.status == "ready"
        assert cluster.last_brief_id is not None
        assert len(packs) == 1  # ONE pack, not 5
        assert len(drafts) == 5


@pytest.mark.asyncio
async def test_regenerate_marks_briefing_failed_when_authority_too_low(monkeypatch):
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        # Only T3
        return [
            {"url": "https://blog.example.com/a", "title": "A", "snippet": "..."},
            {"url": "https://blog2.example.com/b", "title": "B", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({"positioning": "p", "key_claims": [], "canonical_phrasings": [],
                          "stats": [], "narrative_spine": "", "tone_notes": ""})
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-fail")

    await regenerate_cluster(
        AsyncSessionLocal(), cluster_id=cluster_id, tier="basic",
    )
    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert "insufficient" in (cluster.failure_reason or "")
        # No drafts created
        drafts = (await db.execute(
            select(ContentDraft).where(ContentDraft.cluster_id == cluster_id)
        )).scalars().all()
        assert drafts == []


@pytest.mark.asyncio
async def test_partial_generation_marks_generation_partial(monkeypatch):
    """One piece fails; cluster reaches generation_partial; piece has failure_reason."""
    from app.services import cluster_evidence

    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr(cluster_evidence, "fetch_and_dedupe", fake_fetch)

    call_count = {"n": 0}
    async def fake_gen(*args, **kwargs):
        call_count["n"] += 1
        if kwargs["platform"] == "reddit":
            raise RuntimeError("simulated reddit failure")
        return "T", "B", 0.5, []
    monkeypatch.setattr(
        "app.services.clustering_service._generate_piece_text", fake_gen,
    )
    async def fake_brief_call(prompt, tier):
        import json
        return json.dumps({"positioning": "p", "key_claims": [],
                          "canonical_phrasings": [], "stats": [],
                          "narrative_spine": "", "tone_notes": ""})
    monkeypatch.setattr("app.services.cluster_brief._call_llm", fake_brief_call)

    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="pipe-partial")

    await regenerate_cluster(AsyncSessionLocal(), cluster_id=cluster_id, tier="basic")

    async with AsyncSessionLocal() as db:
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "generation_partial"
        # Failed piece recorded its reason
        failed = (await db.execute(
            select(ContentDraft).where(
                ContentDraft.cluster_id == cluster_id,
                ContentDraft.platform == "reddit",
                ContentDraft.generation_state == "failed",
            )
        )).scalars().first()
        assert failed is not None
        assert "simulated" in (failed.failure_reason or "")
```

Also add a helper to `tests/conftest.py`:

```python
async def _seed_minimal_user_brand_prompt(db, *, slug: str) -> tuple[int, int]:
    """Create one user → brand → prompt → empty cluster and return
    (cluster_id, prompt_id). Use only inside async tests that hold an
    AsyncSessionLocal session."""
    from app.models import Brand, ContentCluster, Prompt, User
    user = User(email=f"{slug}@p.com", password_hash="x", name="t")
    db.add(user); await db.flush()
    brand = Brand(name="B", slug=slug, user_id=user.id)
    db.add(brand); await db.flush()
    prompt = Prompt(brand_id=brand.id, text="best CRM")
    db.add(prompt); await db.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="pending")
    db.add(cluster); await db.commit(); await db.refresh(cluster)
    return cluster.id, prompt.id
```

- [ ] **Step 2: Run, see fail**

Run: `pytest tests/test_cluster_pipeline.py -v`
Expected: FAIL — `regenerate_cluster` still uses per-piece evidence and old status names.

- [ ] **Step 3: Refactor `regenerate_cluster`**

In `backend/app/services/clustering_service.py`, replace `regenerate_cluster` with:

```python
async def regenerate_cluster(
    db: AsyncSession,
    *,
    cluster_id: int,
    tier: str | None,
    rebuild_brief: bool = True,
) -> ContentCluster:
    """Regenerate all pieces in a cluster.

    rebuild_brief=True  (default): runs the brief LLM + builds a fresh
        cluster evidence pack. Use for 'Rebuild brief & pieces'.
    rebuild_brief=False: reuses the existing head brief + most recent
        evidence pack. Use for 'Regenerate pieces'.
    """
    cluster = (await db.execute(
        select(ContentCluster).where(ContentCluster.id == cluster_id)
    )).scalar_one()

    # --- BRIEFING PHASE ---
    cluster.status = "briefing"
    cluster.failure_reason = None
    await db.commit()

    if rebuild_brief:
        try:
            brief = await build_brief(db, cluster=cluster, tier=tier)
        except Exception as exc:
            logger.exception("Brief LLM failed for cluster %s: %s", cluster.id, exc)
            cluster.status = "briefing_failed"
            cluster.failure_reason = "brief_llm_failure"
            await db.commit()
            return cluster
    else:
        head = (await db.execute(
            select(ContentBrief).where(ContentBrief.cluster_id == cluster.id)
            .order_by(ContentBrief.version.desc())
        )).scalars().first()
        if head is None:
            cluster.status = "briefing_failed"
            cluster.failure_reason = "no_brief_to_reuse"
            await db.commit()
            return cluster
        brief = head

    # --- EVIDENCE PACK PHASE ---
    from app.services.cluster_evidence import build_cluster_pack, PackGateError
    prompt_row = (await db.execute(
        select(Prompt).where(Prompt.id == cluster.prompt_id)
    )).scalar_one()

    if rebuild_brief or brief.evidence_pack_id is None:
        try:
            pack = await build_cluster_pack(
                db, cluster=cluster, prompt_text=prompt_row.text,
                key_claims=brief.key_claims or [], version=brief.version,
            )
            brief.evidence_pack_id = pack.id
            await db.commit()
        except PackGateError as exc:
            cluster.status = "briefing_failed"
            cluster.failure_reason = str(exc)
            await db.commit()
            return cluster
    else:
        from app.models import ContentEvidencePack as PackModel
        pack = await db.get(PackModel, brief.evidence_pack_id)

    # --- GENERATION PHASE ---
    cluster.status = "generating"
    await db.commit()

    brand_row = (await db.execute(
        select(Brand).where(Brand.id == cluster.brand_id)
    )).scalar_one()
    from app.services.drafting_service import (
        _analyze_responses_for_prompt, _get_prompt_visibility,
        _load_profile_context,
    )
    profile_context = await _load_profile_context(db, cluster.brand_id)
    response_analysis = await _analyze_responses_for_prompt(
        db, cluster.brand_id, cluster.prompt_id,
    )
    visibility_pct = await _get_prompt_visibility(db, cluster.prompt_id)
    enabled = await _enabled_platforms(db, cluster.brand_id)

    # Drop existing drafts before regen
    await db.execute(
        delete(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )
    await db.flush()

    async def _gen(platform: str):
        ctx = _build_brief_context(brief, sibling_platforms=[])
        try:
            title, body, q, citations = await _generate_piece_text(
                db, brand_id=cluster.brand_id, brand_name=brand_row.name,
                prompt_id=cluster.prompt_id, platform=platform,
                prompt_text=prompt_row.text, visibility_pct=visibility_pct,
                profile_context=profile_context,
                response_analysis=response_analysis,
                brief_context=ctx, tier=tier,
            )
            # L3 critic on Pro tier only
            if tier == "pro" and citations:
                from app.services.citation_critic import critique_citations
                body = await critique_citations(
                    text=body,
                    pack_sources=(pack.sources if pack else []),
                )
            # Asymmetric pillar reference
            if cluster.pillar_mode == "attached" and cluster.pillar_url:
                pillar = cluster.pillar_url
            else:
                # Use Medium piece URL as a logical pillar if no own-site pillar
                pillar = None  # cluster doesn't know Medium URL yet at gen time
            body = append_pillar_reference(
                text=body, platform=platform, pillar_url=pillar,
            )
            return ("ok", platform, title, body, q, citations)
        except Exception as exc:
            logger.exception("Piece %s failed: %s", platform, exc)
            return ("fail", platform, str(exc))

    results = await asyncio.gather(*[_gen(p) for p in enabled])

    any_failed = False
    drafts_with_citations: list[tuple[ContentDraft, list]] = []
    for r in results:
        if r[0] == "fail":
            any_failed = True
            _, platform, reason = r
            db.add(ContentDraft(
                brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
                cluster_id=cluster.id, platform=platform,
                status="draft", title=None,
                content_text="", source="cluster",
                generation_state="failed", failure_reason=reason[:255],
            ))
            continue
        _, platform, title, body, q, citations = r
        draft = ContentDraft(
            brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
            cluster_id=cluster.id, platform=platform,
            status="draft", title=title or "(untitled)",
            content_text=body, source="cluster",
            quality_score=q, generation_state="done",
        )
        db.add(draft)
        drafts_with_citations.append((draft, citations))

    await db.flush()
    for draft, citations in drafts_with_citations:
        await _persist_citations_and_summary(
            db, draft=draft, citations=citations, query=prompt_row.text,
        )

    cluster.status = "generation_partial" if any_failed else "ready"
    cluster.last_generated_at = datetime.now(UTC)
    cluster.version += 1
    cluster.last_brief_id = brief.id  # promote brief on successful regen
    await db.commit()

    try:
        await propose_pillar(db, cluster)
    except Exception:
        logger.exception("Pillar proposal failed for cluster %s", cluster.id)

    await db.refresh(cluster)
    return cluster
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_cluster_pipeline.py -v`
Expected: all 3 PASS.

Also run existing cluster tests: `pytest tests/test_clusters.py -v`
Update any assertions referencing `"partial_failed"` to `"generation_partial"` until tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_cluster_pipeline.py backend/tests/conftest.py backend/tests/test_clusters.py
git commit -m "feat(clusters): shared evidence pack pipeline + new status machine + critic"
```

---

### Task 14: Schemas + endpoints — status polling, regen actions, sources, history

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/clusters.py`
- Create: `backend/tests/test_cluster_endpoints.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_cluster_endpoints.py
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    ContentBrief, ContentCluster, ContentClusterSource, ContentEvidencePack,
)


@pytest.mark.asyncio
async def test_status_endpoint_returns_lightweight_payload(client, register_and_login, create_brand):
    headers, _ = await register_and_login(client, "se@x.com")
    brand = await create_brand(client, headers, "B")
    r = await client.post(
        f"/api/brands/{brand['id']}/prompts", json={"text": "q"}, headers=headers,
    )
    prompt_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(
            brand_id=brand["id"], prompt_id=prompt_id, status="generating",
        )
        db.add(cluster); await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    r = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}/status", headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "generating"
    assert "pieces" in body
    assert "failure_reason" in body


@pytest.mark.asyncio
async def test_regenerate_pieces_endpoint_reuses_brief(client, register_and_login, create_brand, monkeypatch):
    headers, _ = await register_and_login(client, "rp@x.com")
    brand = await create_brand(client, headers, "B")
    r = await client.post(
        f"/api/brands/{brand['id']}/prompts", json={"text": "q"}, headers=headers,
    )
    prompt_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster); await db.flush()
        brief = ContentBrief(
            cluster_id=cluster.id, version=1, positioning="p", canonical_phrasings=[],
            key_claims=[], stats=[], competitor_context={}, narrative_spine="", tone_notes="",
        )
        db.add(brief); await db.flush()
        cluster.last_brief_id = brief.id
        await db.commit(); await db.refresh(cluster)
        cluster_id = cluster.id

    called_with = {}
    async def fake_regen(db, *, cluster_id, tier, rebuild_brief=True):
        called_with["rebuild_brief"] = rebuild_brief
        return await db.get(ContentCluster, cluster_id)
    monkeypatch.setattr(
        "app.routers.clusters.regenerate_cluster", fake_regen,
    )

    r = await client.post(
        f"/api/clusters/{brand['id']}/{cluster_id}/regenerate-pieces", headers=headers,
    )
    assert r.status_code == 200
    assert called_with["rebuild_brief"] is False


@pytest.mark.asyncio
async def test_sources_endpoint_returns_spine(client, register_and_login, create_brand):
    headers, _ = await register_and_login(client, "src@x.com")
    brand = await create_brand(client, headers, "B")
    r = await client.post(
        f"/api/brands/{brand['id']}/prompts", json={"text": "q"}, headers=headers,
    )
    prompt_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster); await db.flush()
        pack = ContentEvidencePack(
            cluster_id=cluster.id, version=1, sources=[],
            total_t1=1, total_t2=1, total_t3=0,
        )
        db.add(pack); await db.flush()
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://reuters.com/a", domain="reuters.com",
            tier="T1", title="A", times_cited=2,
        ))
        db.add(ContentClusterSource(
            cluster_id=cluster.id, evidence_pack_id=pack.id,
            url="https://techcrunch.com/b", domain="techcrunch.com",
            tier="T2", title="B", times_cited=1,
        ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}/sources", headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total_t1"] == 1
    assert body["total_t2"] == 1
    assert len(body["sources"]) == 2
    assert body["sources"][0]["tier"] == "T1"  # T1 first


@pytest.mark.asyncio
async def test_brief_history_endpoint(client, register_and_login, create_brand):
    headers, _ = await register_and_login(client, "hist@x.com")
    brand = await create_brand(client, headers, "B")
    r = await client.post(
        f"/api/brands/{brand['id']}/prompts", json={"text": "q"}, headers=headers,
    )
    prompt_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster); await db.flush()
        for v in (1, 2, 3):
            db.add(ContentBrief(
                cluster_id=cluster.id, version=v, positioning=f"v{v}",
                canonical_phrasings=[], key_claims=[], stats=[],
                competitor_context={}, narrative_spine="", tone_notes="",
            ))
        await db.commit()
        cluster_id = cluster.id

    r = await client.get(
        f"/api/clusters/{brand['id']}/{cluster_id}/briefs", headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert [b["version"] for b in body] == [3, 2, 1]  # descending
```

- [ ] **Step 2: Run, see failures**

Run: `pytest tests/test_cluster_endpoints.py -v`
Expected: 404 on `/status`, `/regenerate-pieces`, `/sources`, `/briefs` — none exist yet.

- [ ] **Step 3: Add schemas**

In `backend/app/schemas.py`, add (anywhere with the other content-cluster schemas):

```python
class ClusterPieceStatus(BaseModel):
    platform: str
    draft_id: int | None = None
    status: str | None = None
    generation_state: str = "done"
    failure_reason: str | None = None


class ClusterStatusPayload(BaseModel):
    status: str
    failure_reason: str | None = None
    pieces: list[ClusterPieceStatus]
    version: int
    last_generated_at: datetime | None = None


class ClusterSourceItem(BaseModel):
    url: str
    domain: str
    tier: str
    title: str | None
    times_cited: int


class ClusterSourcesPayload(BaseModel):
    total_t1: int
    total_t2: int
    total_t3: int
    sources: list[ClusterSourceItem]
```

- [ ] **Step 4: Add the four endpoints**

In `backend/app/routers/clusters.py`, append:

```python
from app.models import ContentClusterSource, ContentEvidencePack
from app.schemas import (
    ClusterPieceStatus, ClusterSourceItem, ClusterSourcesPayload,
    ClusterStatusPayload,
)


@router.get("/{brand_id}/{cluster_id}/status", response_model=ClusterStatusPayload)
async def cluster_status(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    drafts = (await db.execute(
        select(ContentDraft).where(ContentDraft.cluster_id == cluster.id)
    )).scalars().all()
    return ClusterStatusPayload(
        status=cluster.status,
        failure_reason=cluster.failure_reason,
        pieces=[ClusterPieceStatus(
            platform=d.platform, draft_id=d.id, status=d.status,
            generation_state=d.generation_state, failure_reason=d.failure_reason,
        ) for d in drafts],
        version=cluster.version,
        last_generated_at=cluster.last_generated_at,
    )


@router.post("/{brand_id}/{cluster_id}/regenerate-pieces", response_model=ContentClusterDetail)
async def regenerate_pieces(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    await regenerate_cluster(
        db, cluster_id=cluster.id, tier=user.subscription_tier, rebuild_brief=False,
    )
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.post("/{brand_id}/{cluster_id}/rebuild", response_model=ContentClusterDetail)
async def rebuild_cluster(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    await regenerate_cluster(
        db, cluster_id=cluster.id, tier=user.subscription_tier, rebuild_brief=True,
    )
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore


@router.get("/{brand_id}/{cluster_id}/sources", response_model=ClusterSourcesPayload)
async def cluster_sources(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    pack = (await db.execute(
        select(ContentEvidencePack)
        .where(ContentEvidencePack.cluster_id == cluster.id)
        .order_by(ContentEvidencePack.version.desc())
    )).scalars().first()
    if pack is None:
        return ClusterSourcesPayload(total_t1=0, total_t2=0, total_t3=0, sources=[])
    rows = (await db.execute(
        select(ContentClusterSource).where(
            ContentClusterSource.cluster_id == cluster.id,
        )
    )).scalars().all()
    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    rows.sort(key=lambda r: (tier_order[r.tier], -r.times_cited))
    return ClusterSourcesPayload(
        total_t1=pack.total_t1, total_t2=pack.total_t2, total_t3=pack.total_t3,
        sources=[ClusterSourceItem(
            url=r.url, domain=r.domain, tier=r.tier, title=r.title,
            times_cited=r.times_cited,
        ) for r in rows],
    )


@router.get("/{brand_id}/{cluster_id}/briefs", response_model=list[ContentBriefSchema])
async def brief_history(brand_id: int, cluster_id: int, db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user.id)
    rows = (await db.execute(
        select(ContentBrief).where(ContentBrief.cluster_id == cluster_id)
        .order_by(ContentBrief.version.desc())
    )).scalars().all()
    return rows
```

- [ ] **Step 5: Run, verify pass**

Run: `pytest tests/test_cluster_endpoints.py -v`
Expected: all 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/clusters.py backend/tests/test_cluster_endpoints.py
git commit -m "feat(clusters): status, regenerate-pieces, rebuild, sources, brief history endpoints"
```

---

### Task 15: Stuck-cluster cleanup in APScheduler

**Files:**
- Modify: `backend/app/scheduler.py` (or wherever the stale-run job is registered)
- Create: `backend/tests/test_stale_clusters.py`

- [ ] **Step 1: Find the stale-run job**

Run: `grep -n "stale\|max_age\|fail.*run.*minutes" backend/app/scheduler.py backend/app/services/*.py | head -20`
Note: the existing logic for stale tracking runs lives in `backend/app/database.py` (`auto_fail_stale_runs`-style). Reuse the same pattern for clusters.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_stale_clusters.py
from datetime import datetime, timedelta, UTC

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import ContentCluster
from app.services.cluster_cleanup import auto_fail_stale_clusters


@pytest.mark.asyncio
async def test_marks_stuck_briefing_as_failed():
    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="stale-1")
        cluster = await db.get(ContentCluster, cluster_id)
        cluster.status = "briefing"
        cluster.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=30)
        await db.commit()

    async with AsyncSessionLocal() as db:
        n = await auto_fail_stale_clusters(db, max_age_minutes=15)
        assert n == 1
        cluster = await db.get(ContentCluster, cluster_id)
        assert cluster.status == "briefing_failed"
        assert cluster.failure_reason == "timeout"


@pytest.mark.asyncio
async def test_leaves_fresh_clusters_alone():
    async with AsyncSessionLocal() as db:
        from tests.conftest import _seed_minimal_user_brand_prompt
        cluster_id, _ = await _seed_minimal_user_brand_prompt(db, slug="stale-2")
        cluster = await db.get(ContentCluster, cluster_id)
        cluster.status = "generating"
        await db.commit()

    async with AsyncSessionLocal() as db:
        n = await auto_fail_stale_clusters(db, max_age_minutes=15)
        assert n == 0
```

- [ ] **Step 3: Run, see fail**

Run: `pytest tests/test_stale_clusters.py -v`
Expected: FAIL — `auto_fail_stale_clusters` not implemented.

- [ ] **Step 4: Implement cleanup**

Create `backend/app/services/cluster_cleanup.py`:

```python
"""Auto-fail clusters stuck in briefing/generating beyond a threshold."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, UTC

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentCluster

logger = logging.getLogger(__name__)


async def auto_fail_stale_clusters(
    db: AsyncSession,
    *,
    max_age_minutes: int = 15,
) -> int:
    """Flip stuck briefing→briefing_failed and stuck generating→generation_partial."""
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)
    result_b = await db.execute(
        update(ContentCluster)
        .where(
            ContentCluster.status == "briefing",
            ContentCluster.created_at < cutoff,
        )
        .values(status="briefing_failed", failure_reason="timeout")
    )
    result_g = await db.execute(
        update(ContentCluster)
        .where(
            ContentCluster.status == "generating",
            ContentCluster.created_at < cutoff,
        )
        .values(status="generation_partial", failure_reason="timeout")
    )
    await db.commit()
    total = (result_b.rowcount or 0) + (result_g.rowcount or 0)
    if total:
        logger.warning("Auto-failed %d stale cluster(s)", total)
    return total
```

Wire it into the scheduler. In `backend/app/scheduler.py`, find where stale tracking runs are cleaned up and add a parallel call. (If a periodic job for cluster cleanup doesn't exist, register a new job that runs every 5 minutes.)

```python
# In backend/app/scheduler.py — extend the existing periodic cleanup job
# or add a new one if none exists.
async def _stale_cleanup_tick() -> None:
    from app.database import AsyncSessionLocal
    from app.services.cluster_cleanup import auto_fail_stale_clusters
    async with AsyncSessionLocal() as db:
        await auto_fail_stale_clusters(db, max_age_minutes=15)


# Inside the scheduler startup function:
scheduler.add_job(_stale_cleanup_tick, "interval", minutes=5, id="cluster_stale_cleanup", replace_existing=True)
```

- [ ] **Step 5: Run, verify pass**

Run: `pytest tests/test_stale_clusters.py -v`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/cluster_cleanup.py backend/app/scheduler.py backend/tests/test_stale_clusters.py
git commit -m "feat(clusters): APScheduler auto-fail of stuck clusters"
```

---

### Task 16: Frontend API client methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add new typed methods**

Locate the existing cluster API methods in `lib/api.ts` and add alongside them:

```typescript
// In the Clusters API group, after existing methods:

getClusterStatus(brandId: number, clusterId: number): Promise<{
  status: string;
  failure_reason: string | null;
  pieces: Array<{
    platform: string;
    draft_id: number | null;
    status: string | null;
    generation_state: string;
    failure_reason: string | null;
  }>;
  version: number;
  last_generated_at: string | null;
}> {
  return this.get(`/api/clusters/${brandId}/${clusterId}/status`);
},

regeneratePieces(brandId: number, clusterId: number) {
  return this.post(`/api/clusters/${brandId}/${clusterId}/regenerate-pieces`);
},

rebuildCluster(brandId: number, clusterId: number) {
  return this.post(`/api/clusters/${brandId}/${clusterId}/rebuild`);
},

getClusterSources(brandId: number, clusterId: number): Promise<{
  total_t1: number;
  total_t2: number;
  total_t3: number;
  sources: Array<{
    url: string;
    domain: string;
    tier: "T1" | "T2" | "T3";
    title: string | null;
    times_cited: number;
  }>;
}> {
  return this.get(`/api/clusters/${brandId}/${clusterId}/sources`);
},

getBriefHistory(brandId: number, clusterId: number): Promise<Array<{
  id: number;
  version: number;
  positioning: string;
  canonical_phrasings: string[];
  key_claims: string[];
  stats: Array<{ label: string; value: string; source?: string }>;
  narrative_spine: string;
  tone_notes: string;
  created_at: string;
  created_by: string;
}>> {
  return this.get(`/api/clusters/${brandId}/${clusterId}/briefs`);
},
```

(Match the existing style — if the client uses `axios.get` directly instead of a helper method, follow that.)

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors related to api.ts changes.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(clusters): frontend API methods for new cluster endpoints"
```

---

### Task 17: Polling hook `useClusterStatus`

**Files:**
- Create: `frontend/hooks/useClusterStatus.ts`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/hooks/useClusterStatus.ts
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const TERMINAL = new Set([
  "ready", "briefing_failed", "generation_partial",
]);
const POLL_MS = 2000;

export type ClusterStatusPayload = Awaited<ReturnType<typeof api.getClusterStatus>>;

export function useClusterStatus(
  brandId: number,
  clusterId: number,
  initial?: ClusterStatusPayload,
) {
  const [data, setData] = useState<ClusterStatusPayload | undefined>(initial);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const next = await api.getClusterStatus(brandId, clusterId);
        if (cancelled) return;
        setData(next);
        if (!TERMINAL.has(next.status)) {
          timer.current = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    }

    if (!data || !TERMINAL.has(data.status)) {
      tick();
    }

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, clusterId]);

  return { data, error };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useClusterStatus.ts
git commit -m "feat(clusters): polling hook for cluster status"
```

---

### Task 18: SourceSpinePanel component

**Files:**
- Create: `frontend/components/content/cluster/SourceSpinePanel.tsx`

- [ ] **Step 1: Build the component**

```tsx
// frontend/components/content/cluster/SourceSpinePanel.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type SrcRow = {
  url: string;
  domain: string;
  tier: "T1" | "T2" | "T3";
  title: string | null;
  times_cited: number;
};

type Payload = {
  total_t1: number;
  total_t2: number;
  total_t3: number;
  sources: SrcRow[];
};

interface Props {
  brandId: number;
  clusterId: number;
}

const TIER_COLORS: Record<SrcRow["tier"], string> = {
  T1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  T2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  T3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function SourceSpinePanel({ brandId, clusterId }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.getClusterSources(brandId, clusterId)
      .then((d) => mounted && setData(d))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [brandId, clusterId]);

  if (loading) return <div className="text-sm text-slate-400">Loading sources…</div>;
  if (!data || data.sources.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        No sources yet. Regenerate to build the cluster evidence pack.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs text-slate-300">
        <span><span className="font-semibold text-emerald-300">T1</span> {data.total_t1}</span>
        <span><span className="font-semibold text-sky-300">T2</span> {data.total_t2}</span>
        <span><span className="font-semibold text-slate-400">T3</span> {data.total_t3}</span>
      </div>
      <ul className="divide-y divide-slate-800">
        {data.sources.map((s) => (
          <li key={s.url} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${TIER_COLORS[s.tier]}`}>
                  {s.tier}
                </span>
                <span className="text-sm text-slate-200 font-medium">{s.domain}</span>
              </div>
              <a
                href={s.url} target="_blank" rel="noreferrer"
                className="block text-xs text-slate-400 hover:text-slate-200 truncate"
              >
                {s.title || s.url}
              </a>
            </div>
            <div className="text-xs text-slate-500 shrink-0">
              used by {s.times_cited}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/cluster/SourceSpinePanel.tsx
git commit -m "feat(clusters): SourceSpinePanel — tiered source list with times-cited"
```

---

### Task 19: BriefPanel — current vs draft + version history

**Files:**
- Modify: `frontend/components/content/cluster/BriefPanel.tsx`
- Create: `frontend/components/content/cluster/BriefVersionHistory.tsx`

- [ ] **Step 1: Build the version history component**

```tsx
// frontend/components/content/cluster/BriefVersionHistory.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  currentVersion: number;
  onRevert: (brief: Awaited<ReturnType<typeof api.getBriefHistory>>[number]) => void;
}

export function BriefVersionHistory({ brandId, clusterId, currentVersion, onRevert }: Props) {
  const [briefs, setBriefs] = useState<Awaited<ReturnType<typeof api.getBriefHistory>>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getBriefHistory(brandId, clusterId).then(setBriefs);
  }, [brandId, clusterId, open]);

  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="text-slate-400 hover:text-slate-200"
      >
        {open ? "▾" : "▸"} History
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {briefs.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">
                v{b.version} {b.version === currentVersion && "(current)"}
              </span>
              <button
                onClick={() => onRevert(b)}
                className="text-emerald-300 hover:text-emerald-200"
                disabled={b.version === currentVersion}
              >
                Revert to v{b.version}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Modify BriefPanel**

Open `frontend/components/content/cluster/BriefPanel.tsx`. Add a dirty-state banner and the version history component. The changes (added near the top of the rendered JSX, before the existing fields):

```tsx
// At top of BriefPanel:
import { BriefVersionHistory } from "./BriefVersionHistory";

// In component state, alongside existing state:
const [draftDirty, setDraftDirty] = useState(false);
const [draftVersion, setDraftVersion] = useState<number>(brief.version);

// Wrap field onChange handlers so they flip draftDirty=true. For each input:
//   onChange={(e) => { setPositioning(e.target.value); setDraftDirty(true); }}

// After saving (the existing PATCH), bump draftVersion:
// setDraftVersion(saved.version);
// setDraftDirty(false);

// In the JSX, add at the top of the panel:
{draftDirty && (
  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
    You have unsaved brief changes. Click <strong>Save</strong> below, then{" "}
    <strong>Regenerate pieces</strong> to apply.
  </div>
)}
{draftVersion > currentVersion && (
  <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
    Brief is at v{draftVersion}; pieces below were generated from v{currentVersion}.
    Click <strong>Regenerate pieces</strong> to apply the new brief.
  </div>
)}

// At bottom of the panel:
<BriefVersionHistory
  brandId={brandId}
  clusterId={clusterId}
  currentVersion={currentVersion}
  onRevert={(b) => {
    setPositioning(b.positioning);
    setCanonicalPhrasings(b.canonical_phrasings);
    setKeyClaims(b.key_claims);
    setNarrativeSpine(b.narrative_spine);
    setToneNotes(b.tone_notes);
    setDraftDirty(true);
  }}
/>
```

(The exact prop names in BriefPanel — e.g. `currentVersion` — depend on what's already wired in. Match them; if not yet exposed, thread them down from the cluster detail page.)

- [ ] **Step 3: Verify visually**

Run dev server (`cd backend && uvicorn app.main:app --reload --port 3001` and `cd frontend && npm run dev`). Visit a cluster detail page. Edit the positioning field, confirm the amber banner appears. Save. Reload — banner should be gone. Edit again — banner reappears.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/BriefPanel.tsx frontend/components/content/cluster/BriefVersionHistory.tsx
git commit -m "feat(clusters): brief version history + dirty/current-vs-draft banners"
```

---

### Task 20: PieceCard — micro-state, inline attribution, failure badge

**Files:**
- Modify: `frontend/components/content/cluster/PieceCard.tsx`

- [ ] **Step 1: Extend the piece card**

The PieceCard currently shows status + title + excerpt + buttons. Add a micro-state pill and a failure-reason badge.

```tsx
// At top of PieceCard.tsx, add types (or extend the existing draft prop type):
type GenerationState = "queued" | "writing" | "critic" | "rendering" | "done" | "failed";

interface PieceCardProps {
  draft: {
    // ... existing fields
    generation_state?: GenerationState;
    failure_reason?: string | null;
  };
  // attribution prop — assume this already exists or add it:
  attribution?: { delta_pp: number | null };
  // ... rest
}

// Within the card render — add right after the status/title row:
{draft.generation_state && draft.generation_state !== "done" && (
  <span className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-sky-500/15 text-sky-200 border border-sky-500/30">
    <span className="size-1.5 rounded-full bg-sky-300 animate-pulse" />
    {draft.generation_state}
  </span>
)}
{draft.generation_state === "failed" && (
  <div className="mt-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
    Failed: {draft.failure_reason || "unknown error"}
  </div>
)}
{props.attribution?.delta_pp != null && (
  <span className="ml-2 text-xs text-emerald-300">
    {props.attribution.delta_pp >= 0 ? "+" : ""}
    {props.attribution.delta_pp.toFixed(1)}pp
  </span>
)}
```

- [ ] **Step 2: Type-check + visual verify**

Run: `npx tsc --noEmit`
Verify with dev server: a draft in failed state shows the rose error block; in-flight states show the pulsing chip.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/content/cluster/PieceCard.tsx
git commit -m "feat(clusters): piece card micro-state + failure reason + inline attribution"
```

---

### Task 21: Cluster detail page — 3-zone layout with polling + 3 regen actions

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

- [ ] **Step 1: Replace the page composition**

The page currently renders: header → BriefPanel → PillarCard → grid of PieceCards. Restructure into the three explicit zones from the spec.

```tsx
// frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx (top-level structure;
// keep existing data fetching at top of component)

import { SourceSpinePanel } from "@/components/content/cluster/SourceSpinePanel";
import { InputsZone } from "@/components/content/cluster/InputsZone";
import { useClusterStatus } from "@/hooks/useClusterStatus";

// Within the component, replace the body with:
const { data: live } = useClusterStatus(brandId, clusterId);
const effectiveStatus = live?.status ?? cluster.status;

return (
  <div className="space-y-6">
    {/* Header */}
    <div>
      <a href={`/content/${brandId}`} className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to clusters
      </a>
      <h1 className="mt-2 text-2xl font-semibold">{cluster.prompt_text}</h1>
      <div className="mt-1 text-sm text-slate-400">
        Visibility {cluster.visibility_pct.toFixed(0)}%
        {" · "}
        Status: <span className="font-medium">{effectiveStatus}</span>
        {live?.failure_reason && (
          <span className="ml-2 text-rose-300">— {live.failure_reason}</span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => { await api.regeneratePieces(brandId, clusterId); }}
          className="px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm"
          disabled={effectiveStatus === "briefing" || effectiveStatus === "generating"}
        >
          Regenerate pieces
        </button>
        <button
          onClick={async () => { await api.rebuildCluster(brandId, clusterId); }}
          className="px-3 py-1.5 rounded bg-slate-700/40 border border-slate-600 text-slate-200 text-sm"
          disabled={effectiveStatus === "briefing" || effectiveStatus === "generating"}
        >
          Rebuild brief & pieces
        </button>
      </div>
    </div>

    {/* ZONE 1 — Brief + Sources */}
    <div className="grid lg:grid-cols-2 gap-4">
      <BriefPanel
        brief={cluster.brief}
        brandId={brandId}
        clusterId={clusterId}
        currentVersion={cluster.brief?.version ?? 1}
      />
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 text-sm font-medium text-slate-200">Sources</div>
        <SourceSpinePanel brandId={brandId} clusterId={clusterId} />
      </div>
    </div>

    {/* ZONE 2 — Pieces (existing PieceCard grid, but driven by live status) */}
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
      {(live?.pieces ?? cluster.drafts).map((p) => (
        <PieceCard key={p.platform} draft={p} brandId={brandId} clusterId={clusterId} />
      ))}
    </div>

    {/* ZONE 3 — Inputs (collapsed by default) */}
    <InputsZone brandId={brandId} clusterId={clusterId} promptId={cluster.prompt_id} />
  </div>
);
```

- [ ] **Step 2: Build the InputsZone shell**

```tsx
// frontend/components/content/cluster/InputsZone.tsx
"use client";

import { useState } from "react";

interface Props {
  brandId: number;
  clusterId: number;
  promptId: number;
}

export function InputsZone({ brandId, clusterId, promptId }: Props) {
  const [openPillar, setOpenPillar] = useState(false);
  const [openOpps, setOpenOpps] = useState(false);
  const [openGaps, setOpenGaps] = useState(false);

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/30 p-3">
      <Row label="Pillar candidate (own site)" open={openPillar} onToggle={() => setOpenPillar(!openPillar)}>
        {/* PillarCard or its content */}
      </Row>
      <Row label="Opportunities for this prompt" open={openOpps} onToggle={() => setOpenOpps(!openOpps)}>
        {/* Fetch and render ContentOpportunity rows filtered by prompt_id */}
      </Row>
      <Row label="Gap analysis" open={openGaps} onToggle={() => setOpenGaps(!openGaps)}>
        {/* Fetch and render ContentGap rows for this prompt */}
      </Row>
    </div>
  );
}

function Row({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full text-left text-sm text-slate-300 hover:text-slate-100">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div className="pl-4 py-2 text-sm text-slate-400">{children}</div>}
    </div>
  );
}
```

(Wire the actual opportunity / gap / pillar content in a follow-up commit if not trivial. The structural shell is what matters here.)

- [ ] **Step 3: Visual verify**

Run dev server. Visit `/content/[brandId]/cluster/[clusterId]`. Confirm 3 zones render. Click Regenerate pieces; verify polling kicks in and status text updates without a manual refresh.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx frontend/components/content/cluster/InputsZone.tsx
git commit -m "feat(clusters): 3-zone cluster detail layout + polling + split regen actions"
```

---

### Task 22: View modal — CitationsSubpanel + CriticNotesSubpanel

**Files:**
- Create: `frontend/components/content/cluster/CitationsSubpanel.tsx`
- Create: `frontend/components/content/cluster/CriticNotesSubpanel.tsx`
- Modify: `frontend/components/content/cluster/PieceCard.tsx` (existing View modal)

- [ ] **Step 1: Create CitationsSubpanel**

```tsx
// frontend/components/content/cluster/CitationsSubpanel.tsx
"use client";

interface Citation {
  source_ref: string;
  url: string;
  title: string | null;
  position_marker: number | null;
}

export function CitationsSubpanel({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return <div className="text-sm text-slate-400">No citations.</div>;
  }
  return (
    <ol className="space-y-1 text-sm">
      {citations.map((c) => (
        <li key={c.source_ref} className="flex items-start gap-2">
          <span className="text-slate-500 shrink-0">{c.source_ref}</span>
          <a href={c.url} target="_blank" rel="noreferrer" className="text-slate-200 hover:underline">
            {c.title || c.url}
          </a>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Create CriticNotesSubpanel (Pro tier gated)**

```tsx
// frontend/components/content/cluster/CriticNotesSubpanel.tsx
"use client";

interface Props {
  isPro: boolean;
  notes: Array<{ marker: string; action: "keep" | "drop"; reason: string }> | null;
}

export function CriticNotesSubpanel({ isPro, notes }: Props) {
  if (!isPro) {
    return (
      <div className="text-sm text-slate-500 italic">
        Citation critic is a Pro-tier feature.
      </div>
    );
  }
  if (!notes || notes.length === 0) {
    return <div className="text-sm text-slate-400">No critic notes for this piece.</div>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {notes.map((n, i) => (
        <li key={i} className="text-slate-300">
          <span className={n.action === "drop" ? "text-rose-300" : "text-emerald-300"}>
            {n.action.toUpperCase()}
          </span>{" "}
          [{n.marker}] — {n.reason}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Wire them into PieceCard's View modal**

In `PieceCard.tsx`, find the View modal JSX. Add two tabs/sections inside it:

```tsx
import { CitationsSubpanel } from "./CitationsSubpanel";
import { CriticNotesSubpanel } from "./CriticNotesSubpanel";

// Inside the modal, after the rendered draft body:
<div className="mt-4 grid lg:grid-cols-2 gap-4">
  <div>
    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Citations</div>
    <CitationsSubpanel citations={draft.citations ?? []} />
  </div>
  <div>
    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Critic notes</div>
    <CriticNotesSubpanel
      isPro={userTier === "pro"}
      notes={draft.critic_notes ?? null}
    />
  </div>
</div>
```

(Note: `draft.citations` and `draft.critic_notes` need to be returned by the cluster-detail endpoint. If not yet, surface them by joining `ContentDraftCitation` in `clusters.py:get_cluster` and returning them in the draft schema. For critic notes, persistence isn't in scope for v1 — render an empty state and document this in the spec's Open Questions section.)

- [ ] **Step 4: Commit**

```bash
git add frontend/components/content/cluster/CitationsSubpanel.tsx frontend/components/content/cluster/CriticNotesSubpanel.tsx frontend/components/content/cluster/PieceCard.tsx
git commit -m "feat(clusters): View modal — citations + Pro-only critic notes subpanels"
```

---

### Task 23: Cluster list page — strip tabs, default to cluster list only

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx`
- Modify: `frontend/components/content/cluster/ClusterCard.tsx`

- [ ] **Step 1: Remove tabs from the page**

In `frontend/app/content/[brandId]/page.tsx`, locate the tab implementation (probably a `<Tabs>` or a manual conditional with `activeTab` state). Replace the entire tabbed body with the cluster list section. Keep the page header. Add a footer link to the archive route:

```tsx
return (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold">Content · {brand.name}</h1>
      <p className="text-sm text-slate-400">One cluster per tracked prompt.</p>
    </div>

    {/* Sort + filter controls (preserve existing or simplify) */}
    {/* … */}

    <ClusterList brandId={brandId} />

    <div className="pt-8 mt-8 border-t border-slate-800">
      <a href={`/content/${brandId}/archive`} className="text-xs text-slate-500 hover:text-slate-300">
        View legacy posted drafts ↗
      </a>
    </div>
  </div>
);
```

(`ClusterList` is the existing component or block that renders the grid of `ClusterCard`s.)

- [ ] **Step 2: Update ClusterCard to surface new info**

In `ClusterCard.tsx`, ensure the rendered card includes (in order):
1. Prompt text + visibility badge
2. **New row**: `Brief v{version} · Pack {n} sources ({t1} T1, {t2} T2) · Updated {ago}`
3. Per-piece chips with platform + status
4. Action buttons (Open cluster, Regenerate ▾)

The data needed (brief version, source counts) comes from the existing `GET /api/clusters/{brand_id}` endpoint — if not present, extend the list endpoint payload to include `brief_version`, `total_t1`, `total_t2` from the most recent `ContentEvidencePack`.

- [ ] **Step 3: Extend backend list endpoint**

In `backend/app/routers/clusters.py`, modify `list_clusters` to enrich each cluster with brief version + pack counts:

```python
# Inside the loop where each cluster summary is built, add:
brief_version = None
if cluster.last_brief_id:
    bv = (await db.execute(
        select(ContentBrief.version).where(ContentBrief.id == cluster.last_brief_id)
    )).scalar_one_or_none()
    brief_version = bv

pack = (await db.execute(
    select(ContentEvidencePack)
    .where(ContentEvidencePack.cluster_id == cluster.id)
    .order_by(ContentEvidencePack.version.desc())
)).scalars().first()

out.append({
    # ... existing fields,
    "brief_version": brief_version,
    "pack_total_t1": pack.total_t1 if pack else 0,
    "pack_total_t2": pack.total_t2 if pack else 0,
    "pack_total_t3": pack.total_t3 if pack else 0,
})
```

Add these to `ContentClusterSummary` schema accordingly.

- [ ] **Step 4: Visual verify**

Run dev server. Visit `/content/[brandId]` — confirm tabs gone, cluster cards show brief version + source counts.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/content/[brandId]/page.tsx frontend/components/content/cluster/ClusterCard.tsx backend/app/routers/clusters.py backend/app/schemas.py
git commit -m "feat(clusters): cluster list IA — strip tabs, surface brief version + pack health"
```

---

### Task 24: Archive page for legacy posted drafts

**Files:**
- Create: `frontend/app/content/[brandId]/archive/page.tsx`
- (No backend change needed — reuse existing GET drafts endpoint with a filter)

- [ ] **Step 1: Create the archive page**

```tsx
// frontend/app/content/[brandId]/archive/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Draft {
  id: number;
  platform: string;
  title: string | null;
  content_text: string;
  status: string;
  posted_at: string | null;
  cluster_id: number | null;
}

export default function ArchivePage(props: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(props.params);
  const bId = Number(brandId);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.getDrafts(bId, { status: "posted" }).then((rows: Draft[]) => {
      const orphans = rows.filter((d) => d.cluster_id === null);
      if (mounted) setDrafts(orphans);
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [bId]);

  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;

  return (
    <div className="p-8 space-y-4 max-w-4xl">
      <a href={`/content/${bId}`} className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to clusters
      </a>
      <h1 className="text-xl font-semibold">Legacy posted drafts</h1>
      <p className="text-sm text-slate-400">
        Drafts posted before the content cluster redesign. Read-only.
      </p>
      {drafts.length === 0 ? (
        <div className="text-slate-500">No legacy drafts.</div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {drafts.map((d) => (
            <li key={d.id} className="py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="uppercase text-xs text-slate-500">{d.platform}</span>
                <span className="font-medium text-slate-200">
                  {d.title || "(untitled)"}
                </span>
                {d.posted_at && (
                  <span className="text-xs text-slate-500 ml-auto">
                    Posted {new Date(d.posted_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400 line-clamp-3">
                {d.content_text}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

(If `api.getDrafts` doesn't support a `status` filter param, either extend it or filter client-side after fetching all drafts.)

- [ ] **Step 2: Visual verify**

Run dev server. Visit `/content/[brandId]/archive`. If no legacy drafts exist on the test DB, the empty state shows. If legacy drafts exist, they render read-only.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/content/[brandId]/archive/page.tsx
git commit -m "feat(clusters): legacy posted drafts archive route"
```

---

### Task 25: Redirect legacy tab deep-links to the cluster list

**Files:**
- Modify: `frontend/middleware.ts` (or the relevant page-level redirect)

- [ ] **Step 1: Add redirect rule**

In `frontend/middleware.ts`, add a rewrite/redirect for the deprecated tab routes if they're URL-segmented (e.g. `/content/[brandId]?tab=drafts`). If tabs were query-string only, no middleware change is needed — but client-side, ignore any `?tab=` parameter on `/content/[brandId]`. If tabs were path segments like `/content/[brandId]/drafts`, add:

```typescript
// Inside middleware function, after auth checks:
const url = request.nextUrl.clone();
const legacyTabPattern = /^\/content\/\d+\/(drafts|opportunities|gaps)$/;
if (legacyTabPattern.test(url.pathname)) {
  url.pathname = url.pathname.split("/").slice(0, 3).join("/");
  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Visual verify**

Run dev server. Visit `/content/[brandId]/drafts` — should redirect to `/content/[brandId]`.

- [ ] **Step 3: Commit**

```bash
git add frontend/middleware.ts
git commit -m "feat(clusters): redirect legacy tab deep-links to cluster list"
```

---

### Task 26: Service-layer enforcement of cluster_id on new drafts + remove manual draft endpoints

**Files:**
- Modify: `backend/app/services/drafting_service.py` (wherever `ContentDraft` is constructed)
- Modify: `backend/app/routers/content.py` (remove `/manual-draft` or equivalent endpoint if it exists)
- Modify: any frontend "New draft" button to remove its onClick handler

- [ ] **Step 1: Find creation paths**

Run: `grep -nR "ContentDraft(" backend/app/ | grep -v test`
List every site that instantiates a draft.

- [ ] **Step 2: Add a service helper that enforces `cluster_id`**

In `backend/app/services/drafting_service.py`, add (or extend an existing factory):

```python
def make_cluster_draft(*, brand_id: int, prompt_id: int, cluster_id: int, **kwargs) -> ContentDraft:
    if cluster_id is None:
        raise ValueError("All new drafts must belong to a cluster")
    return ContentDraft(
        brand_id=brand_id, prompt_id=prompt_id, cluster_id=cluster_id,
        source="cluster", **kwargs,
    )
```

For each site identified in Step 1 that creates a draft outside the cluster flow (e.g. ad-hoc manual draft routes), either delete the route or route it through `get_or_create_cluster` first and pass the resulting `cluster_id`.

- [ ] **Step 3: Remove user-facing "new draft" frontend control**

Search for any "+ New draft" or "New manual draft" buttons:
Run: `grep -nR "Manual draft\|New draft\|manualDraft" frontend/`
Remove the button(s) and their click handlers.

- [ ] **Step 4: Write a test asserting the constraint**

```python
# backend/tests/test_draft_cluster_required.py
import pytest

from app.services.drafting_service import make_cluster_draft


def test_make_cluster_draft_requires_cluster_id():
    with pytest.raises(ValueError):
        make_cluster_draft(brand_id=1, prompt_id=1, cluster_id=None, platform="medium", content_text="x")
```

Run: `pytest tests/test_draft_cluster_required.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting_service.py backend/app/routers/content.py backend/tests/test_draft_cluster_required.py frontend/
git commit -m "feat(clusters): enforce cluster_id on all new drafts; remove manual draft paths"
```

---

### Task 27: Sweep — multi-tenancy isolation tests for new tables

**Files:**
- Modify: `backend/tests/test_clusters.py` (or new file)

- [ ] **Step 1: Add isolation assertions**

```python
# backend/tests/test_cluster_isolation.py
import pytest

from app.database import AsyncSessionLocal
from app.models import ContentClusterSource, ContentEvidencePack


@pytest.mark.asyncio
async def test_user_a_cannot_read_user_b_sources(client, register_and_login, create_brand):
    headers_a, _a = await register_and_login(client, "iso-a@x.com")
    brand_a = await create_brand(client, headers_a, "A")
    headers_b, _b = await register_and_login(client, "iso-b@x.com")
    brand_b = await create_brand(client, headers_b, "B")

    # Create a cluster owned by B with sources
    r = await client.post(
        f"/api/brands/{brand_b['id']}/prompts", json={"text": "q"}, headers=headers_b,
    )
    prompt_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        from app.models import ContentCluster
        cluster_b = ContentCluster(brand_id=brand_b["id"], prompt_id=prompt_id, status="ready")
        db.add(cluster_b); await db.flush()
        pack = ContentEvidencePack(cluster_id=cluster_b.id, version=1, sources=[], total_t1=0, total_t2=0, total_t3=0)
        db.add(pack); await db.flush()
        db.add(ContentClusterSource(
            cluster_id=cluster_b.id, evidence_pack_id=pack.id,
            url="https://x.com", domain="x.com", tier="T1", title=None, times_cited=0,
        ))
        await db.commit(); cluster_b_id = cluster_b.id

    # User A tries to access B's cluster sources
    r = await client.get(
        f"/api/clusters/{brand_a['id']}/{cluster_b_id}/sources", headers=headers_a,
    )
    assert r.status_code in (403, 404)
```

- [ ] **Step 2: Run, expect PASS**

Run: `pytest tests/test_cluster_isolation.py -v`
Expected: PASS (the brand-ownership check `_ensure_brand_owned` rejects mismatched brand_id; the test verifies that path still works for the new sources endpoint).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_cluster_isolation.py
git commit -m "test(clusters): multi-tenancy isolation on new endpoints"
```

---

### Task 28: Run the full backend test suite + manual frontend QA

**Files:** (none modified — verification only)

- [ ] **Step 1: Run the entire backend suite**

Run: `cd backend && pytest -x`
Expected: all tests PASS. If any test fails referencing the old `partial_failed` status or per-piece evidence pack, update its assertions and commit those fixes as a separate commit.

- [ ] **Step 2: Manual frontend smoke**

With dev servers running (`backend` on 3001, `frontend` on 3002 — per memory):

1. Visit `/content/{brandId}` — confirm tab bar is gone, cluster cards show brief version + source counts.
2. Click into a cluster. Confirm 3 zones render (brief+sources, pieces, inputs).
3. Click Regenerate pieces. Confirm: status flips to "briefing" → "generating" → "ready" via polling, without manual refresh.
4. Edit brief → save → confirm "you have unsaved" / "pieces from v{n}" banners appear correctly.
5. Open a piece's View modal. Confirm Citations subpanel shows. On Pro tier confirm Critic notes shows.
6. Visit `/content/{brandId}/drafts` — confirm redirect to `/content/{brandId}`.
7. Visit `/content/{brandId}/archive` — confirm read-only legacy drafts page.
8. Create a brand-new brand with one prompt, hit Generate. Confirm the cluster goes through the lifecycle correctly.

- [ ] **Step 3: Document any regressions**

If something fails during manual QA: stop here, file an issue or fix-in-place, then re-run from step 1 of this task.

- [ ] **Step 4: Final commit (if any QA fixes)**

```bash
git status
# Commit any QA fixes with descriptive messages
```

---

## Self-review

**1. Spec coverage:**
- Goals 1 (single home) → Tasks 23, 24, 25, 26
- Goals 2 (third-party-authority grounding) → Tasks 1, 2, 5, 6, 7, 18
- Goals 3 (honest piece coordination) → Tasks 9, 11, 13
- Goals 4 (trustworthy regen) → Tasks 13, 14, 15, 17, 20, 21
- L1 shared pack → Tasks 5, 6, 7
- L2 authority tiering → Tasks 1, 2, 6
- L3 citation critic → Tasks 8, 13
- Status state machine → Tasks 3, 4, 13, 15
- Brief versioning → Task 12
- Polling → Tasks 14, 17, 21
- Per-piece micro-state → Tasks 3, 13, 20
- Stale recovery → Task 15
- Frontend IA (tabs removed) → Task 23
- Source spine UI → Task 18
- Inputs zone → Task 21
- Cluster ref appender → Task 11
- Platform-native citation rendering → Task 10
- Data model + migrations → Tasks 3, 4
- Archive page → Task 24
- Tab redirects → Task 25
- Manual draft removal → Task 26
- Multi-tenancy → Task 27
- Final verification → Task 28

All spec sections covered. Open question "concrete prompt template for the citation critic LLM" resolved inline in Task 8.

**2. Placeholder scan:** No "TBD", "implement later" placeholders. Where exact existing-code locations were uncertain (e.g. `BriefPanel.tsx` internals, frontend `api.ts` style, middleware tabs handling), the plan flags "match existing style" and the engineer has the context to do so.

**3. Type consistency:**
- `classify_domain` → returns `Literal["T1","T2","T3"]` consistently
- `build_cluster_pack` → returns `ContentEvidencePack` consistently
- `critique_citations` → `(*, text: str, pack_sources: list[dict])` consistently
- `append_pillar_reference` → `(*, text, platform, pillar_url)` consistently
- `regenerate_cluster` → adds `rebuild_brief: bool = True` parameter and callers (both endpoints) match this signature

Plan complete.
