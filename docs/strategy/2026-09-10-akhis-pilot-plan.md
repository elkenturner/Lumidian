# Akhis pilot: step-by-step plan

**Client:** Akhis Authentic Shawarma & Kebab, Turquoise St, North Pacific Beach, San Diego. Contact Malik, eatakhis@gmail.com. Site: akhisshawarma.com.
**Lumidian records:** agency client 1 ("Akhis"), brand 15 (`akhis shawarma & kebab`, type pitch, 10 prompts, 2 runs).
**Purpose of the pilot:** learn the delivery loop and produce the first honest before-and-after. Revenue is secondary.
**Date:** 2026-09-10. Ninety-day window: kickoff week of Sep 14, final report week of Dec 14.

---

## 1. What we found before talking to Malik

Two runs so far (Sep 5 and Sep 7), Perplexity and Gemini only, because the brand is a pitch brand on the free model list.

**Gemini already names Akhis.** On "Where to find authentic shawarma near Pacific Beach," Gemini listed "Akhi's Authentic Shawarma & Kebab" first in both sampled runs. The tracker scored it 0% because the stored brand name is "akhis shawarma & kebab" and the matcher needs the words in order. Fix: rename the brand to the full official name, `Akhis Authentic Shawarma & Kebab`. The normalized matcher strips the apostrophe, so both "Akhis" and "Akhi's" spellings then match.

**Who the AI names instead.** Cafe Athena, Micheline's Pita House, Slowly, Spitz, Shawarma Shack, Mr. Shawarma, Shawarma House (Ocean Beach), The Shawarma Guys, Mystic Grill. These become the peer pool.

**What the AI reads to answer these ten questions** (citation counts across both runs):

| Source | Citations | Type | Akhis on it? |
|---|---|---|---|
| tripadvisor.com | 117 | review directory | check |
| reddit.com | 74 | forum | check r/sandiego threads |
| yelp.com | 54 | review directory | check |
| pitahousesd.com, shawarmahousesd.com, shawarmashacksd.com | 99 | competitor sites | n/a |
| atly.com | 20 | curated map lists | check |
| lajollamom.com | 20 | local blog, best-of lists | outreach |
| gypsysols.com, meaganlyn.com, blueeyedcompass.com | 40 | travel blogs with PB lists | outreach |
| facebook.com | 14 | listing | check |
| opentable.com | 14 | reservations, ratings | check (Perplexity leans on its ratings) |
| ubereats.com, grubhub.com, postmates.com | 25 | delivery listings | check |
| eater.com, sandiegomagazine.com | 15 | local press lists | outreach |
| sandiego.org, visitcalifornia.com, thesandiegolist.com | 18 | tourism lists | outreach |
| foursquare.com, mapquest.com | 16 | data aggregators | check |
| akhisshawarma.com | 6 | own site | yes |

This table is the outreach list. Everything in the next 90 days is about getting Akhis onto more rows of it, with the same name spelling on every row.

**Name spelling matters.** Gemini wrote "Akhi's". The site and the brand record say "Akhis". Pick one spelling (the one on the storefront and Google Business Profile) and use it everywhere.

### 1.1 Verified presence (checked 2026-09-10 via Google results in a browser and direct fetches)

