"""
Drafting Service subpackage.
Re-exports public API from submodules.
"""
from .client import call_claude
from .pipeline import (
    clean_wiki_text,
    estimate_visibility_impact,
    extract_title_and_body,
    parse_wikipedia_draft,
    remove_hedging,
)
from .platforms import (
    ALL_PLATFORMS,
    CONTENT_PLATFORMS,
    PLATFORM_MAX_TOKENS,
    PLATFORM_SPECS,
    build_subreddit_strategy,
    classify_subreddit,
)
from .prompts import WIKIPEDIA_SYSTEM_PROMPT, build_prompt, build_wikipedia_prompt

__all__ = [
    "PLATFORM_SPECS", "ALL_PLATFORMS", "CONTENT_PLATFORMS", "PLATFORM_MAX_TOKENS",
    "classify_subreddit", "build_subreddit_strategy",
    "build_prompt", "build_wikipedia_prompt", "WIKIPEDIA_SYSTEM_PROMPT",
    "call_claude",
    "remove_hedging", "clean_wiki_text", "parse_wikipedia_draft",
    "extract_title_and_body", "estimate_visibility_impact",
]
