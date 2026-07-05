# Cluster Detail Overhaul — Design Spec

**Date:** 2026-07-04
**Branch:** `feat/cluster-detail-overhaul`
**Status:** Approved direction (Ken: "lets do everything and do it very well"), spec pending final review.

## Problem

Deep examination of the cluster detail page (`/content/[brandId]/cluster/[clusterId]`) surfaced seven issues: internal jargon leaking into the UI (T1/T2/T3, "narrative spine", "canonical phrasings"), an "Inputs" zone that implies causality that doesn't exist, always-on Reddit affiliation disclosures, a Reddit citation footer that works against the platform, Reddit pieces not routed to real threads (Quora already is), owned-site — our own research's #1 AIO channel — absent from clusters, and no way to control the content's angle/persona before generating.

Supplemental research (4 briefs, July 2026) is folded in throughout; key findings that changed the design are marked **[R]**.

### Research deltas that shaped this spec

1. **[R] Citations are not a visibility lever.** The Princeton GEO "+40% from citing sources" finding failed replication (C-SEO Bench, NeurIPS 2025: −0.15 to 0.03 rank change; statistics-addition sometimes negative). The evidence pack's justification is *accuracy and quotability*, not citation-count. Citation rendering should favor claim-adjacent prose attribution ("a 2025 Semrush study found…") over footer-only, so a claim and its source survive passage chunking together.
2. **[R] Reddit: zero outbound links by default.** Link footers are the classic content-marketer fingerprint; AutoMod configs commonly filter by link count/domain. Name sources in prose. The current `append_pillar_reference` Medium link on Reddit posts is a liability — remove it. Aged (~1 year) open evergreen question threads are the actual AI retrieval surface; thread replies pay off immediately vs months for new posts. Archiving is a per-subreddit toggle now, not a 6-month rule.
3. **[R] Disclosure is legally required on endorsement, not on brand mention.** FTC 2023 Guides + Consumer Review Rule (16 CFR 465, first warning letters Dec 2025): an employee posting *promotional* content must disclose in the post itself (bio insufficient). Neutral factual mention ≠ endorsement. Casual inline phrasing ("full disclosure — I work at X") is both the community norm and legally sufficient; legalistic boilerplate backfires. Fake-customer voice from staff is a rule violation — hard-ban it. Quora's per-answer credential line is a sanctioned disclosure vehicle. X (Feb 2026) requires labels on own-brand commercial posts.
4. **[R] Authenticity beats advocacy.** Cited Reddit threads run ~5% positive vs ~6% negative sentiment; acknowledging a competitor's strength or a real tradeoff improves citation odds. Question-phrased titles dominate the cited format.

---

## Workstream 1 — Clarity & correctness pass

### 1a. Source tiers in plain language

`SourceSpinePanel` + `CitationsSubpanel` render tier chips with human labels (tier keys unchanged in DB/API):

| Key | Label | Chip color (unchanged) |
|-----|-------|------------------------|
| T1 | Major press & research | emerald |
| T2 | Industry press | sky |
| T3 | Other web | slate |
| brand | Your site & profile | amber (new) |

- Panel header explainer (one line under "Sources"): *"Facts in these posts are grounded in these sources. Stronger sources keep claims accurate and quotable."*
- Tier-count strip becomes labeled ("Major press & research 4 · Industry press 3 · Other web 3") — drop the bare T1/T2/T3.
- **Real usage counts:** `times_cited` is dead (written 0, never incremented, yet sorted by). `GET /clusters/{brand}/{cluster}/sources` computes per-source cited-count at read time by joining `ContentDraftCitation.url` (normalized) over the cluster's drafts, and returns it in the existing `times_cited` field (schema unchanged). Panel shows "Cited in N posts" on sources with N>0 and sorts cited-first, then tier.

### 1b. Brief panel plain language

Display-only renames in `BriefPanel` (API field names unchanged):

| Field | New label |
|-------|-----------|
| positioning | The angle |
| canonical_phrasings | Core messages *(each post rewords these — never verbatim)* |
| key_claims | Claims we make |
| stats | Stats |
| narrative_spine | Story arc |
| tone_notes | Tone |

Framing sentence under the "Brief" title when expanded: *"The shared strategy behind every post in this cluster. Edit it and regenerate to change all posts at once."*

### 1c. Dissolve the Inputs zone

- **Gap analysis → "Why this matters" strip.** A compact line in the header area (under the status row), built from the prompt's `ContentGap`: `You appear in {visibility}% of AI answers here · {top competitor(s)} are winning this question`. Omitted when no gap data. `GapInput.tsx` deleted.
- **Opportunities → Reddit piece routing** (Workstream 2). `OpportunitiesInput.tsx` deleted.
- **Pillar → owned-site anchor card** (Workstream 3). `PillarCard.tsx` folded in.
- `InputsZone.tsx` deleted.

### 1d. Right-sized disclosures (in `drafting/platforms.py` + `prompts.py`)

