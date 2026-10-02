# Lumidian Index: is it worth building?

*Five validation questions, answered with outside evidence. Ken, September 2026.*

The idea under test: a public website where anyone can see what ChatGPT, Gemini and Perplexity recommend for any category in any city, sampled repeatedly and dated, and where a business can claim its page for $29 a month to track itself, see the pages the AI reads that it is missing from, and get an alert when the AI says something wrong about it.

Every number below comes from a public study, a company's own published figures, or a page I checked myself. Where I could not verify something, I say so. Nothing comes from our own software.

## 1. Is the problem severe enough?

There are two problems inside this idea and they are not equally severe.

**Problem A: "Am I recommended by AI?"** Today this costs most small businesses little money. AI assistants send about 1% of website traffic (Conductor, 3.3 billion sessions, 2025). For a restaurant, a missed AI recommendation is a missed handful of customers a month. Nobody loses sleep over it yet.

But it is growing fast and the gap is large. 45% of US consumers say they used an AI assistant to find a local business this year, up from 6% the year before (BrightLocal survey, 1,002 adults). Half of American adults use AI chatbots and the top use is looking things up (Pew, 5,119 adults, 2026). Across 350,000 business locations, a location shows up in Google's map pack 36% of the time and is recommended by ChatGPT 1.2% of the time (SOCi, 2026). For a high-ticket business it is already real money: a dentist's new patient is worth thousands, and dentists, lawyers and home-service companies already pay agencies $1,000 to $3,000 a month for visibility.

