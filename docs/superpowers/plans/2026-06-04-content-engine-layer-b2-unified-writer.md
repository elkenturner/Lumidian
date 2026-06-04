# Layer B2 — Unified Writer — Plan (FOR REVIEW before any code)

> **Status: awaiting Ken's approval of the approach.** This is the high-blast-radius work (it changes what ships to client draft queues), so per the B-spec it gets reviewed before code. Per-phase TDD step detail is expanded at execution time — this doc is for approving the **approach, scope, and sequencing**.

**Spec:** `docs/superpowers/specs/2026-06-03-content-engine-layer-b-design.md`
**Changelog it applies:** `docs/strategy/research/contradictions.md`
**Reuses:** `drafting/anti_ai.py`, `drafting/owned_site.py` (already built + tested)

---

## The reframe (why this is integration, not a rewrite)

The shared core **already exists**: `drafting_service._generate_with_new_pipeline` runs evidence → write → critic → rewrite → voice → cite, tier-gated. Cluster pieces and the new gap-draft path already route through it. B2 does **not** build a new engine. It:

1. Plugs the **new rules** into that core (anti-AI gate, corrected platform rules, first-class voice).
2. Routes the **4 stragglers** that currently bypass it through it.
3. Deletes the **legacy duplicate**.
4. Adds **owned-site** + **per-customer defaults**.

No user-facing feature is removed. Every entry point (cluster button, generate button, opportunity reply, weekly job, Wikipedia) keeps working — it just calls the shared core.

### Current fragmentation (verified in code)
| Path | Location | Routes through core? |
|------|----------|----------------------|
| Cluster pieces | `clustering_service.py:165` | ✅ yes |
| Gap draft (paid) | `drafting_service.py:978` | ✅ yes |
| Free/pitch single-shot fallback | `drafting_service.py:~1006` | ❌ bypasses (direct `call_claude`) |
| Opportunity reply | `drafting_service.py:~1199` | ❌ own path |
| Wikipedia | `drafting_service.py:~804` | ❌ own prompt+parser |
| Legacy `generate_draft` | `content_service.py` | ❌ bypasses entire pipeline; uses stale `PLATFORM_GUIDELINES` |

---

## Phased plan (each phase independently shippable + tested + reviewable)

Sequenced lowest-risk / highest-value first. We can stop, review, and ship after **any** phase.

### Phase 0 — Universal anti-AI gate  *(low risk, high value)*
Add a single `finalize_draft(text, *, regenerate=…)` post-step that runs `anti_ai.autofix` → `anti_ai.scan` → (regenerate-with-feedback up to N) → flag-for-review if still failing. Call it at the end of `_generate_with_new_pipeline` **and** each straggler path. Result: every draft, every path, every tier passes the anti-AI gate before it's stored.
- **Files:** `drafting_service.py` (new `finalize_draft`, call sites), reuse `anti_ai.py`.
- **Risk:** changes draft *text* in prod (autofix + possible regen). Mitigate: log before/after, make the regen loop bounded, flag-not-block on persistent failure (never drops a draft).
- **This is the "option A" Ken deferred — now done inside the reviewed B2.**

### Phase 1 — First-class voice / guidelines  *(low risk)*
Generalize voice from Pro-only bolted-on (`select_voice_sample`) to a first-class `voice` input on the core + `build_prompt`, available to all tiers, sourced from BrandProfile (`tone_of_voice`/`approved_language`) or a new optional per-brand voice/guidelines field. Threaded **before** the anti-AI gate so the gate validates already-voiced text.
- **Files:** `drafting/prompts.py` (`build_prompt` voice param — already has `voice_sample`; promote it), `_generate_with_new_pipeline`, optionally a small migration for a `brand_voice` field.
- **Risk:** low — additive input; default behavior unchanged when no voice set.

### Phase 2 — Apply the contradictions changelog to the rules  *(low risk, pure rule edits)*
Update `drafting/platforms.py` + `prompts.py` per `contradictions.md`: fix Medium "no headers" → require H2/H3; fix Reddit anti-Q&A → allow Q&A; demote/remove NO-EVIDENCE arbitrary rules; reframe verbatim canonical-phrasing → consistent-entity (avoid keyword-stuffing penalty); keep the CONFIRMED rules (answer-first, evidence-grounding, hedging ban). Retire the FP-prone bits now covered by the citation-driver + anti-AI families.
- **Files:** `drafting/platforms.py`, `drafting/prompts.py`. Covered by anti-AI gate + new tests.
- **Risk:** low — rule-text changes; output quality should improve per the evidence.

### Phase 3 — Route the stragglers through the core  *(medium risk — the real consolidation)*
- **3a Free/pitch fallback:** give the un-gated tiers a lightweight pass *through the core* (skip paid-only layers but share prompt-building + finalize), instead of the parallel single-shot block.
- **3b Opportunity replies:** route `generate_opportunity_draft` through the core with an `opportunity_context` (the core already accepts this param).
- **3c Wikipedia:** keep its specialized prompt/parser (it's legitimately different — neutral, sourced) but route its output through `finalize_draft`.
- **Risk:** medium — touches live generation for 3 paths. Mitigate: one sub-phase at a time, snapshot-compare output on a sample of real prompts before/after, keep behavior parity except the intended rule changes.

### Phase 4 — Retire the legacy duplicate  *(medium risk)*
Trace every caller of `content_service.generate_draft` (routers `content.py`/`agency.py`/`admin.py`), repoint them to the unified path, then delete `content_service.PLATFORM_GUIDELINES` + the legacy `generate_draft`. Eliminates the second source of truth.
- **Risk:** medium — ensure no router silently depends on legacy behavior. Mitigate: caller-by-caller, test each.

### Phase 5 — Owned-site platform  *(additive)*
Wire `owned_site` as a real draft platform: add it to platform specs, route generation through `owned_site.build_owned_site_prompt` via the core, surface it in the draft UI/persistence as a platform. The generator + JSON-LD already exist (B1).
- **Risk:** low — additive new platform.

### Phase 6 — Per-customer-type platform defaults  *(additive)*
Make the default platform set configurable per customer type: agency = full breadth (incl. X-for-optics); SaaS self-serve = owned-site-first. A config/policy layer the entry points read.
- **Risk:** low — config; explicit per-surface defaults.

---

## Recommended sequencing for review
- **Approve Phases 0–2 first** (low risk, high value: live anti-AI + voice + corrected rules). Ship and observe.
- **Then Phases 3–4** (the actual consolidation) with output snapshot-comparison checkpoints.
- **Then 5–6** (additive features).

Each phase: TDD, full backend suite green, output spot-checked on real prompts, committed separately. I expand each phase into bite-sized TDD steps when we start it.

## Risks (overall)
- **Live draft output changes** (Phases 0–4). Mitigation baked in: bounded regen, flag-not-drop, before/after snapshot comparison on real prompts, phase-by-phase shipping.
- **Hidden legacy dependency** (Phase 4). Mitigation: caller-by-caller tracing + tests.
- **Free tier** currently skips the paid pipeline by design (cost). Phase 3a must keep cost bounded (no evidence-pack/critic for free) while still gaining the gate + corrected rules.

## Open questions for Ken
1. Approve the phased approach + the "stop-and-ship after any phase" model?
2. Start with **Phase 0 (universal anti-AI gate)** as the first shippable slice?
3. Voice source for Phase 1 — reuse existing BrandProfile fields, or add a dedicated per-brand voice/guidelines field (paste a sample / upload guidelines)?
