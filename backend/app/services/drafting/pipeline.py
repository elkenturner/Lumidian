"""
Post-processing pipeline helpers for the drafting service.
"""
from __future__ import annotations

import re as _re
from typing import Optional

# ── Wikipedia output cleaning ─────────────────────────────────────────────────

# Patterns that indicate the LLM leaked analysis/instructions into the wiki text
_ANALYSIS_LINE_RE = _re.compile(
    r"^\s*(\*{0,3}\s*)?"
    r"(analysis|missing (angle|information|context)|article to edit|"
    r"suggested (edit|insertion|text|paragraph)|what (is )?missing|"
    r"current narrative|note[:\s]|explanation|insight|instructions?"
    r")\b",
    _re.IGNORECASE,
)


def clean_wiki_text(text: str) -> str:
    """
    Strip analysis/instruction lines that Claude sometimes leaks into wiki output.
    Also remove markdown headers that aren't valid wiki syntax.
    """
    lines = text.splitlines()
    cleaned: list[str] = []
    for line in lines:
        # Drop analysis commentary lines
        if _ANALYSIS_LINE_RE.match(line):
            continue
        # Drop markdown headers (## Foo) — these are not wiki syntax
        if _re.match(r"^#{1,6}\s+\S", line):
            continue
        # Drop standalone bold-wrapped headings (**Heading**)
        if _re.match(r"^\s*\*{2,3}[^*\n]+\*{2,3}\s*$", line):
            continue
        cleaned.append(line)
    # Collapse runs of blank lines
    result = _re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned))
    return result.strip()


def parse_wikipedia_draft(raw: str) -> tuple[str, str, str, str, str]:
    """
    Robustly parse LLM output for Wikipedia drafts.
    Returns (article_title, article_url, section, insert_location, wiki_text).
    Handles bold markers, extra whitespace, and leading prose the LLM adds.
    """
    # Strip markdown bold/italic that Claude sometimes adds to field labels or values
    clean = _re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", raw)

    def _field(pattern: str) -> str:
        m = _re.search(pattern, clean, _re.IGNORECASE | _re.MULTILINE)
        if not m:
            return ""
        return _re.sub(r"\*+", "", m.group(1)).strip()

    article_title   = _field(r"^ARTICLE_TITLE:\s*(.+)$")
    article_url     = _field(r"^ARTICLE_URL:\s*(https?://[^\s]+)$")
    section         = _field(r"^SECTION:\s*(.+)$")
    insert_location = _field(r"^INSERT_LOCATION:\s*(.+)$")

    # Everything after WIKI_TEXT: (possibly on the same line or the next)
    wiki_match = _re.search(r"^WIKI_TEXT:\s*(.*)", clean, _re.MULTILINE)
    if wiki_match:
        inline = wiki_match.group(1).strip()
        rest_start = wiki_match.end()
        rest = clean[rest_start:].strip()
        wiki_raw = (inline + "\n" + rest).strip() if inline else rest
    else:
        wiki_raw = ""

    wiki_text = clean_wiki_text(wiki_raw) if wiki_raw else ""
    return article_title, article_url, section, insert_location, wiki_text


# ── Hedging phrase removal ────────────────────────────────────────────────────

_HEDGING_RE = _re.compile(
    # Compound forms must come before their standalone components so the full
    # phrase is consumed rather than leaving "More" or "Even more" dangling.
    r"\b(even more importantly,?|most importantly,?|more importantly,?|"
    r"even more notably,?|most notably,?|more notably,?|"
    r"it['']s worth noting|it['']s important to (note|mention)|notably,?|importantly,?|"
    r"it should be noted|it['']s important to note|one thing to note|it bears mentioning|"
    r"needless to say|of course,?|additionally,|furthermore,|moreover,|"
    r"honestly,?|straightforward(ly)?,?|genuinely,?|delve into|dive into|unpack,?|"
    r"let['']s explore|the bottom line is|the bottom line:|at the end of the day,?)\s*",
    _re.IGNORECASE,
)

