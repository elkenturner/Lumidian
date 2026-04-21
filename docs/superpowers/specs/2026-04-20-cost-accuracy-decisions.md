# Cost Reduction + Accuracy Decisions — 2026-04-20

**Status: ALL DECISIONS LOCKED — 2026-04-20.** This doc is the source spec for the implementation plan at `docs/superpowers/plans/2026-04-20-cost-accuracy-overhaul.md` (forthcoming).

## Context

Goal: reduce LLM costs and increase mention-detection accuracy. Triggering observations:
- ChatGPT (gpt-4.1-mini, no web) has only **0.51% mention rate** in prod — basically dead weight
- Gemini-2.5-pro has **28.8% error rate** in prod (already mostly falling back to Flash)
- Visibility queries don't change much hour-to-hour — high run counts add little signal
- Tier value props are unclear after model changes

Prior context: see `memory/project_chatgpt_web_search.md` (3 days old) and `docs/superpowers/plans/2026-04-08-pro-tier-model-upgrades.md` (when pro models were added).

---

## ✅ LOCKED Decisions (data-backed)

### 1. Kill gemini-2.5-pro entirely — use Flash for all tiers
**Why:** Experiment (2026-04-20, 36 queries) showed identical mention rate vs Flash on both test brands (22.2% vs 22.2% on MSC; 0% vs 0% on SpotitEarly). Pro is **2.8x slower** (40s vs 14s avg latency) and ~2.5x more expensive per query. Plus prod 28.8% error rate means most "pro" requests already fall back to Flash via `_FALLBACK_MODELS` in `llm_service.py:425`.
**Savings:** ~$15/month per Pro brand. Better sweep latency.
**Risk:** None — we're killing a feature that's already broken.

### 2. Reduce runs per prompt: 5 → 3 (all tiers)
**Why:** Web models are deterministic (same query → similar search → similar answer). Aggregate score CI is acceptable (±26pp at p=0.3 with 12 trials). Per-prompt views become coarser (33% increments vs 20%) but aggregate trends remain solid.
**Bundle requirement:** Raise visibility-drop alert threshold from 10pp → 15pp (`tracking_service.py:570`) to compensate for finer granularity → noisier alerts.
**Savings:** 40% query volume reduction.

