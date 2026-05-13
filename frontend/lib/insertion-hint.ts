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
