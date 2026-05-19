'use client';

import { publicDocumentPdfUrl, type PublicDocumentSummary } from '@/lib/api';

const KIND_LABEL: Record<string, string> = {
  agency_weekly_report: 'Weekly Report',
  monthly_report: 'Monthly Report',
  sow: 'Statement of Work',
  audit_initial: 'Initial Audit',
  kickoff_checklist: 'Kickoff Checklist',
};

interface Props {
  doc: PublicDocumentSummary;
  token: string;
  onOpen: () => void;
}

export function DocumentCard({ doc, token, onOpen }: Props) {
  const label = (KIND_LABEL[doc.kind] || doc.kind.replace(/_/g, ' ')).toUpperCase();
  const dateLabel = new Date(doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z'))
    .toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div
      style={{
        background: 'var(--paper-elev)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: 24,
        margin: '16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: 'var(--ink-mute)',
        }}>
          {label}
        </div>
        <h3 style={{
          fontFamily: 'var(--font-instrument), Georgia, serif',
          fontWeight: 400,
          fontSize: 20,
          color: 'var(--ink)',
          margin: '8px 0 6px',
          lineHeight: 1.3,
        }}>
          {doc.title}
        </h3>
        <div style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: 11,
          color: 'var(--ink-mute)',
        }}>
          {dateLabel}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onOpen}
          style={{
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            color: 'var(--ink)',
            fontSize: 13,
            cursor: 'pointer',
            padding: '8px 16px',
            fontWeight: 500,
          }}
        >
          Open
        </button>
        {doc.pdf_available && (
          <a
            href={publicDocumentPdfUrl(token, doc.id)}
            download
            style={{
              background: 'var(--lumidian)',
              border: 0,
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              padding: '10px 16px',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Download ↓
          </a>
        )}
      </div>
    </div>
  );
}
