import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@anybid/shared';
import { api, setUnauthorizedHandler, tokenStore } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(input: Record<string, unknown>): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const tokens = await tokenStore.get();
    if (!tokens) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await api.auth.me();
      setUser(me);
    } catch {
      await tokenStore.set(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login({ email, password });
    await tokenStore.set(result.tokens);
    setUser(result.user);
  }, []);

  const register = useCallback(async (input: Record<string, unknown>) => {
    const result = await api.auth.register(input);
    await tokenStore.set(result.tokens);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    await tokenStore.set(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, register, signOut, refresh }),
    [user, loading, signIn, register, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
