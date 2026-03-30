'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { useAuth } from '@/contexts/AuthContext';
import { authVerifyEmail, authResendVerification } from '@/lib/api';

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

export default function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    document.title = 'Verify Your Email — Lumidian';
  }, []);

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
      await authVerifyEmail(trimmed);
      await refresh();
      // AuthContext useEffect redirects to /dashboard once email_verified=true
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
      await authResendVerification();
      setResent(true);
    } catch {
      setError('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  }

  // Render nothing while user state is resolving (AuthContext redirects if needed)
  if (!user) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 10,
    padding: '12px 16px',
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '0.3em',
    color: '#0F0F12',
    outline: 'none',
    boxSizing: 'border-box',
    textAlign: 'center',
    fontFamily: 'var(--font-fira-code), monospace',
    transition: 'border-color 0.15s',
  };

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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Background gradient orbs — same as login/register */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20vh', left: '-15vw', width: '70vw', height: '70vw', maxWidth: 900, maxHeight: 900, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(147,197,253,0.38) 0%, rgba(147,197,253,0.08) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '-10vh', right: '-10vw', width: '60vw', height: '60vw', maxWidth: 800, maxHeight: 800, borderRadius: '50%', background: 'radial-gradient(circle at 60% 40%, rgba(196,181,253,0.32) 0%, rgba(196,181,253,0.06) 50%, transparent 72%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '35vh', left: '25vw', width: '55vw', height: '55vw', maxWidth: 750, maxHeight: 750, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(167,243,208,0.22) 0%, rgba(167,243,208,0.04) 55%, transparent 72%)', filter: 'blur(70px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: NOISE_SVG, backgroundRepeat: 'repeat', backgroundSize: '200px 200px', opacity: 0.04, mixBlendMode: 'multiply' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 36 }}>
          <LumidianLogo size={40} withWordmark variant="light" />
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 20,
          padding: '36px 32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F0F12', margin: '0 0 4px', letterSpacing: '-0.03em' }}>
            Check your email
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>
            We sent a 6-digit code to{' '}
            <strong style={{ color: '#374151' }}>{user.email}</strong>.
            Enter it below to verify your account.
          </p>

          {error && (
            <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
            </div>
          )}

          {resent && (
            <div style={{ background: 'rgba(209,250,229,0.8)', border: '1px solid rgba(110,231,183,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#065f46', margin: 0 }}>A new code has been sent to your email.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
                Verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
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
                cursor: (loading || code.length !== 6) ? 'not-allowed' : 'pointer',
                opacity: (loading || code.length !== 6) ? 0.6 : 1,
                transition: 'background 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 8px rgba(15,15,18,0.15)',
                fontFamily: 'inherit',
              }}
            >
              {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {loading ? 'Verifying…' : 'Verify email'}
            </button>
          </form>

          <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 20, marginBottom: 0 }}>
            Didn&apos;t receive a code?{' '}
            <button
              onClick={handleResend}
              disabled={resending}
              style={{
                background: 'none',
                border: 'none',
                color: '#6366f1',
                fontWeight: 500,
                cursor: resending ? 'not-allowed' : 'pointer',
                fontSize: 13,
                padding: 0,
                fontFamily: 'inherit',
                opacity: resending ? 0.6 : 1,
              }}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
