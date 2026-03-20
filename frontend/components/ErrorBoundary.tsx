'use client';

import React from 'react';
import OceanLogo from '@/components/OceanLogo';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      fetch('/api/errors/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || 'Unknown error',
          stack: error?.stack || null,
          component_stack: info?.componentStack || null,
          url: typeof window !== 'undefined' ? window.location.href : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => {});
    } catch {}
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#080C14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        padding: '24px',
      }}>
        {/* Background orbs */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: '-15%', left: '-10%',
            width: '580px', height: '580px',
            background: 'radial-gradient(circle, rgba(55,48,163,0.15) 0%, transparent 65%)',
            filter: 'blur(100px)', borderRadius: '50%',
          }} />
          <div style={{
            position: 'absolute', bottom: '-18%', right: '-5%',
            width: '480px', height: '480px',
            background: 'radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 65%)',
            filter: 'blur(90px)', borderRadius: '50%',
          }} />
        </div>

        <div style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          backdropFilter: 'blur(20px)',
          padding: '48px 40px',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
        }}>
          {/* Logo */}
          <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <OceanLogo size={36} withCircle />
            <span style={{ fontSize: '20px', fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
              ClarityAI
            </span>
          </div>

          {/* Error icon */}
          <div style={{
            width: '64px', height: '64px',
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
            fontSize: '28px',
          }}>
            ⚠️
          </div>

          <h1 style={{
            fontSize: '20px',
            fontWeight: 700,
            color: '#e2e8f0',
            marginBottom: '12px',
          }}>
            Something went wrong
          </h1>

          <p style={{
            fontSize: '14px',
            color: '#94a3b8',
            lineHeight: 1.6,
            marginBottom: '32px',
          }}>
            An unexpected error occurred. Our team has been notified.
            Try reloading the page — if the problem persists, contact support.
          </p>

          <button
            onClick={() => window.location.reload()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 24px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            aria-label="Reload the page"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