### 3. Switch ChatGPT to `gpt-4o-mini-search-preview` for paid tiers
**Why:** Current ChatGPT contributes 0.51% mention rate (dead weight). Web search will match the actual user experience (ChatGPT app uses Bing, this model uses ChatGPT search). Memory entry from 3 days ago anticipates this — never implemented.
**Bundle requirements:**
- Strip URL citations from response before mention detection (false positives — "stripe.com" in citation footer matches "Stripe" brand even when answer doesn't mention it)
- Don't fall back to non-search ChatGPT on failure (let it fail and retry normally)
- Likely need to bump `max_completion_tokens` from 1024 — search responses are longer

### 4. Skip ChatGPT entirely for pitch brands (free trial)
**Why:** Pitch brands = `brand_type='pitch'`, only exist in free trial. ChatGPT search becomes the upsell wedge. Free users keep 3 models (Claude, Sonar, Gemini Flash).
**Implementation:** Filter SUPPORTED_MODELS by brand_type in `tracking_service.py`.

### 5. Switch overall score formula to avg-of-per-model-scores
**Why:** With pitch brands at 3 models and paid at 4, current `total_mentions / total_queries` formula systematically biases scores by tier (different denominators). Avg-of-per-model fixes this.
**Edge case:** Skip models with 0 queries from the average.
**Risk:** Historical score discontinuity — every existing run will recompute differently. **Open question:** migration strategy (see Open Questions below).

### 6. Lower Pro prompt cap: 100 → 30
**Why:** Pro at 100 prompts × 4 models × 3 runs × 2 sweeps/day = 4,800 queries/day = ~$2,448/mo cost vs $500 revenue (-390% margin at max). 30 prompts is generous and keeps Pro profitable even at saturation.
**Migration:** Existing Pro brands with >30 prompts: grandfather their current count, but block adding more (display "limit reached" once they delete down). Avoid surprise data loss.

### 7. ~~Auto-trigger runs + manual run limit changes~~ — DEFERRED
Out of scope for this overhaul. The cost work is the priority; manual-run UX revisit is a separate brainstorm.

---

## 🔄 REVISED Decisions (changed from earlier in conversation)

### A. Sonar-pro: KEEP for paid tiers (was: kill it) — LOCKED
**Why changed:** Experiment showed material uplift on both test brands:
- MSC: sonar 33.3% → sonar-pro **55.6%** (+22pp)
- SpotitEarly: sonar 22.2% → sonar-pro **33.3%** (+11pp)

Direction is consistent across two unrelated brands. Statistically marginal at n=9 per cell but mechanistically sensible (sonar-pro hits more search results, finds long-tail mentions).
**Sub-question resolved:** Keep current Growth+ gating (paid tiers only). Pitch/free users get base sonar — preserves the upsell wedge alongside locked ChatGPT search.

### B. Bigger validation experiment — DROP
**Why dropped:** Direction is consistent across two unrelated brands. Cost of waiting on a $8 experiment (delayed shipping) > the additional confidence it would buy. We accept the risk and ship now; if paid users complain about score drops post-rollout, we revisit.

---

## 🆕 New Items Surfaced (not in original ask)

### C. Citation stripping for ChatGPT search
Bundled with decision #3 above. Don't ship search without it.

### D. Sweep latency budget
Once gemini-pro is killed, recheck:
- `_GEMINI_TIMEOUT = 90.0` — could tighten to 60s for Flash-only
- `_GEMINI_PRO_TIMEOUT = 120.0` — delete (no more pro)
- `MAX_CONCURRENT = 10` — may need raising as ChatGPT search adds 10–15s/query

### E. Tier strategy is weak in the middle
**NOT FOR THIS SPEC.** Starter ($100) → Growth ($300) jump mostly buys sonar-pro + small bumps. Predates this work, doesn't get worse. Defer to a separate brainstorm once we have 30+ paid customers and real usage data. With ~5 active brands in prod today, pricing tier optimization is premature.

---

## ✅ Resolved Questions

1. ~~Bigger experiment first?~~ → **DROP.** Ship on existing data.
2. ~~Sonar-pro Growth+ or Pro-only?~~ → **Growth+** (current behavior, keep paid-only gating).
3. ~~Avg-of-per-model migration?~~ → **Cutover date.** Per-model scores still display separately (formula change only affects the OVERALL roll-up). Trend chart will show a step change at switchover; we accept that. No historical recompute.
4. ~~Auto-trigger debounce?~~ → **DEFERRED.** Auto-trigger feature is out of scope for this overhaul; revisit in a follow-up.
5. ~~Pitch first-run full 5-runs?~~ → **No, keep 3.** Lighter trial is acceptable; the lock-out + upsell story does the conversion work.

---

## Cost Impact Summary (with all LOCKED + REVISED decisions)

| Tier | Current $/brand/day | Proposed $/brand/day | Savings |
|------|---------------------|---------------------|---------|
| Free (pitch) | ~$3.00 | ~$0.75 | **~75%** |
| Starter | ~$1.30 | ~$1.40 | -8% (added ChatGPT search) |
| Growth | ~$2.50 | ~$1.64 | **~34%** |
| Pro | ~$2.50 | ~$1.64 | **~34%** |

Note: Starter slightly INCREASES because they gain ChatGPT search but don't have sonar-pro to remove.

---

---

## 💰 Real Margin Analysis (added 2026-04-20)

### Today's snapshot (1 Pro user, 4 free)

| | Amount |
|---|---|
| MRR | $500 |
| Total monthly costs (LLM + Stripe + hosting) | ~$120 |
| **Gross margin** | **$380 (76%) — healthy** |

### At 100 customers (50 Starter / 30 Growth / 20 Pro), modeled

| Scenario | Revenue | LLM | Free trials | Other | **Margin** |
|----------|---------|-----|-------------|-------|-----------|
| Status quo (current settings) | $24,000 | $11,200 | $7,500 | $2,400 | **$2,900 (12%)** ❌ |
| With proposed cost changes | $24,000 | $5,500 | $1,900 | $2,400 | **$14,200 (59%)** ✅ |

**Conclusion:** today's margins are healthy because n=1. Without the cost work, scaling collapses margins to 12%. With it, 59%.

### 🚨 Max-usage profitability problem (TIER_LIMITS in `billing.py:49`)

Real prompt caps: Starter=15, Growth=25, Pro=100×2 brands. Cost at max usage with proposed changes (3 runs, 4 models, 2 sweeps/day):

| Tier | Queries/day at max | Cost/mo at max | Revenue | Margin at max |
|------|--------------------|----------------|---------|---------------|
| Starter | 360 | $151 | $100 | **−$51 (−51%)** ❌ |
| Growth | 600 | $306 | $300 | −$6 (breakeven) ⚠️ |
| Pro | 4,800 | $2,448 | $500 | **−$1,948 (−390%)** 🚨 |

**Average users are profitable** (current Pro user uses $95/mo on $500 revenue = 81% margin), **but the pricing structure permits catastrophic loss at max usage.** As you scale, power users will hit caps.

### Proposed fixes (need decision)

1. **Lower prompt caps:** e.g., Starter 8, Growth 18, Pro 30 × 2 brands.
2. **Tier-based sweep frequency:** Starter 1x/day, Growth+ 2x/day. Adds freshness as a differentiator AND halves Starter cost.
3. **Remove ChatGPT search from Starter:** keep it Growth+ as upsell. Cuts Starter cost ~30%.
4. **Per-prompt overage:** base prompts free, extra ones priced. Cleanest but more billing work.

**Recommendation:** option (2) + lower Pro prompt cap to 30. Tier-frequency = clean differentiator + solves Starter; lower Pro cap because 100 prompts is too generous regardless.

---

## Recommended Next Steps

1. **You review this doc.** Mark items LOCKED / REVISE / DROP.
2. **Resolve max-usage tier sizing** (the new section above) — pick fix option(s).
3. **Run bigger experiment** ($8, ~30 min) to lock sonar-pro decision.
4. **Resolve open questions 1–5** above.
5. **Then** I write the implementation spec (`writing-plans` skill).
6. **Defer** the broader tier-strategy question (Starter↔Growth weakness) to a separate brainstorm.
