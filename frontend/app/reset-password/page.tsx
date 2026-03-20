'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Zap, Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { resetPassword } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = searchParams.get('token') || '';
    setToken(t);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Invalid reset link. Please request a new one.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'This reset link is invalid or has expired. Please request a new one.'
      );
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
          {success ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 className="text-lg font-bold text-[#e2e8f0] mb-2">Password updated</h1>
              <p className="text-sm text-[#64748b]">
                Your password has been changed. Redirecting to sign in…
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#e2e8f0] mb-1">Set new password</h1>
              <p className="text-sm text-[#64748b] mb-6">Choose a new password for your account.</p>

              {error && (
                <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-lg px-4 py-3 mb-5">
                  <p className="text-sm text-[#f87171]">{error}</p>
                </div>
              )}

              {!token && (
                <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-lg px-4 py-3 mb-5">
                  <p className="text-sm text-[#f87171]">
                    No reset token found. Please use the link from your email.
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      minLength={6}
                      className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#475569] hover:text-[#94a3b8] transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Confirm password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !token}
                  className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Updating…' : 'Update password'}
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
