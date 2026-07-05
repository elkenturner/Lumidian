# Content Quality Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Four approved upgrades: (1) full-page-text evidence enrichment, (2) per-piece regen parity with full-cluster regen, (3) owned-site "deep" FAQ-rich pages, (4) re-wire the opportunities surface with draft/dismiss.

**Architecture:** All backend work extends existing modules (`cluster_evidence.py`, `clustering_service.py`, `drafting/owned_site.py`); the opportunities surface is a new section on the existing `/content/[brandId]` board using endpoints that already exist.

**Tech Stack:** FastAPI + async SQLAlchemy + pytest (asyncio_mode=auto); httpx + BeautifulSoup4 (both already dependencies); Next.js 16 + TS strict.

## Global Constraints

- Backend: `cd backend && source venv/bin/activate`; append-only migrations (none needed here); ignore pre-existing red `test_client_portal.py` / `test_prompt_intelligence.py`.
- All network fetches best-effort: failures must NEVER fail pack building or generation.
- Frontend: no new deps; `npx tsc --noEmit` + `npm run build` clean; match existing CSS-token idioms.
- A parallel session may leave uncommitted files (`auth.py`, `test_rate_limits.py`, `CURRENT_STATE.md`) — commit ONLY task files.
- Never use markdown `**` in any new writer-facing copy (house rule as of 2026-07-05).

---

### Task 1: Evidence pack full-text enrichment

**Files:**
- Modify: `backend/app/services/cluster_evidence.py`
- Test: `backend/tests/test_evidence_enrichment.py` (create)

**Interfaces:**
- Produces: `async def enrich_pack_snippets(sources: list[dict], *, max_chars: int = 1800, concurrency: int = 5, timeout_s: float = 8.0) -> list[dict]` — returns the same list with `snippet` (and placeholder `title`) upgraded from fetched page text. Called inside `_persist_pack` before rows are built, so every pack path (citations, Serper, user-only, brand-authority, ungated) benefits.

Behavior:
- Skip URLs not starting with `http` (e.g. `internal://brand-profile`).
- Fetch with `httpx.AsyncClient(follow_redirects=True, timeout=timeout_s, headers={"User-Agent": "Mozilla/5.0 (compatible; LumidianBot/1.0)"})`, bounded by `asyncio.Semaphore(concurrency)`.
- Parse with BeautifulSoup(`html.parser`): drop `script/style/nav/header/footer/aside`, take `soup.get_text(" ", strip=True)`, collapse whitespace, first `max_chars` chars.
- Replace `snippet` only when the fetched text is LONGER than the existing snippet (never downgrade a good Serper snippet to a cookie-banner fragment shorter than it).
- If existing `title` is empty or the `"(cited by AI for this prompt)"` placeholder, replace with the page `<title>` (trimmed, ≤200 chars) when available.
- Any exception per-URL → keep the original dict untouched. Log at debug/info, never raise.

- [ ] **Step 1: Failing tests** — mock `httpx.AsyncClient.get` (patch where looked up): (a) snippet upgraded from short Serper snippet to page text, truncated at max_chars; (b) placeholder title replaced from `<title>`; (c) fetch exception → dict unchanged; (d) `internal://` skipped (no fetch attempted — assert mock not called for it); (e) shorter fetched text than existing snippet → snippet kept; (f) `_persist_pack` integration: persisted `ContentEvidencePack.sources` carry enriched snippets (patch `enrich_pack_snippets` OR the http layer; simplest is a real call with mocked httpx).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `enrich_pack_snippets` + call at the top of `_persist_pack`: `pack_sources = await enrich_pack_snippets(list(pack_sources))`.
- [ ] **Step 4: Green** + `pytest tests/ -k "evidence or cluster_pack or pack" -q` no regressions (existing pack tests must not hit the network: since they call `_persist_pack` with fake URLs, the enricher will try to fetch — ensure the enricher treats connection errors as no-ops fast, and set `timeout_s` low in tests via monkeypatched default or accept the no-op path; if any existing test slows >2s, patch `enrich_pack_snippets` to identity in `conftest`-level fixture for those files instead of editing each test).
- [ ] **Step 5: Commit** `feat(evidence): enrich pack snippets with fetched page text (first ~1800 chars)`

---

### Task 2: Per-piece regen parity (thread routing + angle classification)

