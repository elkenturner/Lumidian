"""Internal linking parser. Runs at audit level, not per-page.

Builds a link graph from page measurements and emits per-page findings for
orphan pages, deep pages, and weak hubs. Each finding lands on the page it
targets so the recommendations engine ties to the right URL.
"""
from __future__ import annotations

from collections import defaultdict, deque
from urllib.parse import urldefrag, urlparse

from app.services.site_audit.parsers import Finding


def parse_linking(
    pages_by_url: dict[str, dict],
    root_url: str,
) -> dict[str, list[Finding]]:
    """Returns {url: [Finding…]} keyed by page url.

    pages_by_url: maps normalized URL → measurement dict containing at minimum:
        - "links": list[str] of in-domain absolute URLs found on that page
        - "http_status": int

    Pages with non-200 status are excluded from depth + inbound calculations
    but still receive findings if they were referenced.
    """
    # Normalize keys, build adjacency in-domain
    host = urlparse(root_url).netloc
    valid_urls = {
        u for u, m in pages_by_url.items()
        if m.get("http_status") == 200
    }
    adj: dict[str, set[str]] = defaultdict(set)
    inbound: dict[str, int] = defaultdict(int)

    for src, meas in pages_by_url.items():
        links = meas.get("links") or []
        for href in links:
            if not isinstance(href, str):
                continue
            href = urldefrag(href).url
            # Only count in-domain links that point to a crawled page
            if host and host not in href:
                continue
            if href in valid_urls and href != src:
                adj[src].add(href)
                inbound[href] += 1

    # BFS from root to compute depth
    root_normalized = root_url.rstrip("/") + "/"
    depth: dict[str, int] = {}
    seeds = [root_url, root_normalized, root_url.rstrip("/")]
    queue: deque[tuple[str, int]] = deque()
    for s in seeds:
        if s in valid_urls:
            depth[s] = 0
            queue.append((s, 0))
            break

    while queue:
        url, d = queue.popleft()
        for nxt in adj.get(url, ()):
            if nxt not in depth:
                depth[nxt] = d + 1
                queue.append((nxt, d + 1))

    findings_by_url: dict[str, list[Finding]] = defaultdict(list)

    for url in valid_urls:
        in_count = inbound.get(url, 0)
        page_meas = pages_by_url.get(url, {})
        page_type = page_meas.get("page_type", "other")

        if in_count == 0 and url != root_url and url != root_normalized:
            findings_by_url[url].append(Finding(
                "orphan_page",
                "medium",
                "technical",
                "Page has zero internal inbound links — AI crawlers may not discover it.",
                {"inbound_internal_links": 0},
            ))

        d = depth.get(url)
        if d is not None and d > 3:
            findings_by_url[url].append(Finding(
                "deep_page",
                "low",
                "technical",
                f"Page is {d} clicks from the homepage; AI crawlers tend to prioritize shallower content.",
                {"depth": d},
            ))

        if page_type == "hub":
            out_count = len(adj.get(url, ()))
            if out_count < 5:
                findings_by_url[url].append(Finding(
                    "weak_hub",
                    "medium",
                    "technical",
                    f"Hub page has only {out_count} internal outbound links; effective hubs link to 5+ child pages.",
                    {"outbound_internal_links": out_count},
                ))

    return findings_by_url
