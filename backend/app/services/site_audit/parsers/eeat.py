"""E-E-A-T parser: author byline, publication/update dates, outbound citations.

These are AI-search signals — content without authorship + dates reads as
anonymous marketing copy, which downweights it in citation-based retrieval.

Only fires on article/blog pages — product/landing pages don't need bylines.
"""
from __future__ import annotations

from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding


_ARTICLE_TYPES = {"article", "post", "blog"}


def parse_eeat(soup: BeautifulSoup, url: str, page_type: str) -> list[Finding]:
    findings: list[Finding] = []
    if page_type not in _ARTICLE_TYPES:
        return findings

    # ── Author byline ────────────────────────────────────────────────────────
    has_rel_author = soup.find(attrs={"rel": "author"}) is not None
    has_byline_class = (
        soup.find(class_=lambda c: c and "byline" in str(c).lower()) is not None
    )
    has_meta_author = soup.find("meta", attrs={"name": "author"}) is not None
    has_author_schema = False
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        text = (tag.string or "") + (tag.text or "")
        if '"author"' in text.lower():
            has_author_schema = True
            break

    if not (has_rel_author or has_byline_class or has_meta_author or has_author_schema):
        findings.append(Finding(
            "missing_author_byline",
            "medium",
            "authority",
            "Article has no author byline (no rel='author', .byline, <meta name='author'>, or schema.author).",
            {},
        ))

    # ── Published date ───────────────────────────────────────────────────────
    has_time_tag = soup.find("time") is not None
    has_pubtime_meta = soup.find(
        "meta", attrs={"property": "article:published_time"}
    ) is not None
    has_date_schema = False
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        text = (tag.string or "") + (tag.text or "")
        if '"datepublished"' in text.lower():
            has_date_schema = True
            break

    if not (has_time_tag or has_pubtime_meta or has_date_schema):
        findings.append(Finding(
            "missing_published_date",
            "high",
            "authority",
            "Article has no visible or structured published date (<time>, article:published_time, or schema.datePublished).",
            {},
        ))

    # ── Outbound citations on long-form ──────────────────────────────────────
    text = (soup.body or soup).get_text(" ", strip=True) if soup.body else ""
    word_count = len(text.split())
    if word_count >= 500:
        host = urlparse(url).netloc
        outbound = 0
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith(("mailto:", "tel:", "javascript:", "#", "/")):
                continue
            if host and host in href:
                continue
            if href.startswith(("http://", "https://")):
                outbound += 1
        if outbound == 0:
            findings.append(Finding(
                "missing_outbound_citations",
                "medium",
                "authority",
                "Long-form article (≥500 words) has no outbound links to other domains.",
                {"word_count": word_count},
            ))

    return findings
