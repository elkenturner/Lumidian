'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, ArrowLeft, CheckCircle, Check, X } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { resetPassword } from '@/lib/api';

const PASSWORD_RULES = [
  { label: '8+ characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number', test: (p: string) => /\d/.test(p) },
];

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

  const passwordChecks = useMemo(() => PASSWORD_RULES.map(r => r.test(password)), [password]);
  const passwordValid = passwordChecks.every(Boolean);

  useEffect(() => {
    document.title = 'Set New Password — Lumidian';
  }, []);

  useEffect(() => {
    const t = searchParams.get('token') || '';
    setToken(t);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!passwordValid) {
      setError('Please meet all password requirements.');
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
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(
        e?.response?.data?.detail || 'This reset link is invalid or has expired. Please request a new one.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#020617] text-[#f8fafc] flex items-center justify-center p-4 md:p-6 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(95,126,166,0.15) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center justify-center mb-9">
          <LumidianLogo size={32} withWordmark variant="dark" />
        </div>

        {/* Card */}
        <div className="bg-[#0f172a] border border-[rgba(51,65,85,0.5)] rounded-2xl p-6 md:p-8">
          {success ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[rgba(34,197,94,0.1)] flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={22} className="text-[#22c55e]" />
              </div>
              <h1 className="text-xl font-bold text-[#f8fafc] mb-2">Password updated</h1>
              <p className="text-sm text-[#94a3b8] leading-relaxed">
                Your password has been changed. Redirecting to sign in…
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-[#f8fafc] mb-1">Set new password</h1>
              <p className="text-sm text-[#94a3b8] mb-6">Choose a new password for your account.</p>

              {!token ? (
                <div>
                  <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
                    <p className="text-sm text-[#f87171]">No reset token found. Please use the link from your email, or request a new one.</p>
                  </div>
                  <Link
                    href="/forgot-password"
                    className="w-full flex items-center justify-center gap-2 bg-[#5f7ea6] hover:bg-[#4a6a90] text-white font-semibold rounded-full py-3 md:py-2.5 px-5 transition-colors min-h-[48px]"
                  >
                    Request new reset link
                  </Link>
                  <p className="text-center text-sm text-[#94a3b8] mt-6">
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-1.5 text-[#64748b] hover:text-[#94a3b8] font-medium transition-colors"
                    >
                      <ArrowLeft size={14} />
                      Back to sign in
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
                      <p className="text-sm text-[#f87171]">{error}</p>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#94a3b8] mb-1.5">New password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          placeholder="Min. 8 characters"
                          minLength={8}
                          className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-3 md:py-2.5 pr-10 text-base md:text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#5f7ea6] focus:ring-2 focus:ring-[rgba(95,126,166,0.2)] transition-[border-color,box-shadow]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] transition-colors"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {password.length > 0 && (
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                          {PASSWORD_RULES.map((rule, i) => (
                            <div key={rule.label} className="flex items-center gap-1.5">
                              {passwordChecks[i]
                                ? <Check size={12} className="text-emerald-400 shrink-0" />
                                : <X size={12} className="text-[#64748b] shrink-0" />}
                              <span className={`text-xs ${passwordChecks[i] ? 'text-emerald-400' : 'text-[#64748b]'}`}>
                                {rule.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#94a3b8] mb-1.5">Confirm password</label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        placeholder="Re-enter password"
                        className="w-full bg-[#1e293b] border border-[rgba(51,65,85,0.5)] rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-[#f8fafc] placeholder-[#64748b] outline-none focus:border-[#5f7ea6] focus:ring-2 focus:ring-[rgba(95,126,166,0.2)] transition-[border-color,box-shadow]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 bg-[#5f7ea6] hover:bg-[#4a6a90] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 md:py-2.5 px-5 mt-1 transition-colors min-h-[48px]"
                    >
                      {loading && <Loader2 size={15} className="animate-spin" />}
                      {loading ? 'Updating…' : 'Update password'}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
