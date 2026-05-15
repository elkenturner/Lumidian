"""Detect the CMS platform a site runs on by sniffing the homepage HTML.

Returns one of: 'wix' | 'shopify' | 'webflow' | 'wordpress' | 'squarespace' |
                'next' | 'hubspot' | None.

Used to deliver platform-specific install guidance on fix cards
(e.g. "Settings > SEO Tools > Custom Code" for Wix vs raw <head> for Shopify).
"""
from __future__ import annotations

import re

# Each signature is a list of substrings; if ANY match (case-insensitive), the
# platform is detected. Specific signals first so Wix sites that also include
# generic <meta> get classified as Wix.
_SIGNATURES: list[tuple[str, list[str]]] = [
    ("wix", [
        "wix.com", "wixstatic.com", "wixui-", "wixui_", "x-wix-",
        '<meta name="generator" content="wix.com"',
        'data-testid="richTextElement"',
    ]),
    ("shopify", [
        "cdn.shopify.com", "shopifycdn.com", "shopify_pay",
        "myshopify.com", 'shop_money_format', 'window.Shopify',
        '<meta name="shopify-checkout-api-token"',
    ]),
    ("webflow", [
        "webflow.io", "webflow.com/", 'data-wf-page=', 'data-wf-site=',
        'w-mod-', 'w-nav', 'w-button',
    ]),
    ("squarespace", [
        "squarespace.com", "squarespace-cdn.com", 'data-controller="Squarespace"',
        'static.squarespace.com',
    ]),
    ("wordpress", [
        "/wp-content/", "/wp-includes/", "wp-json",
        '<meta name="generator" content="wordpress',
    ]),
    ("hubspot", [
        "hs-scripts.com", "hsforms.com", "hubspotusercontent",
        "hubspot.com/cms",
    ]),
    ("next", [
        "_next/static/", "__NEXT_DATA__", "next/dist",
    ]),
]


def detect_platform(html: str | None) -> str | None:
    """Returns the detected platform slug, or None if no signature matched."""
    if not html:
        return None
    low = html.lower()
    for platform, sigs in _SIGNATURES:
        for sig in sigs:
            if sig.lower() in low:
                return platform
    return None


# Friendly display name for the UI.
PLATFORM_DISPLAY: dict[str, str] = {
    "wix": "Wix",
    "shopify": "Shopify",
    "webflow": "Webflow",
    "squarespace": "Squarespace",
    "wordpress": "WordPress",
    "hubspot": "HubSpot",
    "next": "Next.js",
}
