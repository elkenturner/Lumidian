"""llms.txt fetch+validation per the proposed spec (https://llmstxt.org)."""
from __future__ import annotations

from app.services.site_audit.parsers import Finding, ParseOutput


def parse_llms_txt(content: str | None) -> ParseOutput:
    if content is None:
        return ParseOutput(
            measurements={"present": False, "valid": False},
            findings=[Finding("llms_txt_missing", "low", "bot_access",
                              "No /llms.txt file found.", {})],
        )

    text = content.strip()
    if not text or not text.lstrip().startswith("# "):
        return ParseOutput(
            measurements={"present": True, "valid": False},
            findings=[Finding("llms_txt_malformed", "low", "bot_access",
                              "llms.txt should start with an H1 site name (`# Site`).",
                              {"first_line": (text.splitlines() or [""])[0][:100]})],
        )

    return ParseOutput(
        measurements={"present": True, "valid": True},
        findings=[Finding("llms_txt_present_valid", "info", "bot_access",
                          "llms.txt is present and well-formed.", {})],
    )
