"""Cluster-level evidence pack builder.

Builds one evidence pack per cluster (not per piece). Pack is gated by domain
authority tier counts and persisted to ContentEvidencePack + ContentClusterSource.

Public entry points (added in this task):
    expand_queries(...)        — derive search queries from prompt + claims
    fetch_and_dedupe(...)      — call Serper across queries, dedupe by URL
    rank_and_tier(...)         — classify + sort sources by authority tier
    gate_pack(...)             — raise PackGateError if pack lacks authority

(Task 7 will add `build_cluster_pack`.)
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from app.services.drafting.evidence import _serper_search  # reuse existing client

logger = logging.getLogger(__name__)

MAX_QUERIES = 5
PER_QUERY_LIMIT = 10


def expand_queries(*, prompt_text: str, key_claims: list[str]) -> list[str]:
    """Derive up to MAX_QUERIES distinct search queries from prompt + claims."""
    queries: list[str] = []
    seen: set[str] = set()

    def _add(q: str) -> None:
        norm = q.strip().lower()
        if norm and norm not in seen:
            seen.add(norm)
            queries.append(q.strip())

    _add(prompt_text)
    for claim in key_claims:
        _add(claim)
        if len(queries) >= MAX_QUERIES:
            break
    return queries[:MAX_QUERIES]


def _normalize_url(url: str) -> str:
    """Canonical form for dedup: scheme + netloc + path; strip query/fragment."""
    try:
        p = urlparse(url)
        host = p.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return f"{p.scheme}://{host}{p.path.rstrip('/')}"
    except Exception:
        return url


async def fetch_and_dedupe(queries: list[str]) -> list[dict[str, Any]]:
    """Run Serper for each query, merge, dedup by normalized URL."""
    seen: dict[str, dict[str, Any]] = {}
    for q in queries:
        try:
            results = await _serper_search(q, num=PER_QUERY_LIMIT)
        except Exception as exc:
            logger.warning("Serper failed for cluster query %r: %s", q, exc)
            continue
        for r in results:
            url = r.get("link") or r.get("url")
            if not url:
                continue
            key = _normalize_url(url)
            if key in seen:
                continue
            seen[key] = {
                "url": url,
                "title": r.get("title") or "",
                "snippet": r.get("snippet") or "",
            }
    return list(seen.values())


# ---------------------------------------------------------------------------
# Task 6: authority tiering + pack-gate
# ---------------------------------------------------------------------------

from app.services.source_authority import classify_domain  # noqa: E402

PACK_CAP = 10
MIN_T1 = 2
MIN_T1_PLUS_T2 = 4

_TIER_ORDER = {"T1": 0, "T2": 1, "T3": 2}


class PackGateError(Exception):
    """Raised when the cluster pack doesn't meet authority requirements."""


def _domain_of(url: str) -> str:
    """Extract bare domain (no www.) from a URL."""
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def rank_and_tier(raw_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Classify each source and sort T1 → T2 → T3. Returns enriched dicts."""
    enriched = []
    for s in raw_sources:
        domain = _domain_of(s["url"])
        tier = classify_domain(domain)
        enriched.append({**s, "domain": domain, "tier": tier})
    enriched.sort(key=lambda x: _TIER_ORDER[x["tier"]])
    return enriched


def gate_pack(pack: list[dict[str, Any]]) -> None:
    """Raise PackGateError if pack doesn't have enough authoritative sources."""
    t1 = sum(1 for s in pack if s["tier"] == "T1")
    t2 = sum(1 for s in pack if s["tier"] == "T2")
    if t1 < MIN_T1:
        raise PackGateError(
            f"insufficient_T1_sources: found {t1}, need at least {MIN_T1}"
        )
    if t1 + t2 < MIN_T1_PLUS_T2:
        raise PackGateError(
            f"insufficient_authority: T1+T2 = {t1 + t2}, need at least {MIN_T1_PLUS_T2}"
        )
