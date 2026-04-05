"""
Drafting Service subpackage.
Re-exports public API from submodules.
"""
from .platforms import (
    PLATFORM_SPECS, ALL_PLATFORMS, CONTENT_PLATFORMS, PLATFORM_MAX_TOKENS,
    classify_subreddit, build_subreddit_strategy,
)
from .prompts import build_prompt, build_wikipedia_prompt, WIKIPEDIA_SYSTEM_PROMPT
from .client import call_claude
from .pipeline import (
    remove_hedging, clean_wiki_text, parse_wikipedia_draft,
    extract_title_and_body, estimate_visibility_impact,
)

__all__ = [
    "PLATFORM_SPECS", "ALL_PLATFORMS", "CONTENT_PLATFORMS", "PLATFORM_MAX_TOKENS",
    "classify_subreddit", "build_subreddit_strategy",
    "build_prompt", "build_wikipedia_prompt", "WIKIPEDIA_SYSTEM_PROMPT",
    "call_claude",
    "remove_hedging", "clean_wiki_text", "parse_wikipedia_draft",
    "extract_title_and_body", "estimate_visibility_impact",
]
