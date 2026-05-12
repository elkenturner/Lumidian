"""Semantic-HTML parser. Detects heading hygiene, lists/tables, fact density, etc."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding, ParseOutput

_NUMBER_RE = re.compile(r"\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b")
_DATE_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
_FAKE_BULLET_RE = re.compile(r"^\s*[•\-\*]\s")
_PRONOUN_LEADING_RE = re.compile(r"^\s*(It|They|This|That|These|Those|He|She|We)\b", re.IGNORECASE)


def parse_semantic(html: str, url: str) -> ParseOutput:
    soup = BeautifulSoup(html or "", "lxml")
    body = soup.body or soup
    findings: list[Finding] = []

    # Heading inventory
    h1s = body.find_all("h1")
    h2s = body.find_all("h2")
    h3s = body.find_all("h3")

    if not h1s:
        findings.append(Finding("missing_h1", "high", "content", "Page has no <h1> heading.",
                                {"h2_count": len(h2s)}))
    elif len(h1s) > 1:
        findings.append(Finding("multiple_h1", "medium", "content",
                                f"Page has {len(h1s)} <h1> tags; expected exactly one.",
                                {"count": len(h1s)}))

    if not h2s and h1s:
        findings.append(Finding("no_h2", "medium", "content",
                                "Page has H1 but no H2 sections — content isn't chunkable.",
                                {}))

    # Heading skip: h3 before any h2 in document order
    seen_h2 = False
    for tag in body.find_all(["h2", "h3"]):
        if tag.name == "h2":
            seen_h2 = True
        elif tag.name == "h3" and not seen_h2:
            findings.append(Finding("heading_hierarchy_skip", "low", "content",
                                    "An <h3> appears before any <h2>.", {}))
            break

    # Lists, tables
    tables = body.find_all("table")
    lists = body.find_all(["ul", "ol"])
    list_count = len(lists)
    table_count = len(tables)

    paragraphs = body.find_all("p")
    fake_bullet_paras = [p for p in paragraphs if p.get_text(strip=True) and _FAKE_BULLET_RE.match(p.get_text())]
    if len(fake_bullet_paras) >= 3:
        findings.append(Finding("fake_lists", "low", "content",
                                "Detected multiple paragraphs starting with bullet characters; use <ul>/<ol>.",
                                {"count": len(fake_bullet_paras)}))

    # Word count + fact density
    text = body.get_text(" ", strip=True)
    word_count = len(text.split())
    numbers = len(_NUMBER_RE.findall(text))
    dates = len(_DATE_RE.findall(text))
    propers = len(_PROPER_NOUN_RE.findall(text))
    fact_density = ((numbers + dates + propers) / max(word_count, 1)) * 1000.0

    if word_count >= 200 and fact_density < 5:
        findings.append(Finding("fact_density_low", "medium", "content",
                                f"Fact density {fact_density:.1f}/1k words is low; add specific numbers, dates, or named entities.",
                                {"fact_density": fact_density, "word_count": word_count}))

    # Pronoun overuse
    leading_pronouns = sum(1 for p in paragraphs if _PRONOUN_LEADING_RE.match(p.get_text() or ""))
    if word_count > 0 and leading_pronouns / max(word_count, 1) * 1000 > 8:
        findings.append(Finding("pronoun_overuse", "low", "content",
                                "Many paragraphs start with pronouns — passages lose context when extracted.",
                                {"leading_pronouns": leading_pronouns, "word_count": word_count}))

    # Outbound vs internal links
    host = urlparse(url).netloc
    outbound = 0
    internal = 0
    for a in body.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        if host in href or href.startswith("/"):
            internal += 1
        else:
            outbound += 1

    if outbound == 0 and word_count > 200:
        findings.append(Finding("no_outbound_citations", "low", "authority",
                                "Page has zero outbound links — add citations to sources.",
                                {"word_count": word_count}))

    # Answer-first: each H2 section should start with a substantive paragraph (no leading pronoun)
    failed_h2 = 0
    for h2 in h2s:
        # Find the first <p> sibling
        p = h2.find_next_sibling()
        while p is not None and p.name != "p":
            p = p.find_next_sibling()
        first_words = (p.get_text(" ", strip=True).split()[:75] if p else [])
        if not first_words:
            failed_h2 += 1
            continue
        snippet = " ".join(first_words)
        if _PRONOUN_LEADING_RE.match(snippet):
            failed_h2 += 1
    if h2s and failed_h2 / len(h2s) > 0.5:
        findings.append(Finding("answer_first_failed", "medium", "content",
                                "More than half of <h2> sections don't start with a self-contained answer.",
                                {"failed": failed_h2, "total": len(h2s)}))

    measurements = {
        "word_count": word_count,
        "h1_text": h1s[0].get_text(strip=True) if h1s else None,
        "h2_count": len(h2s),
        "h3_count": len(h3s),
        "table_count": table_count,
        "list_count": list_count,
        "fact_density": round(fact_density, 2),
        "outbound_links": outbound,
        "internal_links": internal,
    }
    return ParseOutput(measurements=measurements, findings=findings)
