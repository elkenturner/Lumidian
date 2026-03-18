'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

// The backend sets clarity_session on localhost:3001, but Next.js middleware
// runs on localhost:3000 — different port = different cookie jar. So we also
// set/clear the session flag from the frontend JS so middleware can read it.
function setSessionCookie() {
  document.cookie = 'clarity_session=1; path=/; max-age=604800; samesite=lax';
}
function clearSessionCookie() {
  document.cookie = 'clarity_session=; path=/; max-age=0';
}

export function AuthProvider({ children }: { children: ReactNode }) {
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
