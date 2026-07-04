# Content Generation Hardening — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cluster content generation foolproof: no DB-lock cascades, no empty drafts masquerading as content, no hard-fail when sources are thin, user sources count toward authority, profile can't be silently blank.

**Architecture:** Small, surgical diffs to the existing pipeline (`cluster_evidence.py`, `clustering_service.py`, `drafting/evidence.py`, `routers/content.py`, `routers/brand_profile.py`). No schema-breaking changes; one additive migration pattern (none needed — all columns exist). Spec: `docs/audits/2026-07-04-content-generation-audit.md`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, SQLite/aiosqlite, pytest (`asyncio_mode=auto`).

## Global Constraints

- All DB access async; never sync SQLAlchemy.
- Tests: `cd backend && source venv/bin/activate && pytest tests/<file> -x -q`. Extend the EXISTING test file named in each task — follow its current mocking patterns (read it first).
- Never modify existing migration steps in `database.py:run_migrations()`.
- Failure reasons stored in `ContentCluster.failure_reason` must be machine-prefixed (`insufficient_authority:`, `search_unavailable:`, `no_sources_found`, `brief_llm_failure`) — the frontend maps prefixes to plain language.
- Commit after each task: `git add -A && git commit -m "<type>(content): <summary>"` on branch `fix/audit-sweep`.

---

### Task 1: DB-lock resilience — busy_timeout + evidence-cache writes can never poison a session

**Files:**
- Modify: `backend/app/database.py:42` (busy_timeout)
- Modify: `backend/app/services/drafting/evidence.py:287-299` (`write_cache`)
- Test: `backend/tests/test_drafting_evidence.py`

**Interfaces:**
- Produces: `write_cache(...)` — same signature, but NEVER raises and NEVER leaves the session in pending-rollback state. A module-level `_CACHE_WRITE_LOCK = asyncio.Lock()` serializes evidence_cache writes in-process.

- [ ] **Step 1: Write failing tests** in `tests/test_drafting_evidence.py`:

```python
async def test_write_cache_swallows_operational_error(db_session, monkeypatch):
    """A locked-DB commit inside write_cache must be swallowed and rolled back
    so the caller's session remains usable."""
    from sqlalchemy.exc import OperationalError
    from app.services.drafting import evidence as ev

    pack = ev.EvidencePack(sources=[], query="q", brand_name="B")

    async def boom():
        raise OperationalError("INSERT INTO evidence_cache", {}, Exception("database is locked"))
    monkeypatch.setattr(db_session, "commit", boom)
    rolled = {"n": 0}
    real_rollback = db_session.rollback
    async def spy_rollback():
        rolled["n"] += 1
        await real_rollback()
    monkeypatch.setattr(db_session, "rollback", spy_rollback)

    # Must not raise
    await ev.write_cache(brand_id=1, prompt_id=1, pack=pack, db=db_session)
    assert rolled["n"] == 1

async def test_write_cache_serialized_by_lock():
    from app.services.drafting import evidence as ev
    assert isinstance(ev._CACHE_WRITE_LOCK, __import__("asyncio").Lock)
```

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_drafting_evidence.py -q -k write_cache` → FAIL (no `_CACHE_WRITE_LOCK`, exception propagates).

- [ ] **Step 3: Implement.** In `drafting/evidence.py`:

```python
import asyncio
_CACHE_WRITE_LOCK = asyncio.Lock()  # serialize in-process evidence_cache writers

async def write_cache(brand_id: int, prompt_id: int, pack: EvidencePack, db: AsyncSession) -> None:
    """Best-effort cache write. NEVER raises and never leaves `db` poisoned —
    a cache miss on the next call is strictly cheaper than a failed piece."""
    payload = _json.dumps(pack.to_dict())
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        async with _CACHE_WRITE_LOCK:
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
    except Exception as exc:
        logger.warning("evidence_cache write failed for brand %d prompt %d (non-fatal): %s",
                       brand_id, prompt_id, exc)
        try:
            await db.rollback()
        except Exception:
            pass
