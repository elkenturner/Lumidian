"""Per-platform, per-artifact install guidance for PDF reports.

Mirrors the data in frontend/lib/insertion-hint.ts so a Wix client's PDF
includes Wix-specific steps ("Settings > SEO Tools > Custom Code")
instead of the generic <head> guidance.
"""
from __future__ import annotations


PLATFORM_TIPS: dict[str, dict[str, str]] = {
    "wix": {
        "jsonld_org": "Settings → SEO Tools → Custom Code → Add new code. Place in <head>, all pages.",
        "jsonld_breadcrumb": "Settings → SEO Tools → Custom Code → Add new code (this page only).",
        "jsonld_faq": "Settings → SEO Tools → Custom Code → Add to <head>, all pages OR the FAQ page only.",
        "jsonld_article": 'Open the blog post → SEO panel (right sidebar) → "Advanced SEO" → Structured data markup → paste here.',
        "jsonld_product": "Edit product → SEO panel → Structured data markup → paste JSON-LD.",
        "meta_title": 'Open the page → SEO panel → "What\'s the page title? (Title tag)" → paste the new title.',
        "meta_description": 'Open the page → SEO panel → "What\'s the page about? (Meta description)" → paste.',
        "h1_text": "In the editor, click the existing H1 element → change the text → publish.",
        "faq_section": "Use the FAQ widget. Or embed the HTML via Settings → Custom Code → HTML embed.",
        "robots_snippet": "Settings → SEO Tools → Robots.txt Editor → paste the new rules. (Wix overrides this file, so use their editor, not raw FTP.)",
        "llms_txt": "Wix doesn't support custom root files like /llms.txt directly. Workaround: host on a subdomain you control or use a Velo-served file.",
    },
    "shopify": {
        "jsonld_org": "Online Store → Themes → Edit code → Layout/theme.liquid → paste inside <head>.",
        "jsonld_breadcrumb": "Edit the relevant template (e.g. product.liquid) → paste inside the <head> include.",
        "jsonld_faq": "Page template or theme.liquid → paste inside <head>. Pair with visible FAQ block.",
        "jsonld_article": "article.liquid template → paste inside <head>.",
        "jsonld_product": "product.liquid template → paste inside <head>. Most themes already have basic Product schema; replace it with this richer version.",
        "meta_title": 'Page/Product/Article admin → Search engine listing preview → Edit → "Page title".',
        "meta_description": 'Page/Product/Article admin → Search engine listing preview → "Meta description".',
        "faq_section": "Add via theme editor (sections) or paste HTML into the page body via the rich text editor.",
        "robots_snippet": "Admin → Online Store → Themes → Edit code → robots.txt.liquid (Shopify exposes this as a Liquid template).",
        "llms_txt": "Shopify doesn't allow custom root files via the storefront. Workaround: use App Proxy or a redirect from a subdomain you control.",
    },
    "webflow": {
        "jsonld_org": "Project Settings → Custom code → Footer Code (paste inside a <script> wrapper). Or per-page Settings → Custom code.",
        "jsonld_article": "CMS Collection → page settings → Custom code → <head>.",
        "meta_title": "Page settings → SEO settings → Title Tag.",
        "meta_description": "Page settings → SEO settings → Meta description.",
        "h1_text": "Click the H1 element on the canvas, edit text, publish.",
        "robots_snippet": "Project Settings → SEO → robots.txt → paste rules.",
    },
    "squarespace": {
        "jsonld_org": 'Settings → Advanced → Code Injection → Header → paste <script type="application/ld+json">.',
        "meta_title": "Page Settings → SEO → SEO Title.",
        "meta_description": "Page Settings → SEO → SEO Description.",
    },
    "wordpress": {
        "jsonld_org": "Use a plugin like Yoast or RankMath → Schema → Organization. Or add via theme functions.php / header.php → wp_head.",
        "jsonld_article": "If using Yoast/RankMath, Article schema is auto-generated — verify or extend. Otherwise paste into header.php inside <?php wp_head() ?>.",
        "meta_title": "Yoast/RankMath plugin → page sidebar → SEO title field.",
        "meta_description": "Yoast/RankMath plugin → page sidebar → Meta description field.",
        "robots_snippet": "Yoast → Tools → File editor → robots.txt. Or upload manually if your host allows.",
    },
    "next": {
        "jsonld_org": 'Add <Script type="application/ld+json"> in your root layout (e.g. app/layout.tsx) using dangerouslySetInnerHTML.',
        "meta_title": "Set `export const metadata = { title: \"…\" }` in the page file (app router).",
        "meta_description": "Set `export const metadata = { description: \"…\" }` in the page file.",
    },
    "hubspot": {
        "jsonld_org": "Marketing → Files and Templates → Design Manager → edit your global header template → paste inside <head>.",
        "meta_title": "Edit the page → Settings tab → Title.",
        "meta_description": "Edit the page → Settings tab → Meta description.",
    },
}

PLATFORM_DISPLAY_NAMES: dict[str, str] = {
    "wix": "Wix",
    "shopify": "Shopify",
    "webflow": "Webflow",
    "squarespace": "Squarespace",
    "wordpress": "WordPress",
    "hubspot": "HubSpot",
    "next": "Next.js",
}


def platform_tip(platform: str | None, artifact_type: str | None) -> str | None:
    if not platform or not artifact_type:
        return None
    return PLATFORM_TIPS.get(platform, {}).get(artifact_type)


def platform_display_name(platform: str | None) -> str | None:
    if not platform:
        return None
    return PLATFORM_DISPLAY_NAMES.get(platform)
