'use client';

import React from 'react';

// --- Markdown stripping ---

function stripMarkdown(text: string): string {
  let result = text;

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Citation brackets: [1], [2], etc.
  result = result.replace(/\[\d+\]/g, '');

  // Bold+italic: ***text***
  result = result.replace(/\*{3}(.+?)\*{3}/g, '$1');

  // Bold: **text**
  result = result.replace(/\*{2}(.+?)\*{2}/g, '$1');

  // Italic: *text*
  result = result.replace(/\*(.+?)\*/g, '$1');

  // Inline code: `text`
  result = result.replace(/`([^`]+)`/g, '$1');

  // Headings: # ... ###### at start of line
  result = result.replace(/^#{1,6}\s+/gm, '');

  // List markers: - or * at start of line (with optional indentation)
  result = result.replace(/^[ \t]*[-*]\s+/gm, '');

  // Numbered list markers: 1. 2. etc.
  result = result.replace(/^[ \t]*\d+\.\s+/gm, '');

  // Collapse 3+ newlines to 2 (preserve paragraph breaks)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

// --- Segment building for highlight matches ---

type SegmentType = 'plain' | 'brand' | 'competitor';

interface Segment {
  text: string;
  type: SegmentType;
}

interface Term {
  name: string;
  type: 'brand' | 'competitor';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSegments(text: string, terms: Term[]): Segment[] {
  if (terms.length === 0) {
    return [{ text, type: 'plain' }];
  }

  // Sort terms longest-first to avoid partial matches
  const sorted = [...terms].sort((a, b) => b.name.length - a.name.length);

  // Build a single case-insensitive regex matching all terms
  const pattern = sorted.map((t) => escapeRegex(t.name)).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');

  // Build a lookup map (lowercase name → type)
  const typeMap = new Map<string, SegmentType>();
  for (const t of sorted) {
    typeMap.set(t.name.toLowerCase(), t.type);
  }

  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before the match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), type: 'plain' });
    }

    const matched = match[0];
    const matchType = typeMap.get(matched.toLowerCase()) ?? 'plain';
    segments.push({ text: matched, type: matchType });

    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), type: 'plain' });
  }

  return segments;
}

// --- React component ---

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
  // Strip markdown
  let cleaned = stripMarkdown(text);

  // Truncate if maxLength is set (before highlighting)
  if (maxLength !== undefined && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength) + '\u2026';
  }

  // Build terms list
  const terms: Term[] = [{ name: brandName, type: 'brand' }];
  for (const c of competitors) {
    terms.push({ name: c, type: 'competitor' });
  }

  // Split into paragraphs on double newlines
  const paragraphs = cleaned.split(/\n\n/);

  return (
    <div className={`leading-relaxed ${className}`}>
      {paragraphs.map((para, pIdx) => (
        <React.Fragment key={pIdx}>
          {pIdx > 0 && (
            <>
              <br />
              <br />
            </>
          )}
          {renderParagraph(para, terms)}
        </React.Fragment>
      ))}
    </div>
  );
}

function renderParagraph(para: string, terms: Term[]): React.ReactNode {
  const segments = buildSegments(para, terms);

  return segments.map((seg, sIdx) => {
    if (seg.type === 'brand') {
      return (
        <span
          key={sIdx}
          className="px-1 rounded-[3px] font-medium"
          style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#34d399' }}
        >
          {seg.text}
        </span>
      );
    }

    if (seg.type === 'competitor') {
      return (
        <span
          key={sIdx}
          className="px-1 rounded-[3px] font-medium"
          style={{ backgroundColor: 'rgba(251, 146, 60, 0.15)', color: '#fb923c' }}
        >
          {seg.text}
        </span>
      );
    }

    // Plain text: convert single newlines to <br/>
    const lines = seg.text.split('\n');
    return (
      <React.Fragment key={sIdx}>
        {lines.map((line, lIdx) => (
          <React.Fragment key={lIdx}>
            {lIdx > 0 && <br />}
            {line}
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  });
}

export { stripMarkdown, buildSegments };
export type { ResponseTextProps, Segment, Term };
