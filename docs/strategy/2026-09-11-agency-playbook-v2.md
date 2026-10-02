# Lumidian Agency: what we learned and how we will work with Akhis

*For my partner. Ken, September 2026.*

This is a simple paper so we can think together about the restaurant. Everything in it comes from outside research and from checking Akhis's listings by hand. None of it comes from our own software, which is not reliable enough yet to base decisions on.

## What we set out to learn

Three questions. What are the agencies that sell "AI visibility" actually doing for clients? What does the research say actually makes ChatGPT, Gemini or Perplexity recommend a business? And what should we do for Akhis given the answers.

## What other agencies are doing

I read the service pages of about fifteen agencies on September 10. The pattern is the same everywhere:

- **Track** a set of questions in ChatGPT, Gemini and Perplexity and report whether the client is named.
- **Fix the website**: structured data (schema), FAQ sections, service pages, an "llms.txt" file.
- **Write content**: anywhere from 4 to 20 articles a month, sometimes posted to Reddit, Quora, LinkedIn and Medium as well as the client's site.
- **Get the client listed**: directory submissions, "best of" list outreach, a bit of PR.
- **Reviews**: a review-gathering system or script.

Prices: the cheapest tier anyone sells is $1,000 to $2,500 a month for tracking plus quarterly website fixes. Local shops that sell to dentists, roofers and med spas charge $999 to $2,800 a month, sometimes with a one-time website rebuild of $1,000 to $5,000. Bigger agencies charge $3,000 to $20,000.

What they promise: some offer a refund if the client is not "cited within 45 or 60 days." One citation counts, so it is an easy promise to keep. Their case studies say things like "23 of 50 tracked questions now mention the client" with no method shown.

What the critics say (SparkToro, Search Engine Land, Seer Interactive, Lily Ray of Amsive): AI answers change every time you ask, so a single screenshot or a "ranking" means nothing. Some vendors show AI visibility going up while the client's real traffic goes down. Fake Reddit threads and self-published "best agencies in [city]" lists are now treated as spam by Google and Microsoft. Schema and llms.txt are sold as fixes but have not been shown to matter. Their advice: most of this is ordinary local SEO plus PR, and anyone who says otherwise is selling.

## What the research says actually gets a business recommended

I looked for studies with real sample sizes. Ranked by how strong the evidence is:

| What helps | Evidence | How much |
|---|---|---|
| Your business name appearing on other websites (lists, directories, local press) | Ahrefs, 75,000 brands, 2025 | The strongest predictor of showing up in AI answers. Three times stronger than backlinks. |
| Being listed on review sites and directories | Yext, 6.8 million AI citations, 2025 | 42% of the pages AI cites are directory listings. For restaurants, 42% listings and 13% review and social sites. Reddit is 2% for location-based questions. |
| Having your own website, with prices on it | Census of 4,776 restaurants in one market, 2026 (preprint) | A business with its own website had about twice the odds of being recommended. Listing prices, 1.5 times. Third-party mentions, 1.4 times. |
| Review volume | Same census | 1.6 times the odds. Star rating did not decide who got in, but decided who was named first. |
| Pages with prices and recent update dates | Controlled study of 252,000 trials, SIGIR 2026 | Prices and recent dates consistently raised the chance of being cited. |
| Google Business Profile | Semrush, 5,000 keywords, 2025 | About 1 in 7 Google AI Mode answers embeds the local map pack, so the Google profile feeds the AI directly. |

And what does not hold up:

| What does not help | Evidence |
|---|---|
| Schema markup as an AI lever | Ahrefs tested 1,885 pages that added it against matched controls: no measurable change in AI citations. SE Ranking found pages with FAQ schema were cited slightly less. |
| llms.txt | SE Ranking, 300,000 domains: negligible. |
| Copywriting tricks (adding statistics, quotes, "authoritative" language) | NeurIPS 2025 benchmark: mostly ineffective, often negative. |
| Fake or seeded Reddit threads, self-published listicles | Treated as spam; reputational risk. |

Where local questions get answered from, specifically: Whitespark ran 540 local searches by hand across six industries. For questions like "how much does a plumber cost in Houston" Google showed an AI answer 97% of the time, and 4 in 10 of the sources it cited were individual local business websites. For plain "plumbers in Houston" questions the map pack showed 93% of the time and the AI answer only 15%. BrightLocal's audit found Yelp cited in about a third of local AI answers, and dentist answers built almost entirely from dental directories.

