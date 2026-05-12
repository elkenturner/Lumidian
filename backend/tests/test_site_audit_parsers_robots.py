import pytest

from app.services.site_audit.parsers.robots import parse_robots

ROBOTS_ALLOW_ALL = """User-agent: *
Allow: /
"""

ROBOTS_BLOCK_GPTBOT_AND_OAI = """User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Disallow: /
"""

ROBOTS_BLOCK_GOOGLE_EXTENDED = """User-agent: Google-Extended
Disallow: /
"""


def test_allow_all_no_critical_findings():
    out = parse_robots(ROBOTS_ALLOW_ALL, "https://x.com/")
    ids = {f.check_id for f in out.findings}
    assert "blocked_oai_searchbot" not in ids
    assert out.measurements["bot_status"]["GPTBot"] == "unspecified"


def test_block_oai_searchbot_is_critical():
    out = parse_robots(ROBOTS_BLOCK_GPTBOT_AND_OAI, "https://x.com/")
    crit = [f for f in out.findings if f.severity == "critical"]
    ids = {f.check_id for f in crit}
    assert "blocked_oai_searchbot" in ids
    assert out.measurements["bot_status"]["OAI-SearchBot"] == "disallowed_all"
    assert out.measurements["bot_status"]["GPTBot"] == "disallowed_all"


def test_block_google_extended_high():
    out = parse_robots(ROBOTS_BLOCK_GOOGLE_EXTENDED, "https://x.com/")
    ids = {f.check_id for f in out.findings if f.severity == "high"}
    assert "blocked_google_extended" in ids


def test_no_robots_emits_info():
    out = parse_robots(None, "https://x.com/")
    ids = {f.check_id for f in out.findings}
    assert "no_robots_txt" in ids
    # all bots default to allowed (no robots = no rules)
    assert all(v == "allowed_all" for v in out.measurements["bot_status"].values())
