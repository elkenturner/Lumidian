"""Site crawler — sitemap discovery + BFS (BFS added in Task 7)."""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from app.services.site_audit.constants import (
    HOST_REQUESTS_PER_SECOND,
    PER_AUDIT_CONCURRENCY,
    PER_PAGE_TIMEOUT_S,
    normalise_url,
)
from app.services.site_audit.fetcher import fetch_raw

logger = logging.getLogger(__name__)

_LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>", re.IGNORECASE)
_HREF_RE = re.compile(r"<a[^>]+href=[\"']?([^\"'\s>]+)", re.IGNORECASE)


async def discover_sitemap_urls(root_url: str) -> tuple[list[str], str | None]:
    root_url = root_url.rstrip("/") + "/"
    candidates = [
        urljoin(root_url, "sitemap.xml"),
        urljoin(root_url, "sitemap_index.xml"),
        urljoin(root_url, "sitemap-index.xml"),
    ]
    for sm_url in candidates:
        res = await fetch_raw(sm_url, timeout_s=PER_PAGE_TIMEOUT_S)
        if res.status == 200 and res.html.strip():
            urls = await _expand(res.html)
            if urls:
                return urls, sm_url
    return [], None


async def _expand(body: str) -> list[str]:
    locs = [m.strip() for m in _LOC_RE.findall(body)]
    if not locs:
        return []
    if "<sitemapindex" in body.lower():
        all_urls: list[str] = []
        for child in locs[:50]:
            res = await fetch_raw(child)
            if res.status == 200 and res.html.strip():
                all_urls.extend(m.strip() for m in _LOC_RE.findall(res.html))
        return all_urls
    return locs


@dataclass
class CrawlPage:
    url: str
    depth: int
    status: int | None
    html: str
    fetch_ms: int | None
    error: str | None = None


class _HostRateLimiter:
    """Simple per-host token-bucket. Crawler waits before issuing next request to same host."""

    def __init__(self, rps: float):
        self.delay = 1.0 / rps if rps > 0 else 0
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def wait(self, host: str) -> None:
        if not self.delay:
            return
        loop = asyncio.get_event_loop()
        async with self._lock:
            now = loop.time()
            last = self._last.get(host, 0)
            wait_for = max(0.0, (last + self.delay) - now)
            self._last[host] = now + wait_for
        if wait_for > 0:
            await asyncio.sleep(wait_for)


async def crawl_site(
    root_url: str,
    *,
    max_pages: int,
    max_depth: int = 3,
    seed_urls: list[str] | None = None,
    cancel_event: asyncio.Event | None = None,
) -> list[CrawlPage]:
    """BFS internal-only crawl. Returns CrawlPage list (one per fetched URL)."""
    root = normalise_url(root_url)
    host = urlparse(root).netloc

    queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
    seen: set[str] = set()
    pages: list[CrawlPage] = []
    sem = asyncio.Semaphore(PER_AUDIT_CONCURRENCY)
    limiter = _HostRateLimiter(HOST_REQUESTS_PER_SECOND)

    starting = seed_urls if seed_urls else [root]
    for u in starting:
        try:
            n = normalise_url(u)
        except ValueError:
            continue
        if urlparse(n).netloc != host:
            continue
        if n not in seen:
            seen.add(n)
            await queue.put((n, 0))

    async def _worker():
        while True:
            try:
                url, depth = await asyncio.wait_for(queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if queue.empty():
                    return
                continue
            try:
                if cancel_event and cancel_event.is_set():
                    return
                if len(pages) >= max_pages:
                    return
                async with sem:
                    await limiter.wait(host)
                    res = await fetch_raw(url)
                pages.append(CrawlPage(
                    url=url, depth=depth, status=res.status, html=res.html,
                    fetch_ms=res.fetch_ms, error=res.error,
                ))
                if depth < max_depth and res.html:
                    for link in _extract_internal_links(res.html, url, host):
                        if link not in seen and len(seen) < max_pages * 3:
                            seen.add(link)
                            await queue.put((link, depth + 1))
            finally:
                queue.task_done()

    workers = [asyncio.create_task(_worker()) for _ in range(PER_AUDIT_CONCURRENCY)]
    await asyncio.gather(*workers, return_exceptions=True)
    return pages[:max_pages]


def _extract_internal_links(html: str, base_url: str, host: str) -> list[str]:
    out: list[str] = []
    for raw in _HREF_RE.findall(html):
        if raw.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = urljoin(base_url, raw)
        try:
            n = normalise_url(absolute)
        except ValueError:
            continue
        if urlparse(n).netloc != host:
            continue
        out.append(n)
    return out
