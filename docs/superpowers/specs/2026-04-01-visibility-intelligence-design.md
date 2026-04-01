# Visibility Intelligence Platform — Design Spec

**Status:** Vision document, build post-launch  
**Created:** 2026-04-01  
**Context:** Brainstorm session exploring content posting friction, visibility feedback loops, and long-term product direction

---

## Problem Summary

Two core pain points surfaced:

### 1. Content Posting Friction
Users generate drafts but face significant barriers to posting:
- Reddit karma requirements
- Subreddit-specific COI disclosure rules
- Wikipedia talk page etiquette
- Content removal (low karma, automod, shadowbans)
- No feedback on whether posted content is still live

### 2. Broken Feedback Loop
Users don't know if their efforts are working:
- Visibility changes are slow (especially INDEX_MODELS: ChatGPT, Claude)
- No way to attribute visibility changes to specific content
- Users check scores, see no change, don't know if they should keep going
- No realistic expectation-setting about timelines

### Root Cause
**Lumidian helps users take action but doesn't close the loop.** Users are left guessing whether their content survived, when to expect results, and what actually worked.

---

## Strategic Insight

Through brainstorming, we identified that the real opportunity is not better content tools — it's **visibility intelligence**.

**Current positioning:** "We help you create content to improve AI visibility"

**Stronger positioning:** "We help you understand what actually drives AI visibility — and then act on it"

The content tools become ONE lever, not the whole product. The intelligence layer becomes the moat.

---

## The Vision: Intelligence Platform

### What It Does

1. **Signal Monitoring** — Passively watch for events that could affect visibility:
   - Owned content changes (sitemap monitoring)
   - Reddit/Quora mentions (brand name search, content fingerprinting)
   - News coverage
   - Wikipedia presence
   - GitHub/Stack Overflow (for tech brands)
   - Competitor moves

2. **Visibility Change Detection** — Flag when visibility changes significantly (already exists via tracking runs)

3. **Correlation Engine** — When visibility changes, look back 14-30 days for preceding events. Record correlations.

4. **Collective Learning** — Aggregate patterns across ALL brands on the platform:
   - "News mentions correlate with Perplexity lift 72% of the time"
   - "Wikipedia presence correlates with ChatGPT visibility 3x more than Reddit posts"
   - "For B2B SaaS brands, owned content outperforms Reddit 4:1"

5. **Dynamic Recommendations** — Based on what's worked for similar brands:
   - "Brands like yours saw 23% lift from publishing a direct-answer blog post"
   - "Reddit posts haven't correlated with visibility gains for brands in your space"

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXISTING LUMIDIAN                          │
├─────────────────────────────────────────────────────────────────┤
│   Tracking Tab          Content Tab           Results Tab       │
│   • Brand setup         • Drafts              • Per-run data    │
│   • Prompts             • Opportunities       • Transcripts     │
│   • Run visibility      • Gap analysis        • Trends          │
└─────────────────────────────────────────────────────────────────┘
                              │
              (feeds visibility data into)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEW: INTELLIGENCE TAB                        │
├─────────────────────────────────────────────────────────────────┤
│   Signal Monitor          Insights              Recommendations │
│   • Owned content         • Visibility          • What to do    │
│   • News mentions           changelog           • Why it works  │
│   • Reddit/Quora          • What caused         • Link to       │
│   • Wikipedia               changes?              Content tab   │
│   • GitHub                • Cross-brand           if relevant   │
│   • Competitors             patterns                            │
│                                                                 │
│   COLLECTIVE LEARNING: Aggregates patterns across all brands    │
│   "Based on 500 brands, here's what moves the needle..."        │
└─────────────────────────────────────────────────────────────────┘
```

### Model Categories (Important for Expectation-Setting)

| Model | Type | Feedback Speed | What Influences It |
|-------|------|----------------|-------------------|
| Perplexity | LIVE_MODEL | Days | Web content, recent mentions |
| Gemini | LIVE_MODEL | Days | Web content, recent mentions |
| ChatGPT | INDEX_MODEL | Months | Training data, high-authority sources (Wikipedia, news) |
| Claude | INDEX_MODEL | Months | Training data, high-authority sources |

**Implication:** LIVE_MODELS provide fast feedback for learning. INDEX_MODELS require patience and higher-authority content.

---

## The Content Journey (User-Facing Concept)

A unified view per draft that answers all user questions:

```
Draft created: Mar 28
      ↓
Posted: Mar 29 (detected on r/startups)
      ↓
Status: ✓ Still live (checked 2 hours ago, 12 upvotes)
      ↓
Platform: Reddit
  • LIVE_MODEL impact: expect changes in 3-7 days
  • INDEX_MODEL impact: next training cycle (months)
      ↓
Visibility before: 32% on "best compliance software"
      ↓
Visibility now (Day 7): 38% on Perplexity (+6pp) ✓
                        32% on ChatGPT (unchanged, expected)
      ↓
Status: Likely attributed to this post
      ↓
