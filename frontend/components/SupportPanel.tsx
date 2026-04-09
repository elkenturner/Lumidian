'use client';

import { useState } from 'react';
import { LifeBuoy, X, Send } from 'lucide-react';
import { submitSupportRequest } from '@/lib/api';

interface SupportPanelProps {
  panelLeft: number;
  onClose: () => void;
}

export default function SupportPanel({ panelLeft, onClose }: SupportPanelProps) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    setError('');
    try {
      await submitSupportRequest(subject.trim(), message.trim());
      setSent(true);
    } catch {
      setError('Failed to send. Please email support@lumidian.ai directly.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed z-[200]"
      style={{
        left: panelLeft,
        bottom: 16,
        width: 340,
        background: 'rgba(10,14,24,0.97)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(167,139,250,0.20)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[rgba(255,255,255,0.07)]">
        <div className="flex items-center gap-2">
          <LifeBuoy size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Contact Support</span>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.05)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.30)' }}
            >
              <Send size={17} className="text-[var(--success)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Message sent</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">We&apos;ll get back to you as soon as possible.</p>
            </div>
            <button onClick={onClose} className="mt-1 text-xs text-[var(--accent)] hover:text-[var(--accent-foreground)] transition-colors">
              Close
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--text-muted)] mb-4">We typically reply within 24 hours.</p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What can we help with?"
                  maxLength={200}
                  required
                  className="w-full px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-faint)] rounded-lg outline-none transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.50)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your question or issue..."
                  maxLength={5000}
                  required
                  rows={5}
                  className="w-full px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-faint)] rounded-lg outline-none transition-colors resize-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.50)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
                />
              </div>
              {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
              <button
                type="submit"
                disabled={sending || !subject.trim() || !message.trim()}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-[background-color] duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(167,139,250,0.85)', color: '#fff' }}
                onMouseEnter={(e) => { if (!sending) (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,1)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,0.85)'; }}
              >
                <Send size={11} />
                {sending ? 'Sending…' : 'Send message'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
