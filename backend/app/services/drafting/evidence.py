"""
Evidence retrieval layer for the drafting pipeline.

Assembles an EvidencePack from three sources:
  (a) the brand's own crawled pages (WebsiteAuditPage)
  (b) live Serper web search
  (c) the user-curated BrandSource library

The pack is injected into the drafting prompt as inline-citable sources [S1]..[SN].
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime, UTC, timedelta
from typing import Literal

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WebsiteAudit, WebsiteAuditPage, BrandSource, EvidenceCache

logger = logging.getLogger(__name__)

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


async def _serper_search(query: str, num: int = 10) -> list[dict]:
    """
    General-web Serper search (not site-scoped). Returns a list of dicts each
    containing at minimum ``link`` (or ``url``), ``title``, ``snippet`` and
    optionally ``date``. Isolated as its own function so tests can mock it.

    The existing ``serper_search_service.search_site`` is site-scoped and sync;
    we issue our own httpx call here for an unrestricted query.
    """
    import asyncio
    import os
    import httpx

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        logger.warning("Serper search: SERPER_API_KEY not configured — returning empty")
        return []

    from app.services.serper_search_service import SERPER_SEMAPHORE

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
                resp.raise_for_status()
                data = resp.json()
    except Exception as exc:
        logger.warning("Serper search failed for %r: %s", query, exc)
        return []

    return data.get("organic", []) or []


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
