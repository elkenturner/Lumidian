"""Throwaway Layer A analysis — read-only mining of citation data.

NOT wired into the app. Run against the production DB to answer Stream 1:
what does each model actually cite, and do our 5 target platforms appear?

Usage: python scripts/layer_a_citation_analysis.py <db_path>
"""
import sqlite3
import sys
import json
from collections import Counter, defaultdict

# Exact-or-subdomain suffix -> platform label
_PLATFORM_SUFFIX = {
    "reddit.com": "reddit",
    "quora.com": "quora",
    "medium.com": "medium",
    "linkedin.com": "linkedin",
    "twitter.com": "x",
    "x.com": "x",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "wikipedia.org": "wikipedia",
    "substack.com": "substack",
    "github.com": "github",
    "stackoverflow.com": "stackoverflow",
    "news.ycombinator.com": "hackernews",
    "dev.to": "devto",
}
_SEARCH_REDIRECT = {
    "google.com", "bing.com", "duckduckgo.com",
    "vertexaisearch.cloud.google.com",
}
_NEWS = {
    "forbes.com", "techcrunch.com", "reuters.com", "bloomberg.com",
    "nytimes.com", "businessinsider.com", "theverge.com", "wsj.com",
    "cnbc.com", "wired.com",
}

TARGET5 = ["reddit", "quora", "medium", "linkedin", "x"]


def classify_domain(domain: str) -> str:
    """Map a raw domain to a content-channel label."""
    d = (domain or "").lower().strip()
    if d.startswith("www."):
        d = d[4:]
    if d in _SEARCH_REDIRECT or d.endswith(".google.com"):
        return "search_redirect"
    for suffix, label in _PLATFORM_SUFFIX.items():
        if d == suffix or d.endswith("." + suffix):
            return label
    if d in _NEWS:
        return "news"
    return "other"


def analyze(db_path: str) -> dict:
    """Compute per-model channel distribution + target-5 hit-rate."""
    c = sqlite3.connect(db_path)
    rows = c.execute(
        "select model, domain, kind from citation_sources"
    ).fetchall()
    runs_by_model = dict(
        c.execute(
            "select model, count(*) from query_results group by model"
        ).fetchall()
    )

    per_model_platform = defaultdict(Counter)
    per_model_total = Counter()
    top_domains = defaultdict(Counter)
    for model, domain, _kind in rows:
        plat = classify_domain(domain)
        per_model_platform[model][plat] += 1
        per_model_total[model] += 1
        top_domains[model][(domain or "").lower()] += 1

    summary = {"_responses_by_model": runs_by_model, "models": {}}
    for model, total in per_model_total.items():
        plats = per_model_platform[model]
        target_hits = {t: plats.get(t, 0) for t in TARGET5}
        summary["models"][model] = {
            "total_citations": total,
            "by_platform": dict(plats.most_common()),
            "target5_hits": target_hits,
            "target5_total": sum(target_hits.values()),
            "target5_rate_pct": round(
                100 * sum(target_hits.values()) / total, 2
            ) if total else 0.0,
            "top_domains": dict(top_domains[model].most_common(15)),
        }
    c.close()
    return summary


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else "_layerA_prod.db"
    print(json.dumps(analyze(db), indent=2))