```

In `database.py:42` change `PRAGMA busy_timeout=5000` → `PRAGMA busy_timeout=15000` and update the comment to note the 5-way per-piece writer burst measured in the 2026-07-04 incident.

- [ ] **Step 4: Run tests** — `pytest tests/test_drafting_evidence.py -q` → PASS.
- [ ] **Step 5: Commit** — `fix(content): evidence cache writes can never poison a session; raise busy_timeout`

---

### Task 2: Guard `_load_voice_directive` (and keep pipeline alive on a degraded session)

**Files:**
- Modify: `backend/app/services/drafting_service.py:176-188`
- Test: `backend/tests/test_voice_directive.py`

**Interfaces:**
- Produces: `_load_voice_directive(db, brand_id) -> str | None` — returns None on ANY DB error (logged), matching the swallow behavior of its siblings at `drafting_service.py:673/687/696`.

- [ ] **Step 1: Failing test** in `tests/test_voice_directive.py`:

```python
async def test_load_voice_directive_survives_poisoned_session(db_session, monkeypatch):
    from app.services import drafting_service as ds
    async def boom(*a, **k):
        from sqlalchemy.exc import PendingRollbackError
        raise PendingRollbackError("rolled back")
    monkeypatch.setattr(db_session, "execute", boom)
    result = await ds._load_voice_directive(db_session, brand_id=1)
    assert result is None
```

- [ ] **Step 2: Run** → FAIL (raises PendingRollbackError).
- [ ] **Step 3: Implement** — wrap the body:

```python
async def _load_voice_directive(db: AsyncSession, brand_id: int) -> str | None:
    try:
        result = await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )
        return _voice_directive_from_profile(result.scalar_one_or_none())
    except Exception as exc:
        logger.warning("Voice directive lookup failed for brand %d (non-fatal): %s", brand_id, exc)
        return None
```

- [ ] **Step 4: Run** `pytest tests/test_voice_directive.py -q` → PASS.
- [ ] **Step 5: Commit** — `fix(content): voice directive lookup is non-fatal like its pipeline siblings`

---

### Task 3: Sweep isolation + `retry_failed` mode

**Files:**
- Modify: `backend/app/routers/content.py:86-152` (`_bg_generate_drafts`), `generate_now` endpoint (~:716-790), `GenerateNowRequest` schema (find it in `content.py` or `schemas.py` — it already has `skip_ready`)
- Test: `backend/tests/test_generate_now_cluster_integration.py`

**Interfaces:**
- Produces: `_bg_generate_drafts(brand_id, max_gaps, source, skip_ready=False, retry_failed=False)`. Each cluster now gets a **fresh `AsyncSessionLocal()`**. `retry_failed=True` processes ONLY clusters with status in `{"pending", "briefing_failed", "generation_partial"}`. `POST /content/{brand_id}/generate-now` accepts `retry_failed: bool = False`.

- [ ] **Step 1: Failing tests** (extend existing mocking pattern in `test_generate_now_cluster_integration.py` — it already stubs `regenerate_cluster`):

```python
async def test_sweep_uses_fresh_session_per_cluster(...):
    """A regenerate_cluster failure for prompt N must not prevent prompt N+1
    from being processed with a working session: record the session object ids
    passed to the stubbed regenerate_cluster; assert they differ per call and
    that a raise on call 1 still lets call 2 happen."""

