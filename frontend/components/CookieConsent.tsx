'use client';

import { useState, useEffect } from 'react';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie_consent');
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookie_consent', 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem('cookie_consent', 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  // Full-width bottom bar rather than a floating corner card — a corner card
  // overlaps and clips page content (e.g. the cluster Sources panel). A flush
  // bottom bar reads as chrome and never sits on top of a content panel.
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-[var(--border-subtle)] bg-[var(--bg-base)]/95 backdrop-blur px-4 py-3 shadow-lg">
      <div className="mx-auto max-w-[1400px] flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-[var(--text-secondary)] flex-1">
          We use cookies to keep you signed in and the app running.{' '}
          <a href="/privacy" className="underline hover:text-[var(--text-primary)] transition-colors">
            Privacy Policy
          </a>
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDecline}
            className="rounded-md border border-[var(--bg-card)] px-4 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
