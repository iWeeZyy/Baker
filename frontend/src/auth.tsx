import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, saveToken, getToken, clearToken, setInMemoryToken } from './api';
import { disconnectRealtime } from './realtime';
import { syncWidgetData, clearWidgetData } from './widgetData';

export type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  bio?: string | null;
  instagram_username?: string | null;
  profession?: string | null;
  team_visibility?: 'public' | 'authenticated' | 'private';
  notify_new_follower?: boolean;
  notify_new_recipe?: boolean;
  notify_new_creation?: boolean;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfile: (fields: {
    bio?: string; instagram_username?: string; profession?: string; team_visibility?: string;
    notify_new_follower?: boolean; notify_new_recipe?: boolean; notify_new_creation?: boolean;
  }) => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const applyAuth = useCallback(async (token: string, u: User) => {
    setInMemoryToken(token);
    await saveToken(token);
    setUser(u);
    syncWidgetData(u.user_id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const t = await getToken();
        if (!t) return;
        setInMemoryToken(t);
        try {
          const me = await api('/auth/me');
          setUser(me);
          // Le widget a des données dès le lancement de l'app, sans attendre
          // un passage par l'onglet Planning.
          syncWidgetData(me.user_id);
        } catch {
          await clearToken();
          setInMemoryToken(null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await applyAuth(data.token, data.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
    await applyAuth(data.token, data.user);
  };

  const logout = async () => {
    // Effacé avant même que le token ne le soit : aucune fenêtre où le widget
    // pourrait encore republier les données de ce compte.
    clearWidgetData();
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    disconnectRealtime();
    await clearToken();
    setInMemoryToken(null);
    setUser(null);
  };

  // Relit le compte depuis le serveur plutôt que de corriger l'état local
  // à la main — une seule source de vérité, réutilisée après un
  // changement de photo de profil pour que le nouvel avatar apparaisse
  // immédiatement partout où `user` est lu.
  const refreshUser = async () => {
    const me = await api('/auth/me');
    setUser(me);
  };

  // Même séquence que l'upload d'avatar : on écrit, puis on relit la source
  // de vérité serveur plutôt que de corriger l'état local à la main.
  const updateProfile = async (fields: {
    bio?: string; instagram_username?: string; profession?: string; team_visibility?: string;
    notify_new_follower?: boolean; notify_new_recipe?: boolean; notify_new_creation?: boolean;
  }) => {
    await api('/auth/me', { method: 'PUT', body: JSON.stringify(fields) });
    await refreshUser();
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refreshUser, updateProfile }}>
      {children}
    </Ctx.Provider>
  );
}
