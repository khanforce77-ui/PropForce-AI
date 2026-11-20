'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  apiRequest,
  type MeResponse,
  type RequestOptions,
  type TokenResponse,
} from './api';

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  me: MeResponse | null;
  /** Stores a fresh access token (kept in memory only, never in localStorage). */
  setSession: (token: TokenResponse) => Promise<MeResponse>;
  refreshMe: () => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
  /** Authenticated request; refreshes the access token once on 401. */
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const inFlight = useRef<Promise<boolean> | null>(null);

  // Single-flight: refresh tokens rotate and a reused one revokes the session, so concurrent
  // callers (or React's double-invoked effects in development) must share one refresh request.
  const refreshToken = useCallback((): Promise<boolean> => {
    inFlight.current ??= apiRequest<TokenResponse>('/auth/refresh', { method: 'POST', csrf: true })
      .then((t) => {
        tokenRef.current = t.accessToken;
        return true;
      })
      .catch(() => {
        tokenRef.current = null;
        return false;
      })
      .finally(() => {
        setTimeout(() => (inFlight.current = null), 0);
      });
    return inFlight.current;
  }, []);

  const request = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      try {
        return await apiRequest<T>(path, { ...options, accessToken: tokenRef.current });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && (await refreshToken())) {
          return apiRequest<T>(path, { ...options, accessToken: tokenRef.current });
        }
        throw err;
      }
    },
    [refreshToken],
  );

  const refreshMe = useCallback(async () => {
    try {
      const data = await request<MeResponse>('/me');
      setMe(data);
      setStatus('signed-in');
      return data;
    } catch {
      setMe(null);
      setStatus('signed-out');
      return null;
    }
  }, [request]);

  const setSession = useCallback(
    async (token: TokenResponse) => {
      tokenRef.current = token.accessToken;
      const data = await request<MeResponse>('/me');
      setMe(data);
      setStatus('signed-in');
      return data;
    },
    [request],
  );

  const signOut = useCallback(async () => {
    await apiRequest('/auth/logout', { method: 'POST', csrf: true }).catch(() => undefined);
    tokenRef.current = null;
    setMe(null);
    setStatus('signed-out');
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    void (async () => {
      if (await refreshToken()) await refreshMe();
      else setStatus('signed-out');
    })();
  }, [refreshToken, refreshMe]);

  const value = useMemo(
    () => ({ status, me, setSession, refreshMe, signOut, request }),
    [status, me, setSession, refreshMe, signOut, request],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Where to send a user right after signing in. */
export function landingPath(me: MeResponse): string {
  if (me.mfaRequired && !me.user.mfaEnabled) return '/app/security?required=1';
  if (me.user.isPlatformAdmin) return '/app/admin';
  const first = me.memberships[0];
  if (!first) return '/app';
  if (me.memberships.length > 1) return '/app';
  if (first.agency.status === 'pending' && first.role === 'owner')
    return `/app/${first.agency.id}/onboarding`;
  return `/app/${first.agency.id}`;
}
