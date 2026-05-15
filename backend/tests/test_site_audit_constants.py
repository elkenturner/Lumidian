import pytest

from app.services.site_audit.constants import (
    AI_BOT_USER_AGENTS, THIRD_PARTY_AUTHORITY_DOMAINS,
    TIER_AUDIT_LIMITS, normalise_url,
)


def test_ai_bots_include_all_expected():
    expected = {
        "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai",
        "PerplexityBot", "Google-Extended", "Meta-ExternalAgent",
        "Applebot-Extended", "Amazonbot",
    }
    assert set(AI_BOT_USER_AGENTS) == expected


def test_third_party_allowlist_has_wikipedia_and_reddit():
    assert "wikipedia.org" in THIRD_PARTY_AUTHORITY_DOMAINS
    assert "reddit.com" in THIRD_PARTY_AUTHORITY_DOMAINS


def test_tier_limits_excludes_free():
    assert "basic" in TIER_AUDIT_LIMITS
    assert "starter" in TIER_AUDIT_LIMITS
    assert "pro" in TIER_AUDIT_LIMITS
    assert None not in TIER_AUDIT_LIMITS
    assert TIER_AUDIT_LIMITS["basic"]["max_pages"] == 50
    assert TIER_AUDIT_LIMITS["pro"]["max_pages"] == 250


@pytest.mark.parametrize("input_url,expected", [
    ("HTTPS://Example.COM/", "https://example.com/"),
    ("https://example.com/foo/", "https://example.com/foo"),
    ("https://example.com/foo#section", "https://example.com/foo"),
    ("https://example.com:443/foo", "https://example.com/foo"),
    # http is canonicalised to https on public hosts (collapses scheme variants)
    ("http://example.com:80/", "https://example.com/"),
    ("http://example.com/", "https://example.com/"),
    # www is stripped on public hosts (collapses host variants)
    ("https://www.example.com/", "https://example.com/"),
    ("http://www.example.com/foo", "https://example.com/foo"),
    ("https://example.com/foo?b=2&a=1", "https://example.com/foo?a=1&b=2"),
    ("example.com/foo", "https://example.com/foo"),
    # Loopback hosts preserve original scheme (so local test servers still work)
    ("http://127.0.0.1:8080/", "http://127.0.0.1:8080/"),
    ("http://localhost/foo", "http://localhost/foo"),
])
def test_normalise_url_canonical(input_url, expected):
    assert normalise_url(input_url) == expected


def test_normalise_url_invalid():
    with pytest.raises(ValueError):
        normalise_url("not a url at all")
