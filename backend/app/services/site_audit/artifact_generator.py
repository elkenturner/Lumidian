"""Artifact generator: dispatch by artifact_type to per-type generators.

This module is the entry point for the "Draft this" button on Fix Cards
in the redesigned Site Audit UI. Each artifact_type maps to a function
that produces a paste-ready string (JSON-LD, HTML, plain text, etc.)
from the recommendation + brand profile + target page context.

Generators register themselves via @_register_rule or @_register_llm
decorators (added in Task 6). This module currently provides only the
type registry and ArtifactResult dataclass; the dispatcher lands in
Task 6.
"""
from __future__ import annotations

from dataclasses import dataclass

# All known artifact types. Each must map to a generator function before
# the dispatcher (Task 6) can serve it.
ARTIFACT_TYPES: set[str] = {
    "jsonld_org",
    "jsonld_faq",
    "jsonld_article",
    "jsonld_breadcrumb",
    "jsonld_product",
    "jsonld_howto",
    "meta_title",
    "meta_description",
    "h1_text",
    "og_tags",
    "faq_section",
    "section_rewrite",
    "new_page_draft",
    "alt_text_batch",
    "llms_txt",
    "robots_snippet",
    "agents_md",
    "internal_link_suggestions",
}

# Subset that requires an LLM call. The remainder are rule-based template fills.
LLM_ARTIFACT_TYPES: set[str] = {
    "jsonld_faq",
    "jsonld_article",
    "jsonld_product",
    "jsonld_howto",
    "meta_title",
    "meta_description",
    "h1_text",
    "og_tags",
    "faq_section",
    "section_rewrite",
    "new_page_draft",
    "alt_text_batch",
    "internal_link_suggestions",
}


@dataclass
class ArtifactResult:
    """Return type from any per-type generator function."""
    artifact: str
    artifact_type: str
