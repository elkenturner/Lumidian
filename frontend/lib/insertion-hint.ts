// Exact "where to paste" guidance per artifact type. Surfaced on the FixCard
// so the user knows precisely where on their site to drop the drafted artifact.

export type InsertionHint = {
  /** One-line summary shown in the FixCard's "Where" block. */
  where: string;
  /** Optional second line — a quick validator/test the user can run. */
  validate?: string;
};

const HINTS: Record<string, InsertionHint> = {
  jsonld_org: {
    where:
      'Paste inside <head>, ideally right after <meta charset>. Add to your global layout/template so it appears on every page.',
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  jsonld_breadcrumb: {
    where: "Paste inside this page's <head>. One block per page (not site-wide).",
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  jsonld_faq: {
    where:
      'Paste inside <head> alongside other schemas. The Q&A must also appear as visible HTML on the page — anti-cloaking rule.',
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  jsonld_article: {
    where: "Paste inside the article page's <head>. Update datePublished/dateModified to your CMS values.",
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  jsonld_product: {
    where:
      "Paste inside the product page's <head>, alongside any existing schema. Update price/availability with your live values before deploying.",
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  jsonld_howto: {
    where: "Paste inside the page's <head>. Steps must mirror visible step content on the page.",
    validate: 'Validate at https://search.google.com/test/rich-results.',
  },
  meta_title: {
    where: 'Inside <head>, replace your existing <title>…</title>. Each page should have its own unique <title>.',
    validate: 'Reload the page and check the browser tab title.',
  },
  meta_description: {
    where: 'Inside <head>, replace your existing <meta name="description"…> tag. If none exists, add it.',
    validate: 'View page source to confirm — search engines and AI search rely on this.',
  },
  h1_text: {
    where: 'Inside <main> (or the first content section), above any <h2>. Each page should have exactly one <h1>.',
  },
  og_tags: {
    where: 'Inside <head>, alongside other <meta> tags. Helps social previews and AI training scrape.',
    validate: 'Test with https://opengraph.xyz/ (paste your URL).',
  },
  faq_section: {
    where:
      'Insert at the bottom of the article, before the footer / related-content section. Keep the HTML and JSON-LD together — they must reference the same Q&A.',
    validate: 'Validate at https://search.google.com/test/rich-results after deploying.',
  },
  section_rewrite: {
    where:
      "Replace your existing first <h2> section (heading + first paragraph). Keep surrounding content intact.",
  },
  new_page_draft: {
    where:
      'Create a new page at the suggested URL (commented at the top of the markdown). After publishing, add internal links to it from related existing pages.',
    validate: 'After publishing, confirm the page is in your sitemap.xml and reachable from the homepage in ≤3 clicks.',
  },
  alt_text_batch: {
    where:
      "For each <img> element on the page, set its alt attribute to the value from the matching key in the JSON. Skip purely decorative images (alt='').",
  },
  llms_txt: {
    where: 'Save as /llms.txt at your site root (e.g. https://yoursite.com/llms.txt).',
    validate: 'Open the URL in a browser to confirm it loads as plain text.',
  },
  robots_snippet: {
    where:
      "Append to your existing /robots.txt. If you don't have one, save this file at your site root. Don't overwrite existing rules.",
    validate: 'After deploying, fetch https://yoursite.com/robots.txt and confirm the new rules appear.',
  },
  agents_md: {
    where: 'Save as /agents.md at your site root (e.g. https://yoursite.com/agents.md).',
    validate: 'Open the URL in a browser to confirm it loads.',
  },
  internal_link_suggestions: {
    where:
      'For each {from → to} pair, add a link to the FROM page using the provided anchor text. Place the link in a contextually-natural sentence, not in a generic "Related" footer.',
  },
};

export function insertionHint(artifactType: string | null | undefined): InsertionHint | null {
  if (!artifactType) return null;
  return HINTS[artifactType] ?? null;
}

// Platform-specific addendums — appended below the generic insertion hint.
// Only shown when we detected a platform AND we have advice for that artifact_type.
type PlatformAdvice = Partial<Record<string, string>>;
const PLATFORM_TIPS: Record<string, PlatformAdvice> = {
  wix: {
    jsonld_org:
      'Wix: Settings → SEO Tools → Custom Code → Add new code. Place in <head>, all pages.',
    jsonld_breadcrumb:
      'Wix: Settings → SEO Tools → Custom Code → Add new code (this page only).',
    jsonld_faq:
      'Wix: Settings → SEO Tools → Custom Code → Add to <head>, all pages OR the FAQ page only.',
    jsonld_article:
      'Wix: Open the blog post → SEO panel (right sidebar) → "Advanced SEO" → Structured data markup → paste here.',
    jsonld_product:
      'Wix: Edit product → SEO panel → Structured data markup → paste JSON-LD.',
    meta_title:
      'Wix: Open the page → SEO panel → "What\'s the page title? (Title tag)" → paste the new title.',
    meta_description:
      'Wix: Open the page → SEO panel → "What\'s the page about? (Meta description)" → paste.',
    h1_text:
      'Wix: In the editor, click the existing H1 element → change the text → publish.',
    faq_section:
      'Wix: Use the FAQ widget. Or embed the HTML via Settings → Custom Code → HTML embed.',
    robots_snippet:
      'Wix: Settings → SEO Tools → Robots.txt Editor → paste the new rules. (Wix overrides this file, so use their editor, not raw FTP.)',
    llms_txt:
      "Wix doesn't support custom root files like /llms.txt directly. Workaround: host on a subdomain you control or use Wix's URL redirect to a Velo-served file.",
  },
  shopify: {
    jsonld_org:
      'Shopify: Online Store → Themes → Edit code → Layout/theme.liquid → paste inside <head>.',
    jsonld_breadcrumb:
      'Shopify: Edit the relevant template (e.g. product.liquid) → paste inside the <head> include.',
    jsonld_faq:
      'Shopify: Page template or theme.liquid → paste inside <head>. Pair with visible FAQ block.',
    jsonld_article:
      'Shopify: article.liquid template → paste inside <head>.',
    jsonld_product:
      'Shopify: product.liquid template → paste inside <head>. Most themes already have basic Product schema; replace it with this richer version.',
    meta_title:
      'Shopify: Page/Product/Article admin → Search engine listing preview → Edit → "Page title".',
    meta_description:
      'Shopify: Page/Product/Article admin → Search engine listing preview → "Meta description".',
    faq_section:
      'Shopify: Add via theme editor (sections) or paste HTML into the page body via the rich text editor.',
    robots_snippet:
      "Shopify: Admin → Online Store → Themes → Edit code → robots.txt.liquid (Shopify exposes this as a Liquid template).",
    llms_txt:
      "Shopify doesn't allow custom root files via the storefront. Workaround: use App Proxy or a redirect from a subdomain you control.",
  },
  webflow: {
    jsonld_org:
      'Webflow: Project Settings → Custom code → Footer Code (paste inside a <script> wrapper). Or per-page Settings → Custom code.',
    jsonld_article:
      'Webflow: CMS Collection → page settings → Custom code → <head>.',
    meta_title:
      'Webflow: Page settings → SEO settings → Title Tag.',
    meta_description:
      'Webflow: Page settings → SEO settings → Meta description.',
    h1_text:
      'Webflow: Click the H1 element on the canvas, edit text, publish.',
    robots_snippet:
      "Webflow: Project Settings → SEO → robots.txt → paste rules.",
  },
  squarespace: {
    jsonld_org:
      'Squarespace: Settings → Advanced → Code Injection → Header → paste <script type="application/ld+json">.',
    meta_title:
      'Squarespace: Page Settings → SEO → SEO Title.',
    meta_description:
      'Squarespace: Page Settings → SEO → SEO Description.',
  },
  wordpress: {
    jsonld_org:
      'WordPress: Use a plugin like Yoast or RankMath → Schema → Organization. Or add via theme functions.php / header.php → wp_head.',
    jsonld_article:
      'WordPress: If using Yoast/RankMath, Article schema is auto-generated — verify or extend. Otherwise paste into header.php inside <?php wp_head() ?>.',
    meta_title:
      'WordPress: Yoast/RankMath plugin → page sidebar → SEO title field.',
    meta_description:
      'WordPress: Yoast/RankMath plugin → page sidebar → Meta description field.',
    robots_snippet:
      'WordPress: Yoast → Tools → File editor → robots.txt. Or upload manually if your host allows.',
  },
  next: {
    jsonld_org:
      'Next.js: Add <Script type="application/ld+json"> in your root layout (e.g. app/layout.tsx) using dangerouslySetInnerHTML.',
    meta_title:
      'Next.js: Set `export const metadata = { title: "…" }` in the page file (app router).',
    meta_description:
      'Next.js: Set `export const metadata = { description: "…" }` in the page file.',
  },
  hubspot: {
    jsonld_org:
      'HubSpot: Marketing → Files and Templates → Design Manager → edit your global header template → paste inside <head>.',
    meta_title:
      'HubSpot: Edit the page → Settings tab → Title.',
    meta_description:
      'HubSpot: Edit the page → Settings tab → Meta description.',
  },
};

export function platformTip(
  platform: string | null | undefined,
  artifactType: string | null | undefined,
): string | null {
  if (!platform || !artifactType) return null;
  return PLATFORM_TIPS[platform]?.[artifactType] ?? null;
}

export function platformDisplayName(platform: string | null | undefined): string | null {
  if (!platform) return null;
  return (
    {
      wix: 'Wix',
      shopify: 'Shopify',
      webflow: 'Webflow',
      squarespace: 'Squarespace',
      wordpress: 'WordPress',
      hubspot: 'HubSpot',
      next: 'Next.js',
    }[platform] ?? null
  );
}
