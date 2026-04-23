'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, X } from 'lucide-react';
import { adminExitImpersonation, swapSessionToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AppToast, ToastData } from '@/components/AppToast';

export default function ImpersonationBanner() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [exiting, setExiting] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (typeof window === 'undefined') return null;
  const adminToken = sessionStorage.getItem('admin_restore_token');
  if (!adminToken) return null;

  async function handleExit() {
    const token = sessionStorage.getItem('admin_restore_token');
    if (!token) return;
    setExiting(true);
    try {
      const result = await adminExitImpersonation(token);
      // Set admin cookie via Next.js Route Handler (reliable, bypasses rewrite proxy)
      await swapSessionToken(result.admin_token);
      sessionStorage.removeItem('admin_restore_token');
      await refresh();
      router.push('/admin');
    } catch {
      setToast({ message: 'Failed to exit impersonation. Try logging out and back in.', type: 'error' });
      setExiting(false);
    }
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, #dc2626, #ea580c)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 20px',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={14} />
        <span>Viewing as <strong>{user?.email}</strong></span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 6,
          padding: '4px 12px',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: exiting ? 'wait' : 'pointer',
          opacity: exiting ? 0.6 : 1,
        }}
      >
        <X size={12} />
        {exiting ? 'Restoring...' : 'Exit Impersonation'}
      </button>
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