| Source | Status | Detail |
|---|---|---|
| Google Business Profile | Listed, strong | "Akhis Authentic Shawarma & Kebab", 4.9 stars, 502 reviews, hours confirmed by the business 8 weeks ago, in the 3-pack for "best shawarma pacific beach" |
| Yelp | Listed | 4.8 stars, 147 reviews. Ranked #2 on Yelp's own "Best Shawarma near Pacific Beach" list. Category shown: Mediterranean |
| Uber Eats | Listed | 4.8, 210 ratings |
| Grubhub | Listed | 4.6, 47 votes |
| DoorDash | Listed | "Order Akhis Shawarma & Kebab, 747 Turquoise St" (shorter name spelling) |
| Instagram | Active | @akhisshawarma, 1.1K followers, name shown as "Akhis Shawarma & Kebab" |
| San Diego Union-Tribune | Feature, Nov 6 2025 | "Love of travel and family traditions are behind Akhis"; spells it "Akhis Authentic Shawarma and Kabab" |
| Local interview | Yes | "Hidden Gems: Meet Malik Sayed of Akhis Authentic..." (Voyage-style interview site) |
| Reddit r/sandiego | Thread exists | "Best shawarma spots?" ranks on Google for the query; whether Akhis is named in it is unverified |
| TripAdvisor | Not found | Shawarma Shack (4.7), Mr. Shawarma (4.8, 4 reviews) and Cafe Athena (4.5, ~95 reviews) all have pages. TripAdvisor was the single most-cited domain (117) for these prompts. Free to claim. |
| OpenTable | Not listed, not applicable | Paid reservation platform; counter-service restaurants are not normally on it. Cafe Athena's OpenTable page is a non-bookable stub. |
| La Jolla Mom, Gypsy Sols, Meagan Lyn, Eater SD, SD Magazine, Atly, thesandiegolist | Not found | Site search on lajollamom.com for "shawarma" returned nothing relevant. These are the outreach targets. |
| Website | Good shape | HTML menu with prices (wrap $12.95, bowl $14.95, family platter $59.95 / $119.95), Restaurant and FAQPage JSON-LD, halal statement, hours, phone, address, a "Best Mediterranean food in Pacific Beach" location page. robots.txt allows all bots. No Yelp or delivery links on the site. |

Competitors for scale: Mr. Shawarma Google 4.7 with 2,019 reviews, Yelp 419; Cafe Athena Google 4.6 with 532, Yelp 889; Shawarma Shack Yelp 4.5 with 481.

What this means: listings are mostly done already. The gaps are TripAdvisor, third-party lists and blogs, name consistency across sources, and Yelp category and menu completeness. That is a smaller job than the plan below assumed; budget 25 to 30 hours over 90 days, not 60.

---

## 2. Setup in Lumidian before kickoff (Ken, half a day)

1. Rename brand 15 to `Akhis Authentic Shawarma & Kebab`.
2. Change `brand_type` from pitch to standard so the site audit is allowed and the paid model list applies.
3. Comp the client account to Growth (`subscription_tier = starter`) for the pilot. That adds ChatGPT with web search and Perplexity sonar-pro. ChatGPT is the engine 31% of consumers use for local recommendations; the pilot is meaningless without it. Claude is not needed for a restaurant.
4. Add the peer pool as competitors: Cafe Athena, Shawarma Shack, Mr. Shawarma, Micheline's Pita House, Slowly, Spitz Pacific Beach. Leave Shawarma House and The Shawarma Guys out of the pool (different neighborhoods) but keep an eye on them.
5. Tag prompts (a note in the brand profile until the product has a field):
   - Treatment (the work targets these): 175 best Mediterranean in PB, 176 authentic shawarma near PB, 180 best shawarma in San Diego, 181 gyro or kebab plate in PB, 182 best halal in San Diego.
   - Month-two treatment: 183 vegetarian and vegan in PB, 184 healthy takeout near PB.
   - Holdout (no work aimed here): 177 where should I eat in PB, 178 cheap eats in PB, 179 lunch spots near PB.
6. Set tracking to daily for the first 14 days (baseline) and daily again for the last 14 days of the window. Weekly in between. Prompt 176 shows why: the daily baseline is what lets a per-prompt claim survive.
7. Run the site audit once the brand type is changed. Check crawler access first (robots.txt, any AI bot blocks), then whether the menu and prices are readable as text rather than a PDF or image.
8. Ask Malik for read access to Google Analytics if he has it. If not, install GA4 with a channel group for chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com. Add the site to Google Search Console for the generative AI report.

Product gaps this exposes, to fix during the pilot: brand name aliases; treatment and holdout tags on prompts; per-engine report with ranges; a presence checklist view built from the citation table.

---

## 3. The kickoff conversation with Malik (45 minutes)

