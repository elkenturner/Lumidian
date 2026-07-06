// Helpers for owned-site draft text. The generator appends a paste-ready
// JSON-LD schema block to the page body ("---\nSchema markup (JSON-LD…\n```json…```").
// The UI splits that back out so the body reads as a page and the schema gets
// its own section + copy button (they're pasted into different places anyway:
// body → CMS, JSON-LD → <head>).

// Tolerates both label variants (the pre-Jul-6 one carried an em dash) and
// optional whitespace around the fence.
const SCHEMA_BLOCK_RE =
  /\n*---\s*\nSchema markup \(JSON-LD[^\n]*\n+```json\n([\s\S]*?)\n```\s*$/;

export interface OwnedSiteDraftParts {
  /** Page body (markdown), without the schema block. */
  body: string;
  /** The JSON-LD snippet, or null if the draft carries none. */
  jsonld: string | null;
}

export function splitOwnedSiteDraft(text: string): OwnedSiteDraftParts {
  const m = text.match(SCHEMA_BLOCK_RE);
  if (!m) return { body: text, jsonld: null };
  return { body: text.slice(0, m.index).trimEnd(), jsonld: m[1] };
}

/** Body minus a leading H1 that duplicates the already-displayed title.
 *  (The generator's first line is "# <headline>" and the draft title is
 *  derived from the same headline, so cards/modals showed it twice.) */
export function bodyWithoutDuplicateH1(body: string, title: string | null | undefined): string {
  const m = body.match(/^#\s+(.+?)\s*\n+/);
  if (!m) return body;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (title && normalize(m[1]) === normalize(title)) {
    return body.slice(m[0].length);
  }
  return body;
}