async def test_retry_failed_only_processes_failed_and_pending(...):
    """Seed clusters with statuses ready / briefing_failed / generation_partial /
    pending; run sweep with retry_failed=True; assert stub called only for
    briefing_failed, generation_partial, pending."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Restructure the loop — outer session only for the initial brand/prompt read, then per-cluster sessions:

```python
    try:
        async with AsyncSessionLocal() as db:
            brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one_or_none()
            if brand is None:
                logger.warning("_bg_generate_drafts: brand %d not found", brand_id)
                return
            owner = (await db.execute(select(User).where(User.id == brand.user_id))).scalar_one_or_none()
            tier = owner.subscription_tier if owner else None
            prompt_ids = [p.id for p in (await db.execute(
                select(Prompt)
                .where(Prompt.brand_id == brand_id, Prompt.prompt_type == "standard")
                .order_by(Prompt.id)
            )).scalars().all()]

        for prompt_id in prompt_ids[:max_gaps]:
            try:
                # Fresh session per cluster: one poisoned session must never
                # cascade into "every remaining cluster silently stays pending"
                # (2026-07-04 Roxstart incident).
                async with AsyncSessionLocal() as cluster_db:
                    cluster = await get_or_create_cluster(cluster_db, brand_id=brand_id, prompt_id=prompt_id)
                    if skip_ready and cluster.status in {"ready", "ready_low_evidence", "generation_partial"}:
                        continue
                    if retry_failed and cluster.status not in {"pending", "briefing_failed", "generation_partial"}:
                        continue
                    await asyncio.wait_for(
                        regenerate_cluster(cluster_db, cluster_id=cluster.id, tier=tier),
                        timeout=CLUSTER_TIMEOUT_SECONDS,
                    )
            except asyncio.TimeoutError:
                logger.warning(...)  # keep existing message
                continue
            except Exception:
                logger.exception(...)  # keep existing message
                continue
```

Add `retry_failed: bool = False` to `GenerateNowRequest` and thread it through the endpoint's `asyncio.create_task(_bg_generate_drafts(..., retry_failed=payload.retry_failed))`.

- [ ] **Step 4: Run** `pytest tests/test_generate_now_cluster_integration.py -q` → PASS.
- [ ] **Step 5: Commit** — `fix(content): per-cluster sessions in sweep + retry_failed mode`

---

### Task 4: Move stale-run cleanup off the polled read path

**Files:**
- Modify: `backend/app/routers/tracking.py:808-810` (remove the write loop)
- Modify: `backend/app/scheduler.py` (extend `_stale_cluster_cleanup_tick` region ~:671-687)
- Test: `backend/tests/test_background_status.py`, `backend/tests/test_scheduler.py`

**Interfaces:**
- Produces: scheduler job `stale_run_cleanup` (every 5 min) calling `fail_stale_runs_for_brand(db, bid)` for every brand with a pending/running run. `GET /tracking/background-status` becomes read-only.

- [ ] **Step 1: Failing tests:**

```python
# test_background_status.py
async def test_background_status_does_not_write(client, db_session, ...):
    """Seed a stale running run (created_at far in the past). GET /background-status.
    Assert the run is STILL 'running' afterwards (endpoint no longer auto-fails it)."""

# test_scheduler.py
async def test_stale_run_cleanup_tick_fails_stale_runs(db_session, ...):
    """Seed stale running run; call the new _stale_run_cleanup_tick(); assert failed."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `tracking.py` delete the `for bid in user_brand_ids: await fail_stale_runs_for_brand(db, bid)` loop (leave a comment pointing at the scheduler job). In `scheduler.py` add beside the cluster tick:

```python
    async def _stale_run_cleanup_tick() -> None:
        from sqlalchemy import select
        from app.database import AsyncSessionLocal, fail_stale_runs_for_brand
        from app.models import TrackingRun
        async with AsyncSessionLocal() as db:
            try:
                brand_ids = (await db.execute(
                    select(TrackingRun.brand_id).where(
                        TrackingRun.status.in_(["pending", "running"])
                    ).distinct()
                )).scalars().all()
                for bid in brand_ids:
                    await fail_stale_runs_for_brand(db, bid)
            except Exception as exc:
                logger.warning("stale run cleanup failed: %s", exc)

    scheduler.add_job(
        _stale_run_cleanup_tick,
        trigger=IntervalTrigger(minutes=5),
        id="tracking_stale_run_cleanup",
        name="Auto-fail stale tracking runs (every 5 min)",
        replace_existing=True,
        misfire_grace_time=300,
    )
```

Check other callers of `fail_stale_runs_for_brand` (grep) — keep any non-polled callers as-is.

- [ ] **Step 4: Run both test files** → PASS.
- [ ] **Step 5: Commit** — `fix(tracking): stale-run cleanup runs on scheduler tick, not the polled status endpoint`

---

### Task 5: Failed pieces stop masquerading as drafts

**Files:**
- Modify: `backend/app/services/clustering_service.py:522-528` (failed branch → `status="failed"`)
- Modify: `backend/app/routers/clusters.py` (`_summarize_pieces` ~:117-160 and the cluster detail serializer — failed pieces must still be RETURNED with `generation_state`/`failure_reason` so the UI can show them, but never counted as drafts)
- Modify: `backend/app/routers/content.py` + `backend/app/services/drafting_service.py` — find every draft-count/cap query (`get_draft_cap` usage, draft-status endpoint) and exclude `status="failed"` rows (most already filter `status == "draft"`; verify each).
- Test: `backend/tests/test_clustering_service.py`, `backend/tests/test_cluster_routes.py`

