"""
Evidence retrieval layer for the drafting pipeline.

Assembles an EvidencePack from three sources:
  (a) the brand's own crawled pages (WebsiteAuditPage)
  (b) live Serper web search
  (c) the user-curated BrandSource library

The pack is injected into the drafting prompt as inline-citable sources [S1]..[SN].
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime, UTC, timedelta
from typing import Literal

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WebsiteAudit, WebsiteAuditPage, BrandSource, EvidenceCache

logger = logging.getLogger(__name__)

_CACHE_WRITE_LOCK = asyncio.Lock()  # serialize in-process evidence_cache writers

PACK_CAP = 15
BRAND_PAGE_LIMIT = 3
WEB_RESULT_LIMIT = 5
BRAND_SOURCE_LIMIT = 10
CACHE_TTL_HOURS = 24

EvidenceKind = Literal["brand_page", "web", "library"]


@dataclass
class EvidenceSource:
    ref: str
    kind: EvidenceKind
    url: str
    title: str
    snippet: str
    published_date: str | None = None


@dataclass
class EvidencePack:
    sources: list[EvidenceSource]
    query: str
    brand_name: str

    def to_dict(self) -> dict:
        return {
            "sources": [asdict(s) for s in self.sources],
            "query": self.query,
            "brand_name": self.brand_name,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EvidencePack":
        return cls(
            sources=[EvidenceSource(**s) for s in data.get("sources", [])],
            query=data.get("query", ""),
            brand_name=data.get("brand_name", ""),
        )


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def _score_page(prompt_tokens: set[str], page: WebsiteAuditPage) -> float:
    page_tokens = _tokens((page.title or "") + " " + (page.h1_text or ""))
    if not page_tokens or not prompt_tokens:
        return 0.0
    overlap = len(prompt_tokens & page_tokens) / max(1, len(prompt_tokens))
    return overlap * 0.7 + (page.fact_density or 0.0) * 0.3


async def select_brand_pages(
    brand_id: int,
    prompt_text: str,
    db: AsyncSession,
    limit: int = BRAND_PAGE_LIMIT,
) -> list[EvidenceSource]:
    """Top-N pages from the most recent completed WebsiteAudit, ranked by prompt relevance."""
    audit_result = await db.execute(
        select(WebsiteAudit)
        .where(WebsiteAudit.brand_id == brand_id, WebsiteAudit.status == "completed")
        .order_by(desc(WebsiteAudit.completed_at), desc(WebsiteAudit.id))
        .limit(1)
    )
    audit = audit_result.scalar_one_or_none()
    if audit is None:
        return []

    pages_result = await db.execute(
        select(WebsiteAuditPage).where(WebsiteAuditPage.audit_id == audit.id)
    )
    pages = list(pages_result.scalars().all())

    prompt_tokens = _tokens(prompt_text)
    ranked = sorted(pages, key=lambda p: _score_page(prompt_tokens, p), reverse=True)
    top = [p for p in ranked if _score_page(prompt_tokens, p) > 0][:limit]

    return [
        EvidenceSource(
            ref="",  # ref assigned during pack assembly
            kind="brand_page",
            url=p.url,
            title=(p.title or p.url)[:200],
            snippet=(p.content_excerpt or "")[:600],
            published_date=None,
        )
        for p in top
    ]


# ── Web search (Serper) ─────────────────────────────────────────────────────

_AUTHORITY_HINTS = (
    ".gov", ".edu", "pubmed", "nature.com", "sciencemag.org", "nih.gov",
    "nejm.org", "thelancet.com", "bmj.com", "sciencedirect.com",
    "mit.edu", "stanford.edu", "harvard.edu", "ox.ac.uk", "cam.ac.uk",
    "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "economist.com",
    "wired.com", "arstechnica.com", "ieee.org", "acm.org",
)
_AGGREGATOR_BLOCKLIST = (
    "reddit.com", "quora.com", "pinterest.", "medium.com/@", "youtube.com",
    "content-aggregator", "forum-spam",
)


def _domain_authority_score(url: str) -> float:
    u = url.lower()
    if any(b in u for b in _AGGREGATOR_BLOCKLIST):
        return -1.0
    if any(a in u for a in _AUTHORITY_HINTS):
        return 1.0
    return 0.0


class SerperRateLimitError(Exception):
    """Raised when Serper trips its undocumented rate limit.

    Serper returns HTTP 400 with body 'Query not allowed. Contact support.'
    under burst load instead of a 429. We surface it as a distinct exception
    so callers can decide whether to retry, fall back, or fail the gate with
    a clearer message than a silent empty result.
    """


def _is_serper_rate_limit(resp: object, body_text: str | None = None) -> bool:
    """True if a Serper response looks like the 'Query not allowed' throttle."""
    status = getattr(resp, "status_code", None)
    if status == 429:
        return True
    if status == 400 and body_text and "query not allowed" in body_text.lower():
        return True
    return False


SERPER_RETRY_DELAYS = (1.0, 2.0, 4.0)  # exponential backoff between attempts


async def _serper_search(
    query: str, num: int = 10, raise_on_rate_limit: bool = False,
) -> list[dict]:
    """
    General-web Serper search (not site-scoped). Returns a list of dicts each
    containing at minimum ``link`` (or ``url``), ``title``, ``snippet`` and
    optionally ``date``. Isolated as its own function so tests can mock it.

    Retries up to ``len(SERPER_RETRY_DELAYS)`` times on the 'Query not allowed'
    rate-limit signal; non-rate-limit errors are returned as an empty list
    after a single attempt (preserving the prior swallow-and-continue behavior
    for genuine no-results / transient outages).

    ``raise_on_rate_limit`` (default False, preserving System B's — i.e.
    per-piece drafting's — silent-empty-on-throttle behavior): when True, once
    every retry is exhausted and the failure was a rate limit, re-raise the
    ``SerperRateLimitError`` instead of swallowing it as ``[]``. Used by the
    cluster evidence path so a provider outage is distinguishable from a
    genuine "no authoritative sources exist" result.
    """
    import asyncio
    import os
    import httpx

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning("Serper search: SERPER_API_KEY not configured — returning empty")
        return []

    from app.services.serper_search_service import SERPER_SEMAPHORE

    last_rate_limit: Exception | None = None
    for attempt in range(len(SERPER_RETRY_DELAYS) + 1):
        try:
            async with SERPER_SEMAPHORE:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.post(
                        "https://google.serper.dev/search",
                        headers={
                            "X-API-KEY": api_key,
                            "Content-Type": "application/json",
                        },
                        json={"q": query, "num": num},
                    )
            if _is_serper_rate_limit(resp, body_text=resp.text):
                last_rate_limit = SerperRateLimitError(
                    f"Serper rate-limited (HTTP {resp.status_code}) on attempt {attempt + 1}"
                )
                if attempt < len(SERPER_RETRY_DELAYS):
                    delay = SERPER_RETRY_DELAYS[attempt]
                    logger.warning(
                        "Serper rate-limited for %r, retrying in %.1fs (attempt %d/%d)",
                        query, delay, attempt + 1, len(SERPER_RETRY_DELAYS) + 1,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.warning(
                    "Serper rate-limited for %r after %d attempts — returning empty",
                    query, attempt + 1,
                )
                if raise_on_rate_limit:
                    raise last_rate_limit
                return []
            resp.raise_for_status()
            data = resp.json()
            return data.get("organic", []) or []
        except SerperRateLimitError:
            raise  # already handled in the rate-limit branch
        except Exception as exc:
            logger.warning("Serper search failed for %r: %s", query, exc)
            return []

    if last_rate_limit is not None:
        logger.warning("Serper exhausted retries for %r: %s", query, last_rate_limit)
        if raise_on_rate_limit:
            raise last_rate_limit
    return []


async def select_web_sources(query: str, limit: int = WEB_RESULT_LIMIT) -> list[EvidenceSource]:
    raw = await _serper_search(query, num=10)
    scored: list[tuple[float, dict]] = []
    for item in raw:
        link = item.get("link") or item.get("url") or ""
        if not link:
            continue
        score = _domain_authority_score(link)
        if score < 0:
            continue
        scored.append((score, item))
    scored.sort(key=lambda x: x[0], reverse=True)
    sources: list[EvidenceSource] = []
    for _, item in scored[:limit]:
        sources.append(EvidenceSource(
            ref="",
            kind="web",
            url=item.get("link") or item.get("url") or "",
            title=(item.get("title") or "")[:200],
            snippet=(item.get("snippet") or "")[:600],
            published_date=item.get("date"),
        ))
    return sources


# ── BrandSource library ─────────────────────────────────────────────────────

async def select_library_sources(brand_id: int, db: AsyncSession) -> list[EvidenceSource]:
    result = await db.execute(
        select(BrandSource)
        .where(BrandSource.brand_id == brand_id)
        .order_by(desc(BrandSource.added_at))
        .limit(BRAND_SOURCE_LIMIT)
    )
    rows = list(result.scalars().all())
    return [
        EvidenceSource(
            ref="",
            kind="library",
            url=row.url,
            title=row.title[:200],
            snippet=(row.snippet or "")[:600],
            published_date=None,
        )
        for row in rows
    ]


# ── Cache ───────────────────────────────────────────────────────────────────

import json as _json


async def write_cache(brand_id: int, prompt_id: int, pack: EvidencePack, db: AsyncSession) -> None:
    """Best-effort cache write. NEVER raises and never leaves `db` poisoned —
    a cache miss on the next call is strictly cheaper than a failed piece."""
    payload = _json.dumps(pack.to_dict())
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        async with _CACHE_WRITE_LOCK:
            existing = await db.get(EvidenceCache, (brand_id, prompt_id))
            if existing:
                existing.pack_json = payload
                existing.fetched_at = now
            else:
                db.add(EvidenceCache(
                    brand_id=brand_id, prompt_id=prompt_id,
                    pack_json=payload, fetched_at=now,
                ))
            await db.commit()
    except Exception as exc:
        logger.warning("evidence_cache write failed for brand %d prompt %d (non-fatal): %s",
                       brand_id, prompt_id, exc)
        try:
            await db.rollback()
        except Exception:
            pass


async def read_cache(brand_id: int, prompt_id: int, db: AsyncSession) -> EvidencePack | None:
    row = await db.get(EvidenceCache, (brand_id, prompt_id))
    if row is None:
        return None
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=CACHE_TTL_HOURS)
    if row.fetched_at < cutoff:
        return None
    try:
        return EvidencePack.from_dict(_json.loads(row.pack_json))
    except Exception:
        return None


# ── Top-level assembly ──────────────────────────────────────────────────────

async def build_evidence_pack(
    brand_id: int,
    brand_name: str,
    prompt_id: int,
    prompt_text: str,
    db: AsyncSession,
    use_cache: bool = True,
) -> EvidencePack:
    """
    Assemble the Evidence Pack from library + brand pages + web search.

    Library sources always fold in fresh from the DB. Brand pages + web search
    are cached together for CACHE_TTL_HOURS.
    """
    cached_web_and_brand: list[EvidenceSource] = []
    used_cache = False
    if use_cache:
        cached = await read_cache(brand_id=brand_id, prompt_id=prompt_id, db=db)
        if cached is not None:
            cached_web_and_brand = [s for s in cached.sources if s.kind in ("web", "brand_page")]
            used_cache = True

    if not used_cache:
        brand_pages = await select_brand_pages(
            brand_id=brand_id, prompt_text=prompt_text, db=db, limit=BRAND_PAGE_LIMIT,
        )
        web_sources = await select_web_sources(query=prompt_text, limit=WEB_RESULT_LIMIT)
        cached_web_and_brand = brand_pages + web_sources

    library_sources = await select_library_sources(brand_id=brand_id, db=db)

    # Priority order: library > brand pages > web.
    merged = library_sources + cached_web_and_brand
    merged = merged[:PACK_CAP]
    for idx, src in enumerate(merged, start=1):
        src.ref = f"S{idx}"

    pack = EvidencePack(sources=merged, query=prompt_text, brand_name=brand_name)

    if use_cache and not used_cache:
        cacheable = EvidencePack(
            sources=[s for s in cached_web_and_brand],
            query=prompt_text, brand_name=brand_name,
        )
        await write_cache(brand_id=brand_id, prompt_id=prompt_id, pack=cacheable, db=db)

    return pack
