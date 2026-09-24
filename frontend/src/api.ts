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

// A route this file knows nothing about (entitlements.ts) needs to react the
// moment ANY request is turned away on plan grounds, wherever in the app that
// request was made — this is the one place every request already passes
// through, so it is also the one place that can notice for free. Kept as a
// plain listener set rather than an import of `isPlanLimitError` from
// src/plan.ts to avoid a circular import (plan.ts already imports this file).
type PlanLimitListener = () => void;
const planLimitListeners = new Set<PlanLimitListener>();
export function onPlanLimitError(cb: PlanLimitListener): () => void {
  planLimitListeners.add(cb);
  return () => planLimitListeners.delete(cb);
}

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
    if (res.status === 403 && (detail?.error === 'plan_limit_reached' || detail?.error === 'plan_feature_locked')) {
      // A quota/feature refusal almost always means the account's usage (or,
      // once billing exists, its tier) just changed underneath a stale
      // entitlements snapshot — notify rather than wait for the next
      // scheduled refresh, so the screen that shows the "Verrouillé" chip
      // reflects the server's answer immediately, not on the next foreground.
      planLimitListeners.forEach(cb => { try { cb(); } catch {} });
    }
    const err: any = new Error(msg);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}
