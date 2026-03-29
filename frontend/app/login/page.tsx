'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { useAuth } from '@/contexts/AuthContext';
import { getGoogleAuthUrl, verify2fa } from '@/lib/api';

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // 2FA step
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const from = searchParams.get('from') || '/dashboard';

  useEffect(() => { document.title = 'Sign In — Lumidian'; }, []);

  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) setError('Google sign-in failed. Please try again.');
  }, [searchParams]);

  async function handleGoogleClick() {
    setGoogleLoading(true);
    setError('');
    try {
      const url = await getGoogleAuthUrl(from);
      window.location.href = url;
    } catch {
      setError('Could not start Google sign-in. Please try again.');
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push(from);
    } catch (err: unknown) {
      const e = err as { message?: string; challenge_token?: string; response?: { data?: { detail?: string } } };
      if (e?.message === '2fa_required' && e.challenge_token) {
        setChallengeToken(e.challenge_token);
      } else {
        setError(e?.response?.data?.detail || 'Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError('');
    setLoading(true);
    try {
      await verify2fa(challengeToken, totpCode.trim());
      // verify2fa sets the cookie; refresh loads the user
      await refresh();
      router.push(from);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'relative',
      minHeight: '100vh',
      backgroundColor: '#F8F7F4',
      color: '#0F0F12',
      fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      overflow: 'hidden',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`}</style>

      {/* Background gradient orbs */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20vh', left: '-15vw', width: '70vw', height: '70vw', maxWidth: 900, maxHeight: 900, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(147,197,253,0.38) 0%, rgba(147,197,253,0.08) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '-10vh', right: '-10vw', width: '60vw', height: '60vw', maxWidth: 800, maxHeight: 800, borderRadius: '50%', background: 'radial-gradient(circle at 60% 40%, rgba(196,181,253,0.32) 0%, rgba(196,181,253,0.06) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '35vh', left: '25vw', width: '55vw', height: '55vw', maxWidth: 750, maxHeight: 750, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(167,243,208,0.22) 0%, rgba(167,243,208,0.04) 55%, transparent 72%)', filter: 'blur(70px)' }} />
        {/* Noise grain */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', backgroundSize: '200px 200px', opacity: 0.04, mixBlendMode: 'multiply' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 36 }}>
          <LumidianLogo size={40} withWordmark variant="light" />
        </div>

        {/* ── 2FA challenge card ── */}
        {challengeToken && (
          <div style={{
            background: 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 20,
            padding: '36px 32px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <ShieldCheck size={20} color="#4F46E5" />
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F0F12', margin: 0, letterSpacing: '-0.03em' }}>Two-factor authentication</h1>
            </div>
            <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>
              Enter the 6-digit code from your authenticator app.
            </p>

            {error && (
              <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
              </div>
            )}

            <form onSubmit={handleTotpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Authenticator code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="000000"
                  style={{ width: '100%', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '10px 12px', fontSize: 22, letterSpacing: '0.25em', color: '#0F0F12', outline: 'none', boxSizing: 'border-box', textAlign: 'center', fontFamily: 'monospace', transition: 'border-color 0.15s' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: '#0F0F12', border: 'none', borderRadius: 100, padding: '11px 20px',
                  fontSize: 14, fontWeight: 600, color: '#fff',
                  cursor: (loading || totpCode.length !== 6) ? 'not-allowed' : 'pointer',
                  opacity: (loading || totpCode.length !== 6) ? 0.6 : 1,
                  transition: 'background 0.15s', fontFamily: 'inherit',
                }}
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'Verifying…' : 'Verify'}
                {!loading && <ArrowRight size={15} />}
              </button>
            </form>
            <button
              type="button"
              onClick={() => { setChallengeToken(null); setTotpCode(''); setError(''); }}
              style={{ marginTop: 16, display: 'block', width: '100%', textAlign: 'center', fontSize: 13, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ← Back to sign in
            </button>
          </div>
        )}

        {/* Card */}
        {!challengeToken && <div style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 20,
          padding: '36px 32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F0F12', margin: '0 0 4px', letterSpacing: '-0.03em' }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>Sign in to your account</p>

          {error && (
            <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{ width: '100%', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F0F12', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s', fontFamily: 'inherit' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{ width: '100%', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '10px 40px 10px 12px', fontSize: 14, color: '#0F0F12', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s', fontFamily: 'inherit' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 0, display: 'flex' }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div style={{ textAlign: 'right', marginTop: -6 }}>
              <Link href="/forgot-password" style={{ fontSize: 12, color: '#6B7280', textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#4F46E5')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: '#0F0F12',
                border: 'none',
                borderRadius: 100,
                padding: '11px 20px',
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'background 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 8px rgba(15,15,18,0.15)',
                fontFamily: 'inherit',
                marginTop: 4,
              }}
              onMouseEnter={(e) => { if (!loading) { (e.currentTarget as HTMLButtonElement).style.background = '#2a2a3a'; } }}
              onMouseLeave={(e) => { if (!loading) { (e.currentTarget as HTMLButtonElement).style.background = '#0F0F12'; } }}
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <ArrowRight size={15} />}
            </button>
          </form>

          {/* Divider */}
          <div style={{ position: 'relative', margin: '20px 0' }}>
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', position: 'absolute', inset: '50% 0 auto' }} />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <span style={{ background: 'rgba(255,255,255,0.82)', padding: '0 12px', fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>or</span>
            </div>
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={googleLoading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'rgba(255,255,255,0.9)',
              border: '1px solid rgba(0,0,0,0.10)',
              borderRadius: 100,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              color: '#374151',
              cursor: googleLoading ? 'not-allowed' : 'pointer',
              opacity: googleLoading ? 0.5 : 1,
              transition: 'border-color 0.15s, box-shadow 0.15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLButtonElement; if (!el.disabled) { el.style.borderColor = 'rgba(0,0,0,0.2)'; el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; } }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'rgba(0,0,0,0.10)'; el.style.boxShadow = 'none'; }}
          >
            {googleLoading ? (
              <Loader2 size={15} className="animate-spin" />
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
        </div>}

        {!challengeToken && (
          <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7280', marginTop: 24, fontWeight: 400 }}>
            Don&apos;t have an account?{' '}
            <Link href="/register" style={{ color: '#4F46E5', fontWeight: 600, textDecoration: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#3730a3')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#4F46E5')}
            >
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
