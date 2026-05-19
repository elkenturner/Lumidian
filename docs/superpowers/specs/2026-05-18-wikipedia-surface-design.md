# Wikipedia Surface — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorm phase complete)
**Owner:** Ken
**Related:** [Content Clusters](./2026-05-11-content-clusters-design.md), [Website AIO](./2026-05-11-website-aio-design.md)

---

## Problem

The legacy Wikipedia draft path is folded into the marketing-content flow and is invisible to users. Wikipedia content has different rules: neutral encyclopedic voice, citation-backed claims, no first-person, no promotional language, conflict-of-interest disclosure requirements. Mixing it in with LinkedIn/Reddit/Medium drafts produces marketing-coded output that would be reverted on submission and damage the brand's reputation.

Carving Wikipedia into its own surface — and shifting the workflow from "draft full articles" to "find existing pages where the brand can legitimately be cited" — better matches how Wikipedia editors actually accept brand contributions and gives users a defensible product surface.

## Goals

1. Dedicated `/wiki/[brandId]` surface, separate from `/content/[brandId]`.
2. **Discovery + on-demand draft** UX: list ranked Wikipedia article candidates; user clicks to generate the suggested edit.
3. **Real article discovery** via the Wikipedia REST API — never hallucinate article titles.
4. **Legitimacy gate** via LLM scoring (claude-haiku) — neutral, non-promotional candidates only.
5. **Manual status lifecycle** with user-recorded outcomes (`submitted` / `accepted` / `reverted` / `dismissed`).
6. **Growth + Pro tier only** with scan and draft caps.
7. Reuse the existing `build_wikipedia_prompt` + `parse_wikipedia_draft` primitives in `services/drafting/` — don't reinvent the prompt engineering.

## Non-goals

- Auto-editing Wikipedia. We never call the Wikipedia edit API. User must paste manually.
- Full article creation. We only suggest additions to existing articles.
- Automated revert detection. Status changes are user-recorded.
- Migrating existing `platform='wikipedia'` `ContentDraft` rows. Legacy drafts remain accessible via the legacy `/content` path for now; deprecation is out of scope.
- Scheduled / background scans. Manual trigger only.
- Wikipedia surface for Free / Starter tiers.

## Approach

Three new components plus a small augmentation of an existing prompt builder:

- **`WikipediaScanner`** — queries the Wikipedia REST search API for each tracked prompt; pre-filters obvious non-starters (disambiguation pages, brand-self, list pages); runs a per-candidate LLM legitimacy gate; upserts ranked candidates.
- **`WikipediaDrafter`** — on user click, fetches current article wikitext, calls `build_wikipedia_prompt()` with a locked article title, parses the response via `parse_wikipedia_draft()`, persists the suggested edit on the candidate row.
- **`/api/wikipedia/*` router** — list/detail/scan/draft/status-update endpoints with tier and ownership checks.
- **`build_wikipedia_prompt()` extension** — three new optional kwargs (`locked_article_title`, `article_section_list`, `citation_needed_hints`) that, when set, swap the prompt's "ARTICLE SELECTION" section for a fixed-article instruction. Backwards compatible.

## Data Model

### New: `WikipediaCandidate`

| Field | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `brand_id` | int FK → brands.id | indexed |
| `prompt_id` | int FK → prompts.id, nullable | Tracked prompt this candidate was discovered from |
| `article_title` | str | Verified Wikipedia title |
| `article_url` | str | Verified URL from Wikipedia API |
| `pageid` | int | Wikipedia internal page ID — guarantees article exists |
| `article_summary` | text | First-paragraph extract, snapshot at scan time |
| `legitimacy_score` | float | 0..1, from the LLM gate |
| `legitimacy_reasoning` | text | One-sentence justification |
| `status` | str | `new` / `drafted` / `submitted` / `accepted` / `reverted` / `dismissed` |
| `suggested_wikitext` | text, nullable | Populated on first draft generation |
| `suggested_section` | str, nullable | E.g. "History" |
| `suggested_insert_location` | str, nullable | E.g. "end of section" |
| `evidence_pack_used` | JSON, nullable | Snapshot of `BrandSource` IDs cited |
| `last_drafted_at` | datetime, nullable | |
| `last_status_change_at` | datetime, nullable | |
| `scan_id` | int FK → wikipedia_scans.id | Producing scan |
| `created_at` | datetime | |

UNIQUE constraint on `(brand_id, article_title)`. Re-scans upsert in place.

### New: `WikipediaScan`

| Field | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `brand_id` | int FK → brands.id | indexed |
| `status` | str | `running` / `completed` / `failed` |
| `triggered_by` | int FK → users.id | |
| `prompts_searched` | int | |
| `total_candidates_found` | int | Raw Wikipedia API result count |
| `candidates_persisted` | int | After legitimacy gate |
| `error_message` | text, nullable | |
| `started_at` | datetime | |
| `completed_at` | datetime, nullable | |

### Migration

Two new tables. Appended to `database.py:run_migrations()`. No changes to existing tables. Legacy `platform='wikipedia'` `ContentDraft` rows remain untouched.

## Scanner — `services/wikipedia/scanner.py`

