'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff, ArrowRight, Check, X } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { useAuth } from '@/contexts/AuthContext';
import { getGoogleAuthUrl } from '@/lib/api';

const PASSWORD_RULES = [
  { label: '8+ characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number', test: (p: string) => /\d/.test(p) },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  useEffect(() => { document.title = 'Create Account · Lumidian'; }, []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordChecks = useMemo(() => PASSWORD_RULES.map(r => r.test(password)), [password]);
  const passwordValid = passwordChecks.every(Boolean);

  async function handleGoogleClick() {
    setGoogleLoading(true);
    setError('');
    try {
      const url = await getGoogleAuthUrl('/onboarding');
      window.location.href = url;
    } catch {
      setError('Could not start Google sign-in. Please try again.');
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!passwordValid) {
      setError('Please meet all password requirements.');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      router.push(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex items-center justify-center p-4 md:p-6 overflow-hidden">
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
        <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-2xl p-6 md:p-8">
          <h1 className="text-2xl font-display text-[var(--text-primary)] mb-1">Create your account</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">Start tracking your brand&apos;s AI visibility</p>

          {error && (
            <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg px-3.5 py-2.5 mb-5">
              <p className="text-sm text-[#f87171]">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mobile-input w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(95,126,166,0.2)] transition-[border-color,box-shadow]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="mobile-input w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(95,126,166,0.2)] transition-[border-color,box-shadow]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min. 8 characters"
                  className="mobile-input w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-3 py-3 md:py-2.5 pr-10 text-base md:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(95,126,166,0.2)] transition-[border-color,box-shadow]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
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
                        : <X size={12} className="text-[var(--text-muted)] shrink-0" />}
                      <span className={`text-xs ${passwordChecks[i] ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
                        {rule.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 md:py-2.5 px-5 mt-1 transition-colors min-h-[48px]"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Creating account…' : 'Create account'}
              {!loading && <ArrowRight size={15} />}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border-subtle)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[var(--bg-raised)] px-3 text-xs text-[var(--text-muted)]">or</span>
            </div>
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-primary)] font-medium rounded-full py-2.5 px-5 transition-colors"
          >
            {googleLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {googleLoading ? 'Signing in…' : 'Continue with Google'}
          </button>

          <p className="text-center text-xs text-[var(--text-muted)] mt-5">
            By creating an account you agree to our{' '}
            <Link href="/terms" className="text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] transition-colors">terms of service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] transition-colors">privacy policy</Link>
          </p>
        </div>

        <p className="text-center text-sm text-[var(--text-secondary)] mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--accent)] hover:text-[#8ba8cc] font-semibold transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
