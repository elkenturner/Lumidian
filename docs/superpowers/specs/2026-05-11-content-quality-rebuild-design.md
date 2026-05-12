# Content Drafting Quality Rebuild — Design Spec

**Date:** 2026-05-11
**Status:** Approved for implementation planning
**Scope:** Backend (drafting pipeline), DB models, brand profile API, minimal brand-profile UI additions

---

## Goal

Lift the actual quality of generated content drafts by a factor of "several times better." Drafts today are single-shot Claude calls grounded only in the Brand Profile, which produces vague claims, weak voice, no real citations, and no awareness of sibling drafts. This rebuild adds three layers — **evidence retrieval**, **critic/revise loop**, and **voice anchoring + cross-referencing** — on top of the existing pipeline.

The existing `build_prompt()`, platform specs, and post-processing in `services/drafting/` are not torn out. They are sandwiched between a new retrieval layer (before) and a critic layer (after).

## Non-goals

- No change to the gap analysis or opportunity scanning that *triggers* drafting.
- No change to the platform list or platform specs themselves (Reddit, Quora, Medium, LinkedIn variants, X variants, Wikipedia).
- No new auto-posting or auto-scheduling. Posting remains manual.
- No new tier or pricing changes.

---

## Architecture overview

**Current pipeline (single shot):**
```
build_prompt() → call_claude() → remove_hedging() → save
```

**New pipeline (retrieve → draft → critique → render):**
```
1. EvidencePack assembly      (parallel: brand pages + web search + source library)
2. Voice anchor selection     (pick 1 voice sample, only on Pro)
3. Cross-reference lookup     (find related approved drafts, only on Pro)
4. build_prompt()             (now receives EvidencePack + voice sample + related drafts)
5. call_claude() → draft v1
6. Critic call → quality score + flagged paragraphs (Growth + Pro)
7. If score < 7.0: paragraph-scoped rewrite call (Growth + Pro)
8. Citation rendering per platform
9. Final light polish (shrunk regex)
10. Save ContentDraft + ContentDraftCitation rows
```

## Tier gating

| Tier | Evidence Pack | Critic loop | Voice anchor + cross-ref |
|------|---------------|-------------|--------------------------|
| Free / pitch | ❌ (existing minimal flow) | ❌ | ❌ |
| Starter | ✅ | ❌ | ❌ |
| Growth | ✅ | ✅ | ❌ |
| Pro | ✅ | ✅ | ✅ |

Tier-gating logic lives in `services/drafting_service.py` alongside the existing `TIER_DRAFT_CAPS` pattern.

---

## Layer 1 — Evidence Retrieval

### EvidencePack data structure

```python
@dataclass
class EvidenceSource:
    ref: str                       # "S1", "S2" — citation marker passed to the LLM
    kind: Literal["brand_page", "web", "library"]
    url: str
    title: str
    snippet: str                   # 1–3 sentences of substantive content
    published_date: str | None     # for web sources

@dataclass
class EvidencePack:
    sources: list[EvidenceSource]  # cap 15 total
    query: str
    brand_name: str
```

### Three retrieval sources

**a) Brand's own crawled pages — from `WebsiteAuditPage`**

The latest completed `WebsiteAudit` for the brand is queried. Pages are ranked by prompt-relevance using token overlap of the prompt against `title` + `h1_text`, weighted by `fact_density`. Top 3 pages are taken.

**Required schema change:** `WebsiteAuditPage` currently does not store body text. A new column `content_excerpt TEXT` is added (capturing ~1500 chars of cleaned body text at crawl time). `services/site_audit/crawler.py` is updated to populate it during the crawl.

**b) Live web search via Serper**

Reuses `serper_search_service.py`. The tracking prompt text is the query. Top 5 organic results are taken. A simple authority filter (allowlist of known publication domains + .edu / .gov + general reputation) ranks them. Forum and aggregator domains are deprioritized.

**c) User-curated source library — new `BrandSource` model**

```python
class BrandSource(Base):
    __tablename__ = "brand_sources"
    id: int (PK)
    brand_id: int (FK → brands.id, indexed)
    title: str
    url: str
    snippet: str (max 1500 chars)
    source_type: Literal["paper", "article", "stat", "case_study"]
    added_at: datetime
    added_by_user_id: int (FK → users.id, nullable)
```

