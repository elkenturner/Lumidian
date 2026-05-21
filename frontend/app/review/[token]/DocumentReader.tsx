'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { publicGetDocumentHtml, publicDocumentPdfUrl, type PublicDocumentSummary } from '@/lib/api';

interface Props {
  token: string;
  doc: PublicDocumentSummary;
  onClose: () => void;
}

export function DocumentReader({ token, doc, onClose }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicGetDocumentHtml(token, doc.id)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load document.'); });
    return () => { cancelled = true; };
  }, [token, doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(11, 18, 32, 0.4)',
          zIndex: 50,
        }}
      />
      <motion.div
        key="panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '60vw',
          minWidth: 480,
          background: 'var(--paper)',
          boxShadow: '-20px 0 60px rgba(11,18,32,0.15)',
          zIndex: 51,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: 13,
            color: 'var(--ink)',
            fontWeight: 500,
          }}>
            {doc.title}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {doc.pdf_available && (
              <a
                href={publicDocumentPdfUrl(token, doc.id)}
                download
                style={{
                  background: 'var(--lumidian)',
                  color: 'white',
                  borderRadius: 6,
                  textDecoration: 'none',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Download ↓
              </a>
            )}
            <button onClick={onClose}
              style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink)', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
              Close
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--paper)' }}>
          {error && <div style={{ padding: 24, color: 'var(--down)' }}>{error}</div>}
          {!html && !error && <div style={{ padding: 24, color: 'var(--ink-mute)' }}>Loading…</div>}
          {html && (
            <iframe
              srcDoc={html}
              title={doc.title}
              style={{ width: '100%', height: '100%', border: 0, background: 'var(--paper)' }}
            />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
