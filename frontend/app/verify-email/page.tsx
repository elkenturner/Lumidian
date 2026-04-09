'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { authVerifyEmail, authResendVerification } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const { refresh } = useAuth();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    document.title = 'Verify Your Email — Lumidian';
  }, []);

  // If no email param, send them back to register
  useEffect(() => {
    if (!email) {
      router.replace('/register');
    }
  }, [email, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authVerifyEmail(email, trimmed);
      setVerified(true);
      // Ensure session cookie is visible to refresh() before it checks document.cookie
      // (Set-Cookie from the response may not be processed yet)
      document.cookie = 'clarity_session=1; path=/; max-age=604800; samesite=lax';
      await refresh();
      router.push('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError('');
    setResent(false);
    try {
      await authResendVerification(email);
      setResent(true);
    } catch {
      setError('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  }

  if (!email) return null;

  return (
    <div className="relative min-h-screen bg-[#020617] text-[#f8fafc] flex items-center justify-center p-4 md:p-6 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(167,139,250,0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center justify-center mb-9">
          <LumidianLogo size={32} withWordmark variant="dark" />
        </div>

        {/* Card */}
        <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-6 md:p-8">
          {verified ? (
            <>
              <h1 className="text-2xl font-bold text-[#f8fafc] mb-1">Email verified</h1>
              <p className="text-sm text-[#94a3b8]">
                Redirecting you to your dashboard...
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-[#f8fafc] mb-1">Check your email</h1>
              <p className="text-sm text-[#94a3b8] mb-6">
                We sent a 6-digit code to{' '}
                <strong className="text-[#f8fafc]">{email}</strong>.
                Enter it below to verify your account.
              </p>

              {error && (
                <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
                  <p className="text-sm text-[#f87171]">{error}</p>
                </div>
              )}

              {resent && (
                <div className="bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
                  <p className="text-sm text-[#4ade80]">A new code has been sent to your email.</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div>
                  <label htmlFor="verification-code" className="block text-sm font-medium text-[#94a3b8] mb-2">
                    Verification code
                  </label>
                  <input
                    id="verification-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    autoFocus
                    className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-2.5 text-3xl md:text-2xl text-center font-mono tracking-[0.3em] text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#a78bfa] focus:ring-2 focus:ring-[rgba(167,139,250,0.2)] transition-[border-color,box-shadow]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full flex items-center justify-center gap-2 bg-[#a78bfa] hover:bg-[#8b5cf6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 md:py-2.5 px-5 transition-colors min-h-[48px]"
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Verifying…' : 'Verify email'}
                </button>
              </form>

              <p className="text-sm text-[#64748b] text-center mt-5">
                Didn&apos;t receive a code?{' '}
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="text-[#a78bfa] hover:text-[#c4b5fd] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              </p>
            </>
          )}
        </div>

        {!verified && (
          <button
            onClick={() => router.push('/register')}
            className="flex items-center justify-center gap-1.5 mx-auto mt-6 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors"
          >
            <ArrowLeft size={14} />
            Back to sign up
          </button>
        )}
      </div>
    </div>
  );
}
