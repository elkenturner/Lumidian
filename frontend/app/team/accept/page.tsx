'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { acceptTeamInvite } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function TeamAcceptPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (authLoading) return;

    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus('error');
      setMessage('Invalid invite link: no token found.');
      return;
    }

    if (!user) {
      // Not logged in — redirect to login, then back here
      router.replace(`/login?from=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    acceptTeamInvite(token)
      .then(() => {
        setStatus('success');
        setMessage("You've joined the team! Redirecting to your dashboard…");
        setTimeout(() => router.replace('/dashboard'), 2500);
      })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { detail?: string } } };
        setStatus('error');
        setMessage(err?.response?.data?.detail ?? 'Failed to accept invitation. The link may have expired.');
      });
  }, [authLoading, user, router]);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-6">
      <div className="max-w-md w-full card rounded-2xl p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 size={40} className="animate-spin text-[var(--accent)] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Accepting invitation…</h1>
            <p className="text-sm text-[var(--text-muted)]">Please wait a moment.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="text-[var(--success)] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Welcome to the team!</h1>
            <p className="text-sm text-[var(--text-muted)]">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={40} className="text-[var(--danger)] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Invitation failed</h1>
            <p className="text-sm text-[var(--text-muted)]">{message}</p>
            <button
              onClick={() => router.replace('/dashboard')}
              className="mt-6 px-5 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
