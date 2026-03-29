'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import { forgotPassword } from '@/lib/api';

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

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
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(79,70,229,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2">
                  <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F0F12', margin: '0 0 8px', letterSpacing: '-0.03em' }}>Check your email</h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', lineHeight: 1.6 }}>
                If <span style={{ color: '#374151', fontWeight: 500 }}>{email}</span> is registered, you&apos;ll receive a reset link shortly.
              </p>
              <Link
                href="/login"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#6B7280', textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#4F46E5')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
              >
                <ArrowLeft size={14} />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F0F12', margin: '0 0 4px', letterSpacing: '-0.03em' }}>Reset your password</h1>
              <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 24px', fontWeight: 400 }}>Enter your email and we&apos;ll send you a reset link.</p>

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
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
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
                    cursor: (loading || !email.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (loading || !email.trim()) ? 0.6 : 1,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    boxShadow: '0 2px 8px rgba(15,15,18,0.15)',
                    fontFamily: 'inherit',
                    marginTop: 4,
                  }}
                  onMouseEnter={(e) => { if (!loading && email.trim()) { (e.currentTarget as HTMLButtonElement).style.background = '#2a2a3a'; } }}
                  onMouseLeave={(e) => { if (!loading && email.trim()) { (e.currentTarget as HTMLButtonElement).style.background = '#0F0F12'; } }}
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7280', marginTop: 24, fontWeight: 400 }}>
                <Link
                  href="/login"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6B7280', textDecoration: 'none', fontWeight: 500 }}
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
