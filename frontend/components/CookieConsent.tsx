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
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 border-t border-[#1e293b] bg-[#0a0a0f] px-6 py-4">
      <p className="text-sm text-[#94a3b8]">
        We use cookies to keep you signed in and the app running.{' '}
        <a href="/privacy" className="underline hover:text-[#e2e8f0] transition-colors">
          Privacy Policy
        </a>
      </p>
      <div className="flex shrink-0 gap-3">
        <button
          onClick={handleDecline}
          className="rounded-md border border-[#1e293b] px-4 py-1.5 text-sm text-[#94a3b8] transition-colors hover:border-[#334155] hover:text-[#e2e8f0]"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="rounded-md bg-[#6366f1] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#4f46e5]"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