**Problem B: "Is the AI wrong about me?"** This one costs money today. A full-market audit of 4,776 restaurants found AI assistants recommending 93 venues that had closed, hedging in 62% of answers, and misunderstanding prices almost completely (the same audit and a separate dentist study scored AI's grasp of pricing at 0.04 out of 1). Wrong hours or "closed" in an AI answer is a customer who does not show up. People have sued over false AI statements about them (Walters v. OpenAI, 2023; a Minnesota solar company sued Google in 2025 over an AI Overview, reported but I could not load the filing today). There is no product under $100 a month that tells a small business when this happens.

**Verdict:** Problem A is nice-to-have for a coffee shop today, closer to mandatory for a dentist, and mandatory for everyone in two or three years if adoption keeps its pace. Problem B is a real, current loss with no cheap fix. Lead with B in the pitch, sell A as the upside.

## 2. Will they pay for it today?

Evidence that small businesses pay for this kind of thing:

| Signal | Number | Source |
|---|---|---|
| Businesses paying a $25 to $79 a month AI visibility tracker | 5,000+ (self-reported, unverified) | Scope.online, checked Sep 11 2026 |
| Businesses paying to be visible on a public directory | 510,000 paying advertising locations in Q2 2026 | Yelp press fast facts |
| Big vendor entering at the low end | HubSpot AEO at $50 a month, launched from a free grader | HubSpot, checked Sep 11 2026 |
| Brands that took a free AI visibility sample | 10,000+ | Gumshoe.ai, self-reported |
| Local businesses paying agencies for AI visibility | $999 to $2,800 a month | Agency service pages, Sep 10 2026 |

What this does not prove: that owners will pay for a public page rather than a private dashboard, or that $29 is the right number. Scope's 5,000 is the closest comparable and I could not verify it.

**The test before building anything.** Two weeks, under $300, no code.

1. Pick 50 San Diego categories. Ask ChatGPT, Gemini and Perplexity "best X in San Diego" five times each in the apps. Log who was named. That is 750 answers, a few evenings of work.
2. Put up 50 simple pages by hand (a static site builder is fine): the ranked names, how often each was named, the date, the method.
3. Email the roughly 150 businesses that were named: "ChatGPT named you as one of its picks for shawarma in San Diego 4 times out of 5 this week. Here is your page. Claim it for $29 a month, first month free." Stripe link. Owner emails are on their websites.
4. Talk to ten owners for fifteen minutes each. Ask what they would pay and what they would want to be told.

Go if 5 of 150 pay (3%) or 15 claim the free month and 3 owners say out loud they would pay. Otherwise, the public-page idea is not the front door, and the fallback is the alerts product sold through agencies.

## 3. Is it 10x better than what exists?

**Free hacks an owner uses today:** ask ChatGPT themselves. One answer, one engine, no history, and the research says a single answer is nearly meaningless (SparkToro: the same list comes back under 1% of the time; academic work puts the minimum at 5 to 10 asks). Google Alerts does not see AI answers at all. HubSpot's free grader gives a one-time score and pushes you into HubSpot.

**Rivals:**

| Product | Price | What it lacks |
|---|---|---|
| Scope.online | $25 to $79 | Private dashboard, no public pages, method not published |
| Local Falcon | from $25 | Map-grid tool for SEO people, no public record |
| Semrush, Ahrefs | $165 to $199 | Built for marketers, no city-level questions |
| Gumshoe, Profound | $99 to $399 | Built for brands, ChatGPT-only at the low tier |
| Waikay, Bluefish | $70 or enterprise | Accuracy checks for brand managers, not for a shop |

**Where the index is genuinely 10x:**

- Telling an owner *when the AI is wrong about them*. Nothing under $100 exists. That is not 10x better, it is the only option.
- Showing an owner *which pages the AI read* and which ones they are missing from. Nobody shows this to small businesses. It turns "you are invisible" into a to-do list.
- The public page itself. No competitor has one. It is the trust layer and the distribution channel at once.

**Where it is not 10x:** the ranking number. Knowing you are named 4 times out of 15 is maybe 3x better than asking ChatGPT yourself. Do not build the pitch on the ranking.

## 4. Where does the money come from?

**Model:** subscription. $29 claim, $79 for three locations plus a site audit, $199 for agencies with ten businesses. Later: an API and data licensing.

**Costs, verified on the API price lists Sep 11 2026:**

| Item | Cost |
|---|---|
| Sampling one question 5 times on 3 engines | about $0.30 |
| One city, 100 categories, 3 question shapes, monthly | about $90 |
| One paying business tracked daily | about $2.30 a month |
| Gross margin on a $29 claim | above 90% |

**Lifetime value.** Small-business subscriptions churn fast. Recurly's network reports about 3.6% churn overall (July 2026); I am assuming 5% a month for a $29 local tool, which is conservative but not pessimistic. At an average of $35 a month that is about 20 months and $700 of revenue, roughly $630 of gross profit per customer. At 8% churn it drops to about $390.

**Acquisition cost ceiling.** For a healthy 3-to-1 ratio, acquisition has to cost under about $200 per customer at 5% churn, under $130 at 8%. FirstPageSage puts average B2B SaaS acquisition cost at $205 organic and $341 paid. So paid ads cannot work at $29 a month. The business only works if customers arrive through the pages, through outreach, and through each other. That is the whole reason for the public index.

**Revenue math.** 200 claims at $35 average is $7,000 a month. 300 claims plus 20 agency seats is about $14,000. Two hundred claims across ten cities is twenty per city, which Yelp's numbers (half a million paying locations) suggest is not a stretch once pages exist.

## 5. Can you reach them affordably?

**Channel 1: the pages rank for business names and "best X in city."** Evidence that pages built from public business data get traffic: Restaurant Guru gets about 6.7 million visits a month, 76% from organic search. Wanderlog gets about 7.8 million, 44% organic (Similarweb, August 2026). Both are aggregator sites republishing business data, and both showed up on the first page of Google when I searched for Akhis's competitors. An owner who Googles their own name and finds "What AI says about Akhis" is the claim funnel.

Cost: the sampling and hosting for a city, $90 to $360 a month. At ten claims a city per month that is $9 to $36 per customer. Risk: new pages take three to six months to rank, and Google penalizes thin generated pages. The pages have to carry real, dated, unique data. That is what the sampling produces.

**Channel 2: outreach to the businesses the AI named.** Free except time. The email writes itself and it is good news. Yelp built a business on "people are looking at your page, claim it."

**Channel 3: the badge.** "Recommended by Gemini, 12 of 15 samples, Sep 2026" on the client's site and window. Yelp's "People love us" sticker is the precedent. Each badge advertises the index.

**Channel 4: local press and Reddit.** "We asked ChatGPT about 300 San Diego restaurants; here is who it picks" is a story a local paper runs. Everyone is included, so it is not spam.

**Channel 5: agencies.** Local SEO agencies are losing clients who ask "what about AI?" and have nothing to show. The $199 tier is for them.

**Verdict:** if the pages rank, acquisition is nearly free and the math works. If they do not rank, outreach and badges alone probably cannot get to 200 claims, and the product becomes a feature sold to agencies.

## Overall

| Question | Answer | Confidence |
|---|---|---|
| Severe enough? | Wrong-answer alerts: yes, today. Rankings: not yet, rising fast. | Medium |
| Pay today? | Comparable products say yes at $25 to $79. Unproven for a public page. | Low until tested |
| 10x better? | Yes on alerts and on showing the sources. No on the ranking itself. | High |
| Money? | Works only with near-free acquisition. Margins are fine. | Medium |
| Reach affordably? | Yes if the pages rank; comparables say they can. Three to six month lag. | Medium |

**What I would do:** run the two-week test in section 2 before writing code. It costs under $300 and about 30 hours, and it answers the one question the research cannot: will an owner pay for a public page. If five people pay, build it. If nobody does, we learned that for $300.

## What I could not verify

- Scope.online's 5,000 businesses and 1,200 reviews (their own numbers).
- The Minnesota solar company's lawsuit details (news pages would not load).
- BrightLocal's survey question wording, which could explain part of the 6% to 45% jump.
- Whether Recurly's 3.6% is monthly or annual; I treated it as monthly, which is the conservative reading.

## Sources

- Conductor, 2026 AEO/GEO benchmarks, 3.3B sessions
- BrightLocal, Local Consumer Review Survey 2026 (summary only)
- Pew Research Center, Americans and AI, June 2026
- SOCi, Local Visibility Index, January 2026
- Pitenin, Invisible to the Machine, arXiv, August 2026 (preprint)
- Courtyard, State of AI Visibility for Dentists, 2026
- SparkToro and Gumshoe, AI recommendation inconsistency study, 2026
- Żatuchin, Dice Roll Method, arXiv, September 2026 (preprint)
- Yelp press fast facts, Q2 2026
- Scope.online, HubSpot AEO, Gumshoe, Local Falcon, Semrush, Ahrefs, Waikay, Bluefish pricing pages, checked Sep 11 2026
- OpenAI, Google Gemini, Perplexity API price lists, checked Sep 11 2026
- Recurly churn benchmarks, July 2026
- FirstPageSage, average customer acquisition cost by industry, B2B edition
- Similarweb, wanderlog.com and restaurantguru.com, August 2026
