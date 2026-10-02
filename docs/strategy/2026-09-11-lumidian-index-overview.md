# The Lumidian Index

*What it is, why now, what it costs, and what I want your take on. Ken, September 2026.*

## The idea in one paragraph

When someone asks ChatGPT, Gemini or Perplexity "best dentist in Scottsdale" or "good shawarma near Pacific Beach", the AI names two or three businesses. Nobody knows who it names, how often, or why, and the answer changes from one ask to the next. The Lumidian Index is a public website (and later an app) that asks the AIs these questions repeatedly, every category, every city, and publishes what they said: who was named, how often, whether the engines agree, what sources the AI read to decide, and the date. Every business named gets a page. A business can claim its page and pay a small monthly fee to track itself daily, see the pages the AI reads that it is missing from, and get an alert when the AI gets its hours, prices or existence wrong.

Think of it as the public record of what AI recommends, plus the tool a business uses to get on it.

## Why now

| Fact | Source |
|---|---|
| 45% of US consumers used an AI assistant to find a local business this year, up from 6% the year before | BrightLocal consumer survey, 2026, 1,002 adults |
| A typical business location shows up in Google's map pack 36% of the time and is recommended by ChatGPT 1.2% of the time | SOCi, 350,000 locations, 2026 |
| Asked the same question twice, the AIs give the same list of brands less than 1% of the time | SparkToro, 2,961 runs, 2026 |
| Nobody publishes a browsable, methodology-backed record of what AI recommends by city and category | Checked Evertune, Ahrefs, Semrush, Local Falcon, Yelp, HubSpot, Scope, Gumshoe on Sep 11 2026. All sell private dashboards to businesses. |

Owners are starting to hear "I found you on ChatGPT" and have no way to see what the AI says. The tools that exist are B2B dashboards at $99 to $500 a month, built for marketing teams. There is no Yelp-style public page and no cheap way for a taco shop to check.

## What a page shows

Take /san-diego/shawarma. The page shows:

- The businesses each engine named, ranked by how often they were named across the sample. Per engine bars: Gemini named Akhis in 12 of 15 samples, Perplexity in 0 of 15.
- An agreement score: how many engines agree on the top picks.
- A confidence band, because 12 of 15 is not the same as 100%.
- The sources the AI read to answer: TripAdvisor 117 times, Reddit 74, Yelp 54, three competitor websites, two local food blogs.
- Dated quotes: what the AI actually said, with the date it said it.
- The prompts used and a link to the methodology page.

A business page shows its rate per engine over time, which questions it appears for, what the AI says about it, which sources mention it, and a "claim this page" button.

## How I know the numbers are honest

This is the part most products in this space skip, and it is the part I have spent the most time on. AI answers are random. The academic work on this (four papers from 2025 and 2026, cited on the methodology page) says a single answer is nearly meaningless, five to ten samples per prompt is the minimum, and you must report per engine with intervals, never a single pooled score. The index does that. It also shows disagreement rather than hiding it. Being the honest one is the point, because the critics in this industry are loud about everyone else's fake precision.

## How it makes money

| Tier | Price | What you get |
|---|---|---|
| Browse | Free | Every public page |
| Claim | $29 a month | Daily tracking of your category's questions plus 10 of your own, the source map with "you're on it / you're not" marked, accuracy alerts, a weekly report card, a share badge |
| Pro | $79 | Three locations, 30 questions, competitor set, a site audit with the fix list |
| Agency | $199 | Ten businesses, white-label report card, API |

Scope.online sells a similar $25 to $79 tracker to about 5,000 small businesses today, so the price point is proven. The difference is the public front door: instead of buying ads to find owners, the pages find them, and the "you ranked #2, claim it" email is the sales pitch.

Two hundred claims at a $35 average is $7,000 a month. Three hundred plus a handful of agency seats is $10,000. That is the first target.

## The money question

The scary number is $4,500 a month, which is what it costs to sample 50 metros every month. That is not the starting cost. That is the cost after there are customers.

Real starting cost, verified on the API pricing pages:

| Item | Cost |
|---|---|
| One question, sampled 5 times on 3 engines | about $0.30 |
| San Diego, 100 categories, 3 question shapes, monthly | about $90 |
| Same, weekly | about $360 a month |
| One paying business tracked daily | about $2.30 a month, against $29 |
| Hosting (already running) | about $40 a month |

Gemini gives 500 free grounded queries a day, which covers most of a single-city sweep on its own. So the pre-revenue burn is roughly $150 to $400 a month depending on cadence. A new city is added only when the previous one has 10 paying claims or 2,000 monthly visitors. The expensive version is a choice made after revenue, not before.

## What is already built

About two years of work sits behind this. The engine that asks four AIs the same question repeatedly, detects mentions, extracts every URL the AI cited, and computes a competitor-relative index already runs in production for a paying customer. So does the site crawler, billing, teams, notifications, PDF reports and deployment. The new work is: figuring out which businesses the AI named (entity resolution), the public pages, the claim flow, the fact-sheet alerts, and a small mobile app for push notifications.

## Ninety days

| Weeks | Ship |
|---|---|
| 1 to 2 | Index engine: category list, question templates, entity resolution, first San Diego sweep |
| 3 to 4 | Public site: 100 category pages and 1,500+ business pages for San Diego, methodology, sitemaps |
| 5 to 6 | Claim and pay, owner dashboard, daily tracking, source map |
| 7 to 8 | Accuracy alerts and the owner app with push |
| 9 to 10 | Share badges, a "San Diego by the numbers" press piece, two more metros |
| 11 to 12 | Agency tier and API |

Day-90 rule: keep going if the pages get over 2,000 visitors a month and there are more than 20 paying claims. If pages get traffic but nobody claims, sell the data instead. If pages get no traffic, fall back to the scanner-plus-alerts product without the public index.

## Risks I see

- Some businesses will be unhappy being ranked low. Mitigation: the page reports what the AI said on a date, with quotes and methodology, and anyone can claim for free to correct their listing.
- Matching AI-named businesses to real places will be messy for a while. Ship with "possible match" states and let owners fix it at claim time.
- Search traffic to new pages takes months. Share badges, owner outreach and local press are the faster loops.
- Someone bigger could add public pages. The edge is being first with dated history and being honest about the noise.

## What I want your take on

1. Would you look at a page like /san-diego/tacos? Would anyone?
2. Is $29 the right claim price for a restaurant or dentist?
3. What would make you not trust the numbers?
4. Anything obvious I am missing.
