import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthUser, insforge, isAuthConfigured } from '../lib/insforge';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  authEnabled: boolean;
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  authEnabled: false,
  refresh: async () => undefined,
  setUser: () => undefined,
  signOut: async () => undefined
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // When auth is not configured there is nothing to hydrate, so skip the
  // loading state entirely and let the app render immediately.
  const [loading, setLoading] = useState(isAuthConfigured);

  const refresh = useCallback(async () => {
    if (!insforge) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await insforge.auth.getCurrentUser();
      setUser(error ? null : ((data?.user as AuthUser | undefined) ?? null));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!insforge) {
        setLoading(false);
        return;
      }

      try {
        // On a cold load there is no in-memory access token, so the SDK
        // rehydrates the session from the httpOnly refresh cookie.
        const { data, error } = await insforge.auth.getCurrentUser();
        if (cancelled) return;
        setUser(error ? null : ((data?.user as AuthUser | undefined) ?? null));
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    if (insforge) await insforge.auth.signOut().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, authEnabled: isAuthConfigured, refresh, setUser, signOut }),
    [user, loading, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