Say it in this order.

**What we do.** "When someone asks ChatGPT or Google 'best shawarma in Pacific Beach,' the AI reads a handful of pages, mostly TripAdvisor, Yelp, Reddit and local food blogs, and repeats what they say. Right now Gemini sometimes names you. ChatGPT and Perplexity name Shawarma Shack, Mr. Shawarma and Cafe Athena. Our job is to get you onto the pages the AI reads, make your website answer the questions people ask, and measure every week what the AI says about you and them."

**What we do not do.** No ads. No social media posting. No review management: we give you a script and a cadence, you and your staff ask. No guaranteed placement, because the AI's answers change week to week and we will show you that happening.

**What it costs him.** Pilot terms: 90 days, [free or a token fee, Ken's call], in exchange for case-study rights, a testimonial if it works, and about one hour of his time a week. If it works, the retainer afterwards is $1,000 a month.

**What we need from him.**
- Logins or claimed status for Google Business Profile, Yelp, TripAdvisor, Facebook, OpenTable if listed, and the delivery apps.
- The menu with current prices, and permission to publish prices on the website.
- Access to edit the website, or a person who can paste pages we send.
- The official name spelling, address, phone, hours, and three to five photos.
- His agreement to run the review ask (below) for 90 days.
- Someone at the counter to tally "how did you hear about us" answers on a sheet, including "ChatGPT" or "AI" as an option.

**What success looks like.** Be specific and modest.
- Day 30: listings correct and consistent everywhere, the shawarma page and the halal page live, first outreach sent, baseline report delivered showing where he stands on every question versus the six competitors.
- Day 60: on at least three more of the pages the AI reads. Gemini naming him consistently on the shawarma question. First signs on ChatGPT or Perplexity, or an honest note that there are none yet.
- Day 90: a report that compares the five treatment questions to the three holdout questions and to the six competitors, per engine, with ranges. Either the treatment questions moved and the holdouts did not, or they did not and we say so.
- Business signal: any tally of "found you on ChatGPT" at the counter, any AI referral sessions in GA4. These will be small numbers. Say that now.

**What he should expect to see week to week.** A one-page report every Monday. Some weeks it will go down for reasons that have nothing to do with him. That is normal and the report will show competitors moving the same way when it is the platform, not him.

---

## 4. What Ken measures

All of it comes out of the tracker except the last row.

| Measure | Definition | Where |
|---|---|---|
| Mention rate per engine | Share of non-errored responses naming Akhis, per prompt, per engine. Never pooled across engines. | Tracker |
| Range | Bootstrap interval over responses in the period. Effects under about 5 points are inside the noise. | Report (build) |
| Treatment vs holdout | Change on prompts 175, 176, 180, 181, 182 minus change on 177, 178, 179, per engine. | Report (build) |
| Peer pool | Same mention rate for the six competitors on the same prompts. RVI card already does this. | Tracker |
| Presence score | Number of AI-cited sources Akhis appears on, out of all sources cited for the ten prompts. | Citation table (build the view) |
| Source mix | Which domains each engine cited this week. Shows platform shifts. | Citation table |
| Fetcher hits | OAI-SearchBot, ChatGPT-User, PerplexityBot, Google-Extended hits on new pages. Only if Malik's host exposes logs. | Host logs |
| AI referrals | Sessions from chatgpt.com, perplexity.ai, gemini.google.com. | GA4 channel group |
| Counter tally | "How did you hear about us" answers, weekly count. | Paper sheet, photographed weekly |

Baseline: 14 daily runs, Sep 14 to Sep 27. Final: 14 daily runs, Dec 1 to Dec 14. Weekly in between.

---

## 5. What Ken does, week by week

Hours are estimates for one client.

**Week 0 (Sep 8 to 13), 4 hours.** Section 2 setup. Start daily runs. Draft the kickoff agenda.

**Week 1 (Sep 14 to 20), 6 hours.** Kickoff call. Collect logins, menu, photos, name spelling. Run the site audit. Check every row of the source table by hand: is Akhis listed, is the name spelled the same, is the address and phone the same, are hours current, are prices shown. Record it in a sheet: source, listed yes/no, name matches yes/no, action.

**Week 2 (Sep 21 to 27), 6 hours.** Fix listings: claim or correct Google Business Profile, Yelp, TripAdvisor, Facebook, Foursquare, OpenTable if applicable, the delivery apps. Same name, address, phone, hours, and the shawarma wrap price everywhere that allows a price. Write and send the review script (below). Deliver the baseline report at the end of the week.

**Week 3 (Sep 28 to Oct 4), 6 hours.** Service page 1: "Shawarma in Pacific Beach" on akhisshawarma.com. Prices, what is in each wrap and plate, halal status, hours, address, an updated-on date, and an FAQ block ("Is Akhis halal?", "Do you have vegetarian options?", "How much is a chicken shawarma wrap?", "Where do you park in North PB?"). Generated by the owned-site generator, then edited by hand, then sent to Malik with paste instructions. First outreach batch: five emails.

**Weeks 4 to 6 (Oct 5 to 25), 4 hours a week.** Outreach. Targets in priority order: La Jolla Mom (Pacific Beach and San Diego food lists), Gypsy Sols, Meagan Lyn, Blue Eyed Compass, Atly (submit the spot), The San Diego List, Eater San Diego (tips line), San Diego Magazine (best-of nominations), sandiego.org (restaurant listing), Reddit r/sandiego (answer real "best shawarma" threads as the owner, disclosed, no links). Ask for inclusion in an existing list, offer a photo and a one-line description with the exact name spelling. Track sent, replied, placed. Expect one placement per ten asks.

**Week 7 (Oct 26 to Nov 1), 6 hours.** Service page 2: "Halal and vegetarian Mediterranean in Pacific Beach" aimed at prompts 182, 183, 184. Same structure. Day-45 report: mention rates per engine with ranges, presence score change, outreach placed so far, source mix shifts.

**Weeks 8 to 11 (Nov 2 to 29), 3 hours a week.** Continue outreach. Second pass on any listing that reverted. Check the counter tally and GA4 monthly. Review the review count on Google and Yelp versus Sep 14.

**Week 12 (Nov 30 to Dec 14), 6 hours.** Daily runs. Final report: treatment versus holdout versus peer pool, per engine, with ranges; presence score before and after; placements; review counts; counter tally; AI referrals. One paragraph of plain conclusion. Then the retainer conversation.

Total: about 60 hours across 13 weeks, front-loaded.

---

## 6. The review script (Malik runs it)

At the counter, after the meal or at pickup: "If you liked it, a quick Google review helps us more than anything. It takes a minute." A card or QR code at the register linking to the Google review page. Target: two new Google reviews a week and one Yelp or TripAdvisor review a week. Reply to every review within a week. Reviews decide who the AI names first among the places it already knows.

---

## 7. What Malik receives

- Weekly one-page report every Monday: what the AI said this week, per engine, versus the six competitors, and what changed.
- Day 30: baseline report and the listings sheet showing every source fixed.
- Two service pages, paste-ready.
- The outreach log: who was asked, who placed him.
- Day 90: the before-and-after report.

---

## 8. Risks specific to this client

- Restaurant discovery is the hardest local case. "Where should I eat in PB" is answered from Yelp, TripAdvisor and big lists; that is why those prompts are holdouts. The winnable questions are the specific ones: shawarma, halal, gyro, vegetarian.
- Perplexity leans on OpenTable and TripAdvisor ratings. If Akhis is not on OpenTable, it may never appear there for the broad Mediterranean question. That is fine; report it.
- Platform shifts will happen inside 90 days. The peer pool and holdout prompts are how the report tells the difference.
- Name inconsistency across the web ("Akhi's" vs "Akhis") is the most likely reason the AI splits or drops him. Fixing it is week 2 work and worth more than any page.
- A restaurant is a Tier 3 segment for the paid retainer. The point of this pilot is the proof and the process, not the account.
