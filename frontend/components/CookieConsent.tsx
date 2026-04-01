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
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-[#1e293b] bg-[#0a0a0f] p-4 shadow-lg">
      <p className="text-sm text-[#94a3b8] mb-3">
        We use cookies to keep you signed in and the app running.{' '}
        <a href="/privacy" className="underline hover:text-[#e2e8f0] transition-colors">
          Privacy Policy
        </a>
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleDecline}
          className="flex-1 rounded-md border border-[#1e293b] px-3 py-1.5 text-sm text-[#94a3b8] transition-colors hover:border-[#334155] hover:text-[#e2e8f0]"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="flex-1 rounded-md bg-[#6366f1] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#4f46e5]"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