Global (core WRITING RULES in `prompts.py`):
- **Hard ban on fake-customer voice**: never write as a satisfied customer/user of the brand ("I've been using X and love it") — staff posting that is an FTC Consumer Review Rule violation. Applies at every angle.

Reddit spec rules replace the blanket disclose-if-mentioned rule with:
- *If the post recommends, praises, or favorably compares the brand → disclose casually at first brand mention ("full disclosure — I work at X, so grain of salt"). Inline, first-person, never a formal block.*
- *If the brand appears only as a neutral factual reference among alternatives → no disclosure line.*
- New authenticity rule: *acknowledge one genuine tradeoff, limitation, or a competitor's strength — pure advocacy reads as marketing and gets removed; real evaluation is what AI engines cite.* **[R]**
- Title guidance: standalone posts use a specific question-phrased title. **[R]**
- `disclaimer` (UI string): "If your post endorses your brand, disclose your affiliation casually in the post itself (FTC + Reddit norms). Neutral factual mentions don't need it."
- `posting_tip` gains the account-readiness warning: *"Post from an account that's 30+ days old with ~100+ comment karma — newer accounts get auto-filtered regardless of content."* **[R]**

Quora spec:
- Rule: *Never put affiliation disclosures in the answer body unless the answer recommends the product; affiliation belongs in the answer credential.*
- `posting_tip`: *"Set your answer credential to your role (e.g. 'Founder at X') — that's Quora's sanctioned disclosure. Add one inline disclosure line only if the answer recommends your product."*

X specs (`x_post`, `x_thread`): `posting_tip` notes X's paid-partnership/own-brand labeling policy (Feb 2026) for promotional posts from founder/staff accounts.

### 1e. Reddit citation rendering **[R]**

- `citations.py`: `reddit` + `reddit_reply` move to the strip set — `[SN]` markers removed, **no** trailing "More on this:" footer. Citations are still recorded (`RenderedCitation` list → `ContentDraftCitation`) for the UI subpanel.
- Reddit spec rule added so stripped markers leave attribution intact: *when citing a stat, attribute in prose ("a 2025 Semrush study of 150k citations found…") — never a bare link, never a link list.*
- Footer platforms (medium / linkedin_article / quora) keep footers but gain a claim-adjacent attribution rule: *name the source in the same sentence as the stat; the footer is supplementary.*
- `append_pillar_reference`: Reddit variants dropped entirely (no own-content links on Reddit). LinkedIn/Quora/X keep current behavior.

---

## Workstream 2 — Reddit thread routing

Route the cluster's Reddit piece to a **real, open, relevant thread** when one exists; fall back to today's standalone-post-in-validated-subreddit.

### Backend

- `_resolve_post_targets` Reddit branch v2:
  1. Query `ContentOpportunity` for `(brand_id, prompt_id, platform='reddit', status='new')`, `relevance_score >= 60`, newest `posted_at` last (aged evergreen threads are *preferred*, not penalized **[R]**) — rank by `relevance_score` desc, take the best.
  2. If found → **thread mode**: `content_brief` = thread URL; `target_title` = thread title; writer context = thread title + `body_preview` + subreddit strategy block; the piece is generated with the new `reddit_comment` spec (below). Mark the opportunity `status='drafted'` and set `draft.opportunity_id`.
  3. Else → **post mode** (unchanged): validated subreddit + strategy, standalone `reddit` spec.
