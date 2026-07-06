"use client";

import React from "react";

/**
 * Minimal markdown renderer for owned-site page drafts — the one draft type
 * that is real markdown by design (H2/H3 answer blocks, the citation-driver
 * format). Everything is built as React nodes; no HTML injection.
 *
 * Supports exactly what the generator emits: #–#### headings, paragraphs,
 * -/* and numbered lists, --- rules, and inline **bold** / *italic* /
 * `code` / [text](url).
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // Tokenize on the inline constructs we support; everything else is plain.
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\))/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold text-[var(--text-primary)]">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key} className="px-1 rounded bg-[rgba(148,163,184,0.12)] font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        out.push(
          <a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-foreground)] underline decoration-dotted hover:decoration-solid">
            {lm[1]}
          </a>
        );
      } else {
        out.push(tok);
      }
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" };

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "para", text: para.join("\n") });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list.ordered ? { kind: "ol", items: list.items } : { kind: "ul", items: list.items });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push({ kind: "hr" });
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

const HEADING_CLASSES: Record<number, string> = {
  1: "text-lg font-bold text-[var(--text-primary)] mt-5 mb-2",
  2: "text-base font-bold text-[var(--text-primary)] mt-5 mb-2",
  3: "text-sm font-semibold text-[var(--text-primary)] mt-4 mb-1.5",
  4: "text-sm font-semibold text-[var(--text-secondary)] mt-3 mb-1",
};

export function MarkdownContent({ markdown, className = "" }: { markdown: string; className?: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className={`text-sm text-[var(--text-secondary)] leading-relaxed ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <div key={i} role="heading" aria-level={b.level + 2} className={HEADING_CLASSES[b.level]}>
              {renderInline(b.text, `h${i}`)}
            </div>
          );
        }
        if (b.kind === "hr") return <hr key={i} className="my-4 border-[var(--border-subtle)]" />;
        if (b.kind === "ul" || b.kind === "ol") {
          const Tag = b.kind;
          return (
            <Tag key={i} className={`my-2 pl-5 space-y-1 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}>
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="my-2 whitespace-pre-wrap">
            {renderInline(b.text, `p${i}`)}
          </p>
        );
      })}
    </div>
  );
}