**Interfaces:**
- Produces: failed pieces persist as `ContentDraft(status="failed", generation_state="failed", content_text="", failure_reason=...)`. The regen delete at `clustering_service.py:451-456` already includes `"failed"` — unchanged.

- [ ] **Step 1: Failing tests:**

```python
# test_clustering_service.py — extend the existing regenerate_cluster test that stubs
# _generate_piece_text to raise for one platform:
async def test_failed_piece_persists_with_failed_status(...):
    """Force one piece to fail; assert its ContentDraft row has status='failed'
    (not 'draft') and cluster.status == 'generation_partial'."""

# test_cluster_routes.py
async def test_failed_pieces_not_counted_as_drafts_in_summary(...):
    """Cluster with 2 done + 3 failed pieces: list endpoint's draft/piece counts
    reflect 2; detail endpoint still returns all 5 pieces with failure_reason."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in the failed branch change `status="draft"` → `status="failed"`. Then read `_summarize_pieces` and the board/list serializers and draft-status cap counting; exclude `status="failed"` from counts while keeping the rows in the detail payload. Grep for `status == "draft"` / `status.in_` in `content.py`, `clusters.py`, `drafting_service.py` and verify each query's intent.
- [ ] **Step 4: Run** `pytest tests/test_clustering_service.py tests/test_cluster_routes.py -q` → PASS. Also run `pytest tests/test_draft_limits.py tests/test_content.py -q` (cap logic).
- [ ] **Step 5: Commit** — `fix(content): failed pieces persist as status=failed, excluded from draft counts`

---

### Task 6: Authority classification — subdomain matching, vertical trade press, configurable thresholds

**Files:**
- Modify: `backend/app/services/source_authority.py`
- Modify: `backend/app/services/cluster_evidence.py:94-95` (env-overridable thresholds)
- Test: `backend/tests/test_source_authority.py`, `backend/tests/test_cluster_evidence.py`

**Interfaces:**
- Produces: `classify_domain("blog.reuters.com") == "T1"` (suffix walk); logistics/freight trade domains classify T2; `MIN_T1`/`MIN_T1_PLUS_T2` read from env `CLUSTER_GATE_MIN_T1` / `CLUSTER_GATE_MIN_T1_PLUS_T2` with defaults 1/3.

- [ ] **Step 1: Failing tests:**

```python
# test_source_authority.py
def test_subdomain_inherits_parent_tier():
    assert classify_domain("blog.reuters.com") == "T1"
    assert classify_domain("news.techcrunch.com") == "T2"

def test_gov_subpath_domains():
    assert classify_domain("fmcsa.dot.gov") == "T1"

def test_logistics_trade_press_is_t2():
    for d in ["freightwaves.com", "ttnews.com", "joc.com", "supplychaindive.com",
              "dcvelocity.com", "fleetowner.com", "logisticsmgmt.com", "overdriveonline.com"]:
        assert classify_domain(d) == "T2", d

