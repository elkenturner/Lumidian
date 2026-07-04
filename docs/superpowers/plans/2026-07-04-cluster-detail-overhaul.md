# Cluster Detail Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the cluster detail experience: plain-language UI, right-sized disclosures, research-aligned citation rendering, Reddit thread routing, owned-site anchor piece, and an Insider/Neutral angle control.

**Architecture:** Four workstreams over the existing cluster pipeline. Backend changes concentrate in `drafting/platforms.py`, `drafting/prompts.py`, `drafting/citations.py`, `clustering_service.py`, `routers/clusters.py`; frontend in `components/content/cluster/*` and the cluster detail page. Two additive SQLite migrations (`content_drafts.target_title`, `content_clusters.angle`).

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (asyncio_mode=auto); Next.js 16 + TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-04-cluster-detail-overhaul-design.md` — read it first; the research rationale lives there.

## Global Constraints

- Backend venv: `cd backend && source venv/bin/activate`. Run tests with `pytest tests/ -k <filter>`.
- Migrations: append new `ALTER TABLE` steps at the BOTTOM of `database.py:run_migrations()`; never modify existing steps.
- Tier keys are internal (`basic`=Starter, `starter`=Growth, `pro`=Pro) — don't rename.
- API/DB field names stay as-is where the spec says "display-only rename" (e.g. tier keys T1/T2/T3, brief field names).
- Frontend: no new deps; `npx tsc --noEmit` must stay clean after every frontend task.
- Copy rules: casual disclosure phrasing, never legalistic; never instruct fake-customer voice; UI tier labels exactly "Major press & research" / "Industry press" / "Other web" / "Your site & profile".
- Known pre-existing red tests to IGNORE (not yours): `test_client_portal.py`, `test_prompt_intelligence.py`.

---

### Task 1: Sources endpoint — real usage counts + cited-first sort

**Files:**
- Modify: `backend/app/routers/clusters.py` (`cluster_sources`, ~line 491)
- Test: `backend/tests/test_clusters.py` (append)

**Interfaces:**
- Produces: `ClusterSourcesPayload.sources[].times_cited` now = count of cluster drafts citing that URL (computed, not the dead DB column). Sort: cited-count desc, then tier T1→T2→T3→brand.

- [ ] **Step 1: Write the failing test**

```python
async def test_cluster_sources_reports_real_usage_counts(client, db_session):
    """times_cited must be computed from ContentDraftCitation rows, not the dead column."""
    token, user = await register_and_login(client, "srcusage@example.com")
    brand = await create_brand(client, token, name="SrcUsage")
    # Seed: cluster + pack + 2 sources; one cited by 2 drafts, one uncited
    from app.models import (
        ContentCluster, ContentClusterSource, ContentDraft, ContentDraftCitation,
        ContentEvidencePack, Prompt,
    )
    prompt = Prompt(brand_id=brand["id"], text="best widget tool?")
    db_session.add(prompt); await db_session.flush()
    cluster = ContentCluster(brand_id=brand["id"], prompt_id=prompt.id, status="ready")
    db_session.add(cluster); await db_session.flush()
    pack = ContentEvidencePack(cluster_id=cluster.id, version=1, sources=[],
                               total_t1=1, total_t2=1, total_t3=0)
    db_session.add(pack); await db_session.flush()
    db_session.add(ContentClusterSource(cluster_id=cluster.id, evidence_pack_id=pack.id,
        url="https://reuters.com/a", domain="reuters.com", tier="T1", title="A", times_cited=0))
    db_session.add(ContentClusterSource(cluster_id=cluster.id, evidence_pack_id=pack.id,
        url="https://techcrunch.com/b", domain="techcrunch.com", tier="T2", title="B", times_cited=0))
    d1 = ContentDraft(brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
                      platform="medium", status="draft", content_text="x", source="cluster")
    d2 = ContentDraft(brand_id=brand["id"], prompt_id=prompt.id, cluster_id=cluster.id,
                      platform="quora", status="draft", content_text="y", source="cluster")
    db_session.add_all([d1, d2]); await db_session.flush()
    for d in (d1, d2):
        db_session.add(ContentDraftCitation(draft_id=d.id, source_ref="S1",
            url="https://www.techcrunch.com/b", title="B", position_marker=0, tier="T2"))
    await db_session.commit()

    resp = await client.get(f"/api/clusters/{brand['id']}/{cluster.id}/sources",
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    sources = resp.json()["sources"]
    by_domain = {s["domain"]: s for s in sources}
    # www. prefix must not defeat the URL match
    assert by_domain["techcrunch.com"]["times_cited"] == 2
    assert by_domain["reuters.com"]["times_cited"] == 0
    # cited-first ordering beats tier ordering
    assert sources[0]["domain"] == "techcrunch.com"
```

Note: check how other tests in `test_clusters.py` authenticate (cookie vs Authorization header) and mirror the file's existing pattern exactly — the helpers in `conftest.py` are authoritative, the header above is illustrative.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_clusters.py::test_cluster_sources_reports_real_usage_counts -v`
Expected: FAIL — `times_cited == 0` for techcrunch (endpoint reads the dead column).

- [ ] **Step 3: Implement**

In `cluster_sources` (`routers/clusters.py`), after loading `rows`, compute usage and sort:

```python
    # Compute real per-URL usage from citations attached to this cluster's
    # drafts. ContentClusterSource.times_cited is written 0 at pack build and
    # never incremented — the payload field is computed here instead.
    from app.models import ContentDraft, ContentDraftCitation
    from app.services.cluster_evidence import _normalize_url

    cite_rows = (await db.execute(
        select(ContentDraftCitation.url, ContentDraftCitation.draft_id)
        .join(ContentDraft, ContentDraft.id == ContentDraftCitation.draft_id)
        .where(ContentDraft.cluster_id == cluster.id)
    )).all()
    usage: dict[str, set[int]] = {}
    for url, draft_id in cite_rows:
        usage.setdefault(_normalize_url(url or ""), set()).add(draft_id)

    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    def _cited(r) -> int:
        return len(usage.get(_normalize_url(r.url), set()))
    rows = sorted(rows, key=lambda r: (-_cited(r), tier_order.get(r.tier, 3)))
    return ClusterSourcesPayload(
        total_t1=pack.total_t1, total_t2=pack.total_t2, total_t3=pack.total_t3,
        sources=[ClusterSourceItem(
            url=r.url, domain=r.domain, tier=r.tier, title=r.title,
            times_cited=_cited(r),
        ) for r in rows],
    )
```

(Replace the existing `tier_order`/`sorted`/`return` block; delete the old `-r.times_cited` sort.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_clusters.py::test_cluster_sources_reports_real_usage_counts -v` → PASS
Also: `pytest tests/test_clusters.py -v` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/clusters.py backend/tests/test_clusters.py
git commit -m "fix(clusters): sources endpoint computes real citation usage (times_cited was dead data)"
```

---

### Task 2: Platform rules — right-sized disclosures, authenticity, reddit_comment spec

**Files:**
- Modify: `backend/app/services/drafting/platforms.py`
- Modify: `backend/app/services/drafting/prompts.py` (WRITING RULES block, ~line 280)
- Test: `backend/tests/test_platform_rules.py` (create)

**Interfaces:**
- Produces: `PLATFORM_SPECS["reddit_comment"]` (used by Task 6 thread mode); revised `reddit`/`quora`/`x_*` rules and tips; a fake-customer ban line in every built prompt.

- [ ] **Step 1: Write the failing tests**

```python
"""Rules-content tests: the prompt/spec text encodes the July 2026 research decisions."""
from app.services.drafting.platforms import PLATFORM_SPECS, PLATFORM_MAX_TOKENS
from app.services.drafting.prompts import build_prompt


def _joined_rules(platform: str) -> str:
    return " ".join(PLATFORM_SPECS[platform]["rules"]).lower()


def test_reddit_disclosure_is_conditional_on_endorsement():
    rules = _joined_rules("reddit")
    assert "recommends" in rules or "endorse" in rules  # conditional trigger
    assert "full disclosure" in rules                    # casual phrasing modeled
    assert "neutral factual" in rules                    # neutral mention needs none
    # The old blanket rule must be gone
    assert "disclose brand affiliation if the brand is mentioned" not in rules


def test_reddit_has_authenticity_and_prose_attribution_rules():
    rules = _joined_rules("reddit")
    assert "tradeoff" in rules or "competitor" in rules   # real-evaluation rule
    assert "in prose" in rules or "never a bare link" in rules
    assert "question" in _joined_rules("reddit")          # question-phrased title guidance


def test_reddit_posting_tip_warns_about_account_readiness():
    tip = PLATFORM_SPECS["reddit"]["posting_tip"].lower()
    assert "karma" in tip and "30" in tip


def test_quora_disclosure_lives_in_credential():
    rules = _joined_rules("quora")
    assert "credential" in rules
    tip = PLATFORM_SPECS["quora"]["posting_tip"].lower()
    assert "credential" in tip


def test_x_tips_mention_own_brand_labeling():
    assert "label" in PLATFORM_SPECS["x_post"]["posting_tip"].lower()
    assert "label" in PLATFORM_SPECS["x_thread"]["posting_tip"].lower()


def test_reddit_comment_spec_exists():
    spec = PLATFORM_SPECS["reddit_comment"]
    assert spec["format"] == "thread_reply"
    assert spec["word_range"] == (100, 300)
    rules = _joined_rules("reddit_comment")
    assert "no links" in rules or "no outbound links" in rules
    assert PLATFORM_MAX_TOKENS["reddit_comment"] == 900
    # reply variants stay out of the standalone-content platform list
    from app.services.drafting.platforms import CONTENT_PLATFORMS
    assert "reddit_comment" not in CONTENT_PLATFORMS


def test_core_prompt_bans_fake_customer_voice():
    p = build_prompt(
        brand_name="Acme", platform="reddit", prompt_text="best widget?",
        visibility_pct=10.0, profile_context="", response_analysis="",
        platform_spec=PLATFORM_SPECS["reddit"],
    )
    assert "satisfied customer" in p.lower() or "fake-customer" in p.lower() or "as a customer" in p.lower()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_platform_rules.py -v`
Expected: FAIL (missing rules/spec).

- [ ] **Step 3: Implement in `platforms.py`**

Replace the `reddit` spec's `rules`/`disclaimer`/`posting_tip` (keep `format`, `word_range`, `tone`):

```python
        "rules": [
            "Write as a genuine community member, not a marketer — conversational and first-person where natural",
            "NO formal headers, NO markdown formatting (no ##, no bold headers) — at most 1 to 2 bullet points maximum, only if a short list genuinely helps",
            "A clear problem-then-direct-solution or question-then-answer structure is good — the Reddit content AI engines actually cite is overwhelmingly direct answers to specific questions. Keep it conversational (a person sharing what worked), not an essay, but do not avoid directly answering a question.",
            "For a standalone post, the title must be a specific question a real person would type (e.g. 'Anyone actually compared X vs Y for Z?') — question-framed threads are what AI engines retrieve and cite",
            "Add genuine value — answer a question, share a personal experience, contribute a real insight",
            "Mention the brand only if it fits naturally into the conversation; never force it",
            "Acknowledge one genuine tradeoff, limitation, or a competitor's strength — pure advocacy reads as marketing and gets removed; honest evaluation is what AI engines cite",
            "DISCLOSURE: if the post recommends, praises, or favorably compares the brand, disclose affiliation casually at the first brand mention — e.g. 'full disclosure — I work at X, so grain of salt'. Inline and human, never a formal disclosure block. If the brand appears only as a neutral factual reference among alternatives, no disclosure line is needed.",
            "NO outbound links. When citing a stat or study, attribute it in prose ('a 2025 Semrush study of 150k AI citations found...') — never a bare link, never a link list",
            "No promotional language, no calls to action",
            "Sound like a real person talking — not an article, not a press release, not a structured essay",
        ],
        "disclaimer": (
            "If your post endorses your brand, disclose your affiliation casually in the "
            "post itself (FTC rules + Reddit norms). Neutral factual mentions don't need it."
        ),
        "posting_tip": (
            "Choose the most relevant subreddit for your brand's niche. Post from an account "
            "that's 30+ days old with ~100+ comment karma — newer accounts get auto-filtered "
            "regardless of content quality."
        ),
```

Add `reddit_comment` right after `reddit_reply`:

```python
    "reddit_comment": {
        "format": "thread_reply",
        "word_range": (100, 300),
        "tone": "conversational, firsthand, direct — a knowledgeable person answering a thread they know something about",
        "rules": [
            "Write a substantive top-level comment that directly answers the thread's question — lead with the answer, then the reasoning or experience behind it",
            "First-person experience markers ('I ran into this', 'what worked for us') where genuine — firsthand evaluation is what AI engines cite from Reddit",
            "NO outbound links, no headers, no bullet scaffolding — plain conversational paragraphs",
            "When citing a stat or study, attribute it in prose ('a 2025 study by X found...'), never a link",
            "Acknowledge one genuine tradeoff, limitation, or a competitor's strength — honest evaluation beats advocacy",
            "DISCLOSURE: if the comment recommends or praises the brand, disclose affiliation casually at first mention ('full disclosure — I work at X'). Neutral factual mentions need none.",
            "Do not restate the thread title; do not greet the OP; get straight to the answer",
        ],
        "disclaimer": (
            "If your comment endorses your brand, disclose your affiliation casually in the "
            "comment itself. Neutral factual mentions don't need it."
        ),
        "posting_tip": (
            "Reply as a top-level comment in the linked thread. Use an account that's 30+ days "
            "old with ~100+ comment karma."
        ),
    },
```

Quora spec: replace the last rule (`"No parenthetical asides..."` stays) — add these two rules to the list and swap `disclaimer`/`posting_tip`:

```python
            "Never put affiliation disclosures in the answer body unless the answer recommends the product — affiliation belongs in the answer credential line",
            "If the answer does recommend the product, include one casual inline disclosure at first mention ('disclosure: I work at X')",
```

```python
        "disclaimer": "Disclose affiliation via your answer credential; add an inline line only if the answer recommends your product.",
        "posting_tip": (
            "Find a relevant question on Quora and post this as your answer. Set your answer "
            "credential to your role (e.g. 'Founder at X') — that's Quora's sanctioned "
            "disclosure. Add one inline disclosure line only if the answer recommends your product."
        ),
```

`x_post` and `x_thread` `posting_tip` — append:

```python
        # x_post:
        "posting_tip": "Post directly to X. If the post promotes your own company, use X's paid-partnership/own-brand label (required since Feb 2026 for commercial-intent posts from affiliated accounts).",
        # x_thread:
        "posting_tip": "Post as a thread on X. The first tweet is your hook. If the thread promotes your own company, use X's paid-partnership/own-brand label (required since Feb 2026).",
```

Update `reddit_reply` similarly (drop its blanket `disclaimer`, reuse the conditional one from `reddit_comment`), and add to `PLATFORM_MAX_TOKENS`:

```python
    "reddit_comment": 900,
```

`CONTENT_PLATFORMS` exclusion list gains `"reddit_comment"`:

```python
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p not in ("reddit_reply", "linkedin_reply", "x_reply", "reddit_comment")]
```

In `prompts.py` WRITING RULES block, add after the "Mention {brand_name} only where it fits..." line:

```python
  - NEVER write as a satisfied customer or user of {brand_name} ("I've been using it and love it") when writing on the brand's behalf — undisclosed insider testimonials are an FTC violation. First-person experience is fine only in an openly affiliated voice.
```

And add the claim-adjacent attribution rule after the "Prefer concrete specifics..." line:

```python
  - When you cite a source, name it in the same sentence as the claim ("per a 2026 Ahrefs study, ...") so the claim and its source travel together — a footnote alone is not attribution.
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_platform_rules.py -v` → PASS.
Then the drafting regression net: `pytest tests/ -k "drafting or platform or prompt" -q` — fix any test asserting the OLD rule text (update those assertions to the new copy; that's expected fallout, not a regression).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/platforms.py backend/app/services/drafting/prompts.py backend/tests/test_platform_rules.py
git commit -m "feat(drafting): conditional disclosures, authenticity rules, reddit_comment spec, prose attribution"
```

---

### Task 3: Reddit citation rendering — strip markers, no footer; drop Reddit pillar link

**Files:**
- Modify: `backend/app/services/drafting/citations.py`
- Modify: `backend/app/services/clustering_service.py` (`_APPENDS_PILLAR_REF`, `append_pillar_reference`)
- Test: `backend/tests/test_citations_render.py` (create; if an existing citations test file exists, append there instead — check `grep -rl render_citations backend/tests`)

**Interfaces:**
- Produces: `render_citations(text, pack, "reddit")` returns prose-only text (no `[SN]`, no footer) but still returns the `RenderedCitation` list; `append_pillar_reference(platform="reddit"|"reddit_reply"|"reddit_comment")` returns text unchanged.

- [ ] **Step 1: Write the failing tests**

```python
from app.services.drafting.citations import render_citations
from app.services.drafting.evidence import EvidencePack, EvidenceSource
from app.services.clustering_service import append_pillar_reference


def _pack():
    return EvidencePack(sources=[
        EvidenceSource(ref="S1", url="https://reuters.com/a", title="Reuters piece", snippet="x"),
    ])


def test_reddit_render_strips_markers_and_has_no_footer():
    text = "Widgets cut costs 30% per a Reuters analysis [S1]. That matched our experience."
    rendered, used = render_citations(text, _pack(), "reddit")
    assert "[S1]" not in rendered
    assert "More on this" not in rendered
    assert "reuters.com" not in rendered          # no link footer at all
    assert len(used) == 1                         # citation still recorded for the UI


def test_reddit_reply_render_also_linkless():
    rendered, _ = render_citations("Costs fell [S1].", _pack(), "reddit_reply")
    assert "http" not in rendered


def test_pillar_reference_not_appended_on_reddit():
    for platform in ("reddit", "reddit_reply", "reddit_comment"):
        out = append_pillar_reference(text="body", platform=platform, pillar_url="https://ex.com/p")
        assert out == "body"


def test_pillar_reference_still_appended_on_linkedin():
    out = append_pillar_reference(text="body", platform="linkedin_post", pillar_url="https://ex.com/p")
    assert "https://ex.com/p" in out
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_citations_render.py -v` — reddit tests FAIL (footer present / pillar appended).

- [ ] **Step 3: Implement**

`citations.py`:
- Change set memberships at the top:

```python
_REDDIT_PLATFORMS: set[str] = set()  # retired: reddit renders linkless (July 2026 research)
_STRIP_PLATFORMS = {"x_post", "x_thread", "x_reply", "reddit", "reddit_reply", "reddit_comment"}
```

- Delete the `elif platform in _REDDIT_PLATFORMS:` footer branch in `render_citations` and the `platform in _REDDIT_PLATFORMS` clause inside `_replace` (the `_STRIP_PLATFORMS` clause already returns `""`). Keep the `used` collection loop untouched — it runs before rendering and must keep recording citations.

`clustering_service.py`:

```python
# Platforms that get a soft "further reading" reference to the cluster's
# Medium piece (or own-site pillar). Reddit is EXCLUDED — outbound links to
# own content are the classic spam fingerprint there (July 2026 research);
# Medium/Wikipedia get nothing either.
_APPENDS_PILLAR_REF = {
    "linkedin_post", "linkedin_reply", "linkedin_article",
    "quora",
    "x_post", "x_thread", "x_reply",
}
```

And remove the `if platform.startswith("reddit")` branch from `append_pillar_reference`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_citations_render.py -v` → PASS.
Regression: `pytest tests/ -k "citation or cluster or render" -q` — update any test asserting the old "More on this:" reddit footer or the reddit pillar line.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/citations.py backend/app/services/clustering_service.py backend/tests/test_citations_render.py
git commit -m "feat(citations): reddit renders linkless — prose attribution only, no footer, no pillar link"
```

---

### Task 4: Migrations + schema plumbing (`target_title`, `angle`, cluster draft fields)

**Files:**
- Modify: `backend/app/models.py` (ContentDraft, ContentCluster)
- Modify: `backend/app/database.py` (bottom of `run_migrations()`)
- Modify: `backend/app/schemas.py` (`ContentClusterDraft`, `ContentClusterDetail`, `ContentClusterSummary`)
- Test: `backend/tests/test_cluster_overhaul_schema.py` (create)

**Interfaces:**
- Produces: `ContentDraft.target_title: str | None` (String(300)); `ContentCluster.angle: str` default `"auto"`; `ContentClusterDraft` gains `content_brief: str | None = None` and `target_title: str | None = None`; `ContentClusterDetail` + `ContentClusterSummary` gain `angle: str = "auto"`. Tasks 6, 7, 9, 10 consume these.

- [ ] **Step 1: Write the failing test**

```python
from sqlalchemy import text as sqltext


async def test_new_columns_exist(db_session):
    cols_drafts = {r[1] for r in (await db_session.execute(
        sqltext("PRAGMA table_info(content_drafts)"))).all()}
    assert "target_title" in cols_drafts
    cols_clusters = {r[1] for r in (await db_session.execute(
        sqltext("PRAGMA table_info(content_clusters)"))).all()}
    assert "angle" in cols_clusters


def test_cluster_draft_schema_exposes_routing_fields():
    from app.schemas import ContentClusterDraft, ContentClusterDetail
    fields = ContentClusterDraft.model_fields
    assert "content_brief" in fields and "target_title" in fields
    assert "angle" in ContentClusterDetail.model_fields
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_cluster_overhaul_schema.py -v` → FAIL (no columns/fields).

- [ ] **Step 3: Implement**

`models.py` — in `ContentDraft` after `content_brief`:

```python
    # Human-readable destination for routed pieces (reddit thread title /
    # Quora question title). content_brief holds the URL; this holds the label.
    target_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
```

In `ContentCluster` after `pillar_url`:

```python
    # Content angle for social pieces: 'auto' | 'insider' | 'neutral'.
    # Resolved per-platform at generation time (see drafting/angle.py).
    angle: Mapped[str] = mapped_column(String(16), default="auto")
```

`database.py` — append at the bottom of `run_migrations()`, following the existing try/except-duplicate pattern used by the steps above it:

```python
        # 2026-07-04 cluster-detail overhaul: routed-destination label + angle control
        for stmt in (
            "ALTER TABLE content_drafts ADD COLUMN target_title VARCHAR(300)",
            "ALTER TABLE content_clusters ADD COLUMN angle VARCHAR(16) NOT NULL DEFAULT 'auto'",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # column already exists
```

(Match the file's actual idiom for already-applied steps — copy the pattern from the `failed_queries` migration directly above.)

`schemas.py` — `ContentClusterDraft` add:

```python
    # Routing destination (WS2): URL in content_brief, human label in target_title
    content_brief: str | None = None
    target_title: str | None = None
```

`ContentClusterDetail` and `ContentClusterSummary` add:

```python
    angle: str = "auto"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_cluster_overhaul_schema.py tests/test_clusters.py -q` → PASS (detail endpoint serializes from ORM via `from_attributes`, so the new fields flow through automatically; if a serializer builds `ContentClusterDraft` explicitly, add the two fields at the call site — check `routers/clusters.py` `_draft_to_schema`-style helpers).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/app/schemas.py backend/tests/test_cluster_overhaul_schema.py
git commit -m "feat(clusters): target_title + angle columns and schema plumbing"
```

---

### Task 5: Reddit scanner — retain high-relevance evergreen threads

**Files:**
- Modify: `backend/app/services/reddit_scanner_service.py` (~line 756 prune block)
- Test: `backend/tests/test_reddit_scanner.py` (append; create if missing — check `grep -rl "prune\|scan_reddit" backend/tests`)

**Interfaces:**
- Produces: prune keeps `status='new'` reddit rows with `relevance_score >= 60` for 90 days; low-relevance rows still pruned at 14 days.

- [ ] **Step 1: Write the failing test**

```python
from datetime import UTC, datetime, timedelta


async def test_prune_retains_high_relevance_evergreen_threads(db_session):
    from app.models import Brand, ContentOpportunity, User
    from app.services.reddit_scanner_service import _prune_stale_opportunities  # extract if inline

    user = User(email="prune@example.com", password_hash="x", name="P")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="PruneCo", slug="pruneco", user_id=user.id)
    db_session.add(brand); await db_session.flush()

    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
    keep = ContentOpportunity(brand_id=brand.id, platform="reddit", thread_url="u1",
        thread_title="t1", relevance_score=75.0, status="new", created_at=old)
    drop = ContentOpportunity(brand_id=brand.id, platform="reddit", thread_url="u2",
        thread_title="t2", relevance_score=40.0, status="new", created_at=old)
    ancient = ContentOpportunity(brand_id=brand.id, platform="reddit", thread_url="u3",
        thread_title="t3", relevance_score=90.0, status="new",
        created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=120))
    db_session.add_all([keep, drop, ancient]); await db_session.commit()

    await _prune_stale_opportunities(db_session, brand_id=brand.id)
    await db_session.commit()

    from sqlalchemy import select
    urls = {o.thread_url for o in (await db_session.execute(
        select(ContentOpportunity).where(ContentOpportunity.brand_id == brand.id)
    )).scalars().all()}
    assert urls == {"u1"}  # high-relevance 30d kept; low-rel 30d and 120d dropped
```

(Adapt model constructor kwargs to the actual `ContentOpportunity` columns — check `models.py:564`.)

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_reddit_scanner.py::test_prune_retains_high_relevance_evergreen_threads -v` → FAIL (u1 deleted, or helper doesn't exist).

- [ ] **Step 3: Implement**

Extract the inline prune block at ~line 756 into a module-level helper and change the deletion criteria:

```python
async def _prune_stale_opportunities(db: AsyncSession, *, brand_id: int) -> None:
    """Prune stale un-actioned Reddit opportunities.

    Aged evergreen threads are the AI retrieval surface (avg cited Reddit
    post is ~1 year old — July 2026 research), so high-relevance leads are
    kept for 90 days (matching the router's list window). Low-relevance
    leads still expire at 14 days.
    """
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff_low = now - timedelta(days=14)
    cutoff_high = now - timedelta(days=90)
    rows = (await db.execute(
        select(ContentOpportunity).where(
            ContentOpportunity.brand_id == brand_id,
            ContentOpportunity.platform == "reddit",
            ContentOpportunity.status == "new",
        )
    )).scalars().all()
    for opp in rows:
        created = opp.created_at
        if created is None:
            continue
        threshold = cutoff_high if (opp.relevance_score or 0) >= 60 else cutoff_low
        if created < threshold:
            await db.delete(opp)
```

Call it from the original site: `await _prune_stale_opportunities(db, brand_id=brand_id)` (keep the surrounding commit/logging behavior).

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_reddit_scanner.py -v` and `pytest tests/ -k "opportunit" -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reddit_scanner_service.py backend/tests/test_reddit_scanner.py
git commit -m "feat(opportunities): retain high-relevance evergreen reddit threads for 90 days"
```

---

### Task 6: Thread routing in `_resolve_post_targets` + generation wiring

**Files:**
- Modify: `backend/app/services/clustering_service.py` (`_resolve_post_targets` ~line 213, `_gen` ~line 480, draft persistence ~line 555)
- Test: `backend/tests/test_cluster_thread_routing.py` (create)

**Interfaces:**
- Consumes: `PLATFORM_SPECS["reddit_comment"]` (Task 2), `ContentDraft.target_title` (Task 4).
- Produces: reddit target dict may now be `{"brief": <thread_url>, "target_title": <thread title>, "platform_key_override": "reddit_comment", "opportunity": <writer context>, "opportunity_id": <id>}`; post-mode dict unchanged plus `"target_title": None`. Quora target dict gains `"target_title": <question title>`. Persistence writes `draft.target_title`, `draft.opportunity_id`, and marks the opportunity `drafted`.

- [ ] **Step 1: Write the failing tests**

```python
from unittest.mock import AsyncMock, patch


async def _seed_brand_prompt_cluster(db_session):
    from app.models import Brand, ContentCluster, Prompt, User
    user = User(email="route@example.com", password_hash="x", name="R")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="RouteCo", slug="routeco", user_id=user.id)
    db_session.add(brand); await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="best widget tool?")
    db_session.add(prompt); await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="pending")
    db_session.add(cluster); await db_session.commit()
    return brand, prompt, cluster


async def test_reddit_routes_to_high_relevance_thread(db_session):
    from app.models import ContentOpportunity
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    opp = ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/r/widgets/comments/abc/best_widget",
        thread_title="Anyone compared widget tools?", subreddit="widgets",
        relevance_score=82.0, status="new",
    )
    db_session.add(opp); await db_session.commit()

    targets = await _resolve_post_targets(
        db_session, brand_id=brand.id, brand_name="RouteCo",
        prompt_id=prompt.id, prompt_text=prompt.text, enabled=["reddit"],
    )
    t = targets["reddit"]
    assert t["brief"] == opp.thread_url
    assert t["target_title"] == "Anyone compared widget tools?"
    assert t["platform_key_override"] == "reddit_comment"
    assert t["opportunity_id"] == opp.id
    assert "Anyone compared widget tools?" in t["opportunity"]


async def test_reddit_low_relevance_falls_back_to_post_mode(db_session):
    from app.models import ContentOpportunity
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    db_session.add(ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/x", thread_title="meh",
        relevance_score=45.0, status="new",
    ))
    await db_session.commit()
    with patch("app.services.reddit_scanner_service.get_relevant_subreddits", return_value=["widgets"]), \
         patch("app.services.reddit_scanner_service.find_first_valid_subreddit", new=AsyncMock(return_value="widgets")):
        targets = await _resolve_post_targets(
            db_session, brand_id=brand.id, brand_name="RouteCo",
            prompt_id=prompt.id, prompt_text=prompt.text, enabled=["reddit"],
        )
    assert targets["reddit"]["brief"] == "r/widgets"
    assert "platform_key_override" not in targets["reddit"]


async def test_quora_target_includes_title(db_session):
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    with patch("app.services.quora_search_service.search_quora_questions",
               new=AsyncMock(return_value=[{"title": "What is the best widget tool?",
                                            "url": "https://quora.com/q1", "snippet": "s"}])):
        targets = await _resolve_post_targets(
            db_session, brand_id=brand.id, brand_name="RouteCo",
            prompt_id=prompt.id, prompt_text=prompt.text, enabled=["quora"],
        )
    assert targets["quora"]["target_title"] == "What is the best widget tool?"
```

(Verify the patch targets — patch where the names are *looked up*. `_resolve_post_targets` imports them locally from their source modules, so patching the source module attributes as above is correct.)

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_cluster_thread_routing.py -v` → FAIL.

- [ ] **Step 3: Implement**

In `_resolve_post_targets`, replace the reddit branch with thread-first logic:

```python
    if "reddit" in enabled:
        try:
            from app.services.drafting.platforms import (
                build_subreddit_strategy,
                classify_subreddit,
            )
            # 1) Prefer a real, relevant, un-actioned thread — replies to open
            # evergreen threads are the highest-value Reddit play for AI
            # retrieval (July 2026 research). Best-effort like everything here.
            from app.models import ContentOpportunity
            opp = (await db.execute(
                select(ContentOpportunity)
                .where(
                    ContentOpportunity.brand_id == brand_id,
                    ContentOpportunity.prompt_id == prompt_id,
                    ContentOpportunity.platform == "reddit",
                    ContentOpportunity.status == "new",
                    ContentOpportunity.relevance_score >= 60,
                )
                .order_by(ContentOpportunity.relevance_score.desc())
                .limit(1)
            )).scalars().first()
            if opp is not None:
                sub = (opp.subreddit or "").lstrip("r/")
                strategy = (
                    build_subreddit_strategy(sub, brand_name, classify_subreddit(sub))
                    if sub else ""
                )
                preview = getattr(opp, "body_preview", None) or ""
                targets["reddit"] = {
                    "brief": opp.thread_url,
                    "target_title": (opp.thread_title or "")[:300] or None,
                    "platform_key_override": "reddit_comment",
                    "opportunity_id": opp.id,
                    "opportunity": (
                        f"THREAD: {opp.thread_title}\nURL: {opp.thread_url}\n"
                        + (f"SUBREDDIT: r/{sub}\n" if sub else "")
                        + (f"THREAD EXCERPT:\n{preview}\n" if preview else "")
                        + f"\nWrite a top-level comment that directly answers this thread."
                        + (f"\n{strategy}" if strategy else "")
                    ),
                }
            else:
                # 2) Fall back to a standalone post in a validated subreddit
                #    (existing behavior).
                ...existing subreddit-resolution code, plus "target_title": None in the dict...
        except Exception as exc:
            logger.warning("cluster reddit target resolve skipped: %s", exc)
```

Quora branch: add `"target_title": (title or "")[:300] or None` to its target dict.

In `_gen(platform)` (inside `regenerate_cluster`): honor the override —

```python
        target = post_targets.get(platform, {})
        platform_for_generation = target.get("platform_key_override") or platform
```

and pass `platform=platform_for_generation` into `_generate_piece_text` while keeping the draft's stored `platform` as the base cluster platform (`platform`) so the card slot stays "reddit". `_generate_piece_text` already resolves specs via `resolve_platform_key`; `reddit_comment` resolves to itself (no `_BASE_PLATFORM_MAP` entry — correct).

In the draft-persistence loop (~line 555-570), set the new fields:

```python
            content_brief=post_targets.get(platform, {}).get("brief"),
            target_title=post_targets.get(platform, {}).get("target_title"),
            opportunity_id=post_targets.get(platform, {}).get("opportunity_id"),
```

After the persistence loop, mark routed opportunities drafted (best-effort):

```python
    routed_opp_ids = [t["opportunity_id"] for t in post_targets.values() if t.get("opportunity_id")]
    if routed_opp_ids:
        from app.models import ContentOpportunity
        for o in (await db.execute(
            select(ContentOpportunity).where(ContentOpportunity.id.in_(routed_opp_ids))
        )).scalars().all():
            o.status = "drafted"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_cluster_thread_routing.py tests/test_clusters.py -q` → PASS. Full cluster net: `pytest tests/ -k cluster -q`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/tests/test_cluster_thread_routing.py
git commit -m "feat(clusters): route reddit piece to a real high-relevance thread, fall back to standalone post"
```

---

### Task 7: Owned-site as cluster anchor (backend)

**Files:**
- Modify: `backend/app/services/clustering_service.py` (`CLUSTER_PLATFORMS`, `_gen`)
- Modify: `backend/app/services/drafting/owned_site.py` (`build_owned_site_prompt` gains `brief` param; `generate_owned_site_draft` passes it through)
- Modify: `backend/app/routers/content.py` or wherever `updateDraft`/mark-posted lives — pillar-attach-on-posted hook (find with `grep -n "posted_url" backend/app/routers/content.py`)
- Test: `backend/tests/test_cluster_owned_site.py` (create)

**Interfaces:**
- Consumes: cluster evidence pack (`ContentEvidencePack.sources` dicts with url/title/snippet), `_load_voice_directive`, `generate_owned_site_draft(writer, brand, target_query, evidence, voice, brief, date_published)`.
- Produces: `CLUSTER_PLATFORMS == ("owned_site", "linkedin", "medium", "reddit", "quora", "x")`; owned_site cluster drafts persisted like other pieces (title from JSON-LD headline, JSON-LD block appended to body); marking an owned_site cluster draft posted with a URL sets `cluster.pillar_url`/`pillar_mode='attached'`.

- [ ] **Step 1: Write the failing tests**

```python
from unittest.mock import AsyncMock, patch


def test_owned_site_is_first_cluster_platform():
    from app.services.clustering_service import CLUSTER_PLATFORMS
    assert CLUSTER_PLATFORMS[0] == "owned_site"
    assert set(CLUSTER_PLATFORMS) == {"owned_site", "linkedin", "medium", "reddit", "quora", "x"}


def test_owned_site_prompt_accepts_brief():
    from app.services.drafting.owned_site import build_owned_site_prompt
    p = build_owned_site_prompt(
        {"name": "Acme"}, "best widget?",
        evidence=[{"title": "T", "url": "https://e.com", "snippet": "s"}],
        brief="POSITIONING: the fastest widget",
    )
    assert "the fastest widget" in p


async def test_marking_owned_site_draft_posted_attaches_pillar(client, db_session):
    """POST/PATCH the draft to posted with a URL → cluster.pillar_url set."""
    # Seed user/brand/prompt/cluster + an owned_site cluster draft via ORM,
    # then hit the existing update-draft endpoint with
    # {"status": "posted", "posted_url": "https://acme.com/answers/widgets"}
    # and assert cluster.pillar_mode == "attached" and pillar_url == posted_url.
    # Mirror the auth + update-draft call pattern from tests/test_content.py.
    ...
```

Write the third test fully by copying the update-draft call pattern from `tests/test_content.py` (it exists — `grep -n "def test.*update.*draft" backend/tests/test_content.py`). The assertion body is the contract above; "..." here only because the auth idiom must be copied from the real file, not invented.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_cluster_owned_site.py -v` → FAIL.

- [ ] **Step 3: Implement**

`owned_site.py` — extend signatures:

```python
def build_owned_site_prompt(
    brand: dict,
    target_query: str,
    evidence: list[dict] | None = None,
    voice: str | None = None,
    avoid: str | None = None,
    brief: str | None = None,
) -> str:
```

after the brand block:

```python
    if brief:
        parts.append(
            "CLUSTER BRIEF (this page anchors a coordinated cross-platform cluster — "
            "express these ideas in your own words, never verbatim):\n" + brief
        )
```

`generate_owned_site_draft` gains `brief: str | None = None` and passes it into both `build_owned_site_prompt` calls.

`clustering_service.py`:

```python
CLUSTER_PLATFORMS: tuple[str, ...] = ("owned_site", "linkedin", "medium", "reddit", "quora", "x")
```

In `_gen(platform)`, before the generic path:

```python
        if platform == "owned_site":
            return await _gen_owned_site_piece(
                cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
                brief_context=ctx, pack=pack, tier=tier,
            )
```

New helper (module level) mirroring `drafting_service.py:1023` but fed by the CLUSTER pack:

```python
async def _gen_owned_site_piece(*, cluster, brand_row, prompt_row, brief_context, pack, tier):
    """Cluster anchor piece: the brand's own site. Evidence = the cluster pack."""
    import json as _json
    from datetime import datetime, timezone
    from app.services.drafting.client import call_claude
    from app.services.drafting.platforms import PLATFORM_MAX_TOKENS
    from app.services.drafting import owned_site

    try:
        async with AsyncSessionLocal() as piece_db:
            prof = (await piece_db.execute(
                select(BrandProfile).where(BrandProfile.brand_id == cluster.brand_id)
            )).scalar_one_or_none()
        brand_dict = {
            "name": brand_row.name,
            "description": prof.company_description if prof else None,
            "url": brand_row.website_url or None,
            "audience": prof.target_audience if prof else None,
        }
        evidence = [
            {"title": s.get("title"), "url": s.get("url", ""), "snippet": s.get("snippet", "")}
            for s in (pack.sources if pack else [])
            if s.get("url") and not str(s.get("url")).startswith("internal://")
        ] or None
        from app.services.drafting_service import _voice_directive_from_profile
        voice = _voice_directive_from_profile(prof)

        async def _writer(p: str) -> str:
            return await call_claude(p, max_tokens=PLATFORM_MAX_TOKENS.get("owned_site", 3000))

        owned = await asyncio.wait_for(
            owned_site.generate_owned_site_draft(
                writer=_writer, brand=brand_dict, target_query=prompt_row.text,
                evidence=evidence, voice=voice, brief=brief_context,
                date_published=datetime.now(timezone.utc).date().isoformat(),
            ),
            timeout=PIECE_TIMEOUT_SECONDS,
        )
        body = (
            owned.body
            + "\n\n---\nSchema markup (JSON-LD — paste inside the page's <head>):\n\n```json\n"
            + _json.dumps(owned.jsonld, indent=2)
            + "\n```\n"
        )
        title = owned.jsonld.get("headline") or _derive_title_fallback(
            owned.body, prompt_text=prompt_row.text, platform="owned_site")
        low_ev = not evidence
        return ("ok", "owned_site", title, body, owned.anti_ai_score, [], low_ev)
    except asyncio.TimeoutError:
        return ("fail", "owned_site", f"timeout after {PIECE_TIMEOUT_SECONDS:.0f}s")
    except Exception as exc:
        logger.exception("owned_site piece failed: %s", exc)
        return ("fail", "owned_site", str(exc))
```

Guard the reddit/quora-only code paths: `_resolve_post_targets` only handles reddit/quora — `post_targets.get("owned_site", {})` returns `{}` (already safe). `append_pillar_reference` excludes owned_site (not in `_APPENDS_PILLAR_REF`) and `resolve_platform_key("owned_site") == "owned_site"` — but `_generate_piece_text` must NOT run for owned_site (the special case returns before it). Check `_gen`'s claim-verifier block: skip it for owned_site (the helper returns pre-verified content and its `[]` citations skip `_persist_citations_and_summary`'s citation loop naturally).

**Pillar-attach-on-posted hook:** in the draft-update endpoint (find it: `grep -n "posted_url" backend/app/routers/content.py`), after a cluster draft transitions to `posted` with a `posted_url`:

```python
    if (draft.cluster_id and draft.platform == "owned_site"
            and draft.status == "posted" and draft.posted_url):
        cluster = await db.get(ContentCluster, draft.cluster_id)
        if cluster is not None:
            cluster.pillar_url = draft.posted_url
            cluster.pillar_mode = "attached"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_cluster_owned_site.py tests/ -k "cluster" -q` → PASS. Watch for tests asserting the 5-platform set ("5 posts", `len(CLUSTER_PLATFORMS)`) — update them to 6/derive dynamically.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/clustering_service.py backend/app/services/drafting/owned_site.py backend/app/routers/content.py backend/tests/test_cluster_owned_site.py
git commit -m "feat(clusters): owned-site anchor piece — cluster-pack evidence, JSON-LD, pillar attach on posted"
```

---

### Task 8: Angle control (backend) — resolution, prompt directives, PATCH endpoint

**Files:**
- Create: `backend/app/services/drafting/angle.py`
- Modify: `backend/app/services/drafting/prompts.py` (`build_prompt` gains `angle_directive`)
- Modify: `backend/app/services/drafting_service.py` (`_generate_with_new_pipeline` threads `angle_directive`)
- Modify: `backend/app/services/clustering_service.py` (resolve per piece, pass through)
- Modify: `backend/app/routers/clusters.py` (PATCH endpoint)
- Modify: `backend/app/schemas.py` (`ClusterAngleUpdate`)
- Test: `backend/tests/test_angle.py` (create)

**Interfaces:**
- Produces:
  - `effective_angle(platform: str, angle: str, subreddit_classification: str | None = None) -> str | None` — returns `"insider"`, `"neutral"`, or `None` (owned_site/no directive).
  - `angle_directive(angle: str | None, brand_name: str) -> str | None` — prompt text.
  - `PATCH /api/clusters/{brand_id}/{cluster_id}` body `{"angle": "auto"|"insider"|"neutral"}` → 200 `ContentClusterDetail`.

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from app.services.drafting.angle import angle_directive, effective_angle


@pytest.mark.parametrize("platform,angle,sub_cls,expected", [
    ("owned_site", "auto", None, None),
    ("owned_site", "neutral", None, None),          # owned_site ignores overrides
    ("linkedin_article", "auto", None, "insider"),
    ("medium", "auto", None, "insider"),
    ("x_thread", "auto", None, "insider"),
    ("quora", "auto", None, "neutral"),
    ("reddit", "auto", "allowed", "insider"),
    ("reddit", "auto", "cautious", "neutral"),
    ("reddit", "auto", "restricted", "neutral"),
    ("reddit_comment", "auto", "allowed", "insider"),
    ("reddit", "insider", "restricted", "insider"),  # explicit overrides classification
    ("medium", "neutral", None, "neutral"),
])
def test_effective_angle_matrix(platform, angle, sub_cls, expected):
    assert effective_angle(platform, angle, sub_cls) == expected


def test_insider_directive_contents():
    d = angle_directive("insider", "Acme")
    assert "works at Acme" in d or "work at Acme" in d
    assert "full disclosure" in d.lower()
    assert "customer" in d.lower()          # fake-customer ban restated


def test_neutral_directive_contents():
    d = angle_directive("neutral", "Acme")
    assert "independent" in d.lower() or "practitioner" in d.lower()
    assert "among" in d.lower()             # brand as one option among alternatives
    assert "claim of independence" in d.lower() or "claim independence" in d.lower()  # astroturf guard
    assert "disclosure" in d.lower()        # explains none is needed


def test_no_directive_for_none():
    assert angle_directive(None, "Acme") is None


async def test_patch_cluster_angle(client, db_session):
    # Seed brand+cluster (copy auth/seed pattern from tests/test_clusters.py),
    # PATCH {"angle": "neutral"} → 200 and detail payload angle == "neutral";
    # PATCH {"angle": "bogus"} → 422.
    ...
```

(Write the PATCH test fully using the file's real seed/auth helpers.)

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_angle.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement**

`drafting/angle.py`:

```python
"""Content angle (persona) control — Insider vs Neutral expert.

Research note (July 2026): FTC disclosure attaches to ENDORSEMENT, not brand
mention. Insider = openly affiliated voice with casual disclosure when
endorsing. Neutral = genuinely non-endorsing informational text — which is
what makes 'no disclosure' legally safe. A neutral piece must NEVER claim
independence (affiliated poster claiming independence = astroturfing).
"""
from __future__ import annotations

VALID_ANGLES = ("auto", "insider", "neutral")

_INSIDER_DEFAULT = {"linkedin_article", "linkedin_post", "linkedin_reply",
                    "medium", "x_thread", "x_post", "x_reply"}
_NO_ANGLE = {"owned_site", "wikipedia"}


def effective_angle(platform: str, angle: str, subreddit_classification: str | None = None) -> str | None:
    """Resolve the cluster-level angle setting for one platform."""
    if platform in _NO_ANGLE:
        return None  # a page on the brand's own domain is inherently first-party
    if angle in ("insider", "neutral"):
        return angle
    # auto
    if platform in _INSIDER_DEFAULT:
        return "insider"
    if platform.startswith("reddit"):
        return "insider" if subreddit_classification == "allowed" else "neutral"
    if platform == "quora":
        return "neutral"  # the credential line carries affiliation
    return "insider"


def angle_directive(angle: str | None, brand_name: str) -> str | None:
    """Prompt section expressing the persona. None → no section."""
    if angle == "insider":
        return (
            f"ANGLE — INSIDER: you are writing as someone who works at {brand_name}. "
            f"First-person experience is welcome ('we kept hitting this', 'what worked for us'), "
            f"grounded in the Brand Profile's real specifics. If (and only if) the piece "
            f"recommends or praises {brand_name}, include one casual inline disclosure at the "
            f"first brand mention — e.g. 'full disclosure — I work at {brand_name}, so grain of "
            f"salt'. Never a formal disclosure block. NEVER pose as a customer or user of "
            f"{brand_name} — an insider writing as a satisfied customer is an FTC violation."
        )
    if angle == "neutral":
        return (
            f"ANGLE — NEUTRAL EXPERT: you are writing as an experienced practitioner surveying "
            f"the space. {brand_name} appears as one concrete option among alternatives — "
            f"factual claims only, no superlatives about it, no recommendation of it over the "
            f"others. No first-person claims about using or working at {brand_name}. Make NO "
            f"claim of independence or non-affiliation either — the text must simply be neutral "
            f"enough that knowing the author's employer would not change its weight. Because the "
            f"piece endorses nothing, no disclosure line is needed."
        )
    return None
```

`prompts.py` — `build_prompt(..., angle_directive: str | None = None)`; render right before `{voice_directive_section}`:

```python
    angle_section = f"{angle_directive}\n\n" if angle_directive else ""
```

and include `{angle_section}` in the f-string just before `{voice_directive_section}`.

`drafting_service._generate_with_new_pipeline` — add parameter `angle_directive: str | None = None`, pass to every `build_prompt` call inside.

`clustering_service` — in `_gen(platform)`:

```python
        from app.services.drafting.angle import angle_directive as _angle_text, effective_angle
        sub_cls = None
        if platform == "reddit":
            tgt_sub = (target.get("brief") or "")
            if tgt_sub.startswith("r/"):
                from app.services.drafting.platforms import classify_subreddit
                sub_cls = classify_subreddit(tgt_sub)
            elif target.get("platform_key_override") == "reddit_comment":
                # routed thread — classify its subreddit if we have one
                ...classify from the opportunity subreddit captured in the target dict...
        resolved = effective_angle(platform_for_generation, cluster.angle or "auto", sub_cls)
        angle_text = _angle_text(resolved, brand_row.name)
```

(Cleanest: have Task 6's thread-mode target dict also carry `"subreddit": sub` so this block reads `target.get("subreddit")` for both modes; adjust Task 6's dict accordingly — post mode stores `"subreddit": sub` too.)

Then thread `angle_directive=angle_text` through `_generate_piece_text` → `_generate_with_new_pipeline`.

`routers/clusters.py` — PATCH endpoint (mirror the file's auth/ownership idiom):

```python
@router.patch("/{brand_id}/{cluster_id}", response_model=ContentClusterDetail)
async def update_cluster(brand_id: int, cluster_id: int, payload: ClusterAngleUpdate,
                         db: DbDep, user: CurrentUser):
    await _ensure_brand_owned(db, brand_id, user)
    cluster = (await db.execute(
        select(ContentCluster).where(
            ContentCluster.id == cluster_id, ContentCluster.brand_id == brand_id,
        )
    )).scalar_one_or_none()
    if cluster is None:
        raise HTTPException(404, "Cluster not found")
    cluster.angle = payload.angle
    await db.commit()
    return await get_cluster(brand_id, cluster.id, db, user)  # type: ignore
```

`schemas.py`:

```python
class ClusterAngleUpdate(BaseModel):
    angle: Literal["auto", "insider", "neutral"]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_angle.py tests/ -k "cluster or drafting" -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/drafting/angle.py backend/app/services/drafting/prompts.py backend/app/services/drafting_service.py backend/app/services/clustering_service.py backend/app/routers/clusters.py backend/app/schemas.py backend/tests/test_angle.py
git commit -m "feat(drafting): insider/neutral angle control — resolution matrix, prompt directives, PATCH endpoint"
```

---

### Task 9: Frontend — sources panel, brief panel, dissolve Inputs zone

**Files:**
- Modify: `frontend/components/content/cluster/SourceSpinePanel.tsx`
- Modify: `frontend/components/content/cluster/CitationsSubpanel.tsx` (tier chip labels)
- Modify: `frontend/components/content/cluster/BriefPanel.tsx`
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`
- Delete: `frontend/components/content/cluster/InputsZone.tsx`, `GapInput.tsx`, `OpportunitiesInput.tsx`

**Interfaces:**
- Consumes: `times_cited` now meaningful (Task 1). PillarCard temporarily renders standalone where InputsZone was (Task 10 replaces it).

- [ ] **Step 1: Implement tier labels + explainer + usage in `SourceSpinePanel`**

```tsx
const TIER_LABELS: Record<string, string> = {
  T1: "Major press & research",
  T2: "Industry press",
  T3: "Other web",
  brand: "Your site & profile",
};
const TIER_COLORS: Record<string, string> = {
  T1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  T2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  T3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  brand: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};
```

- Chip renders `TIER_LABELS[s.tier] ?? s.tier` (drop `uppercase` styling; the labels are sentence-case).
- Tier-count strip uses the labels (`Major press & research 4 · …`), keeps the dim-at-zero treatment, and only shows tiers present.
- Add under the count strip: `<p className="text-xs text-[var(--text-faint)]">Facts in these posts are grounded in these sources. Stronger sources keep claims accurate and quotable.</p>`
- Per source: when `s.times_cited > 0`, render `Cited in {n} post{s}` as a right-aligned `text-xs text-[var(--text-muted)]` span (the list arrives pre-sorted cited-first from Task 1).
- `TIER_COLORS`/`TIER_LABELS` must index with a fallback (`?? TIER_COLORS.T3`) since `tier` is typed as a union that now also carries `"brand"` — update the `ClusterSourceItem["tier"]` type in `lib/api.ts` to `string` or `"T1" | "T2" | "T3" | "brand"`.
- Same label/fallback treatment in `CitationsSubpanel.tsx` (it shows per-citation tier badges).

- [ ] **Step 2: BriefPanel plain language**

- Framing line inside the expanded panel, above the fields: `The shared strategy behind every post in this cluster. Edit it and regenerate to change all posts at once.` (`text-xs text-[var(--text-faint)]`).
- Display + edit labels: `Positioning` → `The angle`; `Canonical phrasings (appear verbatim across pieces)` → `Core messages (each post rewords these — never verbatim)`; `Key claims` → `Claims we make`; `Narrative spine` → `Story arc`; `Tone notes` → `Tone`. (Edit-mode labels match: `Core messages (one per line)`, `Claims we make (one per line)`, `Story arc`, `Tone`.)

- [ ] **Step 3: Dissolve InputsZone in the page**

In `page.tsx`:
- Remove `InputsZone`, `GapInput`, `OpportunitiesInput` imports and the ZONE 3 block.
- Keep `PillarCard` mounted directly (temporary until Task 10): `{(candidate || cluster.pillar_mode !== "none") && <PillarCard …/>}` after the Brief/Sources grid.
- Remove the `opportunities` state + fetch (Task 10's PieceCard routing replaces the display; the cluster page no longer lists them).
- "Why this matters" strip: keep the `gaps` fetch; under the status row in the header render:

```tsx
{gaps.length > 0 && (() => {
  const g = gaps[0];
  const top = Object.entries(g.competitor_mentions ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  return (
    <div className="mt-1.5 text-sm text-[var(--text-muted)]">
      {g.prompt_visibility !== null && (
        <>You appear in <span className="text-[var(--text-secondary)] font-medium">{Math.round(g.prompt_visibility)}%</span> of AI answers here</>
      )}
      {top.length > 0 && <> · <span className="text-[var(--text-secondary)]">{top.join(", ")}</span> {top.length === 1 ? "is" : "are"} winning this question</>}
    </div>
  );
})()}
```

- Delete the three component files.

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit` → clean. `npm run build` → clean. Load a cluster page via dev servers if available (backend 8001, frontend 3002 with `BACKEND_URL=http://localhost:8001` per CURRENT_STATE note).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/components/content/cluster frontend/app/content frontend/lib/api.ts
git commit -m "feat(content-ui): plain-language sources & brief, why-this-matters strip, inputs zone dissolved"
```

---

### Task 10: Frontend — piece routing lines, owned-site anchor card, angle control

**Files:**
- Modify: `frontend/components/content/cluster/PieceCard.tsx`
- Create: `frontend/components/content/cluster/OwnedSiteCard.tsx` (absorbs PillarCard)
- Delete: `frontend/components/content/cluster/PillarCard.tsx`
- Modify: `frontend/lib/clusterPlatforms.ts`, `frontend/lib/api.ts`, `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`

**Interfaces:**
- Consumes: `ContentDraft.content_brief` + `target_title` (Task 4 schema), `PATCH` angle endpoint (Task 8), `CLUSTER_PLATFORMS` including `owned_site` (Task 7).

- [ ] **Step 1: `lib/api.ts` + `clusterPlatforms.ts`**

- `ContentDraft`/cluster draft type: add `target_title?: string | null` (confirm `content_brief` already typed; add if missing). `ContentClusterDetail` type: add `angle: "auto" | "insider" | "neutral"`.
- New client fn:

```ts
export async function updateClusterAngle(brandId: number, clusterId: number, angle: "auto" | "insider" | "neutral"): Promise<ContentClusterDetail> {
  const { data } = await api.patch(`/clusters/${brandId}/${clusterId}`, { angle });
  return data;
}
```

- `clusterPlatforms.ts`:

```ts
export const CLUSTER_PLATFORMS: readonly string[] = ["owned_site", "linkedin", "medium", "reddit", "quora", "x"];
export const CLUSTER_PLATFORM_LABELS: Record<string, string> = {
  owned_site: "Your site", linkedin: "LinkedIn", medium: "Medium",
  reddit: "Reddit", quora: "Quora", x: "X",
};
```

- [ ] **Step 2: PieceCard routing line**

Replace the current `content_brief` footnote link block with a prominent destination row (still above the actions divider):

```tsx
{draft && (platform === "reddit" || platform === "quora") && draft.content_brief && (
  <a
    href={draft.content_brief.startsWith("r/") ? `https://reddit.com/${draft.content_brief}` : draft.content_brief}
    target="_blank" rel="noopener noreferrer"
    className="mt-2 flex items-start gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[rgba(148,163,184,0.06)] px-2.5 py-2 text-xs font-medium text-[var(--accent-foreground)] hover:border-[var(--accent-foreground)]"
    title={platform === "reddit"
      ? (draft.content_brief.startsWith("r/") ? "Suggested subreddit for this post" : "A real thread this comment answers — reply there")
      : "A real Quora question this answers"}
  >
    <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" />
    <span className="min-w-0">
      {platform === "reddit" && draft.content_brief.startsWith("r/") && <>Post in <span className="font-semibold">{draft.content_brief}</span></>}
      {platform === "reddit" && !draft.content_brief.startsWith("r/") && <>Reply in this thread{draft.target_title ? <>: <span className="font-semibold line-clamp-2">“{draft.target_title}”</span></> : null}</>}
      {platform === "quora" && <>Answer{draft.target_title ? <>: <span className="font-semibold line-clamp-2">“{draft.target_title}”</span></> : " this Quora question"}</>}
    </span>
    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 mt-px" />
  </a>
)}
```

Also render the platform `disclaimer`-style hint? No — YAGNI; posting tips already live in the expanded modal flow elsewhere. Skip.

- [ ] **Step 3: OwnedSiteCard**

`OwnedSiteCard.tsx` wraps a `PieceCard` for `platform="owned_site"` with pillar states above it:

```tsx
"use client";

import { Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptClusterPillar, rejectClusterPillar, type ContentClusterDetail, type ContentDraft, type PillarCandidate } from "@/lib/api";
import { useState } from "react";
import { PieceCard } from "./PieceCard";

interface Props {
  brandId: number;
  cluster: ContentClusterDetail;
  candidate: PillarCandidate | null;
  draft: ContentDraft | null;
  onClusterUpdated: (c: ContentClusterDetail) => void;
  onDraftUpdated: (d: ContentDraft) => void;
}

export function OwnedSiteCard({ brandId, cluster, candidate, draft, onClusterUpdated, onDraftUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const showProposal = cluster.pillar_mode === "proposed" && !!candidate && !draft;

  return (
    <div className="flex flex-col gap-2">
      {cluster.pillar_mode === "attached" && cluster.pillar_url && (
        <div className="rounded-md border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.06)] px-3 py-2 text-xs text-[var(--text-secondary)] flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-[#4ade80] shrink-0" />
          <span className="min-w-0 truncate">
            Anchored to{" "}
            <a href={cluster.pillar_url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--text-primary)]">
              {cluster.pillar_url}
            </a>
          </span>
          <ExternalLink className="h-3 w-3 shrink-0 text-[var(--text-faint)]" />
        </div>
      )}
      {showProposal && (
        <div className="rounded-md border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.05)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <div className="mb-1.5">
            Your site already has a page for this question:{" "}
            <a href={candidate!.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--text-primary)]">
              {candidate!.title ?? candidate!.url}
            </a>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={async () => {
              setBusy(true);
              try { onClusterUpdated(await acceptClusterPillar(brandId, cluster.id)); } finally { setBusy(false); }
            }}>Use existing page</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              setBusy(true);
              try { onClusterUpdated(await rejectClusterPillar(brandId, cluster.id)); } finally { setBusy(false); }
            }}>Write a new page instead</Button>
          </div>
        </div>
      )}
      <PieceCard brandId={brandId} clusterId={cluster.id} platform="owned_site" draft={draft} onUpdated={onDraftUpdated} />
    </div>
  );
}
```

In `page.tsx`, the Posts grid renders `OwnedSiteCard` for `owned_site` and `PieceCard` for the rest; delete `PillarCard.tsx` and its temporary mount from Task 9. "Generate refreshed draft" when attached = the PieceCard's existing Generate/Rewrite button (no extra UI).

- [ ] **Step 4: Angle segmented control**

In `page.tsx` header actions row (next to Rewrite/Start fresh):

```tsx
const ANGLES = [
  { key: "auto", label: "Auto", tip: "Insider voice on LinkedIn/Medium/X; neutral on Quora and strict subreddits" },
  { key: "insider", label: "Insider", tip: "Openly affiliated voice — first-person experience, casual disclosure when endorsing" },
  { key: "neutral", label: "Neutral", tip: "Independent-practitioner voice — the brand appears as one option among alternatives" },
] as const;

const [savingAngle, setSavingAngle] = useState(false);

async function setAngle(a: "auto" | "insider" | "neutral") {
  if (!cluster || a === cluster.angle) return;
  setSavingAngle(true);
  try { setCluster(await updateClusterAngle(brandId, clusterId, a)); }
  finally { setSavingAngle(false); }
}
```

```tsx
<div className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] p-0.5" role="radiogroup" aria-label="Content voice">
  <span className="px-1.5 text-[11px] text-[var(--text-faint)] font-semibold uppercase tracking-wider">Voice</span>
  {ANGLES.map((a) => (
    <button key={a.key} role="radio" aria-checked={cluster.angle === a.key} title={a.tip}
      disabled={savingAngle || isActive}
      onClick={() => setAngle(a.key)}
      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
        cluster.angle === a.key
          ? "bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}>
      {a.label}
    </button>
  ))}
</div>
```

Plus a hint when pieces exist and the angle changed since generation — simplest honest version: after a successful `setAngle` to a non-current value while `hasContent`, show a one-line note under the buttons: `Applies when you rewrite the posts.` (static text rendered whenever `cluster.angle !== "auto"` is fine too — pick the simplest that reads clearly; do NOT track brief-version-style dirty state for this).

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npx tsc --noEmit && npm run build` → clean.

```bash
git add -A frontend
git commit -m "feat(content-ui): routing destinations on piece cards, owned-site anchor card, voice angle control"
```

---

### Task 11: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Content Clusters section), `CURRENT_STATE.md`

- [ ] **Step 1: Full backend suite**

Run: `cd backend && source venv/bin/activate && pytest tests/ -q`
Expected: green except known pre-existing `test_client_portal` + `test_prompt_intelligence`.

- [ ] **Step 2: Frontend gates**

Run: `cd frontend && npx tsc --noEmit && npm run build && npm run lint` — clean on touched files (35 pre-existing agency lint errors are known).

- [ ] **Step 3: End-to-end sanity (if local servers available)**

Backend on 8001, frontend on 3002 (`BACKEND_URL=http://localhost:8001`). Open a cluster: verify plain-language sources/brief, why-this-matters strip, 6 piece slots with owned-site first, voice control persists, no Inputs zone.

- [ ] **Step 4: Docs**

- `CLAUDE.md` Content Clusters section: platforms now `owned_site, linkedin, medium, reddit, quora, x`; reddit routes to real threads via ContentOpportunity when available; `ContentCluster.angle`; `ContentDraft.target_title`.
- `CURRENT_STATE.md`: session summary per its update protocol.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CURRENT_STATE.md
git commit -m "docs: cluster-detail overhaul shipped — clusters gain owned-site anchor, thread routing, angle control"
```

---

## Self-Review Notes

- **Spec coverage:** 1a→T1+T9; 1b→T9; 1c→T9; 1d→T2; 1e→T3; WS2→T4+T5+T6+T10; WS3→T7+T10; WS4→T8+T10; testing/docs→T11. Schema-field bug (cluster drafts missing `content_brief`) → T4.
- **Ordering:** T2 before T6 (`reddit_comment`); T4 before T6/T8/T10; T7 before T10 (platform list); T9 before T10 (page cleanup before card additions).
- **Type consistency:** target dict keys (`brief`, `target_title`, `platform_key_override`, `opportunity_id`, `subreddit`, `opportunity`, `brief_append`) — T6 defines, T8 consumes `subreddit`; `effective_angle`/`angle_directive` signatures match between T8 backend and tests.
- **Known judgment calls for implementers:** test seed/auth idioms must be copied from the real test files (marked inline); patch targets for scanner/quora helpers must match local-import lookup sites.