Users add sources via the brand profile page. The backend fetches the URL via Jina to extract title + first paragraph for the snippet. Cap 20 sources per brand. All `BrandSource` rows for the brand are included in the EvidencePack (within the overall cap of 15).

### Selection budget

- Always include all `BrandSource` rows (truncate at 10 if more)
- Top 3 brand pages from `WebsiteAuditPage`
- Top 5 web search results
- Hard cap: 15 sources total (BrandSource > brand pages > web search if pruning needed)

### Caching

New table:
```python
class EvidenceCache(Base):
    __tablename__ = "evidence_cache"
    brand_id: int (PK part 1)
    prompt_id: int (PK part 2)
    pack_json: str (TEXT)
    fetched_at: datetime
```

TTL: 24 hours. On cache miss, the full EvidencePack is rebuilt and persisted. `BrandSource` rows are refolded into the cached pack on each read (no invalidation needed when sources are added).

### Prompt injection

A new section is added to `build_prompt()` in `services/drafting/prompts.py`:

```
EVIDENCE SOURCES — cite these inline using [S1], [S2], etc.:

[S1] Title of the first source
     URL: https://example.com/foo
     "The 2024 study found that 67% of patients showed measurable improvement..."

[S2] Brand's own page: Methodology overview
     URL: https://brand.com/methodology
     "Our breath-based detection has been validated across 1,400 participants..."

CITATION RULES (mandatory):
- Every statistic, study reference, or specific factual claim must end with [SN].
- If you cannot back a claim with one of the sources above, REMOVE the claim — do not hedge, do not paraphrase.
- Never invent sources or cite sources not listed above.
```

The existing "INFORMATION HIERARCHY" block in `prompts.py` is rewritten so that the Evidence Pack is the primary source. Brand Profile fields (`approved_language`, `key_stats`, etc.) become secondary context for tone and brand-specific framing.

### Citation rendering

After draft generation, `[SN]` markers are resolved per platform by `services/drafting/citations.py`:

| Platform | Rendering |
|----------|-----------|
| Medium, LinkedIn Article, Quora | Inline markdown link `[1](url)` + numbered Sources list at end |
| Reddit, LinkedIn Post | Inline `(source: domain.com)` — no footer list |
| X post / X thread | Markers stripped from text; sources stored as draft metadata |
| X reply / LinkedIn reply | Markers stripped; sources stored as metadata |
| Wikipedia | Each `[SN]` becomes `<ref>{{cite web\|url=...\|title=...}}</ref>` (replaces the current single-citation logic in `_build_citation_ref`) |

Unmatched citations (e.g. `[S6]` when only `S1`–`S5` exist) are dropped silently. Each successful citation creates a `ContentDraftCitation` row:

```python
class ContentDraftCitation(Base):
    __tablename__ = "content_draft_citations"
    id: int (PK)
    draft_id: int (FK → content_drafts.id)
    source_ref: str  # "S1"
    url: str
    title: str
    position_marker: int  # character offset in the rendered draft
```

---

## Layer 2 — Critic + targeted rewrite

### Critic call

A second Claude call (Sonnet 4.6) runs after the first draft, using **Anthropic tool-use** for structured output. The tool schema:

```python
{
    "name": "score_draft",
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
                        "note":  {"type": "string"}
                    }
                }
            }
        },
        "required": ["claim_density", "citation_coverage", "query_mirroring",
                     "concrete_specificity", "voice_authenticity", "overall_score",
                     "flagged_paragraphs"]
    }
}
```

The critic receives: the original Evidence Pack, the target query, the draft, and the platform spec. `max_tokens=400`.

### Scoring weights (in `critic.py`)

```python
WEIGHTS = {
    "claim_density":        0.25,
    "citation_coverage":    0.25,
    "concrete_specificity": 0.20,
    "voice_authenticity":   0.20,
    "query_mirroring":      0.10,
}
REWRITE_THRESHOLD = 7.0
HARD_FAIL = 4.0
```

`overall_score` is computed by the critic but cross-checked: if the critic's `overall_score` differs from `sum(weights[k] * score[k])` by more than 0.5, we recompute and use the weighted version. (Defensive — LLMs sometimes return inconsistent rollups.)

### Rewrite — paragraph-scoped