# test_cluster_evidence.py
def test_gate_thresholds_env_overridable(monkeypatch):
    """gate_pack must consult _min_t1()/_min_t1_plus_t2() helpers that read env."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `classify_domain` walks label suffixes:

```python
def classify_domain(domain: str) -> Tier:
    d = _normalize(domain)
    if not d:
        return "T3"
    # Walk suffixes so subdomains inherit the parent's tier
    # (blog.reuters.com -> reuters.com).
    parts = d.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in T1_DOMAINS:
            return "T1"
        if candidate in T2_DOMAINS:
            return "T2"
    if d.endswith(".gov") or d.endswith(".gov.uk") or d.endswith(".edu"):
        return "T1"
    return "T3"
```

Add to `T2_DOMAINS` (new "Logistics / freight / supply-chain trade" group): `freightwaves.com`, `ttnews.com`, `joc.com`, `supplychaindive.com`, `transportdive.com`, `dcvelocity.com`, `fleetowner.com`, `logisticsmgmt.com`, `overdriveonline.com`, `landline.media`, `truckinginfo.com`, `commercialcarrierjournal.com`. In `cluster_evidence.py` replace the constants with:

```python
import os
def _min_t1() -> int:
    return int(os.getenv("CLUSTER_GATE_MIN_T1", "1"))
def _min_t1_plus_t2() -> int:
    return int(os.getenv("CLUSTER_GATE_MIN_T1_PLUS_T2", "3"))
```

and use them in `gate_pack` (keep module-level `MIN_T1`/`MIN_T1_PLUS_T2` as deprecated aliases if other code imports them — grep first).

- [ ] **Step 4: Run** `pytest tests/test_source_authority.py tests/test_cluster_evidence.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): subdomain-aware authority tiers + logistics trade press + env-tunable gate`

---

### Task 7: User-attached sources count toward the authority gate

**Files:**
- Modify: `backend/app/services/cluster_evidence.py` (`build_cluster_pack`)
- Test: `backend/tests/test_cluster_evidence.py`

**Interfaces:**
- Consumes: `BrandSource` model (`app.models`, fields: `brand_id`, `url`, `title`, `snippet`, `added_at`).
- Produces: `_load_user_sources(db, brand_id) -> list[dict]` returning `rank_and_tier`-shaped dicts. User sources are merged into BOTH the citations path and the Serper path before gating, with a **tier floor of T2** (classify_domain may still yield T1): the user vouched for them.

- [ ] **Step 1: Failing test:**

```python
async def test_user_sources_satisfy_gate(db_session, monkeypatch, ...):
    """Brand has 3 BrandSource rows (arbitrary T3 domains). Serper returns nothing.
    build_cluster_pack must PASS the gate (3 user sources = T2 floor -> T1+T2 >= 3
    fails MIN_T1 though...). Seed 1 BrandSource on a .gov domain + 2 others:
    gate passes with t1=1, t1+t2=3. Assert pack persisted with tier values
    and no PackGateError."""
```

(Also add a test that user sources appear in the pack even when Serper results alone would pass.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:**

```python
async def _load_user_sources(db: AsyncSession, brand_id: int) -> list[dict]:
    """BrandSource library entries, shaped for rank_and_tier. The user vouched
    for these, so they get a T2 floor (classify_domain may still say T1)."""
    from sqlalchemy import select, desc
    from app.models import BrandSource
    rows = (await db.execute(
        select(BrandSource).where(BrandSource.brand_id == brand_id)
        .order_by(desc(BrandSource.added_at)).limit(10)
    )).scalars().all()
    out = []
    for r in rows:
        domain = _domain_of(r.url)
        tier = classify_domain(domain)
        if tier == "T3":
            tier = "T2"
        out.append({"url": r.url, "title": r.title or "", "snippet": r.snippet or "",
                    "domain": domain, "tier": tier, "user_supplied": True})
    return out
```

In `build_cluster_pack`, load once at the top: `user_sources = await _load_user_sources(db, cluster.brand_id)`. In the citations path: `ranked = rank_and_tier(raw_citations)` → `pack_sources = _merge_user(user_sources, ranked)[:PACK_CAP]`. Same in the Serper path. `_merge_user` prepends user sources and dedups by normalized URL:

```python
def _merge_user(user_sources: list[dict], ranked: list[dict]) -> list[dict]:
    seen = {_normalize_url(s["url"]) for s in user_sources}
    return user_sources + [s for s in ranked if _normalize_url(s["url"]) not in seen]
```

Note: user sources are already-tiered dicts — `rank_and_tier` must NOT reclassify them; merge after ranking.

- [ ] **Step 4: Run** `pytest tests/test_cluster_evidence.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): user source library counts toward the cluster authority gate`

---

### Task 8: Never hard-fail to nothing — ungated low-evidence fallback

**Files:**
- Modify: `backend/app/services/cluster_evidence.py` (`PackGateError` carries sources; `build_cluster_pack` attaches them)
- Modify: `backend/app/services/clustering_service.py:392-414` (fallback chain)
- Test: `backend/tests/test_cluster_pack_fallback.py`

**Interfaces:**
- Produces: `PackGateError(msg, sources=list[dict])` — `exc.sources` holds the ranked (post-merge) sources that failed the gate. New `build_cluster_pack_ungated(db, *, cluster, sources, version) -> ContentEvidencePack` persists them as-is. Fallback chain in `regenerate_cluster` becomes: gated pack → brand-authority pack → **ungated pack from exc.sources (if any) → low_evidence=True** → only if `exc.sources` is empty: `briefing_failed` with `failure_reason="no_sources_found"` (or the original gate message when sources existed but persisting failed).

- [ ] **Step 1: Failing tests:**

```python
async def test_gate_error_carries_sources(...):
    """gate_pack raises PackGateError with .sources == the pack it rejected."""

async def test_regenerate_falls_back_to_ungated_t3_pack(...):
    """Serper returns 4 T3 sources, no profile, no audit: cluster must NOT be
    briefing_failed — it proceeds to generation with low_evidence status semantics
    (final status ready_low_evidence when pieces succeed)."""

async def test_truly_zero_sources_fails_with_no_sources_found(...):
    """Serper empty + no citations + no profile + no audit -> briefing_failed,
    failure_reason == 'no_sources_found'."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**

