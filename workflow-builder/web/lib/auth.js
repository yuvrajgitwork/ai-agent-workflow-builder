import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AUTH_URL } from './config';

const STORAGE_KEY = 'wf_session';

// Module-level mirror of the current access token so the Apollo links (which live
// outside React) can always read the latest token synchronously without re-rendering.
let currentAccessToken = null;
export function getAccessToken() {
  return currentAccessToken;
}

function loadSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

async function authFetch(path, body) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || `Auth request failed (HTTP ${res.status})`);
  }
  return json;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef(null);

  const applySession = useCallback((s) => {
    currentAccessToken = s?.accessToken ?? null;
    setSession(s);
    saveSession(s);

    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (s?.refreshToken && s?.accessTokenExpiresIn) {
      const refreshInMs = Math.max((s.accessTokenExpiresIn - 60) * 1000, 5000);
      refreshTimer.current = setTimeout(() => doRefresh(s.refreshToken), refreshInMs);
    }
  }, []);

  const doRefresh = useCallback(
    async (refreshToken) => {
      try {
        const json = await authFetch('/token', { refreshToken });
        applySession(json.session ?? json);
      } catch (err) {
        console.error('Token refresh failed', err);
        applySession(null);
      }
    },
    [applySession]
  );

  useEffect(() => {
    const stored = loadSession();
    if (stored?.refreshToken) {
      doRefresh(stored.refreshToken).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signUp = useCallback(
    async (email, password) => {
      const json = await authFetch('/signup/email-password', { email, password });
      if (json.session) {
        applySession(json.session);
        return { needsVerification: false };
      }
      return { needsVerification: true };
    },
    [applySession]
  );

  const signIn = useCallback(
    async (email, password) => {
      const json = await authFetch('/signin/email-password', { email, password });
      applySession(json.session ?? json);
    },
    [applySession]
  );

  const signOut = useCallback(() => {
    applySession(null);
  }, [applySession]);

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
