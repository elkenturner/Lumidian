"""Generators for llms.txt and robots.txt AI-bot snippets."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BrandSummary:
    name: str
    website_url: str
    description: str | None


@dataclass
class KeyPage:
    url: str
    title: str
    page_type: str
    score: float


def build_llms_txt(brand: BrandSummary, key_pages: list[KeyPage]) -> str:
    """Build a spec-compliant llms.txt for a brand."""
    lines: list[str] = []
    lines.append(f"# {brand.name}")
    lines.append("")
    if brand.description:
        lines.append(f"> {brand.description}")
        lines.append("")
        lines.append("## About")
        lines.append("")
        lines.append(brand.description)
        lines.append("")

    lines.append("## Key resources")
    lines.append("")
    primary_types = {"homepage", "pricing", "product", "docs"}
    primary = [p for p in key_pages if p.page_type in primary_types]
    optional = [p for p in key_pages if p.page_type not in primary_types]

    if not primary:
        # Skeleton
        root = brand.website_url.rstrip("/")
        lines.append(f"- [Homepage]({root}/) — what {brand.name} is")
        lines.append(f"- [Pricing]({root}/pricing) — what it costs")
        lines.append(f"- [Docs]({root}/docs) — technical detail")
    else:
        # Sort by score desc, dedup by page_type with highest score
        seen_types: set[str] = set()
        for page in sorted(primary, key=lambda p: -p.score):
            if page.page_type in seen_types:
                continue
            seen_types.add(page.page_type)
            blurb = _blurb_for(page.page_type, brand.name)
            lines.append(f"- [{page.title}]({page.url}) — {blurb}")

    if optional:
        lines.append("")
        lines.append("## Optional")
        lines.append("")
        for page in sorted(optional, key=lambda p: -p.score)[:5]:
            lines.append(f"- [{page.title}]({page.url})")

    return "\n".join(lines) + "\n"


def _blurb_for(page_type: str, brand_name: str) -> str:
    return {
        "homepage": f"what {brand_name} is",
        "pricing": "pricing and plans",
        "product": "product details",
        "docs": "documentation",
    }.get(page_type, "")


_ALL_BOTS_ALLOW = [
    "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot",
    "Google-Extended", "Meta-ExternalAgent",
]


def build_robots_snippet(mode: str) -> str:
    if mode == "allow_all":
        lines: list[str] = ["# AI crawler access (managed by Lumidian)"]
        for bot in _ALL_BOTS_ALLOW:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Allow: /")
        return "\n".join(lines) + "\n"

    if mode == "search_only":
        # Block training, allow live-search bots
        train_block = ["GPTBot", "ClaudeBot", "Google-Extended"]
        search_allow = ["OAI-SearchBot", "PerplexityBot"]
        lines = ["# Block AI training, allow AI live search (managed by Lumidian)"]
        for bot in train_block:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Disallow: /")
        for bot in search_allow:
            lines.append("")
            lines.append(f"User-agent: {bot}")
            lines.append("Allow: /")
        return "\n".join(lines) + "\n"

    raise ValueError(f"unknown mode: {mode}")