One honest caveat. AI assistants synthesize; a page can shape an answer without being cited, and material on the open web can end up in training data months later. Nobody has measured that, so I am not claiming posts on Medium or LinkedIn do nothing. I am saying the measured evidence puts directories, review sites, lists and the business's own website at the top, and our time is limited, so that is where it goes.

## What is actually valuable for us to do

Four things, in this order.

1. **Get the business listed correctly on the sites the AI reads.** Google, Yelp, TripAdvisor, Facebook, Apple Maps, the delivery apps, and the directories for that industry. Same name spelling, address, phone, hours and prices on every one.
2. **Get the business onto local "best of" lists and into local press.** This is the strongest lever in the research and it is plain outreach: an email from the owner with a hook and a specific ask.
3. **Make sure the website answers the questions people ask, with prices and a date.** One page per question. "Halal restaurant in Pacific Beach." "Catering platters, $59.95 for four."
4. **Keep reviews coming.** A card at the counter, a one-line ask, reply to every review.

Then check, once a week, what the AIs say, and be honest about what changed.

What we will not sell: schema, llms.txt or "AI-optimized articles" as the thing that gets you recommended; social posting; review management; any guarantee of a mention.

## Where Akhis stands

Checked by hand on September 10 using Google's results, Akhis's website, and the competitors' listings.

| Place | Akhis | Notes |
|---|---|---|
| Google | 4.9 stars, 502 reviews. Shows in the map pack for "best shawarma pacific beach." | Strong. Higher rating than all three competitors. |
| Yelp | 4.8 stars, 147 reviews. Number 2 on Yelp's own "Best Shawarma near Pacific Beach" list. | Good. Fewer reviews than Mr. Shawarma (419) and Cafe Athena (889). |
| Uber Eats, Grubhub, DoorDash | 4.8 (210), 4.6 (47), listed | Fine |
| Instagram | 1.1K followers | Fine |
| Press | San Diego Union-Tribune feature, Nov 2025; a local "Hidden Gems" interview | Good, and rare for a place this size |
| Website | Menu in text with prices (wrap $12.95, bowl $14.95, family platter $59.95), halal statement, hours, phone, address, a Pacific Beach page. Open to all AI crawlers. | Better than most restaurants. No links to Yelp or the delivery apps on it. |
| TripAdvisor | Could not find a page | Shawarma Shack (4.7), Mr. Shawarma (4.8) and Cafe Athena (4.5, about 95 reviews) all have one. Free to claim. |
| Local food blogs and lists (La Jolla Mom, Eater San Diego, San Diego Magazine, and similar) | Not found on any | These are the outreach targets |
| Name spelling | Four versions across the web: "Akhis Authentic Shawarma & Kebab" (site, Google), "Akhis Shawarma & Kebab" (DoorDash, Instagram), "Akhis Authentic Shawarma and Kabab" (Union-Tribune), "Akhi's" (various) | Pick one and use it everywhere |

Competitors, for scale: Mr. Shawarma has 2,019 Google reviews at 4.7. Cafe Athena has 532 at 4.6. Shawarma Shack has about 480 Yelp reviews at 4.5.

Bottom line: Akhis is in better shape than almost any local business we will meet. The gaps are TripAdvisor, the blogs and lists, the name spelling, and two or three pages on the website. That is a small job.

## How we will do it

Ninety days, September 14 to December 14. Free or a token fee, in exchange for permission to use the results as a case study.

**Week 1. Kickoff with Malik.** Explain what we do in plain words: the AI reads a handful of pages to answer "best shawarma in PB," mostly Yelp, TripAdvisor, Google and local food blogs; we get him onto those pages with one consistent name, make his site answer the questions people ask, and check every week what each AI says. What we do not do: ads, social posting, review management, guarantees. What we need from him: manager access to his Google Business Profile by email invite, someone who can paste a page onto the website, and 20 minutes on a call to claim TripAdvisor and Bing in his own name. No passwords.

**Week 1. Baseline by hand.** Every Monday, one of us asks ChatGPT, Gemini and Perplexity ten fixed questions (best Mediterranean in PB, best shawarma in PB, halal near PB, gyro or kebab plate in PB, best shawarma in San Diego, and five more), three times each in the actual apps, and logs who was named in a spreadsheet with a screenshot. Thirty answers per AI per week. That is our measurement until the software earns trust. The research says a single answer is meaningless and that you have to ask several times and keep the AIs separate, so that is what we do.