```python
class PackGateError(Exception):
    """Raised when the cluster pack doesn't meet authority requirements.
    Carries the rejected sources so callers can degrade instead of hard-failing."""
    def __init__(self, message: str, sources: list[dict] | None = None):
        super().__init__(message)
        self.sources = sources or []
```

`gate_pack(pack)` raises `PackGateError(msg, sources=pack)`. In `build_cluster_pack`'s citations path the try/except already falls through — ensure the FINAL `gate_pack(pack_sources)` call's exception (Serper path) carries the merged sources.

`build_cluster_pack_ungated` mirrors `_persist_pack` via the same helper:

```python
async def build_cluster_pack_ungated(db, *, cluster, sources, version):
    """Persist a pack that failed the authority gate. The claim verifier +
    ready_low_evidence status keep thin sourcing honest downstream."""
    return await _persist_pack(db, cluster=cluster, pack_sources=sources[:PACK_CAP], version=version)
```

In `clustering_service.py` replace the `if pack is None:` hard-fail block:

```python
            except PackGateError as exc:
                logger.info("cluster %d: external authority gate failed (%s) — trying brand-as-authority",
                            cluster.id, exc)
                pack = await build_cluster_pack_from_brand_authority(
                    db, cluster=cluster, version=brief.version,
                )
                if pack is None and exc.sources:
                    # No profile/crawl to lean on, but the web DID return sources —
                    # generate from them ungated rather than producing nothing.
                    # ready_low_evidence + claim verifier keep it honest.
                    logger.info("cluster %d: proceeding ungated with %d low-authority sources",
                                cluster.id, len(exc.sources))
                    pack = await build_cluster_pack_ungated(
                        db, cluster=cluster, sources=exc.sources, version=brief.version,
                    )
                if pack is None:
                    cluster.status = "briefing_failed"
                    cluster.failure_reason = "no_sources_found"
                    await db.commit()
                    return cluster
                brief.evidence_pack_id = pack.id
                low_evidence = True
                await db.commit()
```

- [ ] **Step 4: Run** `pytest tests/test_cluster_pack_fallback.py tests/test_cluster_evidence.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): degrade to ungated low-evidence pack instead of hard-failing briefs`

---

### Task 9: Serper rate-limit becomes a distinct, retryable failure

**Files:**
- Modify: `backend/app/services/drafting/evidence.py` (`_serper_search` gains `raise_on_rate_limit=False`)
- Modify: `backend/app/services/cluster_evidence.py` (`fetch_and_dedupe` propagates; `build_cluster_pack` raises `SearchUnavailableError`)
- Modify: `backend/app/services/clustering_service.py` (catch → `failure_reason="search_unavailable: provider rate-limited, retry shortly"`)
- Test: `backend/tests/test_serper_rate_limit.py`

**Interfaces:**
- Produces: `SearchUnavailableError(Exception)` in `cluster_evidence.py`. `_serper_search(query, num=10, raise_on_rate_limit=False)` — when True, raises `SerperRateLimitError` after exhausting retries instead of returning `[]`. System B callers (`select_web_sources`) keep the default False → behavior unchanged.
- Rule: rate-limit only aborts the CLUSTER pack when the search came back completely empty; partial results still flow to the gate.

- [ ] **Step 1: Failing tests** (extend `test_serper_rate_limit.py` — it already mocks the httpx layer):

