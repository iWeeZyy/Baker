import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'bakers_auth_token';

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
    try { const j = await res.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
