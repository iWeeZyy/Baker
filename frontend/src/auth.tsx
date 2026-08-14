import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { api, saveToken, getToken, clearToken, setInMemoryToken } from './api';

WebBrowser.maybeCompleteAuthSession();

export type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as any);
export const useAuth = () => useContext(Ctx);

const processedSessions = new Set<string>();

async function exchangeSessionId(sessionId: string) {
  if (processedSessions.has(sessionId)) return null;
  processedSessions.add(sessionId);
  const data = await api('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  });
  return data;
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const applyAuth = useCallback(async (token: string, u: User) => {
    setInMemoryToken(token);
    await saveToken(token);
    setUser(u);
  }, []);

  const checkExisting = useCallback(async () => {
    const t = await getToken();
    if (!t) return false;
    setInMemoryToken(t);
    try {
      const me = await api('/auth/me');
      setUser(me);
      return true;
    } catch {
      await clearToken();
      setInMemoryToken(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let capturedUrl: string | null = null;
    const sub = Linking.addEventListener('url', (e) => { capturedUrl = e.url; });

    (async () => {
      try {
        // Handle cold start deep link
        const initialUrl = await Linking.getInitialURL();
        const sid = extractSessionId(initialUrl) || extractSessionId(capturedUrl);
        if (sid) {
          const data = await exchangeSessionId(sid);
          if (data) { await applyAuth(data.token, data.user); setLoading(false); return; }
        }
        // Web: check window
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const url = window.location.href;
          const wsid = extractSessionId(url);
          if (wsid) {
            const data = await exchangeSessionId(wsid);
            if (data) {
              await applyAuth(data.token, data.user);
              try {
                const clean = window.location.pathname + window.location.search.replace(/[?&]session_id=[^&]+/, '');
                window.history.replaceState(window.history.state, '', clean.replace(/[?&]$/, ''));
              } catch {}
              setLoading(false);
              return;
            }
          }
        }
        await checkExisting();
      } finally {
        setLoading(false);
      }
    })();

    return () => sub.remove();
  }, [applyAuth, checkExisting]);

  const login = async (email: string, password: string) => {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await applyAuth(data.token, data.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
    await applyAuth(data.token, data.user);
  };

  const loginWithGoogle = async () => {
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin + '/' : '')
      : Linking.createURL('');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === 'web') {
      window.location.href = authUrl;
      return;
    }
    let captured: string | null = null;
    const sub = Linking.addEventListener('url', (e) => { captured = e.url; });
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let sid: string | null = null;
      if ((result as any).url) sid = extractSessionId((result as any).url);
      if (!sid) sid = extractSessionId(captured);
      if (!sid) {
        const init = await Linking.getInitialURL();
        sid = extractSessionId(init);
      }
      if (sid) {
        const data = await exchangeSessionId(sid);
        if (data) await applyAuth(data.token, data.user);
      }
    } finally {
      sub.remove();
    }
  };

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await clearToken();
    setInMemoryToken(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, loginWithGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}
