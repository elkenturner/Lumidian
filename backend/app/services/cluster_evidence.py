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

import asyncio
import logging
import os
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.services.drafting.evidence import (  # reuse existing client
    SerperRateLimitError,
    _serper_search,
)

logger = logging.getLogger(__name__)

MAX_QUERIES = 5
PER_QUERY_LIMIT = 10


class SearchUnavailableError(Exception):
    """Raised when Serper is rate-limited across every cluster search query and
    returns no results at all.

    Distinct from a genuine "no authoritative sources exist" outcome — a
    provider throttling incident is retryable and should never be recorded as
    the same failure_reason as a real content gap. Only raised when the search
    came back completely empty; if even one query returned real results
    (partial success), those results still flow through to the authority
    gate rather than aborting the pack.
    """


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
    """Run Serper for each query, merge, dedup by normalized URL.

    Requests rate-limit errors be raised (rather than swallowed to ``[]``) so
    this function can tell "Serper is throttled" apart from "Serper legitimately
    found nothing". If every query is rate-limited AND nothing was found at
    all, raise SearchUnavailableError so the caller can mark the cluster
    retryable instead of recording a misleading no-authority failure. Partial
    results (some queries rate-limited, others succeeded) still flow through
    to the gate as before.
    """
    seen: dict[str, dict[str, Any]] = {}
    rate_limited = 0
    for q in queries:
        try:
            results = await _serper_search(q, num=PER_QUERY_LIMIT, raise_on_rate_limit=True)
        except SerperRateLimitError:
            rate_limited += 1
            continue
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
    if rate_limited and not seen:
        raise SearchUnavailableError(
            f"search_unavailable: Serper rate-limited on {rate_limited}/{len(queries)} queries"
        )
    return list(seen.values())


# ---------------------------------------------------------------------------
# Task 6: authority tiering + pack-gate
# ---------------------------------------------------------------------------

from app.services.source_authority import classify_domain  # noqa: E402

PACK_CAP = 10


def _min_t1() -> int:
    """Authority floor: minimum T1 sources required, env-tunable.

    Defaults to 1 — the strict floor of 2 was rejecting prompts where Serper
    returned a single solid authoritative result (SEC.gov, NIH.gov, etc.)
    plus several T2 trade-press hits, which was enough to ground the brief.
    """
    return int(os.getenv("CLUSTER_GATE_MIN_T1", "1"))


def _min_t1_plus_t2() -> int:
    """Authority floor: minimum T1+T2 sources required, env-tunable."""
    return int(os.getenv("CLUSTER_GATE_MIN_T1_PLUS_T2", "3"))


# Deprecated: module-level snapshots of the above, computed at import time.
# Prefer `_min_t1()` / `_min_t1_plus_t2()`, which re-read the env on every
# call (needed so the gate can be tuned per-environment without a restart of
# any caller that imports these constants directly). Kept for compatibility
# with any external readers of the old constant names.
MIN_T1 = _min_t1()
MIN_T1_PLUS_T2 = _min_t1_plus_t2()

_TIER_ORDER = {"T1": 0, "T2": 1, "T3": 2}


class PackGateError(Exception):
    """Raised when the cluster pack doesn't meet authority requirements.
    Carries the rejected sources so callers can degrade instead of hard-failing.
    """

    def __init__(self, message: str, sources: list[dict] | None = None):
        super().__init__(message)
        self.sources = sources or []


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
    min_t1 = _min_t1()
    min_t1_plus_t2 = _min_t1_plus_t2()
    t1 = sum(1 for s in pack if s["tier"] == "T1")
    t2 = sum(1 for s in pack if s["tier"] == "T2")
    if t1 < min_t1:
        raise PackGateError(
            f"insufficient_T1_sources: found {t1}, need at least {min_t1}",
            sources=pack,
        )
    if t1 + t2 < min_t1_plus_t2:
        raise PackGateError(
            f"insufficient_authority: T1+T2 = {t1 + t2}, need at least {min_t1_plus_t2}",
            sources=pack,
        )


