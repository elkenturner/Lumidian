"""JSON-LD schema parser."""
from __future__ import annotations

import json
import re
from typing import Any

from app.services.site_audit.parsers import Finding, ParseOutput

_LD_BLOCK_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def parse_schema(html: str, url: str, page_type: str) -> ParseOutput:
    findings: list[Finding] = []
    types_found: list[str] = []
    nodes_by_type: dict[str, list[dict]] = {}

    blocks = _LD_BLOCK_RE.findall(html or "")
    has_blocks = bool(blocks)
    any_parsed = False

    for raw in blocks:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            findings.append(Finding("malformed_jsonld", "high", "schema",
                                    f"JSON-LD block could not be parsed: {exc}",
                                    {"snippet": raw[:300]}))
            continue
        any_parsed = True
        for node in _iter_nodes(data):
            t = node.get("@type")
            if isinstance(t, list):
                t = next((x for x in t if isinstance(x, str)), None)
            if isinstance(t, str):
                types_found.append(t)
                nodes_by_type.setdefault(t, []).append(node)

    if not has_blocks:
        findings.append(Finding("no_jsonld", "medium", "schema",
                                "Page has no JSON-LD schema blocks.", {}))

    # Organization (homepage only)
    if page_type == "homepage":
        org_nodes = nodes_by_type.get("Organization", [])
        if not org_nodes:
            findings.append(Finding("missing_organization_schema", "high", "schema",
                                    "Homepage is missing Organization JSON-LD.", {}))
        else:
            org = org_nodes[0]
            missing = [k for k in ("name", "url", "logo", "sameAs") if not org.get(k)]
            if missing:
                findings.append(Finding("incomplete_organization_schema", "medium", "schema",
                                        f"Organization schema is missing: {', '.join(missing)}",
                                        {"missing": missing}))

    # Article / BlogPosting
    if page_type == "article":
        article_nodes = nodes_by_type.get("Article", []) + nodes_by_type.get("BlogPosting", [])
        if article_nodes:
            a = article_nodes[0]
            author = a.get("author")
            if not author or (isinstance(author, dict) and not author.get("@type") == "Person"):
                findings.append(Finding("article_missing_author", "medium", "schema",
                                        "Article schema lacks Person-typed author.", {}))
            if not (a.get("datePublished") or a.get("dateModified")):
                findings.append(Finding("article_missing_dates", "medium", "schema",
                                        "Article schema lacks datePublished/dateModified.", {}))

    # Product
    if nodes_by_type.get("Product"):
        p = nodes_by_type["Product"][0]
        missing = [k for k in ("name", "description", "offers") if not p.get(k)]
        if missing:
            findings.append(Finding("product_missing_required", "medium", "schema",
                                    f"Product schema missing: {', '.join(missing)}",
                                    {"missing": missing}))

    # FAQPage with no questions
    for f in nodes_by_type.get("FAQPage", []):
        if not f.get("mainEntity"):
            findings.append(Finding("faqpage_no_questions", "high", "schema",
                                    "FAQPage schema declared but has no Q&A entries.", {}))
            break

    # schema_content_mismatch sanity: compare schema headline/name to page <title>
    title_match = re.search(r"<title[^>]*>([^<]*)</title>", html or "", re.IGNORECASE)
    title_text = title_match.group(1).strip() if title_match else ""
    if title_text:
        for node in (nodes_by_type.get("Article", []) +
                     nodes_by_type.get("BlogPosting", []) +
                     nodes_by_type.get("WebPage", [])):
            headline = (node.get("headline") or node.get("name") or "").strip()
            if headline and headline not in title_text and title_text not in headline:
                findings.append(Finding("schema_content_mismatch", "low", "schema",
                                        "JSON-LD headline/name doesn't match the page <title>.",
                                        {"title": title_text[:120], "schema_headline": headline[:120]}))
                break

    measurements = {
        "has_jsonld": any_parsed,
        "schema_types": sorted(set(types_found)),
    }
    return ParseOutput(measurements=measurements, findings=findings)


def _iter_nodes(data: Any) -> list[dict]:
    """Yield all JSON-LD nodes; handles @graph + lists."""
    out: list[dict] = []
    if isinstance(data, list):
        for item in data:
            out.extend(_iter_nodes(item))
    elif isinstance(data, dict):
        if "@graph" in data and isinstance(data["@graph"], list):
            for item in data["@graph"]:
                out.extend(_iter_nodes(item))
        else:
            out.append(data)
    return out
