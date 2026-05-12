"""Site crawler — sitemap discovery + BFS (BFS added in Task 7)."""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

from app.services.site_audit.constants import PER_PAGE_TIMEOUT_S
from app.services.site_audit.fetcher import fetch_raw

logger = logging.getLogger(__name__)

_LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>", re.IGNORECASE)


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