# Matches lines that are internal analysis notes the LLM sometimes appends
_ANALYSIS_SECTION_RE = _re.compile(
    r"\n[\-\*_]{3,}\n.*?(analysis of missing angle|what this (reply|post|content) (does|fills|addresses)|"
    r"current (narrative|ai response)|missing angle|this (post|reply|answer|draft) (fills|addresses|explains)|"
    r"grounding theory|why this (works|matters|fills))",
    _re.IGNORECASE | _re.DOTALL,
)

# Match a separator line followed by an all-caps or bold analysis header
_ANALYSIS_HEADER_RE = _re.compile(
    r"(\n[\-\*_]{3,}\n|\n{2,})\*{0,2}(ANALYSIS OF MISSING ANGLE|MISSING ANGLE|WHAT THIS (POST|REPLY|CONTENT|DRAFT) (DOES|FILLS|ADDRESSES)|NOTE TO EDITOR)\*{0,2}[:\s].*",
    _re.IGNORECASE | _re.DOTALL,
)


def remove_hedging(text: str) -> str:
    """
    Strip em dashes, AI hedging phrases, markdown headers, and internal analysis
    notes from generated content. Em dashes (—) are replaced with a comma + space.
    """
    if not text:
        return text

    # Strip any internal analysis section the LLM appended after the actual content
    processed = _ANALYSIS_HEADER_RE.sub("", text)
    processed = _ANALYSIS_SECTION_RE.sub("", processed)

    # Strip markdown headers (## Heading, ### Heading) — not appropriate in any platform
    processed = _re.sub(r"^#{1,6}\s+(.+)$", r"\1", processed, flags=_re.MULTILINE)

    # Replace em dash used as a separator: "word — word" → "word, word"
    processed = _re.sub(r"\s*—\s*", ", ", processed)

    # Remove hedging phrases (they're filler, replace with nothing)
    processed = _HEDGING_RE.sub("", processed)

    # Clean up double spaces or leading comma artifacts
    processed = _re.sub(r"  +", " ", processed)
    processed = _re.sub(r"^,\s*", "", processed, flags=_re.MULTILINE)
    processed = processed.strip()

    return processed


# ── Title / body extraction ───────────────────────────────────────────────────

def extract_title_and_body(raw_text: str, platform: str) -> tuple[Optional[str], str]:
    """
    Extract title from the first line for Reddit and Medium.
    The prompt instructs Claude to separate title from body with a blank line.
    Strips markdown bold (**) and 'Title:' prefix if Claude adds them anyway.
    """
    title_platforms = {"reddit", "medium"}
    text = raw_text.strip()
    if platform not in title_platforms:
        return None, text

    # Split on first blank line so we cleanly separate title from body
    # when Claude uses the blank-line-separated format.
    if "\n\n" in text:
        first_block, rest = text.split("\n\n", 1)
        # Title block must be a single line (no internal newlines)
        if "\n" not in first_block.strip():
            candidate = first_block.strip()
            candidate = candidate.lstrip("#").strip().strip("*").strip()
            if candidate.lower().startswith("title:"):
                candidate = candidate[len("title:"):].strip()
            if 5 < len(candidate) <= 150 and not candidate.endswith((".", "?")):
                return candidate, rest.strip()

    # Fallback: try first newline only
    lines = text.split("\n", 1)
    first = lines[0].strip()
    first = first.lstrip("#").strip().strip("*").strip()
    if first.lower().startswith("title:"):
        first = first[len("title:"):].strip()
    if 5 < len(first) <= 150 and not first.endswith((".", "?")):
        body = lines[1].strip() if len(lines) > 1 else text
        return first, body
    return None, text


# ── Estimated visibility impact ───────────────────────────────────────────────

def estimate_visibility_impact(
    gap_score: float,
    visibility_pct: float,
    recent_posts: int,
) -> float:
    """
    Estimate the visibility impact of a draft (0–100).
    Higher = more likely to move the needle.

    Parameters
    ----------
    gap_score       : gap score for the prompt (0–100)
    visibility_pct  : current visibility percentage (0–100)
    recent_posts    : number of posts on the platform in the last 30 days
    """
    low_vis_bonus = max(0.0, (50.0 - visibility_pct))  # noqa: F841 — reserved for future weighting
    platform_bonus = 20.0 if recent_posts == 0 else max(0.0, 10.0 - recent_posts * 2)
    raw = gap_score * 0.8 + platform_bonus
    return round(min(100.0, raw), 1)