Recommendation: Perplexity improved. ChatGPT won't reflect this 
until their next update. Consider Wikipedia for INDEX_MODEL impact.
```

**This closes the feedback loop:**
- Is it still alive? → Yes/No with last-checked timestamp
- When will I see changes? → Platform-specific timeline
- Did it work? → Before/after comparison
- What next? → Contextual recommendation

---

## Build Phases

### Phase 0: Expected Timelines (Quick Win)
**Effort:** ~1 day  
**When:** Can do anytime, even before launch

Add static copy to existing UI explaining LIVE vs INDEX models:
- On tracking results: "Perplexity/Gemini reflect recent web content. ChatGPT/Claude update less frequently."
- On content drafts: "Reddit/Quora content typically affects LIVE_MODELS within 1-2 weeks."

No new features, just education.

---

### Phase 1: Signal Logging (The Seed)
**Effort:** ~1 week  
**When:** Post-launch, when ready

Build the data collection infrastructure with NO user-facing UI.

#### New Models

```python
class VisibilitySignal(Base):
    """External events that may affect visibility."""
    id: int
    brand_id: int (FK)
    signal_type: str  # 'news_mention', 'reddit_mention', 'owned_content', 'wikipedia', etc.
    source_url: str (nullable)
    detected_at: datetime
    metadata: JSON  # platform, title, snippet, etc.

class DraftFingerprint(Base):
    """Distinctive phrases for passive content detection."""
    id: int
    draft_id: int (FK)
    phrase: str  # 8-12 word distinctive phrase
    
class DraftVerification(Base):
    """Tracks whether draft was posted and where."""
    id: int
    draft_id: int (FK)
    status: str  # 'unverified', 'detected', 'confirmed_removed', 'expired'
    detected_url: str (nullable)
    detected_at: datetime (nullable)
    last_checked_at: datetime
    is_still_live: bool (nullable)
```

#### Background Jobs

1. **Draft fingerprinting** — On draft creation, extract 2-3 distinctive phrases
2. **Content detection scan** (weekly) — Search for fingerprints via Serper, mark as detected
3. **Content survival check** (weekly) — For detected content, verify still accessible
4. **External mention scan** (weekly) — Search for brand name on news, Reddit, Quora, Wikipedia
5. **Owned content scan** (weekly) — If sitemap provided, check for new/changed pages

#### Cost Estimate
- ~$0.03-0.05 per draft for fingerprint scanning
- ~$0.50-1.00 per brand per week for external mention scanning
- Total: ~$3-5 per active brand per month

---

### Phase 2: Visibility Changelog (Per-Brand Attribution)
**Effort:** ~2 weeks  
**When:** After Phase 1 has collected data for a few months

Build the correlation engine and basic UI:
- When visibility changes ≥10pp, look back 14 days for signals
- Surface possible causes: "Visibility improved. 5 days ago: blog post detected."
- Per-brand only, no collective learning yet

---

### Phase 3: Content Journey UI
**Effort:** ~1-2 weeks  
**When:** After Phase 2, if users want it

Build the unified per-draft view showing:
- Post status (detected? still live?)
- Expected timelines
- Before/after visibility
- Attribution confidence

---

### Phase 4: Collective Intelligence
**Effort:** ~3-4 weeks  
**When:** When you have 50+ active brands

Aggregate patterns across all brands:
- Which signal types correlate most with visibility changes?
- Segment by brand type, industry, etc.
- Surface benchmarks: "You: 45%, Similar brands: 60%"
- Dynamic recommendations based on what works

---

### Phase 5: ML-Powered Insights (Future)
**Effort:** TBD  
**When:** When you have substantial data

- Evolving signal weights based on observed correlations
- Predictive: "If you do X, expected impact is Y%"
- Anomaly detection: "Unusual visibility drop detected"

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Start with signal logging, no UI | Collect data cheaply, defer commitment to full vision |
| Passive detection over "I posted" button | More reliable, no user action required |
| Focus on LIVE_MODELS first for attribution | Faster feedback loop, cleaner signal |
| Defer collective learning until 50+ brands | Need volume for statistical significance |
| No ML initially | Need training data first; simple correlations are enough to start |

---

## What NOT to Build (For Now)

- Auto-posting to Reddit/Quora (ToS risk, ethical concerns)
- Karma-building features (scope creep)
- Full ML pipeline (premature without data)
- Done-for-you posting marketplace (big business model pivot)

---

## Open Questions (Revisit Post-Launch)

1. Do users actually care about attribution, or do they just want "do this, get results"?
2. Is the intelligence positioning compelling enough to be a differentiator?
3. What's the right pricing for intelligence features vs content features?
4. Should owned content optimization be a separate product/tier?

---

## Immediate Actions (Pre-Launch)

1. **Add expected timelines copy** — Explain LIVE vs INDEX models in tracking results and content sections (~1 day, low risk)

2. **Document the vision** — This spec (done)

3. **After launch:** Revisit Phase 1 (signal logging) when ready to invest ~1 week

---

## Related Ideas Explored But Deferred

### Platform Expansion
Other platforms that may matter for GEO:
- GitHub (for dev tools)
- Stack Overflow
- YouTube transcripts
- Podcasts transcripts
- Hacker News
- LinkedIn articles
- Industry directories (G2, Capterra)

**Decision:** Don't expand platforms until we understand which ones actually correlate with visibility.

### Owned Content Analyzer
Analyze user's blog/docs for GEO optimization:
- Does any page directly answer tracked prompts?
- Are there obvious content gaps?
- Recommendations for new pages

**Decision:** Interesting but separate feature. Could be Phase 3+.

### Managed Service / Marketplace
Connect brands with high-karma posters for done-for-you posting.

**Decision:** Too risky (ToS, ethics) and too big a business model shift. Not pursuing.
