"""Q&A format parser: detects question/answer structure on pages.

AI search engines strongly favor Q&A content for direct-answer extraction.
This parser detects:
- Pure absence of any Q&A markup on long-form content
- Q&A visible to humans but missing FAQPage JSON-LD
- FAQPage schema present but with too few Q&A pairs to be useful
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from app.services.site_audit.parsers import Finding


_QUESTION_HEADING_RE = re.compile(
    r"^\s*(what|how|why|when|where|who|which|can|do|does|is|are|should|would|could)\b",
    re.IGNORECASE,
)


def _has_faq_schema(soup: BeautifulSoup) -> tuple[bool, int]:
    """Returns (has_faq, num_questions). num_questions is 0 if no FAQPage found."""
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        text = (tag.string or "") + (tag.text or "")
        lower = text.lower()
        if '"faqpage"' in lower or '"@type":"faqpage"' in lower.replace(" ", ""):
            # crude count: questions ≈ instances of "@type":"Question"
            count = lower.count('"question"')
            return True, count
    return False, 0


def parse_qa(soup: BeautifulSoup, url: str, page_type: str) -> list[Finding]:
    findings: list[Finding] = []
    body = soup.body or soup
    text = body.get_text(" ", strip=True)
    word_count = len(text.split())

    # ── Detect Q&A markup signals ────────────────────────────────────────────
    has_dl = bool(body.find("dl") and body.find_all(["dt", "dd"]))
    has_details = bool(body.find("details"))
    question_headings = [
        h for h in body.find_all(["h2", "h3"])
        if _QUESTION_HEADING_RE.match(h.get_text(strip=True) or "")
    ]
    has_question_headings = len(question_headings) >= 3
    has_visible_qa = has_dl or has_details or has_question_headings

    has_schema, schema_q_count = _has_faq_schema(soup)

    # ── Finding: no Q&A format at all on long content ────────────────────────
    if word_count >= 800 and not has_visible_qa and not has_schema:
        findings.append(Finding(
            "no_qa_format",
            "low",
            "content",
            "Long-form page (≥800 words) has no Q&A structure — AI search favors direct-answer formats.",
            {"word_count": word_count},
        ))

    # ── Finding: visible Q&A but no schema ───────────────────────────────────
    if has_visible_qa and not has_schema:
        findings.append(Finding(
            "qa_without_schema",
            "medium",
            "schema",
            "Page has Q&A content but no FAQPage JSON-LD — schema markup makes AI extraction reliable.",
            {
                "question_headings": len(question_headings),
                "has_dl": has_dl,
                "has_details": has_details,
            },
        ))

    # ── Finding: thin FAQ schema ─────────────────────────────────────────────
    if has_schema and 0 < schema_q_count < 3:
        findings.append(Finding(
            "qa_thin",
            "low",
            "schema",
            f"FAQPage schema has only {schema_q_count} questions — aim for 5-8 for meaningful coverage.",
            {"questions": schema_q_count},
        ))

    return findings
