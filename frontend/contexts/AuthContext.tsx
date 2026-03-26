'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AuthUser, authMe, authLogin, authRegister, authLogout } from '@/lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Mirrored from middleware.ts — paths that don't require authentication
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password'];

// Set/clear the JS-accessible session flag that Next.js middleware reads.
// (The httponly clarity_token is set by the backend; this companion cookie
//  lets the middleware know a session exists without reading the token.)
function setSessionCookie() {
  document.cookie = 'clarity_session=1; path=/; max-age=604800; samesite=lax';
}
function clearSessionCookie() {
  document.cookie = 'clarity_session=; path=/; max-age=0';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const u = await authMe();
      setUser(u);
      setSessionCookie();
    } catch {
      setUser(null);
      clearSessionCookie();
      // If the token was stale/expired and we're on a protected route,
      // redirect to login so the user isn't stranded on a broken page.
      const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
      if (!isPublic) {
        router.push('/login');
      }
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const u = await authLogin(email, password);
    setUser(u);
    setSessionCookie();
  }

  async function register(email: string, password: string, name?: string) {
    const u = await authRegister({ email, password, name });
    setUser(u);
    setSessionCookie();
  }

  async function logout() {
    await authLogout();
    setUser(null);
    clearSessionCookie();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
