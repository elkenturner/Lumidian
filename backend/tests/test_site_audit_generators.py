from app.services.site_audit.generators import (
    build_llms_txt, build_robots_snippet, BrandSummary, KeyPage,
)


def test_build_llms_txt_with_key_pages():
    brand = BrandSummary(
        name="Acme",
        website_url="https://acme.com",
        description="Acme makes B2B widgets that help small SaaS teams scale.",
    )
    pages = [
        KeyPage(url="https://acme.com/", title="Home", page_type="homepage", score=92),
        KeyPage(url="https://acme.com/pricing", title="Pricing", page_type="pricing", score=88),
        KeyPage(url="https://acme.com/docs", title="Docs", page_type="docs", score=80),
    ]
    txt = build_llms_txt(brand, pages)
    assert txt.startswith("# Acme")
    assert "Acme makes B2B widgets" in txt
    assert "[Pricing](https://acme.com/pricing)" in txt
    assert "## Key resources" in txt


def test_build_llms_txt_skeleton_when_no_pages():
    brand = BrandSummary(name="X", website_url="https://x.com", description=None)
    txt = build_llms_txt(brand, [])
    assert "# X" in txt
    assert "[Homepage](https://x.com" in txt


def test_robots_snippet_allow_all():
    out = build_robots_snippet("allow_all")
    assert "GPTBot" in out
    assert "OAI-SearchBot" in out
    assert "Allow: /" in out


def test_robots_snippet_search_only():
    out = build_robots_snippet("search_only")
    assert "OAI-SearchBot" in out
    assert "User-agent: GPTBot" in out
    assert "Disallow: /" in out  # training blocked
    # OAI-SearchBot still allowed
    assert "User-agent: OAI-SearchBot\nAllow: /" in out