If `overall_score < 7.0`: a third Claude call rewrites **only the flagged paragraphs**. Inputs:
1. The original Evidence Pack
2. The full draft (read-only context)
3. The flagged paragraphs joined with their critic notes
4. Instruction: return only the replacement paragraphs in the same order, separated by `---PARAGRAPH---` delimiters

The returned paragraphs are spliced back into the draft by index. If the rewrite returns fewer paragraphs than were flagged, the missing ones keep their original text.

### Hard-fail path

If `overall_score < 4.0`, the draft is discarded and regenerated from scratch once (back to step 4 of the pipeline). Maximum one retry. If the second attempt also scores below 4.0, save the higher-scoring of the two and log a warning to Sentry.

### Persistence

```python
ContentDraft.quality_score: float | None  # new nullable column
```

Stored on every draft that goes through the critic. Free/Starter drafts leave it null. Used later for voice anchor selection (Layer 3) and for surfacing quality badges in the UI (deferred to v1.1).

---

## Layer 3 — Voice anchoring + cross-referencing (Pro only)

### Voice samples

**New column on `BrandProfile`:**
```python
voice_samples: JSON  # list[{title: str, text: str}], cap 3 entries, ~2000 chars each
```

**New endpoints in `routers/brand_profile.py`:**
- `POST /api/brand_profile/{brand_id}/voice-samples` — add
- `GET /api/brand_profile/{brand_id}/voice-samples` — list
- `DELETE /api/brand_profile/{brand_id}/voice-samples/{index}` — remove by index

**Selection in `services/drafting/voice.py:select_voice_sample(brand_id, platform, db) -> str | None`:**
1. If `BrandProfile.voice_samples` is non-empty → return the most recent one's text
2. Else: query `ContentDraft` where `brand_id=X AND platform=Y AND status='approved' AND quality_score IS NOT NULL`, order by `quality_score DESC, posted_at DESC LIMIT 1`. Return that draft's `content_text`.
3. Else return None (Pro user with no history — falls back to Growth behavior cleanly)

**Prompt injection (in `prompts.py`):**

```
VOICE EXAMPLE — the draft should match the rhythm, claim density,
and tone of this passage written for this brand:

"<voice sample text>"
```

No meta-commentary on the example. Just the example.

### Cross-referencing

**`services/drafting/voice.py:select_related_drafts(brand_id, prompt_id, exclude_platform, db) -> str | None`:**

Queries `ContentDraft` where `brand_id=X AND prompt_id=Y AND platform != exclude_platform AND status IN ('approved', 'posted')`. Returns a single string summary of the most recent matching draft, or None:

```
- LinkedIn article: "<title>" — argues that <30-word summary>
```

The 30-word summary is generated once per draft at creation time by a small dedicated Haiku call (`max_tokens=80`, model `claude-haiku-4-5-20251001`), then cached on the draft row as a new `summary: str | None` column on `ContentDraft`. Subsequent cross-reference lookups for sibling drafts read the cached summary — no per-lookup LLM cost.

**Prompt injection:**

```
RELATED PUBLISHED CONTENT — this brand already has approved content
on this exact query. Do not duplicate its angle. You may reference it
naturally (e.g. "in a recent LinkedIn piece") but take a different angle:

- LinkedIn article: "<title>" — argues that <summary>
```

### Banned-word list shrinks

The current 20+ phrase list in `prompts.py:build_prompt()` shrinks to ~5 unambiguous AI-tells: `delve`, `unpack` (as a verb), `it's worth noting`, `the bottom line`, `at the end of the day`. The rest are deleted from the prompt — the voice example carries that weight on Pro, and the critic catches it on Growth.

`pipeline.py:remove_hedging()` stays as the final safety net but its regex pattern shrinks correspondingly.

---

## Files changed

### New files
- `backend/app/services/drafting/evidence.py` — EvidencePack assembly, Serper integration, brand-page selection, BrandSource integration, cache read/write
- `backend/app/services/drafting/critic.py` — critic call + weighted scoring + targeted rewrite
- `backend/app/services/drafting/voice.py` — voice sample selection + cross-reference lookup
- `backend/app/services/drafting/citations.py` — per-platform citation rendering

