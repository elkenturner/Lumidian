'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { resetPassword } from '@/lib/api';

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

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
          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F0F12', margin: '0 0 8px', letterSpacing: '-0.03em' }}>Password updated</h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Your password has been changed. Redirecting to sign in…
              </p>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F0F12', margin: '0 0 4px', letterSpacing: '-0.03em' }}>Set new password</h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>Choose a new password for your account.</p>

              {!token && (
                <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                  <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>No reset token found. Please use the link from your email.</p>
                </div>
              )}

              {error && (
                <div style={{ background: 'rgba(254,226,226,0.8)', border: '1px solid rgba(252,165,165,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                  <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>New password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      minLength={6}
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
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Confirm password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="••••••••"
                    style={{ width: '100%', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F0F12', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s', fontFamily: 'inherit' }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(79,70,229,0.5)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !token}
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
                    cursor: (loading || !token) ? 'not-allowed' : 'pointer',
                    opacity: (loading || !token) ? 0.6 : 1,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    boxShadow: '0 2px 8px rgba(15,15,18,0.15)',
                    fontFamily: 'inherit',
                    marginTop: 4,
                  }}
                  onMouseEnter={(e) => { if (!loading && token) { (e.currentTarget as HTMLButtonElement).style.background = '#2a2a3a'; } }}
                  onMouseLeave={(e) => { if (!loading && token) { (e.currentTarget as HTMLButtonElement).style.background = '#0F0F12'; } }}
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>

              <p style={{ textAlign: 'center', marginTop: 24 }}>
                <Link
                  href="/login"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#6B7280', textDecoration: 'none', fontWeight: 500 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#4F46E5')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
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
