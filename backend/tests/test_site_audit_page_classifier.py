import pytest

from app.services.site_audit.page_classifier import classify_page


@pytest.mark.parametrize("url,html,expected", [
    ("https://x.com/",         "<html></html>",                       "homepage"),
    ("https://x.com",          "<html></html>",                       "homepage"),
    ("https://x.com/pricing",  "<html></html>",                       "pricing"),
    ("https://x.com/Pricing/", "<html></html>",                       "pricing"),
    ("https://x.com/foo",      "<html><title>Pricing FAQ</title></html>",  "pricing"),
    ("https://x.com/about",    "<html></html>",                       "about"),
    ("https://x.com/team",     "<html></html>",                       "about"),
    ("https://x.com/docs/api", "<html></html>",                       "docs"),
    ("https://x.com/help",     "<html></html>",                       "docs"),
    ("https://x.com/blog/p1",  "<html></html>",                       "article"),
    ("https://x.com/news/foo", "<html></html>",                       "article"),
    ("https://x.com/post",     "<html><article>...</article></html>", "article"),
    ("https://x.com/features", "<html></html>",                       "product"),
    ("https://x.com/products", "<html></html>",                       "product"),
    ("https://x.com/random",   "<html></html>",                       "other"),
])
def test_classify_page(url, html, expected):
    assert classify_page(url, html) == expected
