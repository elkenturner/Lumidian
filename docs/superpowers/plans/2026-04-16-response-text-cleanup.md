# Response Text Cleanup & Mention Highlighting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw markdown-artifact-ridden LLM response text with clean plain text and highlighted brand/competitor mentions across three UI locations.

**Architecture:** A single self-contained `<ResponseText>` React component strips markdown and highlights mentions. It's integrated into BrandTable (dashboard), Reports page, and Prompt Detail page. No new dependencies — pure React + regex.

**Tech Stack:** React 18, TypeScript, Tailwind CSS

**UI Skills:** Use `impeccable` and `emil-design-eng` skills when implementing the component's visual treatment.

---

### Task 1: Create the `<ResponseText>` component

**Files:**
- Create: `frontend/components/ui/ResponseText.tsx`

- [ ] **Step 1: Create the component file with stripMarkdown and highlight logic**

Create `frontend/components/ui/ResponseText.tsx`:

```tsx
'use client';

import React from 'react';

/* ── Markdown stripping ──────────────────────────────────────────────────────── */

function stripMarkdown(text: string): string {
  return text
    // Links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Citation brackets: [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Bold+italic: ***text***
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // Italic: *text*
    .replace(/\*(.+?)\*/g, '$1')
    // Inline code: `text`
    .replace(/`([^`]+)`/g, '$1')
    // Headings: # ... ###### at start of line
    .replace(/^#{1,6}\s+/gm, '')
    // List markers: - or * at start of line (with optional indentation)
    .replace(/^[\t ]*[-*]\s+/gm, '')
    // Numbered list markers: 1. 2. etc.
    .replace(/^[\t ]*\d+\.\s+/gm, '')
    // Collapse 3+ newlines to 2 (preserve paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── Mention highlighting ────────────────────────────────────────────────────── */

interface HighlightTerm {
  name: string;
  type: 'brand' | 'competitor';
}

interface TextSegment {
  text: string;
  type: 'plain' | 'brand' | 'competitor';
}

function buildSegments(text: string, terms: HighlightTerm[]): TextSegment[] {
  if (terms.length === 0) return [{ text, type: 'plain' }];

  // Sort longest-first to avoid partial matches (e.g., "Brandwatch" before "Brand")
  const sorted = [...terms].sort((a, b) => b.name.length - a.name.length);

  // Build a single regex matching all terms, case-insensitive
  const escaped = sorted.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  // Build a lookup map for term type (lowercased name → type)
  const typeMap = new Map<string, 'brand' | 'competitor'>();
  for (const t of sorted) {
    typeMap.set(t.name.toLowerCase(), t.type);
  }

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), type: 'plain' });
    }
    // Add the highlighted match
    const matchedText = match[1];
    const termType = typeMap.get(matchedText.toLowerCase()) ?? 'plain';
    segments.push({ text: matchedText, type: termType });
    lastIndex = pattern.lastIndex;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), type: 'plain' });
  }

  return segments;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

interface ResponseTextProps {
  text: string;
  brandName: string;
  competitors?: string[];
  className?: string;
  maxLength?: number;
}