```python
async def test_serper_search_raises_when_flagged(...):
    """All attempts rate-limited + raise_on_rate_limit=True -> SerperRateLimitError."""

async def test_cluster_pack_reports_search_unavailable(...):
    """fetch_and_dedupe hits rate limit on every query and citations are empty ->
    build_cluster_pack raises SearchUnavailableError (not PackGateError)."""

async def test_regenerate_cluster_marks_search_unavailable(...):
    """Cluster ends briefing_failed with failure_reason.startswith('search_unavailable')."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `_serper_search`, in the exhausted-retries branch: `if raise_on_rate_limit and last_rate_limit is not None: raise last_rate_limit` (both the in-loop exhaustion return and the fallthrough). In `fetch_and_dedupe`:

```python
async def fetch_and_dedupe(queries: list[str]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    rate_limited = 0
    for q in queries:
        try:
            results = await _serper_search(q, num=PER_QUERY_LIMIT, raise_on_rate_limit=True)
        except SerperRateLimitError:
            rate_limited += 1
            continue
        except Exception as exc:
            logger.warning("Serper failed for cluster query %r: %s", q, exc)
            continue
        ...  # existing merge
    if rate_limited and not seen:
        raise SearchUnavailableError(
            f"search_unavailable: Serper rate-limited on {rate_limited}/{len(queries)} queries"
        )
    return list(seen.values())
```

(import `SerperRateLimitError` from `app.services.drafting.evidence`.) In `clustering_service.regenerate_cluster` wrap the evidence phase's `build_cluster_pack` call with an additional `except SearchUnavailableError as exc:` → status `briefing_failed`, `failure_reason=str(exc)`, commit, return. (This is retryable via Task 3's `retry_failed`.)

- [ ] **Step 4: Run** `pytest tests/test_serper_rate_limit.py tests/test_cluster_pack_fallback.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): distinguish search-provider throttling from genuine no-authority`

---

### Task 10: Brand profile — blank-overwrite guard, `clear_fields`, `target_audience`, `internal_brand_context`

**Files:**
- Modify: `backend/app/schemas.py:646-654` (`BrandProfileUpdate` + response schema)
- Modify: `backend/app/routers/brand_profile.py:42-49` (`ALL_FIELDS`), `:52-86` (`_compute_completion`), `:157-189` (PUT)
- Test: `backend/tests/test_brand_profile.py`

**Interfaces:**
- Produces: `BrandProfileUpdate` gains `target_audience: str | None = Field(None, max_length=2000)`, `internal_brand_context: str | None = Field(None, max_length=20000)`, `clear_fields: list[str] | None = None`. PUT rule: an EMPTY incoming value (`""`, `[]`) over a NON-EMPTY stored value is skipped unless the field name is in `clear_fields`. `BrandProfileResponse` includes `target_audience`. `_compute_completion` counts `target_audience` (denominator 7).

- [ ] **Step 1: Failing tests:**

```python
async def test_put_empty_does_not_wipe_filled_field(client, ...):
    """Fill company_description via PUT; then PUT {'company_description': ''} ->
    stored value unchanged."""

async def test_put_clear_fields_explicitly_wipes(client, ...):
    """PUT {'company_description': '', 'clear_fields': ['company_description']}
    -> stored value cleared."""

async def test_target_audience_roundtrip(client, ...):
    """PUT {'target_audience': 'mid-market trucking ops leaders'} -> GET returns it,
    completion_pct reflects 7 fields."""

async def test_internal_brand_context_writable(client, ...):
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In the PUT handler replace the per-field blocks with a guard helper:

```python
    def _apply(field: str, incoming, stored, setter) -> None:
        """Write-through unless this would blank a non-empty stored value
        without explicit clear_fields consent (2026-07-04 audit: an empty
        Settings form could wipe a filled profile)."""
        if incoming is None:
            return
        is_empty = (incoming == "" or incoming == [])
        if is_empty and stored and field not in (payload.clear_fields or []):
            return
        setter(incoming)
```

Apply for each field (JSON fields via `json.dumps`). Add `target_audience`/`internal_brand_context` handling, `ALL_FIELDS` += `"target_audience"`, completion counts it, `_profile_to_response` returns it. Check `AiFillProfileResponse`/frontend contract only in backend scope here.

- [ ] **Step 4: Run** `pytest tests/test_brand_profile.py -q` → PASS.
- [ ] **Step 5: Commit** — `fix(profile): blank-overwrite guard + clear_fields + target_audience/internal_brand_context write paths`

---

### Task 11: AI-fill persists non-destructively

**Files:**
- Modify: `backend/app/routers/brand_profile.py:192-278` (`ai_fill_profile`)
- Test: `backend/tests/test_brand_profile.py`