### Modified
- `backend/app/services/drafting/prompts.py` — accepts EvidencePack + voice sample + related drafts; rewritten INFORMATION HIERARCHY block; shrunk banned-word list
- `backend/app/services/drafting/pipeline.py` — citation rendering hook called before the final polish; shrunk `_HEDGING_RE` regex
- `backend/app/services/drafting_service.py` — orchestrates the new flow with tier gating
- `backend/app/services/site_audit/crawler.py` — captures `content_excerpt` during the crawl
- `backend/app/models.py` — new models: `BrandSource`, `ContentDraftCitation`, `EvidenceCache`; new columns: `BrandProfile.voice_samples`, `WebsiteAuditPage.content_excerpt`, `ContentDraft.quality_score`, `ContentDraft.summary`
- `backend/app/database.py:run_migrations()` — new ALTER TABLE / CREATE TABLE steps appended at the bottom
- `backend/app/routers/brand_profile.py` — endpoints for sources (POST/GET/DELETE) and voice samples (POST/GET/DELETE)
- `backend/app/schemas.py` — Pydantic schemas for source/voice-sample CRUD

### Frontend
- `frontend/app/settings/` — Brand Profile tab gets a new Sources section and Voice Samples section (per `CLAUDE.md`, the brand profile UI is consolidated into `/settings`; `/tracker/[brandId]/profile` redirects there)
- `frontend/lib/api.ts` — typed methods: `addBrandSource`, `listBrandSources`, `deleteBrandSource`, `addVoiceSample`, `listVoiceSamples`, `deleteVoiceSample`
- UI intentionally minimal: textarea + add button + list-with-delete. No fancy editor.

### Deferred to v1.1
- Quality score badge in the drafts UI
- Source curation UI (categorize, edit, reorder)
- Per-source analytics ("which sources are cited most")

---

## Database migrations (appended to `run_migrations()`)

1. `ALTER TABLE website_audit_pages ADD COLUMN content_excerpt TEXT`
2. `ALTER TABLE brand_profiles ADD COLUMN voice_samples JSON`
3. `ALTER TABLE content_drafts ADD COLUMN quality_score REAL`
4. `ALTER TABLE content_drafts ADD COLUMN summary TEXT`
5. `CREATE TABLE brand_sources (...)`
6. `CREATE TABLE content_draft_citations (...)`
7. `CREATE TABLE evidence_cache (...)`

All seven steps follow the existing migration pattern in `database.py`: wrapped in try/except so re-runs are idempotent.

---

## Testing

New tests in `backend/tests/`:
- `test_evidence.py` — EvidencePack assembly, ranking, cache hit/miss, source cap enforcement
- `test_critic.py` — score parsing from tool-use response, weighted rollup cross-check, rewrite splicing by paragraph index, hard-fail retry path
- `test_voice.py` — voice sample selection precedence (user samples > approved drafts > none), cross-reference lookup
- `test_citations.py` — per-platform rendering, unmatched citation drop, ContentDraftCitation row creation
- `test_drafting_pipeline_integration.py` — end-to-end test per tier (Free, Starter, Growth, Pro) verifying which layers ran

All tests follow the existing `conftest.py` fixtures and isolated SQLite pattern. LLM calls are mocked via the existing test patterns.

---

## Observability

- Sentry breadcrumbs for: EvidencePack assembly (source counts per kind), critic score, rewrite trigger, hard-fail retry
- Log `quality_score` on every draft completion at INFO level
- Track new analytics events: `draft.evidence_pack_built`, `draft.critic_score`, `draft.rewrite_triggered`, `draft.hard_fail_retry`

---

## Open questions resolved during brainstorming

- **Full rebuild vs incremental:** full three-layer rebuild approved.
- **`WebsiteAuditPage.content_excerpt` migration:** approved (~1.5KB per row × ~200 pages = ~300KB per audit is acceptable).
- **`BrandSource` UI scope for v1:** minimal textarea + add button + delete. Full curation deferred.
- **Voice samples UI scope for v1:** same — minimal textarea + add button + delete.
- **Citation rendering per platform:** as specified in the table above. Wikipedia replaces the existing single-citation logic; X variants drop markers.
- **Tier gating:** Free/pitch keep existing minimal flow. Starter gets Evidence Pack only. Growth adds critic. Pro adds voice + cross-ref.
- **Cost / latency on Growth+:** ~2.5× tokens, ~25–35s wall time per draft. Acceptable for async draft generation.