export default function ResponseText({
  text,
  brandName,
  competitors = [],
  className = '',
  maxLength,
}: ResponseTextProps) {
  // 1. Strip markdown
  let cleaned = stripMarkdown(text);

  // 2. Truncate if needed
  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength) + '\u2026';
  }

  // 3. Build highlight terms
  const terms: HighlightTerm[] = [
    { name: brandName, type: 'brand' },
    ...competitors.map((c) => ({ name: c, type: 'competitor' as const })),
  ];

  // 4. Split into paragraphs (double newline), then highlight within each
  const paragraphs = cleaned.split(/\n{2,}/);

  return (
    <div className={`leading-relaxed ${className}`}>
      {paragraphs.map((para, pi) => {
        const segments = buildSegments(para, terms);
        return (
          <React.Fragment key={pi}>
            {pi > 0 && <><br /><br /></>}
            {segments.map((seg, si) => {
              if (seg.type === 'brand') {
                return (
                  <span
                    key={si}
                    className="px-1 rounded-[3px] font-medium"
                    style={{
                      backgroundColor: 'rgba(34, 197, 94, 0.15)',
                      color: '#34d399',
                    }}
                  >
                    {seg.text}
                  </span>
                );
              }
              if (seg.type === 'competitor') {
                return (
                  <span
                    key={si}
                    className="px-1 rounded-[3px] font-medium"
                    style={{
                      backgroundColor: 'rgba(251, 146, 60, 0.15)',
                      color: '#fb923c',
                    }}
                  >
                    {seg.text}
                  </span>
                );
              }
              // Plain text — convert single newlines to <br/>
              return (
                <React.Fragment key={si}>
                  {seg.text.split('\n').map((line, li) => (
                    <React.Fragment key={li}>
                      {li > 0 && <br />}
                      {line}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `ResponseText.tsx`

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/ResponseText.tsx
git commit -m "feat: add ResponseText component for clean LLM output with mention highlights"
```

---

### Task 2: Integrate into BrandTable (Dashboard)

**Files:**
- Modify: `frontend/components/dashboard/BrandTable.tsx`

Data availability: `analytics.brand_name` (string) and `analytics.competitor_comparison` (array with `.name` on each item) are already passed into this component via the `analytics` prop.

- [ ] **Step 1: Add ResponseText import and replace the stripMarkdown import**

In `frontend/components/dashboard/BrandTable.tsx`, change the import on line 10:

```tsx
// Old:
import { MODEL_CONFIG, stripMarkdown } from './helpers';

// New:
import { MODEL_CONFIG } from './helpers';
import ResponseText from '@/components/ui/ResponseText';
```

- [ ] **Step 2: Replace the collapsed preview (lines 133-140)**

Replace the preview paragraph that uses `stripMarkdown`:

```tsx
// Old (lines 133-140):
{conv.response_preview && (
  <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
    {(() => {
      const clean = stripMarkdown(conv.response_preview);
      return clean.length > 120 ? clean.slice(0, 120) + '\u2026' : clean;
    })()}
  </p>
)}

// New:
{conv.response_preview && (
  <div className="line-clamp-2">
    <ResponseText
      text={conv.response_preview}
      brandName={analytics?.brand_name ?? ''}
      competitors={analytics?.competitor_comparison.map((c) => c.name) ?? []}
      maxLength={120}
      className="text-xs text-[var(--text-faint)]"
    />
  </div>
)}
```

- [ ] **Step 3: Replace the expanded response (lines 142-148)**

Replace the raw `{conv.response_text}` rendering:

```tsx
// Old (lines 142-148):
{expandedConvId === conv.id && conv.response_text && (
  <div className="px-5 pb-4 pt-3 border-t border-[var(--accent-border)] bg-[var(--accent-muted)]">
    <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">
      {conv.response_text}
    </p>
  </div>
)}

// New:
{expandedConvId === conv.id && conv.response_text && (
  <div className="px-5 pb-4 pt-3 border-t border-[var(--accent-border)] bg-[var(--accent-muted)]">
    <ResponseText
      text={conv.response_text}
      brandName={analytics?.brand_name ?? ''}
      competitors={analytics?.competitor_comparison.map((c) => c.name) ?? []}
      className="text-xs sm:text-sm text-[var(--text-muted)]"
    />
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboard/BrandTable.tsx
git commit -m "feat: use ResponseText in dashboard BrandTable for clean output with highlights"
```

---

### Task 3: Integrate into Reports page

**Files:**
- Modify: `frontend/app/reports/page.tsx`

Data availability: `selectedBrand?.name` (from `useBrand()`) and `competitorAnalysis?.overall.competitors` (already fetched and used on line 614). Both are already in component state.

- [ ] **Step 1: Add ResponseText import**

Add to the imports section near the top of `frontend/app/reports/page.tsx` (after line 43):

```tsx
import ResponseText from '@/components/ui/ResponseText';
```

- [ ] **Step 2: Delete the local stripMarkdown function (lines 54-62)**

Remove this entire block from `frontend/app/reports/page.tsx`:

```tsx
function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}
```

- [ ] **Step 3: Replace the response text rendering (lines 640-646)**

Replace the `stripMarkdown` usage in the expanded response view:

```tsx
// Old (lines 640-646):
{r.response_text ? (
  <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-line">
    {stripMarkdown(r.response_text)}
  </p>
) : (
  <p className="text-xs text-[var(--text-faint)] italic">No response text</p>
)}

// New:
{r.response_text ? (
  <ResponseText
    text={r.response_text}
    brandName={selectedBrand?.name ?? ''}
    competitors={competitorAnalysis?.overall.competitors.map((c) => c.name) ?? []}
    className="text-xs text-[var(--text-muted)]"
  />
) : (
  <p className="text-xs text-[var(--text-faint)] italic">No response text</p>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/app/reports/page.tsx
git commit -m "feat: use ResponseText in reports page for clean output with highlights"
```

---

### Task 4: Integrate into Prompt Detail page

**Files:**
- Modify: `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`

Data availability: `data.competitors` has competitor names (`.name` field). For brand name, use `useBrand()` context which is already available app-wide — look up by `brandId`.

- [ ] **Step 1: Add imports**

In `frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx`, add these imports:

```tsx
// Add to existing imports:
import ResponseText from '@/components/ui/ResponseText';
import { useBrand } from '@/contexts/BrandContext';
```

- [ ] **Step 2: Add brand name lookup from context**

Inside the `PromptDetailPage` component, after the existing `useState` declarations (after line 24), add:

```tsx
const { brands } = useBrand();
const brandName = brands.find((b) => b.id === brandId)?.name ?? '';
```

- [ ] **Step 3: Replace the response text rendering (lines 219-224)**

Replace the raw text slice with ResponseText:

```tsx
// Old (lines 219-224):
{resp.response_text && (
  <div className="px-4 py-3 text-xs text-[var(--text-secondary)] leading-relaxed max-h-32 overflow-y-auto">
    {resp.response_text.slice(0, 500)}
    {resp.response_text.length > 500 && '…'}
  </div>
)}

// New:
{resp.response_text && (
  <div className="px-4 py-3 max-h-32 overflow-y-auto">
    <ResponseText
      text={resp.response_text}
      brandName={brandName}
      competitors={data.competitors.map((c) => c.name)}
      maxLength={500}
      className="text-xs text-[var(--text-secondary)]"
    />
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/app/tracker/[brandId]/prompt/[promptId]/page.tsx
git commit -m "feat: use ResponseText in prompt detail page for clean output with highlights"
```

---

### Task 5: Build verification and manual testing

**Files:** None (verification only)

- [ ] **Step 1: Run full production build**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run lint**

Run: `cd frontend && npm run lint 2>&1 | tail -20`
Expected: No new lint errors

- [ ] **Step 3: Start dev server and verify all 3 pages**

Run: `cd frontend && npm run dev`

Manual verification checklist (test in browser):
1. **Dashboard** (`/dashboard`) — expand a conversation row → response text should be clean (no `**` or `##`), brand name highlighted green, competitor names highlighted orange
2. **Reports** (`/reports`) — select a brand, expand a prompt group, expand a response → same clean text with highlights
3. **Prompt Detail** (`/tracker/{brandId}/prompt/{promptId}`) — "Recent AI Responses" section → clean text, truncated at 500 chars, highlights visible

Verify no regressions:
4. Content drafts page → drafts still render normally with `renderPreviewHtml()`
5. Domain lists in dashboard → unchanged
6. Competitor tab in reports → unchanged

- [ ] **Step 4: Final commit (if any adjustments needed)**

```bash
git add -A
git commit -m "fix: address any issues found during verification"
```
