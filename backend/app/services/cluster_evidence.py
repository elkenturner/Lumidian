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
# Authority floor for the cluster pack. Lowered from (2, 4) — the strict floor
# was rejecting prompts where Serper returned a single solid authoritative
# result (SEC.gov, NIH.gov, etc.) plus several T2 trade-press hits, which was
# enough to ground the brief.
MIN_T1 = 1
MIN_T1_PLUS_T2 = 3

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


# ---------------------------------------------------------------------------
# Task 7: top-level builder + persistence
# ---------------------------------------------------------------------------

from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.models import (  # noqa: E402
    ContentCluster, ContentClusterSource, ContentEvidencePack,
)


async def _persist_pack(
    db: AsyncSession,
    *,
    cluster: ContentCluster,
    pack_sources: list[dict],
    version: int,
) -> ContentEvidencePack:
    """Persist the gated pack + per-source rows. Shared by all pack builders.

    Idempotent: deletes any existing ContentClusterSource rows for this cluster
    before inserting the new ones. ContentClusterSource has a UNIQUE constraint
    on (cluster_id, url), so without this regen would fail with an integrity
    error any time a URL appears in both the previous and the new pack.
    """
    from sqlalchemy import delete
    await db.execute(
        delete(ContentClusterSource).where(ContentClusterSource.cluster_id == cluster.id)
    )
    await db.flush()

    pack = ContentEvidencePack(
        cluster_id=cluster.id,
        version=version,
        sources=pack_sources,
        total_t1=sum(1 for s in pack_sources if s["tier"] == "T1"),
        total_t2=sum(1 for s in pack_sources if s["tier"] == "T2"),
        total_t3=sum(1 for s in pack_sources if s["tier"] == "T3"),
    )
    db.add(pack)
    await db.flush()
    for s in pack_sources:
        db.add(ContentClusterSource(
            cluster_id=cluster.id,
            evidence_pack_id=pack.id,
            url=s["url"],
            domain=s["domain"],
            tier=s["tier"],
            title=s.get("title"),
            times_cited=0,
        ))
    await db.commit()
    await db.refresh(pack)
    return pack


async def _load_cluster_citations(
    db: AsyncSession,
    *,
    brand_id: int,
    prompt_id: int,
    limit_runs: int = 5,
) -> list[dict]:
    """Pull third-party citations the tracking runs already extracted.

    These are URLs that real AI assistants (ChatGPT, Claude, Perplexity, Gemini)
    cited when answering this exact prompt — pre-filtered by the LLMs themselves,
    so they tend to be higher-authority than raw Google results. We pull from
    the most recent `limit_runs` completed runs and dedup by URL. Returns dicts
    in the same shape that `rank_and_tier` expects.
    """
    from sqlalchemy import select
    from app.models import CitationSource, TrackingRun

    recent_run_ids = (await db.execute(
        select(TrackingRun.id)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.id.desc())
        .limit(limit_runs)
    )).scalars().all()
    if not recent_run_ids:
        return []
    rows = (await db.execute(
        select(CitationSource.url, CitationSource.domain)
        .where(
            CitationSource.brand_id == brand_id,
            CitationSource.prompt_id == prompt_id,
            CitationSource.kind == "third_party",
            CitationSource.tracking_run_id.in_(list(recent_run_ids)),
        )
    )).all()
    seen: set[str] = set()
    out: list[dict] = []
    for url, _domain in rows:
        if url in seen:
            continue
        seen.add(url)
        # No snippet (we only stored URL+domain). Title is a placeholder so the
        # writer can reference the source by name in citations.
        out.append({"url": url, "title": "(cited by AI for this prompt)", "snippet": ""})
    return out


async def build_cluster_pack(
    db: AsyncSession,
    *,
    cluster: ContentCluster,
    prompt_text: str,
    key_claims: list[str],
    version: int,
) -> ContentEvidencePack:
    """Build, tier, gate, and persist a cluster-level evidence pack.

    Fallback chain (each step persists + returns on success, otherwise falls
    through to the next):

      1. Citations from the tracking runs (third_party only). High-precision
         because LLMs already filtered them for relevance/credibility.
      2. Live Serper web search across the prompt + key_claims.

    Raises PackGateError if neither path clears the authority gate. On failure
    nothing is persisted; the caller should set cluster.status='briefing_failed'
    with failure_reason=str(exc) and the soft-fail handler (in regenerate_cluster)
    decides whether to fall back to a brand-as-authority pack.
    """
    # 1. Try citations first
    raw_citations = await _load_cluster_citations(
        db, brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
    )
    if raw_citations:
        ranked = rank_and_tier(raw_citations)
        pack_sources = ranked[:PACK_CAP]
        try:
            gate_pack(pack_sources)
            return await _persist_pack(
                db, cluster=cluster, pack_sources=pack_sources, version=version,
            )
        except PackGateError as exc:
            logger.info(
                "cluster %d: citations pack failed gate (%s) — falling through to Serper",
                cluster.id, exc,
            )

    # 2. Live Serper search
    queries = expand_queries(prompt_text=prompt_text, key_claims=key_claims)
    raw = await fetch_and_dedupe(queries)
    ranked = rank_and_tier(raw)
    pack_sources = ranked[:PACK_CAP]
    gate_pack(pack_sources)  # raises on failure — nothing persisted yet
    return await _persist_pack(
        db, cluster=cluster, pack_sources=pack_sources, version=version,
    )


async def build_cluster_pack_from_brand_authority(
    db: AsyncSession,
    *,
    cluster: ContentCluster,
    version: int,
) -> ContentEvidencePack | None:
    """Soft-fail pack: synthesize sources from BrandProfile + crawled site pages.

    Used when both citations and Serper packs fail the authority gate — typically
    for niche commercial discovery questions where no external authority exists
    ("which advisor is best for X biotech?"). The brand IS the authoritative
    source for claims about itself.

    Returns None if the brand has no profile AND no crawled pages — in that case
    even soft-fail can't ground the writer.

    Persists with `tier="brand"` for each row (a synthetic tier outside T1/T2/T3
    so the pack is clearly distinct from the gated path in UI + analytics).
    """
    from sqlalchemy import select, desc
    from app.models import BrandProfile, WebsiteAudit, WebsiteAuditPage

    sources: list[dict] = []

    # Brand profile entry — synthesized "source" that the writer can cite.
    profile = (await db.execute(
        select(BrandProfile).where(BrandProfile.brand_id == cluster.brand_id)
    )).scalar_one_or_none()
    if profile and (profile.company_description or profile.key_stats):
        sources.append({
            "url": "internal://brand-profile",
            "domain": "brand-profile",
            "tier": "brand",
            "title": "Brand profile (first-party)",
        })

    # Most recent completed audit's top pages — the brand's own crawled site.
    audit = (await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == cluster.brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.id))
        .limit(1)
    )).scalar_one_or_none()
    if audit is not None:
        pages = (await db.execute(
            select(WebsiteAuditPage)
            .where(WebsiteAuditPage.audit_id == audit.id)
            .limit(8)
        )).scalars().all()
        for p in pages:
            sources.append({
                "url": p.url,
                "domain": (p.url.split("/")[2] if "://" in p.url else p.url)[:255],
                "tier": "brand",
                "title": (p.title or p.url)[:200],
            })

    if not sources:
        return None

    return await _persist_pack(
        db, cluster=cluster, pack_sources=sources, version=version,
    )
