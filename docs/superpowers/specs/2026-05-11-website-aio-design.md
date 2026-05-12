# Website AIO — Design Spec

**Date:** 2026-05-11
**Status:** Draft (awaiting Ken's review)
**Goal:** Build a Website AI-Optimization module that audits a brand's site for AI search visibility, links findings to the prompts the brand loses on, and generates fixes. The differentiated wedge is page↔prompt linking — competitors do site audits, but nobody connects audit findings to "which queries this fix will move."

---

## 1. Problem Statement

Brands tracked by Lumidian get a visibility score and a list of underperforming prompts but no answer to *"why am I invisible, and what specifically do I fix on my site?"* The AI-search audit market has plenty of generic checkers (Otterly, Wellows, llmclicks); none of them know which prompts the brand actually loses on. Lumidian already stores three years' worth of `QueryResult.response_text` — the citations inside those responses are the missing link between "this competitor page is winning" and "this is what to fix on yours."

The Website AIO module:
1. Audits the brand's site for the structural and technical traits that actually correlate with AI citation (per Aggarwal 2024 + Vercel crawler study).
2. Extracts citation sources from already-stored AI responses and classifies them as own / competitor / third-party.
3. Links audit findings to the specific prompts the brand loses, producing recommendations of the form *"fix /pricing → expect lift on prompts X, Y, Z."*
4. Generates spec-compliant `llms.txt` and a `robots.txt` AI-bot snippet.

Research grounding lives in the chat thread from 2026-05-11 (Aggarwal KDD 2024, Vercel billion-fetch study, KIME content patterns, NAV43 7-pillar framework, Search Engine Land "no-hype" schema piece).

---

## 2. What We're Building

Five capabilities, shipped together as the v1 module:

1. **Site crawler** — sitemap-first discovery, BFS fallback, polite fetch, render-mode detection via Playwright.
2. **Per-page structural audit** — semantic HTML, headings, answer-first, tables, fact density, JSON-LD schema, byline, update date, alt text, internal linking, title/meta description shape.
3. **Site-wide accessibility audit** — robots.txt status per AI bot (8 user-agents), llms.txt presence, sitemap freshness, HTTPS/cert validity, render mode, Organization schema on homepage.
4. **Citation source extraction + page↔prompt linking** — extracts URLs from `QueryResult.response_text`, classifies them, then matches own-domain pages to losing prompts.
5. **Recommendations engine + generators** — rule-based recommendations per finding, optional LLM rewrites of underperforming sections (Pro/Growth), one-click `llms.txt` and `robots.txt` snippet generation.

Manual trigger only — no scheduled job. Audits are user-initiated through the UI or API.

---

## 3. Database Schema Additions

All migrations appended to `database.py:run_migrations()`. No Alembic; never modify existing migration steps.

### 3a. `WebsiteAudit` Table

One row per audit run.

```
WebsiteAudit
  id                   INTEGER PRIMARY KEY
  brand_id             INTEGER FK → Brand (indexed)
  status               TEXT          -- 'pending' | 'crawling' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
  triggered_by         TEXT          -- 'user' | 'agency_staff' | 'backfill'
  started_at           DATETIME
  completed_at         DATETIME      (nullable)
  total_pages          INTEGER       (default 0)
  pages_failed         INTEGER       (default 0)
  overall_score        FLOAT         (nullable; 0–100)
  bot_access_score     FLOAT         (nullable)
  content_score        FLOAT         (nullable)
  schema_score         FLOAT         (nullable)
  technical_score      FLOAT         (nullable)
  render_mode          TEXT          -- 'ssr' | 'csr' | 'ssg' | 'mixed' | 'unknown'
  sitemap_url          TEXT          (nullable)
  robots_txt_raw       TEXT          (nullable; truncated to 8 KB)
  llms_txt_present     BOOLEAN       (default 0)
  llms_txt_valid       BOOLEAN       (default 0)
  error_message        TEXT          (nullable)
  created_at           DATETIME
```

**Index:** `idx_website_audit_brand_started` on `(brand_id, started_at DESC)` — primary query is "latest audit for brand."

### 3b. `WebsiteAuditPage` Table

One row per page crawled.

```
WebsiteAuditPage
  id                   INTEGER PRIMARY KEY
  audit_id             INTEGER FK → WebsiteAudit (indexed)
  url                  TEXT          (indexed; stored normalised — lowercase host, no fragment, no trailing slash on non-root paths)
  depth                INTEGER
  http_status          INTEGER       (nullable; null = fetch error)
  fetch_ms             INTEGER       (nullable)
  page_type            TEXT          -- 'homepage' | 'article' | 'product' | 'pricing' | 'about' | 'docs' | 'other'
  word_count           INTEGER       (default 0)
  title                TEXT          (nullable)
  meta_description     TEXT          (nullable)
  h1_text              TEXT          (nullable)
  h2_count             INTEGER       (default 0)
  h3_count             INTEGER       (default 0)
  table_count          INTEGER       (default 0)
  list_count           INTEGER       (default 0)
  fact_density         FLOAT         (default 0)   -- numbers+dates+named entities per 1k words
  outbound_links       INTEGER       (default 0)
  internal_links       INTEGER       (default 0)
  image_count          INTEGER       (default 0)
  image_alt_pct        FLOAT         (default 0)   -- 0–100
  has_jsonld           BOOLEAN       (default 0)
  schema_types         TEXT          (nullable; JSON array)
  is_js_rendered       BOOLEAN       (default 0)   -- raw vs rendered diff > threshold
  page_score           FLOAT         (nullable; 0–100)
  content_score        FLOAT         (nullable)
  structure_score      FLOAT         (nullable)
  schema_score         FLOAT         (nullable)
  raw_html_size        INTEGER       (nullable)
  rendered_html_size   INTEGER       (nullable)
  fetch_error          TEXT          (nullable)
```

**Indexes:**
- `idx_audit_page_audit` on `(audit_id)` — list pages for an audit
- `idx_audit_page_url` on `(url)` — used by citation matcher to find own-domain pages

### 3c. `WebsiteAuditFinding` Table

One row per finding (site-level or page-level).

```
WebsiteAuditFinding
  id           INTEGER PRIMARY KEY
  audit_id     INTEGER FK → WebsiteAudit (indexed)
  page_id      INTEGER FK → WebsiteAuditPage (nullable; null = site-level)
  check_id     TEXT          -- stable identifier; see Check ID catalogue below
  severity     TEXT          -- 'critical' | 'high' | 'medium' | 'low' | 'info'
  category     TEXT          -- 'bot_access' | 'content' | 'schema' | 'technical' | 'authority'
  message      TEXT          -- human-readable summary
  evidence     TEXT          -- JSON: what was found vs expected
  created_at   DATETIME
```

**Index:** `idx_finding_audit_severity` on `(audit_id, severity)` — surfaces critical findings first.

### 3d. `WebsiteAuditRecommendation` Table

One row per recommendation. Recommendations are derived from findings + page↔prompt matching.

```
WebsiteAuditRecommendation
  id                  INTEGER PRIMARY KEY
  audit_id            INTEGER FK → WebsiteAudit (indexed)
  page_id             INTEGER FK → WebsiteAuditPage (nullable; null = site-level)
  priority            TEXT          -- 'high' | 'medium' | 'low'
  effort              TEXT          -- 'low' | 'medium' | 'high'
  category            TEXT          -- mirrors WebsiteAuditFinding.category
  title               TEXT
  body                TEXT          -- markdown
  linked_prompt_ids   TEXT          -- JSON array of prompt IDs this rec would help
  expected_impact     TEXT          (nullable; human description)
  llm_generated       BOOLEAN       (default 0)
  created_at          DATETIME
```

### 3e. `CitationSource` Table

One row per URL cited in a stored AI response. Populated by the citation extractor (post-tracking-run + one-shot backfill).

```
CitationSource
  id                INTEGER PRIMARY KEY
  brand_id          INTEGER FK → Brand (indexed)
  tracking_run_id   INTEGER FK → TrackingRun (indexed)
  prompt_id         INTEGER FK → Prompt (indexed)
  query_result_id   INTEGER FK → QueryResult
  model             TEXT          -- 'chatgpt' | 'claude' | 'perplexity' | 'gemini'
  url               TEXT          (indexed)
  domain            TEXT          (indexed)
  kind              TEXT          -- 'own' | 'competitor' | 'third_party' | 'unknown'
  competitor_id     INTEGER FK → Competitor (nullable)
  extracted_at      DATETIME
  
  UNIQUE(query_result_id, url)
```

**Indexes:**
- `idx_citation_brand_domain` on `(brand_id, domain)` — "what domains are cited for me?"
- `idx_citation_brand_prompt` on `(brand_id, prompt_id)` — drives page↔prompt linking

---

## 4. Backend Layout

```
backend/app/services/site_audit/
  __init__.py
  crawler.py             # sitemap discovery, BFS, polite fetch, deduping, per-page budget
  fetcher.py             # httpx raw HTML + Playwright rendered HTML; SSR/CSR diff
  page_classifier.py     # url + content → page_type (homepage/article/pricing/about/...)
  parsers/
    __init__.py
    semantic.py          # h-tags, lists, tables, answer-first, fact density, links
    schema.py            # JSON-LD extraction + per-type shape validation
    robots.py            # robots.txt parser → status per AI bot
    llms_txt.py          # llms.txt fetch + spec validation
    meta.py              # title, description, image alts, author, dates
  auditor.py             # orchestrates per-page + site-wide checks → findings + scores
  citations.py           # URL extraction from QueryResult.response_text; classification
  page_prompt_link.py    # match own-domain pages to losing prompts
  recommendations.py     # rule-based recs (mandatory) + LLM rewrites (gated)
  generators.py          # llms.txt + robots.txt snippet builders
  scoring.py             # per-page + per-category + overall score formulas
  constants.py           # AI bot UA list, fact-density thresholds, check IDs, etc.

backend/app/routers/site_audit.py
backend/scripts/backfill_citations.py
```

Tests:
```
backend/tests/
  test_site_audit_crawler.py
  test_site_audit_parsers_semantic.py
  test_site_audit_parsers_schema.py
  test_site_audit_parsers_robots.py
  test_site_audit_parsers_llms_txt.py
  test_site_audit_parsers_meta.py
  test_site_audit_citations.py
  test_site_audit_page_prompt_link.py
  test_site_audit_recommendations.py
  test_site_audit_generators.py
  test_site_audit_scoring.py
  test_site_audit_endpoints.py
  fixtures/site_audit/
    well_structured_article.html
    spa_shell.html
    blocked_robots.txt
    valid_llms.txt
    malformed_jsonld.html
    competitor_response.json   # sample QueryResult response_text shapes
    ...
```

---

## 5. Crawler Design

### 5a. Discovery order

1. Fetch `{root}/sitemap.xml`. If present, enqueue all `<loc>` URLs. Recursively follow sitemap-index files one level.
2. Fetch `{root}/sitemap_index.xml` as fallback. Same rules.
3. If neither found, BFS from homepage at depth ≤ 3, following only same-host links.

### 5b. Caps

- **Per-tier `max_pages`** caps the queue size (see §10).
- **Per-page hard timeout:** 10s fetch.
- **Per-audit hard budget:** 5 minutes wall-clock from "crawling" to "analyzing." Pages still in-flight when the budget expires are abandoned and counted as `pages_failed`.

### 5c. Politeness

- `User-Agent: LumidianAuditBot/1.0 (+https://lumidian.ai/bot)`
- Per-host rate limit: 1 req/sec (token bucket).
- Per-audit concurrency: `Semaphore(4)`.
- Global concurrency: `MAX_CONCURRENT_AUDITS=3`.
- Respect `robots.txt`. If the site disallows our UA on the targeted paths, the audit fails fast with a clear site-level finding `audit_blocked_by_robots` and stores no page rows. Otherwise honour per-path rules.

### 5d. Render-mode detection (Playwright)

For each page, fetch:
1. **Raw HTML** via `httpx` with the audit User-Agent.
2. **Rendered HTML** via Playwright Chromium, `wait_until="networkidle"`, 8s timeout.

"Critical content" for the comparison = the visible text inside `<body>` after stripping `<script>`, `<style>`, and `<template>` tags and collapsing whitespace.

Diff rule:
- If `rendered_text_length > raw_text_length * 1.5` AND `raw_text_length < 500 chars` → page is `is_js_rendered=True` (CSR).
- Else if `rendered_text_length ≈ raw_text_length` (within 15% of each other) → SSR/SSG.
- Else if raw HTML contains a `<noscript>...enable JavaScript...</noscript>` marker → CSR regardless.
- Otherwise → `unknown` for that page.

Site-level `render_mode` is the majority verdict across the 5 sampled pages (homepage + 4 deterministically-sampled interior pages — Playwright is expensive so we cap at 5 rendered fetches per audit). Sample selection: page indexes `[0, n/4, n/2, 3n/4, n-1]` from the sorted-by-discovery-order queue, deduped by page_type so we don't sample five article pages.

### 5e. Page classification

`page_classifier.py` assigns a `page_type` from URL patterns + content signals. Rules are evaluated in the order below; first match wins.

| Order | Type | Rule |
|---|---|---|
| 1 | `homepage` | URL path is `/` or empty (after normalising trailing slash) |
| 2 | `pricing` | URL path contains `/pricing` (any segment) or `<title>` contains "pricing" (case-insensitive) |
| 3 | `about` | URL path contains `/about`, `/team`, or `/company` |
| 4 | `docs` | URL path contains `/docs`, `/documentation`, `/api`, `/help`, `/support`, or `/guides` |
| 5 | `article` | URL path contains `/blog`, `/articles`, `/posts`, `/news`, or `/insights`, OR the DOM contains a single dominant `<article>` element |
| 6 | `product` | URL path contains `/product`, `/products`, `/features`, `/solutions`, or `/use-cases` |
| 7 | `other` | fallback |

Ordering choice: `pricing` and `about` are checked before `product`/`article` because they're more diagnostic and less common.

---

## 6. Parsers

Each parser is a pure function: `(html_str, url) → list[Finding]` plus any extracted measurements (used by scoring).

### 6a. `parsers/semantic.py`

Uses BeautifulSoup (lxml backend).

| Check ID | Fires when | Severity |
|---|---|---|
| `missing_h1` | No `<h1>` tag | high |
| `multiple_h1` | More than one `<h1>` | medium |
| `heading_hierarchy_skip` | `<h3>` appears before any `<h2>`, or other skip levels | low |
| `no_h2` | Page has no `<h2>` (typical for SPA shells) | medium |
| `divs_styled_as_headings` | Heuristic: `<div>` with very large font-size class or role="heading" | low |
| `fake_lists` | Paragraphs starting with `•` or `-` patterns instead of `<ul>` | low |
| `fake_tables` | Grids of `<div>` with `display: grid` containing tabular data | low |
| `answer_first_failed` | First 75 words of an H2 section don't contain an "X is Y" / definitional pattern OR contain too many pronouns without antecedents | medium |
| `fact_density_low` | Numbers + dates + named entities per 1k words < 5 | medium |
| `no_outbound_citations` | Page has zero external links | low |
| `pronoun_overuse` | More than 8 sentence-leading pronouns ("It", "They", "This") per 1k words | low |

Extracted measurements: `word_count`, `h1_text`, `h2_count`, `h3_count`, `table_count`, `list_count`, `fact_density`, `outbound_links`, `internal_links`.

### 6b. `parsers/schema.py`

| Check ID | Fires when | Severity |
|---|---|---|
| `no_jsonld` | No `<script type="application/ld+json">` blocks | medium |
| `malformed_jsonld` | JSON parse fails | high |
| `missing_organization_schema` | Homepage lacks `Organization` schema | high |
| `incomplete_organization_schema` | `Organization` schema missing one of `name`, `url`, `logo`, `sameAs` | medium |
| `article_missing_author` | `Article`/`BlogPosting` schema without `author` (or author isn't a linked `Person`) | medium |
| `article_missing_dates` | Article schema without `datePublished` or `dateModified` | medium |
| `product_missing_required` | `Product` schema missing `name`, `description`, or `offers` | medium |
| `faqpage_no_questions` | `FAQPage` schema declared but no `mainEntity` Q&A entries | high |
| `schema_content_mismatch` | Title in schema doesn't match `<title>` (sanity check) | low |

Extracted: `has_jsonld`, `schema_types` (JSON array of `@type` values present).

### 6c. `parsers/robots.py`

Fetches `{root}/robots.txt`, parses using Python stdlib `urllib.robotparser` augmented with per-UA path checks for these eight bots:

```python
AI_BOTS = [
    "GPTBot",              # OpenAI training
    "OAI-SearchBot",       # ChatGPT live search
    "ChatGPT-User",        # legacy/manual user fetches
    "ClaudeBot",           # Anthropic training + Claude
    "anthropic-ai",        # legacy Anthropic
    "PerplexityBot",       # Perplexity
    "Google-Extended",     # Gemini + AI Overviews
    "Meta-ExternalAgent",  # Meta AI
    "Applebot-Extended",   # Apple Intelligence
    "Amazonbot",           # Alexa/Amazon AI
]
```

For each bot, status is one of `allowed_all`, `allowed_partial`, `disallowed_all`, `unspecified`.

| Check ID | Fires when | Severity |
|---|---|---|
| `blocked_gptbot` | GPTBot status is `disallowed_all` | high |
| `blocked_oai_searchbot` | OAI-SearchBot disallowed (this is the live-search bot — blocking it kills ChatGPT visibility) | **critical** |
| `blocked_claudebot` | ClaudeBot disallowed | high |
| `blocked_perplexitybot` | PerplexityBot disallowed | high |
| `blocked_google_extended` | Google-Extended disallowed (kills Gemini + AI Overviews) | high |
| `no_robots_txt` | No robots.txt found (allowed by default but flag the missing-file) | low |
| `unspecified_ai_bots` | No directives for any of the 10 known AI UAs (default-allow but recommend explicit allow) | info |

Stored on the audit: `robots_txt_raw` (truncated to 8 KB) and the full bot-status map as evidence inside findings.

### 6d. `parsers/llms_txt.py`

Fetches `{root}/llms.txt`.

| Check ID | Fires when | Severity |
|---|---|---|
| `llms_txt_missing` | Returns 404 | low |
| `llms_txt_malformed` | Found but not valid markdown / missing the H1 site name | low |
| `llms_txt_present_valid` | Found and well-formed | info (positive) |

Stored: `llms_txt_present`, `llms_txt_valid`.

### 6e. `parsers/meta.py`

| Check ID | Fires when | Severity |
|---|---|---|
| `missing_title` | No `<title>` or empty | high |
| `title_too_long` | `<title>` > 70 chars | low |
| `title_too_short` | `<title>` < 20 chars on a content page | low |
| `missing_meta_description` | No `<meta name="description">` | medium |
| `meta_description_length` | Description > 160 or < 70 chars | low |
| `missing_byline` | Article-type page with no visible author name + no `Person` schema | medium |
| `missing_update_date` | Article-type page with no visible date + no `dateModified` schema | medium |
| `stale_content` | `dateModified` > 18 months ago | medium |
| `low_alt_text_coverage` | < 70% of `<img>` tags have descriptive `alt` (> 5 chars, not "image") | low |

Extracted: `title`, `meta_description`, `image_count`, `image_alt_pct`.

---

## 7. Citation Source Extraction

`citations.py` processes one `QueryResult` row at a time.

### 7a. URL extraction

Two regexes, run in order:
1. **Markdown links** — `\[([^\]]+)\]\((https?://[^)\s]+)\)`
2. **Bare URLs** — `(?<![\[\(])https?://[^\s\]\)]+`

Both are post-filtered:
- Strip trailing punctuation `.,;:!?`
- Drop fragment-only URLs
- Normalise (lowercase host, strip default ports)
- Drop URLs already extracted from this query result

### 7b. Classification

For each URL:
1. Parse domain via `tldextract` → `{subdomain}.{domain}.{suffix}`. Use the registered domain (`domain.suffix`) for matching.
2. If registered domain matches the brand's `Brand.website_url` registered domain → `own`.
3. Else if registered domain matches any `Competitor.website_url` for this brand → `competitor` (record `competitor_id`).
4. Else if registered domain is in `THIRD_PARTY_AUTHORITY_DOMAINS` (small allowlist: `wikipedia.org`, `g2.com`, `capterra.com`, `trustradius.com`, `reddit.com`, `linkedin.com`, `youtube.com`, `github.com`, `medium.com`, `stackoverflow.com`, `quora.com`, `producthunt.com`, `crunchbase.com`) → `third_party`.
5. Otherwise → `unknown`.

`Brand.website_url` and `Competitor.website_url` are normalised at lookup time (lowercase, strip protocol/path/trailing slash, run through `tldextract`) — we don't migrate stored values.

### 7c. When extraction runs

- **Live**: post-tracking-run hook in `tracking_service.py`, same non-fatal section that already calls `gap_analysis_service`. Runs after the gap analysis call.
- **Backfill**: one-shot script `backend/scripts/backfill_citations.py` iterates all completed `TrackingRun` rows, extracts and inserts. Idempotent via the `UNIQUE(query_result_id, url)` constraint.

---

## 8. Page ↔ Prompt Linking

`page_prompt_link.py` runs at the end of the audit's `analyzing` phase.

For each prompt where the brand has < 50% visibility (the existing `GAP_THRESHOLD` from `gap_analysis_service.py`):

1. Collect `CitationSource` rows where `prompt_id` matches and `kind ∈ {'competitor', 'third_party'}`. These are the URLs the AI cited instead of you.
2. For each cited competitor/third-party URL, find the best-matching own-domain page from this audit's `WebsiteAuditPage` rows using:
   - URL slug token overlap (Jaccard, normalised slugs)
   - Page title token overlap with the prompt text
   - Page type match (e.g., competitor `/pricing-guide` ↔ own `/pricing`)
   - Combined score = `0.5 * slug_overlap + 0.3 * title_overlap + 0.2 * (page_type matches)`
3. If max score ≥ 0.3, link the prompt to that page. Otherwise pick the top 3 candidate pages by title overlap with the prompt text as fallback.

Output: a map `{audit_page_id: [prompt_id, ...]}` consumed by `recommendations.py`.

---

## 9. Recommendations Engine

`recommendations.py` runs after findings + page↔prompt linking.

### 9a. Rule-based recommendations (always)

Each `check_id` maps to 0 or 1 canonical `WebsiteAuditRecommendation` via a static template registry. Examples:

| Finding | Recommendation title | Body shape |
|---|---|---|
| `blocked_oai_searchbot` | Unblock ChatGPT live search | "Your robots.txt blocks OAI-SearchBot. ChatGPT can't fetch your pages when users ask about your brand. Add: `User-agent: OAI-SearchBot / Allow: /` ..." |
| `is_js_rendered=True` on a critical page | Render this page server-side | "GPTBot fetched this page but couldn't see your content — it's only present after JavaScript runs. Switch to SSR/SSG. Vercel's billion-fetch study found zero JS execution by any AI crawler." |
| `fact_density_low` on a high-traffic page | Add specific facts and numbers | "Statistics Addition was the second-highest-impact technique in the Aggarwal 2024 GEO paper (+33% citations). Add 3–5 specific stats with year + source." |
| `answer_first_failed` | Lead each section with a self-contained answer | + LLM rewrite if tier allows |
| `missing_organization_schema` | Add Organization schema to homepage | (includes a templated JSON-LD block) |
| `llms_txt_missing` | Add an llms.txt file | "Use the generator below. Adoption is low but cost-free and signals to early-adopter agents." |

Each recommendation inherits `linked_prompt_ids` from page↔prompt linking when the related finding is on a linked page.

Priority is derived: critical → `high`; high → `high`; medium → `medium`; low/info → `low`.

Effort defaults: bot/robots/llms.txt changes are `low`; schema/meta fixes are `low`; SSR migration is `high`; content rewrites are `medium`.

### 9b. LLM rewrites (Growth + Pro tiers)

For the top N pages by `(prompt link count × inverse page_score)`, send to Claude using `claude-haiku-4-5-20251001` (same model used elsewhere in the app — see `llm_service.py`):

Prompt inputs:
- Page excerpt (first 2 H2 sections, max 4 KB)
- The findings that fired on the page
- Brand profile (tone, audience, what_not_to_say)
- The prompts the page is linked to

Output: a specific rewrite of the first H2 section in answer-first form (lead with a 40–75-word self-contained answer, then supporting structure).

Per-tier cap:
- Growth: 5 pages per audit
- Pro: 15 pages per audit

Each call uses a 30s timeout; on failure the recommendation degrades to rule-based only and a warning is logged (the user sees no error). Stored with `llm_generated=1`. Total LLM spend per audit is bounded by `pages × 1 call × ~2k tokens`.

---

## 10. Tier Gating

| Tier (internal / display) | Audit access | Max pages / audit | Audits / month | Recommendations | LLM rewrites | Generators |
|---|---|---|---|---|---|---|
| `None` Free / pitch | **no** | — | — | — | — | — |
| `basic` Starter ($100) | yes | 50 | 4 | rule-based | — | ✓ |
| `starter` Growth ($300) | yes | 100 | 8 | rule-based | ✓ 5 pages | ✓ |
| `pro` Pro ($500) | yes | 250 | unlimited | rule-based | ✓ 15 pages | ✓ |

Configured in `services/site_audit/constants.py:TIER_AUDIT_LIMITS`. Free tier requesting an audit gets HTTP 403 with an upgrade prompt. Per-month count is enforced via `select count(*) from WebsiteAudit where brand_id = ? and started_at >= now() - interval 30 days`.

---

## 11. API Endpoints

Mounted at `/api/site-audit/`. All require `get_current_user`; ownership enforced by `brand.user_id == user.id` OR `is_agency_staff` (agency staff scoped via `AgencyClient → Brand`).

```
POST   /api/site-audit/{brand_id}/trigger
       → 202 { audit_id }
       → 403 if tier doesn't allow / monthly cap reached / no website_url on brand
       → 409 if an audit is already in progress for this brand

GET    /api/site-audit/{brand_id}/latest
       → 200 { audit, pages_summary, top_findings, top_recommendations } or 404

GET    /api/site-audit/{brand_id}/history?limit=10
       → 200 [{ audit_id, started_at, completed_at, overall_score, status }]

GET    /api/site-audit/audit/{audit_id}
       → 200 full audit detail (scores + site-level findings + recommendations summary)

GET    /api/site-audit/audit/{audit_id}/pages?page=1&per_page=50&sort=score
       → 200 paginated pages with per-page scores

GET    /api/site-audit/audit/{audit_id}/page/{page_id}
       → 200 single page detail with all findings + recs for that page

GET    /api/site-audit/audit/{audit_id}/findings?severity=critical
       → 200 [WebsiteAuditFinding]

GET    /api/site-audit/audit/{audit_id}/recommendations?priority=high
       → 200 [WebsiteAuditRecommendation] (with linked_prompt_ids resolved to prompt text)

GET    /api/site-audit/{brand_id}/citations?days=30
       → 200 { by_domain: [...], own_vs_competitor_pct, top_competitor_domains }

GET    /api/site-audit/{brand_id}/llms-txt
       → 200 text/plain (generated llms.txt)

GET    /api/site-audit/{brand_id}/robots-snippet?mode=allow_all|search_only
       → 200 text/plain (generated robots.txt AI-bot block)

POST   /api/site-audit/audit/{audit_id}/cancel
       → 204 (sets status='cancelled', triggers asyncio.Event)
```

Agency staff hit the same endpoints; the brand ownership check accepts agency-staff users when the brand belongs to one of their clients.

---

## 12. Frontend

### 12a. Navigation

Top-level nav order becomes: **Dashboard / Content / Site Audit / Reports / Settings**.
- New nav item lives in `frontend/components/Navigation.tsx` (or whatever the current nav component is).
- Hidden on Free tier (use existing tier-gating helper).
- For agency staff, equivalent link inside `/agency/clients/[id]/audit`.

### 12b. Routes

```
frontend/app/site-audit/[brandId]/page.tsx
frontend/app/site-audit/[brandId]/audit/[auditId]/page.tsx
frontend/app/site-audit/[brandId]/audit/[auditId]/pages/[pageId]/page.tsx
frontend/app/agency/clients/[id]/audit/page.tsx
```

### 12c. Components

```
frontend/components/site-audit/
  AuditTriggerButton.tsx        # gated by tier + monthly-cap state
  AuditOverviewCard.tsx          # 4-axis radar (bot/content/schema/technical)
  AuditScoreHeadline.tsx         # big number + trend vs last audit
  CriticalFindingsList.tsx       # critical/high severity only
  BotAccessPanel.tsx             # per-bot status grid + robots.txt preview
  LlmsTxtPanel.tsx               # presence + content + "regenerate" button
  GeneratorsCard.tsx             # llms.txt + robots-snippet download buttons
  PageList.tsx                   # sortable table; columns: URL, type, score, top finding
  PageDetail.tsx                 # full findings + recs for one page
  CitationDomainList.tsx         # bar chart of domains cited per brand
  PromptCitationDrilldown.tsx    # for a prompt, show cited URLs + classification
  PagePromptMap.tsx              # network graph: pages ↔ prompts
  RecommendationsList.tsx        # priority-grouped with linked-prompt badges
  RecommendationDetail.tsx       # rule-based body + optional LLM rewrite
```

### 12d. Tabs on the main page

1. **Overview** — radar, score history sparkline, top 5 critical findings, top 5 recommendations
2. **Pages** — sortable list with per-page scores
3. **AI Bots & Files** — bot access grid, robots.txt preview, llms.txt panel, generators
4. **Citations** — domain breakdown chart, own vs competitor pct, prompt drilldown
5. **Recommendations** — full prioritised list

### 12e. Empty / loading states

- No audit yet → big CTA "Run your first audit" with what-it-checks blurb
- Audit running → live progress (poll `latest` every 5s)
- Audit failed → error message + retry button
- Free tier → locked screen with upgrade CTA

### 12f. API client additions

In `frontend/lib/api.ts`:
```
triggerAudit(brandId)
getLatestAudit(brandId)
getAuditHistory(brandId, opts?)
getAudit(auditId)
getAuditPages(auditId, opts?)
getAuditPage(auditId, pageId)
getAuditFindings(auditId, opts?)
getAuditRecommendations(auditId, opts?)
getCitations(brandId, opts?)
getLlmsTxt(brandId)
getRobotsSnippet(brandId, mode)
cancelAudit(auditId)
```

---

## 13. Trigger & Lifecycle

1. User clicks **Run audit** in UI → `POST /api/site-audit/{brand_id}/trigger`.
2. Endpoint checks tier, monthly cap, brand `website_url`, no in-progress audit for the brand. Inserts `WebsiteAudit` with `status='pending'`.
3. Endpoint spawns an `asyncio.create_task(run_audit(audit_id))` (matching the `tracking_service` pattern).
4. `run_audit` flow:
   - status → `crawling`: discover URLs, fetch raw HTML, sample 5 pages for Playwright render-mode detection
   - status → `analyzing`: run parsers on each page, extract findings, score, page↔prompt link, build recommendations, optionally call LLM
   - status → `completed` with `overall_score` set
5. Cancellation: `POST /audit/{id}/cancel` sets `asyncio.Event`; loops in the crawler and auditor check this event and bail.
6. Failure: any unhandled exception sets `status='failed'` with `error_message`. Partial page rows are kept for debugging.

No APScheduler job — audits are user-initiated only.

---

## 14. Scoring

Each page gets four sub-scores (0–100):
- **Structure**: weighted sum of heading hygiene, semantic tags, lists/tables, internal linking
- **Content**: word count band + fact density + answer-first pass-rate + citation presence
- **Schema**: presence + completeness + validity of JSON-LD
- **Technical**: HTTP status, fetch speed, render mode, image alt coverage

Page score = `0.30 * Structure + 0.35 * Content + 0.15 * Schema + 0.20 * Technical`.

Audit sub-scores (0–100):
- **Bot access**: 100 minus penalties per blocked AI bot (OAI-SearchBot block = -40; GPTBot/ClaudeBot/Google-Extended each = -15; PerplexityBot/others = -5)
- **Content score**: average of page Content scores weighted by page importance (homepage=3, pricing/product=2, others=1)
- **Schema score**: average of page Schema scores, plus +20 bonus if homepage has full Organization schema, -10 if no schema anywhere
- **Technical**: HTTPS (+25), render mode SSR/SSG (+50), sitemap (+10), llms.txt (+5), majority of pages render-clean (+10)

Overall score = simple average of the four sub-scores.

All weights live in `scoring.py` with named constants and a test that exercises each.

---

## 15. Generators

### 15a. `build_llms_txt(brand) -> str`

Produces a spec-compliant `llms.txt`:

```
# {Brand Name}

> {one-sentence description from brand profile}

## About

{2–4 sentences from brand profile's company_description}

## Key resources

- [Homepage](https://example.com/) — what the brand is
- [Pricing](https://example.com/pricing) — what it costs
- [Docs](https://example.com/docs) — technical detail
- [Blog](https://example.com/blog) — most recent articles
...

## Optional

- [About us](...)
- [Team](...)
```

"Key resources" is populated by selecting the top-scoring pages from the latest audit; "Optional" gets the next tier. Falls back to a static skeleton if no audit exists.

### 15b. `build_robots_txt_snippet(brand, mode) -> str`

Two modes:

```
# mode='allow_all' — paste at top of robots.txt
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Meta-ExternalAgent
Allow: /
```

```
# mode='search_only' — block training, allow live search
User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Disallow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Disallow: /
```

Endpoint returns `text/plain` so the user can curl or copy directly.

---

## 16. Backfill

`backend/scripts/backfill_citations.py`:

- Iterates all `TrackingRun` rows with status='completed', ordered by `started_at`.
- For each run, loads its `QueryResult` rows.
- For each `QueryResult` with non-empty `response_text`, calls `citations.extract_and_classify(query_result, brand, competitors)`.
- Inserts `CitationSource` rows. The `UNIQUE(query_result_id, url)` constraint makes this idempotent — running twice produces no duplicates.
- Progress logging every 100 runs.
- Configurable `--brand-id` to scope to one brand, `--since YYYY-MM-DD` for incremental backfills.

Run once after deployment; safe to re-run.

---

## 17. Error Handling

| Failure mode | Handling |
|---|---|
| Per-page fetch timeout (10s) | Record `WebsiteAuditPage` with `http_status=NULL`, `fetch_error='timeout'`. Continue. |
| Per-page DNS / SSL error | Same — recorded as page with `fetch_error`. Continue. |
| Per-page non-2xx HTTP | Record status code, continue (4xx pages count toward `pages_failed`). |
| Playwright crash | Fall back to raw-HTML-only for that page. Site-level `render_mode='unknown'` if too many pages fail render. |
| Malformed JSON-LD | Emit `malformed_jsonld` finding; don't crash the parser. |
| Robots.txt forbids us entirely | Audit fails fast with `audit_blocked_by_robots`, status='failed'. |
| Per-audit budget exceeded | Mark in-flight pages as failed; proceed to analyzing with what we have. |
| LLM call fails | Skip the rewrite, no error to the user, log warning. |
| Backfill encounters bad response_text | Skip that QueryResult, log warning, continue. |

Never let one page's failure abort the whole audit.

---

## 18. Testing

### 18a. Unit tests (no network)

- Parser tests: each parser gets fixture HTML files exercising the happy path + every check it can emit. Assert the right `Finding`s are returned.
- Citation extractor tests: feed sample `QueryResult.response_text` strings (saved from real runs); assert extracted URLs + classifications.
- Page↔prompt linker: small synthetic graph of pages + prompts + citations; assert correct linking.
- Scoring tests: golden inputs → expected score; one test per scoring rule.
- Generator tests: snapshot tests for `llms.txt` and both robots modes.
- Recommendation engine: each finding → expected recommendation template, with `linked_prompt_ids` propagation tested.

### 18b. Integration tests

- A local `aiohttp` test server serves canned HTML files for a few synthetic "sites" (well-structured, SPA-only, blocked-robots, etc.). The crawler runs against `127.0.0.1:{port}`. Asserts audit status reaches `completed` with expected scores.
- Endpoint tests using existing `tests/conftest.py` fixtures: trigger audit on a brand, mock `run_audit` to return immediately, assert lifecycle endpoints.

### 18c. Playwright in CI

CI uses Playwright in headless Chromium. The integration test server hosts both an SSR page and a CSR page; assert correct render-mode detection. If CI installation of Playwright is too heavy for the existing test target, gate Playwright tests behind a `--playwright` pytest marker, on by default locally and on in a separate CI job.

---

## 19. Dependencies Added

Backend `requirements.txt` additions:
- `beautifulsoup4` — HTML parsing
- `lxml` — fast parser backend for BS4
- `playwright` — render-mode detection
- `tldextract` — domain extraction for citation classification

After install, `playwright install chromium` is run as part of the Docker build / `start.sh`. Adds ~150 MB to the backend image.

Frontend: no new dependencies (Recharts already present for the radar/sparkline).

---

## 20. Out of Scope (v1.1+)

Explicitly deferred to keep v1 sharp:
- Auto-fix any of the issues found (PR-style "apply this schema" automation against the user's CMS)
- WCAG / accessibility scoring beyond image alt text
- Backlink / referring-domain analysis
- Wikidata / Wikipedia entity check
- Multi-language audits
- Diff view between two audits
- Email digest of audit results
- Slack notifications

---

## 21. URL Normalisation

A single canonical normaliser is used everywhere URLs need to be compared — crawler dedup, citation matching, page↔prompt linking. Defined in `services/site_audit/constants.py`:

```python
def normalise_url(url: str) -> str:
    """Lowercase host; strip fragment; strip default port; strip trailing slash
    on non-root paths; sort query params; never decode percent-encoding."""
```

All URLs entering the audit DB pass through this. Both `Brand.website_url` and `Competitor.website_url` are normalised at lookup time (read-only), not migrated.

---

## 22. Decision Log

| Decision | Why |
|---|---|
| Playwright over heuristic for render-mode | Accuracy: GPTBot non-rendering is the single highest-leverage finding; we want to catch it without false negatives |
| Manual trigger only | Avoid cron-driven surprise costs; keeps the feature deterministic; user pushed for manual |
| Free tier excluded | User decision; aligns with the "Free is pitch brands only" pattern |
| Backfill citations | Three years of stored `QueryResult.response_text` is the asset that powers the wedge — must be exploited |
| Citation extraction lives in `tracking_service` post-hooks | Same place `gap_analysis_service` runs; mirrors the existing non-fatal-post-processing pattern |
| Rule-based recs first, LLM second | Rule-based covers 90% of findings deterministically and is auditable; LLM is gated to Pro tiers for cost |
| Two robots-snippet modes | Pro users may want "allow live search, block training" — that's a real choice and we should support it |