- New `PLATFORM_SPECS["reddit_comment"]`: substantive top-level reply, 100–300 words, conversational, first-person experience markers, no links, no headers, direct answer to the thread's question, disclosure per 1d, authenticity rule per 1d. `PLATFORM_MAX_TOKENS["reddit_comment"] = 900`.
- New nullable column `ContentDraft.target_title` (String(300)) + migration — human-readable destination (thread title / Quora question title). Quora targeting populates it too (title already available at resolve time).
- Scanner pruning fix: `reddit_scanner_service` currently deletes stored rows >14 days old. Keep pruning low-relevance rows, but retain `status='new'` reddit rows with `relevance_score >= 60` up to 90 days (aligning with the router's 90-day list window) so evergreen threads survive to be routed. **[R]**

### Frontend

- `PieceCard` destination treatment gets promoted from footnote to a proper routing line (icon + label + title):
  - Reddit thread mode: `→ Reply in r/{sub}: "{target_title}" ↗`
  - Reddit post mode: `→ Post in r/{sub}` (+ question-title tip)
  - Quora: `→ Answer: "{target_title}" ↗`
- Out of scope: re-wiring the standalone opportunity draft/dismiss endpoints into the UI (dead since the content-hub retirement) — noted as follow-up.

---

## Workstream 3 — Owned-site anchor (pillar merged)

`owned_site` becomes a first-class cluster platform — the anchor piece, listed first.

### Backend

- `CLUSTER_PLATFORMS = ("owned_site", "linkedin", "medium", "reddit", "quora", "x")` (backend + frontend constant + labels: "Your site").
- `_gen("owned_site")` special-cases like `drafting_service.py:1023`: brand dict from `Brand`+`BrandProfile`, evidence mapped from the **cluster pack** (not a per-piece pack), voice via `_load_voice_directive`, brief context appended to the prompt (extend `build_owned_site_prompt` with an optional `brief` param), `generate_owned_site_draft` (anti-AI gate internal), claim verifier after, JSON-LD appended as the paste-ready block. No pillar cross-ref on itself.
- **Pillar merge:** `pillar_mode`/`pillar_url` stay as the data model; `propose_pillar` flow keeps working. Semantics:
  - `pillar_mode='attached'` → the owned-site slot shows the existing page as the anchor; generating a draft is offered as "refresh this page's content".
  - Candidate `proposed` → the owned-site card offers **Use existing page** (accept → attached) or **Write a new page** (generate draft; auto-rejects the proposal).
  - When an owned-site draft is marked posted **with a URL**, set `cluster.pillar_url = posted_url`, `pillar_mode='attached'` — siblings cross-reference it on next regen.
- `BrandContentSettings` respects an `owned_site` row (default enabled, like others).
- Tier gating: available on all tiers (it's the one channel the user fully controls; no marginal LLM-cost difference).

### Frontend

- Owned-site `PieceCard` variant: "Your site" badge (globe icon exists), pillar states above, JSON-LD block arrives inside `content_text` (copy button already covers it).
- `PillarCard.tsx`, `acceptClusterPillar`/`rejectClusterPillar` calls move into the owned-site card; the standalone card is deleted.
- Cluster grids/headers already derive platform sets at runtime — "N of 6 posts" adapts without hardcoding.

---

## Workstream 4 — Angle control (Insider / Neutral)

A per-cluster setting controlling the persona of social pieces. **Not** "profile on/off" — the profile still feeds facts/voice at every angle.

### Data model

- `ContentCluster.angle: String(16), default 'auto'` (`auto` | `insider` | `neutral`) + migration.
- `PATCH /api/clusters/{brand_id}/{cluster_id}` accepting `{angle}` (ownership-checked). Applies on next generate/rewrite.

### Resolution (`effective_angle(platform, angle, subreddit_classification)`)

| Platform | auto resolves to |
|----------|------------------|
| owned_site | (no angle — always first-party) |
| linkedin, medium | insider |
| reddit | insider when subreddit classification is `allowed`; neutral for `cautious`/`restricted` |
| quora | neutral (credential carries affiliation) |
| x | insider |

Explicit `insider`/`neutral` overrides all social platforms; owned_site ignores it.

### Prompt directives (new section in `build_prompt`)

- **Insider:** write as someone who works at {brand} — first-person experience, real specifics from the profile, casual inline disclosure **iff the piece endorses the brand** (per 1d). Fake-customer voice banned.
- **Neutral:** write as an independent practitioner surveying the space — the brand appears as one concrete option among alternatives, factual claims only, no superlatives about the brand, **no first-person claims about using/working at the brand, and never an explicit claim of independence** (an affiliated poster claiming independence is astroturfing — the text must simply be neutral enough that affiliation doesn't change its weight). No disclosure line.

### UI

Segmented control in the cluster header actions row: `Voice: Auto · Insider · Neutral`, with a tooltip explaining each; persists immediately; a hint appears if pieces were generated under a different angle ("Rewrite all posts to apply").

---

## Error handling & edge cases

- Sources endpoint usage-count join is read-only and best-effort; URL normalization mirrors `cluster_evidence._normalize_url`.
- Thread routing is best-effort like all `_resolve_post_targets` work — any failure falls back to post mode; never blocks generation.
- Owned-site generation failure persists a `failed` shell like any other piece; cluster status logic unchanged.
- `angle` on regenerating clusters: resolved per piece at generation time; stored value is the cluster-level intent.
- Migrations: two `ALTER TABLE` steps appended to `database.py:run_migrations()` (`content_drafts.target_title`, `content_clusters.angle`) — additive, idempotent pattern as existing steps.

## Testing

TDD throughout. New/updated backend tests: tier-label payloads + usage counts on the sources endpoint; reddit render = no footer/markers preserved-in-DB; disclosure + authenticity rules present in built prompts (insider vs neutral × reddit classifications); `effective_angle` matrix; thread-routing selection (relevance floor, drafted-marking, fallback); scanner pruning retention; owned_site cluster piece via stubbed writer (JSON-LD block, pack-fed evidence, pillar-on-posted transition); migrations. Frontend: `tsc --noEmit`, `npm run build`, lint on touched files.

## Out of scope (noted follow-ups)

- Re-wiring standalone opportunity draft/dismiss UI.
- Fetching full thread bodies (Serper snippet only today).
- Comment/upvote-based thread ranking (no data source available).
- Per-engine optimization splits (ChatGPT vs Perplexity targeting).