**Files:**
- Modify: `backend/app/services/clustering_service.py` (`regenerate_piece`)
- Test: `backend/tests/test_cluster_thread_routing.py` (append)

**Interfaces:**
- Consumes: `_resolve_post_targets(db, brand_id=..., brand_name=..., prompt_id=..., prompt_text=..., enabled=[platform])` — already platform-scoped via `enabled`.
- Produces: `regenerate_piece` for reddit/quora now: resolves a target; honors `platform_key_override` (reddit_comment) for generation; passes `opportunity` context and `brief_append`; persists `content_brief`/`target_title`/`opportunity_id` on the updated-or-created draft; marks the routed opportunity `drafted` ONLY on success; resolves angle with the target's `subreddit` classification instead of `sub_cls=None`.

- [ ] **Step 1: Failing tests** (mirror the file's existing seeding/patching idioms): (a) `regenerate_piece(platform="reddit")` with a seeded qualifying opportunity → draft has `content_brief == thread_url`, `target_title`, `opportunity_id`; opportunity `status == "drafted"`; the patched `_generate_piece_text` received `platform="reddit_comment"` (capture kwargs); (b) failed generation → opportunity stays `new`; (c) quora piece regen gets `target_title` from the (patched) quora search.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** In `regenerate_piece`, before generation for platform in ("reddit", "quora"): `post_targets = await _resolve_post_targets(db, brand_id=cluster.brand_id, brand_name=brand_row.name, prompt_id=cluster.prompt_id, prompt_text=prompt_row.text, enabled=[platform])`; `target = post_targets.get(platform, {})`; append `target.get("brief_append")` to ctx; pass `opportunity_context=target.get("opportunity")`; `platform_for_generation = target.get("platform_key_override") or platform`; angle `sub_cls` from `target.get("subreddit")` classification (same as `_gen`); persist the three routing fields on the draft (both the update-existing and create-new branches); after successful persistence mark `target.get("opportunity_id")` drafted (reuse/extract the marking snippet from `regenerate_cluster` if trivially shareable — a tiny helper `_mark_opportunities_drafted(db, ids)` both call sites use).
- [ ] **Step 4: Green** + `pytest tests/ -k cluster -q`.
- [ ] **Step 5: Commit** `feat(clusters): per-piece regen resolves thread routing and subreddit-aware angle`

---

### Task 3: Owned-site deep pages (FAQ-rich, long-form)

**Files:**
- Modify: `backend/app/services/drafting/owned_site.py`, `backend/app/services/clustering_service.py`, `backend/app/routers/clusters.py`, `backend/app/schemas.py` (if a body model is cleaner than a query param)
- Modify: `frontend/components/content/cluster/OwnedSiteCard.tsx`, `frontend/lib/api.ts`
- Test: `backend/tests/test_owned_site_deep.py` (create)

**Interfaces:**
- `build_owned_site_prompt(..., depth: str = "standard")` — `"deep"` adds: target 1800-3000 words; a final `## Frequently asked questions` section with 5-8 `### <question>` subsections, each question phrased as a real user query about the target topic (query-mirroring), each answered in a self-contained 60-120 word block; instruction that every H2 must read as a question or direct answer to a query variant.
- `generate_owned_site_draft(..., depth: str = "standard")` — passes depth through both prompt builds; after generation, `_extract_faq(body)` parses the FAQ section (`### ` headings under the FAQ H2 → `[{"question","answer"}]`, best-effort regex, empty list when absent) and passes it to the existing `build_jsonld(..., faq=...)` so deep pages emit FAQPage JSON-LD.
- Writer token cap: `max_tokens=8000` when deep (thread a `max_tokens` into the writer closure at the two call sites in `clustering_service` — `_gen_owned_site_piece(depth=...)` — and `drafting_service`'s gap branch stays standard).
- Endpoint: the existing per-piece regenerate route in `routers/clusters.py` gains an optional `depth: Literal["standard","deep"] = "standard"` query parameter, forwarded only for `owned_site` (422-safe default; ignored for other platforms).
- Frontend: `regenerateClusterPiece(brandId, clusterId, platform, opts?: { depth?: "deep" })` appends `?depth=deep`; `OwnedSiteCard` gains a secondary ghost button "Write deep version" (title: "Longer FAQ-rich page (1,800+ words) built for AI citation — takes a bit longer") shown whenever a Generate/Rewrite action is available; wire through the same regenerating state.

- [ ] **Step 1: Failing tests**: (a) deep prompt contains "Frequently asked questions", "1800" (or the word-range text) and the H2-as-question rule; standard prompt unchanged (no FAQ mandate); (b) `_extract_faq` parses a body with `## Frequently asked questions` + three `### Q` blocks into 3 pairs, returns [] when section missing; (c) `generate_owned_site_draft(depth="deep")` with stub writer returning an FAQ-bearing body → `jsonld` list/dict includes a FAQPage node with mainEntity length 3 (inspect existing build_jsonld faq shape first and assert accordingly); (d) router: regenerate owned_site with `?depth=deep` passes depth into the (patched) `regenerate_piece`/`_gen_owned_site_piece` path — capture kwargs.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** backend then frontend; `npx tsc --noEmit && npm run build`.
- [ ] **Step 4: Green** + `pytest tests/ -k "owned_site or cluster" -q`.
- [ ] **Step 5: Commit** `feat(owned-site): deep FAQ-rich page option with FAQPage JSON-LD`

---

### Task 4: Opportunities surface on the content board

**Files:**
- Modify: `frontend/lib/api.ts` (add `draftOpportunity(id): Promise<ContentDraft>` → `POST /opportunities/{id}/draft`; `dismissOpportunity(id): Promise<void>` → `DELETE /opportunities/{id}/dismiss`; confirm `getOpportunities` typing)
- Create: `frontend/components/content/OpportunitiesPanel.tsx`
- Modify: `frontend/app/content/[brandId]/page.tsx` (mount below the cluster grid)

**Interfaces:**
- Consumes existing backend: `GET /api/opportunities/{brand_id}` (list of {id, platform, thread_url, thread_title, subreddit, relevance_score, status, created_at/posted_at}); `POST /api/opportunities/{opportunity_id}/draft` returns the full ContentDraft (title, content_text); `DELETE /api/opportunities/{opportunity_id}/dismiss`. Paid-gating errors (402/403) surface as a toast/inline message, not a crash.

Panel behavior (keep it one component, ~200 lines):
- Header: `Live threads to join` + one-line explainer: "Real conversations on Reddit, Quora, LinkedIn and X that match your tracked questions. Reply there to build presence AI engines retrieve."
- Collapsed by default when clusters exist; badge with count of `status === "new"` items.
- Rows (status new, sorted by relevance desc): PlatformBadge, thread title → external link, `r/{sub}` when present, `{relevance}% match`. Actions: `Draft reply` (spinner while POSTing; on success expand an inline sub-panel with the draft text, Copy button, `Mark posted` (reuses `updateDraft(draft.id, {status:"posted"})`), and the thread link again), `Dismiss` (row fades out; optimistic).
- Drafted rows (status drafted, no expanded draft in state) show a muted `Drafted` chip instead of the Draft button.
- Error state per-row inline (e.g. upgrade-required message body from the API), never a blank crash.

- [ ] **Step 1: Implement** api fns + panel + mount.
- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run build` clean; if local dev stack is running (backend 8001 / frontend 3002), load `/content/2` and exercise draft+dismiss against seeded MSC opportunities.
- [ ] **Step 3: Commit** `feat(content-ui): live-threads panel — draft replies and dismiss from the board`

---

### Task 5: Verification, docs, ship

- [ ] Full backend: `pytest tests/ -q --ignore=tests/test_client_portal.py --ignore=tests/test_prompt_intelligence.py` → green.
- [ ] Frontend: tsc + build clean.
- [ ] Docs: CLAUDE.md — evidence enrichment sentence in Content Clusters section; deep-page + opportunities-panel mentions; CURRENT_STATE.md session entry.
- [ ] Merge to main via `.worktrees/design-cleanup`, push, watch Railway to SUCCESS, probe prod health.

## Self-Review Notes

- Coverage: #1→T1, #2→T2, #3→T3, #4→T4; ship→T5.
- Interface consistency: `depth` literal `"standard"|"deep"` everywhere; `_mark_opportunities_drafted` helper shared by regenerate_cluster + regenerate_piece (T2 extracts, nothing else renames it).
- Risk notes: T1's enrichment runs inside `_persist_pack` used by tests with fake URLs — the fetch must fail fast and silently (see Step 4 note). T3's writer token bump only applies to the deep path.
