'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, LogOut, Loader2 } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { authLogout } from '@/lib/api';

const SUPPORT_MAILTO = 'mailto:support@lumidian.ai?subject=Account%20paused%20%E2%80%94%20request%20review&body=Please%20review%20my%20account%20status.';

/**
 * Full-screen page shown when an admin has paused the user's account.
 * Reachable via the 403 interceptor in lib/api.ts. Makes no API calls
 * other than the explicit Logout action — the page must work even when
 * every other endpoint is returning 403 for this user.
 */
export default function AccountPausedPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.title = 'Account paused — Lumidian';
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await authLogout();
    } catch {
      // Logout endpoint should always work for paused users (no auth required),
      // but if anything goes sideways, clear cookies client-side as fallback.
      document.cookie = 'clarity_session=; path=/; max-age=0';
      document.cookie = 'clarity_token=; path=/; max-age=0';
    } finally {
      router.push('/login');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <LumidianLogo />
        </div>
        <div className="card p-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
            Your account has been paused
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
            Access to your account has been restricted. To restore access, please contact our team and we&rsquo;ll get back to you shortly.
          </p>
          <a
            href={SUPPORT_MAILTO}
            className="inline-flex items-center justify-center gap-2 w-full rounded-lg bg-[var(--accent)] hover:brightness-110 px-4 py-2.5 text-sm font-semibold text-white transition-all"
          >
            <Mail size={14} />
            Contact support
          </a>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-3 inline-flex items-center justify-center gap-2 w-full rounded-lg border border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors disabled:opacity-60"
          >
            {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