Pipeline per manual scan:

1. **Resolve inputs** — Brand, standard prompts, BrandProfile, existing candidates.
2. **Search Wikipedia per prompt** — `GET .../api.php?action=query&list=search&srsearch=<prompt>&srlimit=5`. Up to 5 results each.
3. **Deduplicate** by `pageid` across prompts. Keep the prompt with the strongest match.
4. **Fetch lead extract per unique article** — `action=query&prop=extracts&exintro=1&explaintext=1`. Verifies the article still exists (pageid still resolves).
5. **Free pre-filter** — drop disambiguation pages, list pages, the brand's own article and direct competitors' articles (by name match against `BrandProfile.target_audience` + competitors list), stub pages, summaries under 100 chars.
6. **LLM legitimacy gate** — one `call_claude(model=CROSS_REF_SUMMARY_MODEL)` per survivor. Strict-JSON output: `{score: 0..1, reasoning: "..."}`. Drop candidates below 0.55.
7. **Upsert** — preserve user-recorded statuses (`submitted` / `accepted` / `reverted`) across rescans; for those rows, refresh score/reasoning/summary but never reset status. New articles inserted as `status='new'`.
8. **Mark scan completed.**

**API hygiene:** Wikipedia requires a descriptive `User-Agent` header (`Lumidian/1.0 (https://lumidian.app; support@lumidian.app)`). No auth needed. 10s timeout per call, one retry on network error. Rate limit (200 req/s upstream) is not a practical concern.

**Cost per scan:** ~25 free Wikipedia API calls + ~10-15 haiku calls ≈ $0.01-0.02.

## Drafter — `services/wikipedia/drafter.py`

Pipeline on user click:

1. Load `WikipediaCandidate`, `BrandProfile`, originating `Prompt`, brand publications / `BrandSource` rows → `EvidencePack`.
2. Reuse existing `_analyze_responses_for_prompt(db, brand_id, prompt_id)` for response context.
3. Fetch full article wikitext via `action=parse&pageid=<id>&prop=wikitext`. Extract `==Section==` list and `{{citation needed}}` template locations.
4. Call extended `build_wikipedia_prompt(..., locked_article_title=candidate.article_title, article_section_list=sections, citation_needed_hints=cn_locations)`.
5. Single `call_claude` call. Model: `writer_model_for_tier(tier)` (sonnet for Growth, opus for Pro).
6. `parse_wikipedia_draft(raw_text)` → `(title, url, section, insert_location, wikitext)`.
7. Sanity-check returned title against locked title (case-insensitive, `_` ↔ space). On mismatch: one auto-retry with a stronger lock instruction; persistent mismatch errors out to the UI.
8. Persist `suggested_wikitext`, `suggested_section`, `suggested_insert_location`, `evidence_pack_used`, `last_drafted_at`. Update status: `new` → `drafted`; never reset `submitted` / `accepted` / `reverted` outcomes on regeneration.

**Error paths:**
- Article deleted/renamed since scan → set `status='dismissed'`, return error
- Unparseable LLM output → bubble up, user can retry
- Persistent title mismatch → bubble up, user can retry

## `build_wikipedia_prompt()` Extension

Add three optional kwargs to `services/drafting/prompts.py:build_wikipedia_prompt()`:

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
) -> str: ...
```

When `locked_article_title` is set, the prompt's existing "ARTICLE SELECTION" guidance is replaced by:

```
FIXED ARTICLE — non-negotiable. Insert into the Wikipedia article titled "{locked_article_title}".
Do not choose a different article. Do not invent a title.

EXISTING SECTIONS in this article (pick the best fit):
  - {section_1}
  - {section_2}
  ...

CITATION NEEDED hints (these are existing {{citation needed}} locations the brand could help fill):
  - {hint_1}
  - {hint_2}
