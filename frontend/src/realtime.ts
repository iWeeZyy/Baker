import { API_BASE, getToken } from './api';

type NewMessageEvent = { type: 'new_message'; message: any };
// Poussé par tout site d'appel de _create_notification/l'upsert de like
// côté serveur — mêmes 8 types que GET /notifications (3 existants + 5
// ajoutés par la Messagerie), jamais une infrastructure séparée.
type NotificationEvent = { type: 'notification'; notification: any };
type RealtimeEvent = NewMessageEvent | NotificationEvent;
type Listener = (evt: RealtimeEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;

function wsUrl(token: string) {
  const base = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');
  return `${base}/api/ws?token=${encodeURIComponent(token)}`;
}

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    connect();
  }, reconnectDelay);
}

async function connect() {
  if (listeners.size === 0) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const token = await getToken();
  if (!token) return;
  try {
    const ws = new WebSocket(wsUrl(token));
    ws.onopen = () => { reconnectDelay = 2000; };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        listeners.forEach((l) => l(data));
      } catch {}
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
    socket = ws;
  } catch {
    scheduleReconnect();
  }
}

// Multiple screens can subscribe concurrently; they all share one socket.
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

export function disconnectRealtime() {
  listeners.clear();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) { try { socket.close(); } catch {} socket = null; }
}