**Interfaces:**
- Consumes: Task 10's field set.
- Produces: after generating suggestions, `ai_fill_profile` writes each suggested field into the profile **only where the stored field is currently empty**, commits, and the response gains `persisted_fields: list[str]`. Add `target_audience` to the LLM extraction prompt + response schema (`AiFillProfileResponse` in `schemas.py`).

- [ ] **Step 1: Failing tests:**

```python
async def test_ai_fill_persists_into_empty_fields(client, monkeypatch, ...):
    """Mock the LLM to return description/tone/key_stats/target_audience.
    POST ai-fill on an empty profile -> GET shows them persisted;
    response.persisted_fields lists all four."""

async def test_ai_fill_never_overwrites_filled_fields(client, monkeypatch, ...):
    """Pre-fill tone_of_voice; ai-fill suggests a different tone ->
    stored tone unchanged; persisted_fields excludes tone_of_voice."""
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — after the existing suggestion parsing (keep 422/502/503 paths intact):

```python
    persisted: list[str] = []
    if suggestions.company_description and not (profile.company_description or "").strip():
        profile.company_description = suggestions.company_description
        persisted.append("company_description")
    if suggestions.tone_of_voice and not (profile.tone_of_voice or "").strip():
        profile.tone_of_voice = suggestions.tone_of_voice
        persisted.append("tone_of_voice")
    if suggestions.key_stats and not profile.key_stats:
        profile.key_stats = json.dumps(suggestions.key_stats)
        persisted.append("key_stats")
    if suggestions.target_audience and not (profile.target_audience or "").strip():
        profile.target_audience = suggestions.target_audience
        persisted.append("target_audience")
    if persisted:
        await db.commit()
```

Update the docstring ("Does NOT save anything" is no longer true). Extend the extraction prompt to also produce `target_audience` (one sentence describing who the brand sells to).

- [ ] **Step 4: Run** `pytest tests/test_brand_profile.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(profile): AI-fill persists suggestions into empty fields (non-destructive)`

---

### Task 12: Content readiness endpoint (preflight)

**Files:**
- Modify: `backend/app/routers/content.py` (new GET endpoint)
- Test: `backend/tests/test_content.py`

**Interfaces:**
- Produces: `GET /api/content/{brand_id}/readiness` →

```json
{
  "profile_completion_pct": 0.0,
  "profile_empty": true,
  "source_count": 0,
  "has_completed_run": true,
  "warnings": [
    {"code": "profile_empty", "message": "The brand profile is empty — posts will be generic and briefs are more likely to fail for lack of credible sources."},
    {"code": "no_sources", "message": "No sources in the brand library — add links you trust to strengthen sourcing."}
  ]
}
```

Warnings emitted when: `profile_completion_pct < 30` (`profile_empty`), `source_count == 0` (`no_sources`), no completed TrackingRun (`no_tracking_run`, message about missing citation evidence). Reuse `_compute_completion` from `routers/brand_profile.py` (import it) and `BrandSource` count.

- [ ] **Step 1: Failing tests:**

```python
async def test_readiness_flags_empty_profile_and_no_sources(client, ...):
async def test_readiness_clean_when_profile_filled_and_sources_exist(client, ...):
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the endpoint with ownership check (`get_brand_for_user` pattern used elsewhere in `content.py`).
- [ ] **Step 4: Run** `pytest tests/test_content.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): readiness preflight endpoint`

---

### Task 13: `failure_reason` in the cluster list payload

**Files:**
- Modify: `backend/app/routers/clusters.py` (list serializer)
- Test: `backend/tests/test_cluster_routes.py`

**Interfaces:**
- Produces: each item in `GET /api/clusters/{brand_id}` gains `failure_reason: str | None` (verbatim DB value; frontend translates).

- [ ] **Step 1: Failing test:** list endpoint returns `failure_reason` for a seeded `briefing_failed` cluster.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add the field to the list serializer (and its Pydantic schema if one exists).
- [ ] **Step 4: Run** `pytest tests/test_cluster_routes.py -q` → PASS.
- [ ] **Step 5: Commit** — `feat(content): expose failure_reason on cluster list for board-level display`

---

## Final verification (after all tasks)

- [ ] `cd backend && source venv/bin/activate && pytest tests/ -q` — full suite. Known pre-existing failures: `test_client_portal` (Ken's WIP) — everything else must be green.
- [ ] `git log --oneline` — one commit per task on `fix/audit-sweep`.