```

Backwards compatible. Existing call sites in `drafting_service.py` continue working unchanged.

## API — `/api/wikipedia/*`

New router mounted in `app/main.py` (prefix `/api`). All endpoints verify `Brand.user_id == current_user.id` and tier eligibility.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/wikipedia/{brand_id}/candidates` | List candidates. Query params: `status`, `min_score`. Default sort: `legitimacy_score desc`. |
| `GET` | `/wikipedia/{brand_id}/candidates/{candidate_id}` | Detail (includes `suggested_wikitext` if drafted) |
| `POST` | `/wikipedia/{brand_id}/scan` | Trigger manual scan. Returns `scan_id`, runs in background. 402 if tier ineligible; 429 if cap exceeded. |
| `GET` | `/wikipedia/{brand_id}/scans/latest` | Most recent `WikipediaScan` for the brand. Powers the scan progress banner. |
| `POST` | `/wikipedia/{brand_id}/candidates/{candidate_id}/draft` | Generate or regenerate the suggested edit. 429 if cap exceeded. |
| `PATCH` | `/wikipedia/{brand_id}/candidates/{candidate_id}/status` | Body: `{status: "submitted"\|"accepted"\|"reverted"\|"dismissed"}`. User-recorded outcome. |

Pydantic schemas: `WikipediaCandidateSchema`, `WikipediaScanSchema`, `UpdateCandidateStatusRequest`.

## Tier Gating + Caps

Constant `WIKIPEDIA_ENABLED_TIERS = {"starter", "pro"}` (matches the internal-key convention; UI names are Growth + Pro). Agency brands (`brand_type='agency'`) always eligible regardless of subscription.

**Caps — rolling 30-day window per brand:**

| Tier | Scans / 30d | Draft generations / 30d |
|---|---|---|
| Growth (`starter`) | 4 | 30 |
| Pro (`pro`) | unlimited | unlimited |
| Agency | unlimited | unlimited |

Enforced in the router. `WikipediaScan.started_at >= now - 30d` for scan cap; `WikipediaCandidate.last_drafted_at` aggregated by brand for draft cap. 429 response includes `Retry-After` header indicating when the oldest counted scan/draft will roll off.

## Frontend

**Sidebar:** new entry `{ label: 'Wikipedia', href: '/wiki', icon: BookOpen }` rendered only when `user.subscription_tier in {'starter', 'pro'}` or `user.is_agency_staff`. Same conditional-render pattern as the Site Audit entry.

**Routes:**
- `/wiki/page.tsx` — redirects to `/wiki/[brandId]` once active brand resolves; renders `<WikipediaSurface />` directly if no active brand (empty-state).
- `/wiki/[brandId]/page.tsx` — thin wrapper mounting `<WikipediaSurface brandId={...} />`.

**Components — `frontend/components/wikipedia/`:**
- `WikipediaSurface.tsx` — page container: header, scan button, scan banner, filter chips, candidate grid.
- `ScanButton.tsx` — handles trigger + polling for running scans.
- `CandidateCard.tsx` — single candidate, all status states (new / drafted / submitted / accepted / reverted / dismissed).
- `SuggestedEditPanel.tsx` — expanded draft view: wikitext block, copy-to-clipboard, COI reminder, status action buttons, link to open Wikipedia article in new tab.

**`lib/api.ts` additions:** `listWikipediaCandidates`, `getWikipediaCandidate`, `scanWikipedia`, `getLatestWikipediaScan`, `draftWikipediaCandidate`, `updateWikipediaCandidateStatus` — typed functions following the existing flat-function pattern.

**Sort:** `legitimacy_score desc`. **Filter chips:** All / New / Drafted / Submitted / Accepted / Reverted. **Dismissed:** hidden by default; toggle reveals.

## Conflict of Interest Handling

Surface a persistent reminder in `SuggestedEditPanel`:

> COI reminder: Disclose your affiliation on the article talk page before editing. We do not post to Wikipedia for you.

Keep the existing `content_service.py` COI warning text adjacent to wikitext copy. Users are responsible for compliance with Wikipedia's policies.

## Testing

Backend (TDD):
- `tests/test_wikipedia_scanner.py` — pre-filter, dedup, legitimacy gate mocking, upsert idempotency, status preservation across rescans
- `tests/test_wikipedia_drafter.py` — locked-title enforcement, retry on mismatch, status transitions, evidence pack snapshot
- `tests/test_wikipedia_routes.py` — endpoint contract, tier gating (402), cap enforcement (429), ownership isolation
- `tests/test_wikipedia_prompt_extension.py` — `build_wikipedia_prompt` with new kwargs produces the locked-article section; unchanged when kwargs absent
- `tests/test_wikipedia_e2e.py` — full lifecycle: scan → list → draft → status updates

Frontend: no test suite (per `CLAUDE.md`); manual verify in dev across all card states.

## Risks & Open Questions

- **Wikipedia API courtesy.** A misbehaving scanner could get our User-Agent banned. Mitigations: descriptive UA, low rate, exponential backoff on 429/503, surface API errors to user (don't silently retry forever).
- **Locked-title evasion.** LLMs sometimes pick a different article anyway despite a strong instruction. The auto-retry + mismatch error covers the common case but not 100%. Monitor in production; if persistent, tighten by making the prompt regenerate-from-empty rather than reformat the existing article.
- **Brand-self / competitor detection in pre-filter.** Naive string match on brand name + competitor names. Will miss edge cases (e.g., a Wikipedia article that mentions the brand as one example in a list). Acceptable for v1; the LLM gate will catch most slips by scoring low. Add explicit `excluded_article_titles: list[str]` on `BrandProfile` if false positives become a complaint.
- **30-day rolling cap math.** Implemented as a count of `WikipediaScan.started_at >= now-30d`. Boundary case: if a Pro user downgrades to Growth mid-month, they should not retroactively be over-cap. Current rule: count is forward-looking only from the moment of the new tier; do not error on the downgrade. Acceptable.

## Out of Scope (parked)

- Retiring the legacy `platform='wikipedia'` `ContentDraft` flow on `/content`. Will need a separate cleanup project.
- Automatic revert detection (Wikipedia revisions API).
- Wikipedia-language localization (only English Wikipedia, `en.wikipedia.org`, for v1).
- Bulk-export of suggested edits.
- An "auto-disclose COI on talk page" feature.
- Tracking the user's Wikipedia username and historical edit acceptance rate.
