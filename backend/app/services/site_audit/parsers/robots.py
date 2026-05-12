"""robots.txt parser → per-AI-bot status map + findings."""
from __future__ import annotations

import re

from app.services.site_audit.constants import AI_BOT_USER_AGENTS
from app.services.site_audit.parsers import Finding, ParseOutput

_LINE_RE = re.compile(r"^([A-Za-z\-]+)\s*:\s*(.+?)\s*$")


def parse_robots(content: str | None, root_url: str) -> ParseOutput:
    findings: list[Finding] = []
    bot_status: dict[str, str] = {bot: "unspecified" for bot in AI_BOT_USER_AGENTS}

    if not content:
        findings.append(Finding("no_robots_txt", "info", "bot_access",
                                "No robots.txt file found; all bots default to allowed.",
                                {}))
        for bot in AI_BOT_USER_AGENTS:
            bot_status[bot] = "allowed_all"
        return ParseOutput(measurements={"bot_status": bot_status}, findings=findings)

    groups: list[tuple[set[str], list[tuple[str, str]]]] = []
    current_uas: set[str] = set()
    current_rules: list[tuple[str, str]] = []

    for raw_line in content.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            if current_uas:
                groups.append((current_uas, current_rules))
                current_uas, current_rules = set(), []
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        directive, value = m.group(1).lower(), m.group(2)
        if directive == "user-agent":
            if current_rules:
                groups.append((current_uas, current_rules))
                current_uas, current_rules = set(), []
            current_uas.add(value.strip())
        elif directive in ("allow", "disallow"):
            current_rules.append((directive, value))
    if current_uas:
        groups.append((current_uas, current_rules))

    for bot in AI_BOT_USER_AGENTS:
        rules = _rules_for_bot(bot, groups)
        bot_status[bot] = _classify(rules)

    severity_map = {
        "OAI-SearchBot": ("blocked_oai_searchbot", "critical"),
        "GPTBot": ("blocked_gptbot", "high"),
        "ClaudeBot": ("blocked_claudebot", "high"),
        "Google-Extended": ("blocked_google_extended", "high"),
        "PerplexityBot": ("blocked_perplexitybot", "high"),
    }
    for bot, status in bot_status.items():
        if status == "disallowed_all" and bot in severity_map:
            cid, sev = severity_map[bot]
            findings.append(Finding(cid, sev, "bot_access",
                                    f"robots.txt disallows {bot} from all paths.",
                                    {"bot": bot, "status": status}))

    if all(s == "unspecified" for s in bot_status.values()):
        findings.append(Finding("unspecified_ai_bots", "info", "bot_access",
                                "No directives for any AI bot user-agent — bots default to allowed but consider an explicit Allow.",
                                {}))

    return ParseOutput(measurements={"bot_status": bot_status}, findings=findings)


def _rules_for_bot(bot: str, groups: list[tuple[set[str], list[tuple[str, str]]]]) -> list[tuple[str, str]]:
    """Return only rules from groups that explicitly name this bot.

    Wildcard '*' groups intentionally do NOT propagate — an AI bot without a
    specific directive is reported as 'unspecified' so the audit can surface
    that the operator hasn't made an explicit choice.
    """
    bot_lower = bot.lower()
    specific: list[tuple[str, str]] = []
    for uas, rules in groups:
        ua_lowers = {u.lower() for u in uas}
        if bot_lower in ua_lowers:
            specific.extend(rules)
    return specific


def _classify(rules: list[tuple[str, str]]) -> str:
    if not rules:
        return "unspecified"
    has_disallow_all = any(d == "disallow" and v.strip() == "/" for d, v in rules)
    has_allow_all = any(d == "allow" and v.strip() == "/" for d, v in rules)
    has_partial_disallow = any(d == "disallow" and v.strip() not in ("", "/") for d, v in rules)
    if has_disallow_all and not has_allow_all:
        return "disallowed_all"
    if has_partial_disallow:
        return "allowed_partial"
    return "allowed_all"
