"""Title, meta description, byline, dates, image alt coverage."""
from __future__ import annotations

import re
from datetime import datetime, UTC

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding, ParseOutput

_DATE_TEXT_RE = re.compile(r"\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b")
_BYLINE_TEXT_RE = re.compile(r"\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+", re.IGNORECASE)


def parse_meta(html: str, url: str, page_type: str) -> ParseOutput:
    findings: list[Finding] = []
    soup = BeautifulSoup(html or "", "lxml")

    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None
    desc_tag = soup.find("meta", attrs={"name": "description"})
    desc = (desc_tag.get("content") if desc_tag else None) or None

    if not title:
        findings.append(Finding("missing_title", "high", "content",
                                "Page has no <title> or it is empty.", {}))
    else:
        if len(title) > 70:
            findings.append(Finding("title_too_long", "low", "content",
                                    f"<title> is {len(title)} chars; aim for ≤ 70.",
                                    {"length": len(title)}))
        if page_type != "homepage" and len(title) < 20:
            findings.append(Finding("title_too_short", "low", "content",
                                    f"<title> is {len(title)} chars; consider expanding.",
                                    {"length": len(title)}))

    if not desc:
        findings.append(Finding("missing_meta_description", "medium", "content",
                                "Page has no meta description.", {}))
    else:
        if len(desc) < 70 or len(desc) > 160:
            findings.append(Finding("meta_description_length", "low", "content",
                                    f"Meta description is {len(desc)} chars; aim for 70–160.",
                                    {"length": len(desc)}))

    if page_type == "article":
        text = soup.get_text(" ", strip=True)
        if not _BYLINE_TEXT_RE.search(text) and not soup.find(attrs={"itemprop": "author"}):
            findings.append(Finding("missing_byline", "medium", "authority",
                                    "Article page lacks a visible byline.", {}))
        if not _DATE_TEXT_RE.search(text) and not soup.find("time"):
            findings.append(Finding("missing_update_date", "medium", "authority",
                                    "Article page lacks a visible publication/update date.", {}))
        # Stale-content check based on first ISO date found
        m = _DATE_TEXT_RE.search(text)
        if m:
            try:
                d = datetime.strptime(m.group(0), "%Y-%m-%d").replace(tzinfo=UTC)
                if (datetime.now(UTC) - d).days > 18 * 30:
                    findings.append(Finding("stale_content", "medium", "content",
                                            f"Most recent visible date is {m.group(0)}; content may be stale.",
                                            {"date": m.group(0)}))
            except ValueError:
                pass

    # Image alts
    imgs = soup.find_all("img")
    img_count = len(imgs)
    if img_count:
        good = sum(1 for i in imgs if (i.get("alt") or "").strip() and (i.get("alt") or "").strip().lower() != "image" and len(i.get("alt", "")) > 5)
        pct = good / img_count * 100.0
        if pct < 70:
            findings.append(Finding("low_alt_text_coverage", "low", "content",
                                    f"Only {pct:.0f}% of images have descriptive alt text.",
                                    {"image_count": img_count, "good": good}))
    else:
        pct = 0.0

    measurements = {
        "title": title,
        "meta_description": desc,
        "image_count": img_count,
        "image_alt_pct": round(pct, 1),
    }
    return ParseOutput(measurements=measurements, findings=findings)
