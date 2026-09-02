import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'levanea_auth_token';

export async function saveToken(token: string) {
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(KEY, token); } catch {}
  } else {
    await SecureStore.setItemAsync(KEY, token);
  }
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return window.localStorage.getItem(KEY); } catch { return null; }
  }
  return await SecureStore.getItemAsync(KEY);
}

export async function clearToken() {
  if (Platform.OS === 'web') {
    try { window.localStorage.removeItem(KEY); } catch {}
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}

export const API_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

let cachedToken: string | null = null;
export function setInMemoryToken(t: string | null) { cachedToken = t; }

export async function api(path: string, opts: RequestInit = {}) {
  const token = cachedToken || (await getToken());
  const headers: any = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let msg = `${res.status}`;
    let detail: any = null;
    try {
      const j = await res.json();
      detail = j.detail ?? null;
      // `detail` is a plain string for most errors, but a structured object for
      // ones the UI must react to (e.g. plan_limit_reached -> show Baker Pro).
      if (typeof detail === 'string') msg = detail;
      else if (detail?.message) msg = detail.message;
    } catch {}
    const err: any = new Error(msg);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}
