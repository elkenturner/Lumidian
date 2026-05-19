'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { publicApproveDraft, publicRequestChanges, publicRejectDraft, type ReviewDraft } from '@/lib/api';

type Status = 'approved' | 'changes_requested' | 'rejected';

interface Props {
  draft: ReviewDraft;
  token: string;
  onResolved: (status: Status) => void;
  resolvedStatus?: Status;
  resolvedAt?: Date;
}

const STATUS_LABEL: Record<Status, string> = {
  approved: '✓ Approved',
  changes_requested: '⤴ Changes requested',
  rejected: '✕ Rejected',
};
const STATUS_COLOR: Record<Status, string> = {
  approved: 'var(--up)',
  changes_requested: 'var(--ink-soft)',
  rejected: 'var(--down)',
};

export function DraftCard({ draft, token, onResolved, resolvedStatus, resolvedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (resolvedStatus) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{
          padding: '12px 18px',
          margin: '12px 0',
          borderLeft: `2px solid ${STATUS_COLOR[resolvedStatus]}`,
          color: STATUS_COLOR[resolvedStatus],
          fontSize: 13,
          fontFamily: 'var(--font-mono), monospace',
        }}
      >
        {STATUS_LABEL[resolvedStatus]} — {draft.title || 'Untitled'}
        {resolvedAt && (
          <span style={{ color: 'var(--ink-faint)', marginLeft: 8 }}>
            {resolvedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </motion.div>
    );
  }

  const handle = async (action: 'approve' | 'changes' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') {
        await publicApproveDraft(token, draft.id);
        onResolved('approved');
      } else if (action === 'changes') {
        if (!feedback.trim()) {
          setError('Please tell us what you’d like changed.');
          setBusy(false);
          return;
        }
        await publicRequestChanges(token, draft.id, feedback);
        onResolved('changes_requested');
      } else {
        await publicRejectDraft(token, draft.id, rejectReason);
        onResolved('rejected');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      style={{
        background: 'var(--paper-elev)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: 24,
        margin: '16px 0',
      }}
    >
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--lumidian-tint)',
        color: 'var(--lumidian)',
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: 'var(--font-mono), monospace',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        <span>●</span>{draft.platform}
      </div>

      <h3 style={{
        fontFamily: 'var(--font-instrument), Georgia, serif',
        fontWeight: 400,
        fontSize: 22,
        color: 'var(--ink)',
        margin: '12px 0 10px',
        lineHeight: 1.25,
      }}>
        {draft.title || `Draft #${draft.id}`}
      </h3>

      <div style={{
        color: 'var(--ink-soft)',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        maxHeight: expanded ? 'none' : 110,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {draft.content_text}
        {!expanded && draft.content_text.length > 220 && (
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0, height: 40,
            background: 'linear-gradient(to bottom, transparent, var(--paper-elev))',
          }} />
        )}
      </div>
      {draft.content_text.length > 220 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            color: 'var(--lumidian)',
            fontSize: 13,
            cursor: 'pointer',
            marginTop: 8,
            fontWeight: 500,
          }}
        >
          {expanded ? 'Show less ↑' : 'Read full draft ↓'}
        </button>
      )}

      <AnimatePresence>
        {showChanges && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 16, overflow: 'hidden' }}
          >
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What would you like changed?"
              rows={4}
              style={{
                width: '100%',
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'var(--paper)',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: 14,
                color: 'var(--ink)',
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lumidian)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => handle('changes')} disabled={busy}
                style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Send feedback
              </button>
              <button onClick={() => { setShowChanges(false); setFeedback(''); setError(null); }} disabled={busy}
                style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink-mute)', border: 0, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
        {showReject && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 16, overflow: 'hidden' }}
          >
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why are you rejecting this? (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'var(--paper)',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: 14,
                color: 'var(--ink)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => handle('reject')} disabled={busy}
                style={{ padding: '8px 16px', background: 'var(--down)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Confirm reject
              </button>
              <button onClick={() => { setShowReject(false); setRejectReason(''); setError(null); }} disabled={busy}
                style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink-mute)', border: 0, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div style={{ color: 'var(--down)', fontSize: 13, marginTop: 12 }}>{error}</div>
      )}

      {!showChanges && !showReject && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            onClick={() => setShowReject(true)}
            disabled={busy}
            style={{ background: 'none', border: 0, color: 'var(--ink-mute)', fontSize: 13, cursor: 'pointer', padding: '8px 12px' }}
          >
            Reject
          </button>
          <button
            onClick={() => setShowChanges(true)}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid var(--rule)',
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '8px 14px',
              fontWeight: 500,
            }}
          >
            Request changes
          </button>
          <button
            onClick={() => handle('approve')}
            disabled={busy}
            style={{
              background: 'var(--lumidian)',
              border: 0,
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              padding: '10px 18px',
              fontWeight: 600,
              minHeight: 36,
            }}
          >
            {busy ? 'Saving…' : 'Approve →'}
          </button>
        </div>
      )}
    </motion.div>
  );
}
