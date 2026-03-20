'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Zap, Loader2, ArrowLeft } from 'lucide-react';
import { forgotPassword } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

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
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#6366f1] flex items-center justify-center">
            <Zap size={20} className="text-white" fill="white" />
          </div>
          <span className="text-2xl font-bold text-[#e2e8f0]">ClarityAI</span>
        </div>

        <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[#6366f1]/20 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
                  <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h1 className="text-lg font-bold text-[#e2e8f0] mb-2">Check your email</h1>
              <p className="text-sm text-[#64748b] mb-6">
                If <span className="text-[#94a3b8]">{email}</span> is registered, you&apos;ll receive a password reset link shortly.
              </p>
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-[#818cf8] hover:text-[#6366f1] transition-colors"
              >
                <ArrowLeft size={14} />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#e2e8f0] mb-1">Reset your password</h1>
              <p className="text-sm text-[#64748b] mb-6">
                Enter your email and we&apos;ll send you a reset link.
              </p>

              {error && (
                <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-lg px-4 py-3 mb-5">
                  <p className="text-sm text-[#f87171]">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link
                  href="/login"
                  className="flex items-center justify-center gap-2 text-sm text-[#64748b] hover:text-[#818cf8] transition-colors"
                >
                  <ArrowLeft size={14} />
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