**Week 2. Listings.** Claim TripAdvisor. Fix the name on DoorDash and anywhere else it differs. Check categories on Yelp (Halal, Middle Eastern, Mediterranean), photos, menu with prices, hours. Add Yelp and delivery links to the website.

**Week 2. Review card.** A card and QR code at the register pointing at Google reviews with a one-line ask. Reply to every review within a week. Note: Yelp has long told businesses not to ask for reviews and filters ones it thinks were solicited. I could not load Yelp's policy page today to quote it, so check before pointing anything at Yelp.

**Week 3. First page.** "Halal Mediterranean in Pacific Beach": prices, what is in each wrap and plate, hours, address, parking, an updated-on date, a short FAQ. We draft, Malik pastes.

**Weeks 3 to 10. Outreach.** Ten targets: La Jolla Mom, Eater San Diego, San Diego Magazine, San Diego Reader, the San Diego tourism site, and the travel and food blogs that publish Pacific Beach lists. Email from Malik: family-run, 100% halal, 4.9 on Google with 500 reviews, featured in the Union-Tribune in November, please consider adding us to your Pacific Beach list, come in for lunch on us. Track sent, replied, added. One placement per ten asks is a realistic rate.

**Week 7. Second page.** "Catering and family platters in Pacific Beach" or "Vegetarian and vegan options," whichever Malik says customers ask about more.

**Week 12. Final check.** Compare the Monday logs from week 1 and week 12 for each AI separately. Compare against the competitors named in the same answers. Write one paragraph, honest either way.

Total time: roughly 25 to 30 hours over 90 days, most of it outreach.

## What we promise a client, in writing

We get you listed correctly on the sites the AI reads, we work to get you onto local lists and press, we make your website answer the questions customers ask, and we check every week what each AI says about you and your competitors. We do not run ads, post on social media, manage reviews, or guarantee a mention. At 30 days your listings are fixed and a page is live. At 90 days you get a before-and-after, honest either way.

## Pricing, when we charge

$1,000 a month for the first five clients, then $1,500. Three-month minimum. That is at the bottom of what anyone charges, which is fine while we prove it. Restaurants are the lightest case. A dentist or a roofer usually has a broken website, no prices online and wrong directory listings, which is more work and a more visible result, and they already pay agencies $1,000 to $3,000 a month.

## What we decide on December 14

Three questions. Did the outreach produce placements? Did any AI's answers move for Akhis but not for the competitors, in the hand-checked log? Would Malik pay for the weekly check? If the answers are good, we sell this to five dentists, med spas, lawyers or home-service businesses in San Diego. If the work is real but the retainer is a grind, the same idea becomes a self-serve product, which I have written up separately.

## Sources

- Ahrefs, "AI Overview brand visibility factors," 75,000 brands, May 2025
- Yext, "86% of AI citations come from brand-managed sources," 6.8M citations, Oct 2025
- Pitenin, "Invisible to the Machine," census of 4,776 venues, arXiv, Aug 2026 (preprint)
- Vishwakarma et al., "What Gets Cited," SIGIR 2026
- Semrush, "AI Mode vs traditional search," 5,000 keywords, Jul 2025
- Ahrefs, schema markup controlled test, 1,885 pages, May 2026
- SE Ranking, "What makes ChatGPT cite a source," 129,000 domains, Nov 2025
- Puerto et al., "C-SEO Bench," NeurIPS 2025
- Whitespark, "Prevalence of AI Overviews in local search," 540 queries, May 2025
- BrightLocal, local consumer survey 2026 and listings-source audit (summaries only; the pages would not load for me)
- SparkToro and Gumshoe, "AIs are highly inconsistent when recommending brands," 2,961 runs, 2026
- Search Engine Land, Digiday, Seer Interactive and Lily Ray on GEO agency practices, 2025 to 2026
- Agency service pages read Sep 10, 2026: ShowUpWithAI, Avante Visibility, RankOps, i-call, KailxLabs, Intleacht, Digital Elevator, Discovered Labs, First Page Sage, WebFX, Optimist, Thrive, Siege Media, Go Fish Digital, NP Digital
- Akhis and competitor listings checked by hand via Google results and the businesses' own sites, Sep 10, 2026
