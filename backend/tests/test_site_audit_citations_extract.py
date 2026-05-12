import pytest

from app.services.site_audit.citations import (
    extract_urls, classify_url, ClassifyResult, registered_domain,
)


def test_markdown_link_extraction():
    text = "See [the docs](https://acme.com/docs) and [other](https://x.com/y)."
    urls = extract_urls(text)
    assert "https://acme.com/docs" in urls
    assert "https://x.com/y" in urls


def test_bare_url_extraction():
    text = "Cited at https://example.com/article and also at https://other.com/page!"
    urls = extract_urls(text)
    assert "https://example.com/article" in urls
    assert "https://other.com/page" in urls


def test_dedup_within_one_response():
    text = "[a](https://x.com/a) https://x.com/a [b](https://x.com/a)"
    urls = extract_urls(text)
    assert urls.count("https://x.com/a") == 1


def test_classify_own_competitor_third_party_unknown():
    own = "acme.com"
    competitors = {"rival.com": 7}
    assert classify_url("https://acme.com/x", own, competitors).kind == "own"
    res = classify_url("https://rival.com/y", own, competitors)
    assert res.kind == "competitor" and res.competitor_id == 7
    assert classify_url("https://wikipedia.org/x", own, competitors).kind == "third_party"
    assert classify_url("https://random.com/x", own, competitors).kind == "unknown"


def test_registered_domain():
    assert registered_domain("https://docs.acme.co.uk/foo") == "acme.co.uk"
    assert registered_domain("https://acme.com/") == "acme.com"
    assert registered_domain("not a url") is None
