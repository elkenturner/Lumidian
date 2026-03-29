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
      setMessage('Invalid invite link — no token found.');
      return;
    }

    if (!user) {
      // Not logged in — redirect to login, then back here
      router.replace(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
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
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-2xl p-8 text-center shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
        {status === 'loading' && (
          <>
            <Loader2 size={40} className="animate-spin text-[#6366f1] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[#F0F4F8] mb-2">Accepting invitation…</h1>
            <p className="text-sm text-[#64748B]">Please wait a moment.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="text-[#10b981] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[#F0F4F8] mb-2">Welcome to the team!</h1>
            <p className="text-sm text-[#64748B]">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={40} className="text-[#f87171] mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-[#F0F4F8] mb-2">Invitation failed</h1>
            <p className="text-sm text-[#64748B]">{message}</p>
            <button
              onClick={() => router.replace('/dashboard')}
              className="mt-6 px-5 py-2 bg-[#6366f1] text-white rounded-lg text-sm font-medium hover:bg-[#4f46e5] transition-colors"
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
