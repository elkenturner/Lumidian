'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { forgotPassword } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Reset Password — Lumidian';
  }, []);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#020617] text-[#f8fafc] flex items-center justify-center p-6 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center justify-center mb-9">
          <LumidianLogo size={40} withWordmark variant="dark" />
        </div>

        {/* Card */}
        <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[rgba(99,102,241,0.1)] flex items-center justify-center mx-auto mb-4">
                <Mail size={22} className="text-[#6366f1]" />
              </div>
              <h1 className="text-xl font-bold text-[#f8fafc] mb-2">Check your email</h1>
              <p className="text-sm text-[#94a3b8] mb-6 leading-relaxed">
                If <span className="text-[#f8fafc] font-medium">{email}</span> is registered, you&apos;ll receive a reset link shortly.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[#64748b] hover:text-[#94a3b8] font-medium transition-colors"
              >
                <ArrowLeft size={14} />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-[#f8fafc] mb-1">Reset your password</h1>
              <p className="text-sm text-[#94a3b8] mb-6">Enter your email and we&apos;ll send you a reset link.</p>

              {error && (
                <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
                  <p className="text-sm text-[#f87171]">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-sm font-medium text-[#94a3b8] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-2.5 text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-2.5 px-5 mt-1 transition-colors"
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-[#94a3b8] mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-[#64748b] hover:text-[#94a3b8] font-medium transition-colors"
                >
                  <ArrowLeft size={14} />
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
