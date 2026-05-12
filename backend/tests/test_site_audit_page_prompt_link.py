import pytest

from app.services.site_audit.page_prompt_link import (
    score_url_match, link_pages_to_prompts, PageLinkInput, PromptLinkInput,
)


def test_score_url_match_slug_overlap():
    assert score_url_match(
        own_url="https://acme.com/pricing",
        own_title="Pricing",
        own_page_type="pricing",
        cited_url="https://rival.com/pricing-guide",
        prompt_text="What is the pricing for widget tools?",
    ) > 0.3


def test_low_score_for_unrelated():
    s = score_url_match(
        own_url="https://acme.com/about",
        own_title="About Us",
        own_page_type="about",
        cited_url="https://rival.com/pricing",
        prompt_text="What does it cost?",
    )
    assert s < 0.3


def test_link_pages_to_prompts_picks_best_page():
    pages = [
        PageLinkInput(id=1, url="https://acme.com/pricing", title="Pricing", page_type="pricing"),
        PageLinkInput(id=2, url="https://acme.com/about", title="About Us", page_type="about"),
    ]
    prompts = [
        PromptLinkInput(id=10, text="What does Acme pricing look like?",
                        cited_urls=["https://rival.com/pricing-guide"]),
    ]
    result = link_pages_to_prompts(pages, prompts)
    assert 10 in result[1]
    assert 10 not in result.get(2, [])
