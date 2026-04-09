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

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-80 z-50 rounded-xl border border-[var(--bg-card)] bg-[var(--bg-base)] p-4 shadow-lg">
      <p className="text-sm text-[var(--text-secondary)] mb-3">
        We use cookies to keep you signed in and the app running.{' '}
        <a href="/privacy" className="underline hover:text-[var(--text-primary)] transition-colors">
          Privacy Policy
        </a>
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleDecline}
          className="flex-1 rounded-md border border-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="flex-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
