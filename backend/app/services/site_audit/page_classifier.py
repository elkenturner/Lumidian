"""URL + DOM → page_type classifier."""
from __future__ import annotations

import re
from urllib.parse import urlparse

_TITLE_RE = re.compile(r"<title[^>]*>([^<]*)</title>", re.IGNORECASE)
_ARTICLE_TAG_RE = re.compile(r"<article[\s>]", re.IGNORECASE)


def classify_page(url: str, html: str) -> str:
    path = (urlparse(url).path or "/").lower().rstrip("/")
    if path == "":
        return "homepage"

    title = ""
    m = _TITLE_RE.search(html or "")
    if m:
        title = m.group(1).strip().lower()

    if _matches(path, ["/pricing"]) or "pricing" in title:
        return "pricing"
    if _matches(path, ["/about", "/team", "/company"]):
        return "about"
    if _matches(path, ["/docs", "/documentation", "/api", "/help", "/support", "/guides"]):
        return "docs"
    if _matches(path, ["/blog", "/articles", "/posts", "/news", "/insights"]):
        return "article"
    if _ARTICLE_TAG_RE.search(html or ""):
        # only call it article if the DOM has a single dominant <article>
        if (html or "").lower().count("<article") <= 2:
            return "article"
    if _matches(path, ["/product", "/products", "/features", "/solutions", "/use-cases"]):
        return "product"
    return "other"


def _matches(path: str, prefixes: list[str]) -> bool:
    return any(prefix in path for prefix in prefixes)