def pack_meets_gate(sources: list[dict]) -> bool:
    """True if these already-tiered sources would pass the authority gate now.
    Used by the pack-reuse path to preserve low-evidence status without
    sniffing synthetic tiers."""
    try:
        gate_pack(list(sources))
        return True
    except PackGateError:
        return False


# ---------------------------------------------------------------------------
# Task 7: top-level builder + persistence
# ---------------------------------------------------------------------------

from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.models import (  # noqa: E402
    ContentCluster, ContentClusterSource, ContentEvidencePack,
)


_ENRICH_STRIP_TAGS = ("script", "style", "nav", "header", "footer", "aside")
_ENRICH_USER_AGENT = "Mozilla/5.0 (compatible; LumidianBot/1.0)"
_CITED_BY_AI_PLACEHOLDER = "(cited by AI for this prompt)"


async def enrich_pack_snippets(
    sources: list[dict],
    *,
    max_chars: int = 1800,
    concurrency: int = 5,
    timeout_s: float = 8.0,
) -> list[dict]:
    """Fetch each source's page and upgrade `snippet` (and placeholder `title`)
    with real page text, in place, on the same dicts.

    Best-effort only: skips non-http(s) URLs (e.g. `internal://brand-profile`)
    without attempting a fetch, and any per-URL failure (network error, parse
    error, anything) leaves that source's dict completely untouched. Never
    raises — a slow or broken source must never block pack persistence.

    Never downgrades: the fetched snippet only replaces the existing one when
    it is strictly longer, so a solid Serper snippet is never clobbered by a
    short cookie-banner/paywall fragment.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _enrich_one(client: httpx.AsyncClient, source: dict) -> None:
        url = source.get("url") or ""
        if not url.startswith("http"):
            return
        try:
            async with sem:
                resp = await client.get(url)
            soup = BeautifulSoup(resp.text, "html.parser")

            title_tag = soup.title
            fetched_title = ""
            if title_tag is not None:
                fetched_title = " ".join(title_tag.get_text(" ", strip=True).split())

            for tag_name in _ENRICH_STRIP_TAGS:
                for tag in soup.find_all(tag_name):
                    tag.decompose()
            fetched_text = " ".join(soup.get_text(" ", strip=True).split())
            fetched_snippet = fetched_text[:max_chars]

            existing_snippet = source.get("snippet") or ""
            if len(fetched_snippet) > len(existing_snippet):
                source["snippet"] = fetched_snippet

            existing_title = (source.get("title") or "").strip()
            if fetched_title and existing_title in ("", _CITED_BY_AI_PLACEHOLDER):
                source["title"] = fetched_title[:200]
        except Exception as exc:
            logger.debug("evidence enrichment: failed to fetch %s: %s", url, exc)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=timeout_s,
        headers={"User-Agent": _ENRICH_USER_AGENT},
    ) as client:
        await asyncio.gather(*(_enrich_one(client, s) for s in sources))

    return sources


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
    pack_sources = await enrich_pack_snippets(list(pack_sources))

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


async def _load_user_sources(db: AsyncSession, brand_id: int) -> list[dict]:
    """BrandSource library entries, shaped for rank_and_tier. The user vouched
    for these, so they get a T2 floor (classify_domain may still say T1).
    """
    from sqlalchemy import select, desc
    from app.models import BrandSource
    rows = (await db.execute(
        select(BrandSource).where(BrandSource.brand_id == brand_id)
        .order_by(desc(BrandSource.added_at)).limit(10)
    )).scalars().all()
    out = []
    for r in rows:
        domain = _domain_of(r.url)
        tier = classify_domain(domain)
        if tier == "T3":
            tier = "T2"
        out.append({"url": r.url, "title": r.title or "", "snippet": r.snippet or "",
                    "domain": domain, "tier": tier, "user_supplied": True})
    return out


def _merge_user(user_sources: list[dict], ranked: list[dict]) -> list[dict]:
    """Prepend user sources ahead of ranked sources, deduped by normalized URL.

    user_sources are already tiered (T2-floored) — rank_and_tier must NOT be
    run on them again, so this merge happens after ranking the other path.
    """
    seen = {_normalize_url(s["url"]) for s in user_sources}
    return user_sources + [s for s in ranked if _normalize_url(s["url"]) not in seen]


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

    The user's BrandSource library (if any) is merged into BOTH paths before
    gating — the user vouched for these sources, so they count with a T2
    floor toward the authority gate, giving users a way to help a failing
    brief without waiting on Serper/citations alone.

    Raises PackGateError if neither path clears the authority gate. On failure
    nothing is persisted; the caller should set cluster.status='briefing_failed'
    with failure_reason=str(exc) and the soft-fail handler (in regenerate_cluster)
    decides whether to fall back to a brand-as-authority pack.
    """
    user_sources = await _load_user_sources(db, cluster.brand_id)

    # 1. Try citations first
    raw_citations = await _load_cluster_citations(
        db, brand_id=cluster.brand_id, prompt_id=cluster.prompt_id,
    )
    if raw_citations:
        ranked = rank_and_tier(raw_citations)
        pack_sources = _merge_user(user_sources, ranked)[:PACK_CAP]
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
    try:
        raw = await fetch_and_dedupe(queries)
    except SearchUnavailableError:
        # Serper is throttled and returned nothing at all. Don't let that
        # defeat a user who has already supplied enough sources of their own
        # to clear the authority gate on their own merits — persist a
        # user-sources-only pack instead of forcing them to wait out the
        # provider outage. If the user sources alone don't clear the gate,
        # there's nothing to fall back to, so re-raise as before.
        user_pack_sources = user_sources[:PACK_CAP]
        if user_pack_sources and pack_meets_gate(user_pack_sources):
            logger.info(
                "cluster %d: Serper unavailable but user sources alone pass "
                "the gate — persisting user-only pack",
                cluster.id,
            )
            return await _persist_pack(
                db, cluster=cluster, pack_sources=user_pack_sources, version=version,
            )
        raise
    ranked = rank_and_tier(raw)
    pack_sources = _merge_user(user_sources, ranked)[:PACK_CAP]
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
        # Carry a real snippet so the claim verifier / citation critic can judge
        # support from the brand's own words rather than an empty string.
        profile_snippet = " ".join(
            s for s in (profile.company_description, profile.key_stats) if s
        ).strip()[:600]
        sources.append({
            "url": "internal://brand-profile",
            "domain": "brand-profile",
            "tier": "brand",
            "title": "Brand profile (first-party)",
            "snippet": profile_snippet,
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
                "snippet": (getattr(p, "content_excerpt", None) or "")[:600],
            })

    if not sources:
        return None

    return await _persist_pack(
        db, cluster=cluster, pack_sources=sources, version=version,
    )


# ---------------------------------------------------------------------------
# Task 8: ungated low-evidence fallback — never hard-fail to nothing
# ---------------------------------------------------------------------------


async def build_cluster_pack_ungated(
    db: AsyncSession,
    *,
    cluster: ContentCluster,
    sources: list[dict],
    version: int,
) -> ContentEvidencePack:
    """Persist a pack that failed the authority gate. The claim verifier +
    ready_low_evidence status keep thin sourcing honest downstream.

    Used only when the brand-authority soft-fail pack also came back empty
    (no BrandProfile, no crawled site) but the web DID return sources — e.g.
    a handful of low-authority (T3) blogs. Rather than hard-failing the
    brief, we proceed ungated: the writer gets real, if thin, sourcing and
    the claim verifier strips anything the sources don't actually support.
    """
    return await _persist_pack(
        db, cluster=cluster, pack_sources=sources[:PACK_CAP], version=version,
    )
