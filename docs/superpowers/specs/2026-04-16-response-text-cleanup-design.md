# Response Text Cleanup & Mention Highlighting

## Problem

LLM response text is displayed with raw markdown artifacts (`**`, `##`, `-` list markers) across three locations in the app. There is no highlighting of brand or competitor mentions in response viewers. Three separate `stripMarkdown()` implementations exist with inconsistent regex patterns.

## Solution

A self-contained `<ResponseText>` React component that strips markdown to clean plain text and highlights brand/competitor mentions with colored pills.

## Component API

```tsx
<ResponseText
  text={response_text}
  brandName="Lumidian"
  competitors={["Brandwatch", "Semrush"]}
  className="text-xs text-[var(--text-muted)]"
/>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `text` | `string` | Yes | Raw LLM response text (may contain markdown) |
| `brandName` | `string` | Yes | Brand name to highlight in green |
| `competitors` | `string[]` | No (default `[]`) | Competitor names to highlight in orange |
| `className` | `string` | No | Additional CSS classes for the outer container |
| `maxLength` | `number` | No | Truncate stripped text to this length with ellipsis |

### File Location

`frontend/components/ui/ResponseText.tsx`

## Internal Logic

### 1. Strip Markdown

A single `stripMarkdown()` function inside the component module handles:

- `**bold**` and `*italic*` markers → plain text
- `# Heading` markers (all levels) → plain text
- `- ` and `* ` list item markers → plain text
- `[link text](url)` → just the link text
- `[1]` citation brackets → removed
- `` `inline code` `` backticks → plain text
- Excess whitespace normalized, paragraph breaks (double newline) preserved

### 2. Highlight Mentions

After stripping markdown:

1. Build a list of terms to highlight: `[{ name: brandName, type: 'brand' }, ...competitors.map(c => ({ name: c, type: 'competitor' }))]`
2. Create a single case-insensitive regex matching all terms, longest-first to avoid partial matches (e.g., "Brand" doesn't match inside "Brandwatch")
3. Split text on matches, producing alternating segments of plain text and matched terms
4. Render each segment as either a plain `<span>` or a highlighted `<span>` with the appropriate style

### 3. Render

- Plain text segments: rendered as-is in the container's text color
- Brand matches: `bg-[rgba(34,197,94,0.15)] text-[#34d399] px-1 rounded-[3px] font-medium`
- Competitor matches: `bg-[rgba(251,146,60,0.15)] text-[#fb923c] px-1 rounded-[3px] font-medium`
- Double newlines → `<br/><br/>` for paragraph spacing
- If `maxLength` is set, truncate the stripped text before highlighting, append ellipsis

## Affected Files

### Modified (3 files)

**`components/dashboard/BrandTable.tsx`**
- Lines 133-148: Replace `stripMarkdown()` preview + raw `{conv.response_text}` expanded view with `<ResponseText>`
- Preview (collapsed): use `<ResponseText>` with `maxLength={120}` — highlights apply to previews too
- Expanded: use `<ResponseText>` without `maxLength` — full response with highlights
- Brand name and competitors passed from parent data

**`app/reports/page.tsx`**
- Lines 640-643: Replace `{stripMarkdown(r.response_text)}` with `<ResponseText>`
- Delete the local `stripMarkdown()` function (lines 54-62) — no longer needed
- Brand name and competitors available from the report data context

**`app/tracker/[brandId]/prompt/[promptId]/page.tsx`**
- Lines 219-224: Replace raw `{resp.response_text.slice(0, 500)}` with `<ResponseText maxLength={500}>`
- Brand name available from the page's brand data; competitors fetched or passed in

### Created (1 file)

**`components/ui/ResponseText.tsx`** — the new component

### Not Modified

- `components/dashboard/helpers.ts` — `stripMarkdown` export stays (other exports from this file are used elsewhere)
- `lib/utils/formatting.ts` — `stripMarkdown` export stays (unused but out of scope)
- `components/content/helpers.tsx` — `renderPreviewHtml()` is for draft content, completely separate
- All content draft cards, domain lists, quality checklists — untouched

## Data Flow

Each of the 3 call sites already has access to brand data. For competitors:

- **BrandTable**: The dashboard page already fetches brand data. Competitors can be fetched via the existing `getCompetitors(brandId)` API call or passed alongside brand stats.
- **Reports page**: Report data includes brand context. Competitors fetched alongside report data.
- **Prompt detail page**: Already has `brandId` in the URL params. Competitors fetched via existing `getCompetitors(brandId)`.

If competitors aren't already available at a call site, the component gracefully degrades — it just won't highlight competitors, only the brand name.

## Highlight Colors

Uses existing design token patterns from the app:

| Type | Background | Text | Reference |
|------|-----------|------|-----------|
| Brand | `rgba(34,197,94,0.15)` | `#34d399` | Matches `--success-muted` / `--success-text` |
| Competitor | `rgba(251,146,60,0.15)` | `#fb923c` | Warm orange, distinct from model colors |

## Edge Cases

- **Empty text**: Render nothing (or a "No response text" fallback, matching current behavior at each call site)
- **No matches**: Renders as clean plain text with no highlights
- **Overlapping names**: Longest-first regex prevents partial matches (e.g., "AI" inside "Lumidian" won't double-match)
- **Special characters in names**: Brand/competitor names regex-escaped before matching
- **Very long responses**: `maxLength` prop handles truncation; `overflow-y-auto` at the call site handles scroll

## UI Skills

Implementation should use `impeccable` and `emil-design-eng` skills for the component's visual treatment — ensuring the highlight pills feel polished, transitions are smooth, and the typography is clean.
