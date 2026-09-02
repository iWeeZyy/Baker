/**
 * Upload générique vers POST /upload, partagé par les écrans d'extraction
 * assistée (scan.tsx, instagram-import.tsx) pour la photo de couverture
 * optionnelle. share.tsx garde sa propre copie inline — hors périmètre de
 * cette extraction.
 */
import { Platform } from 'react-native';
import { API_BASE, getToken } from '@/src/api';

export async function uploadImage(uri: string, name: string): Promise<string> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, name);
  } else {
    form.append('file', { uri, name, type: `image/${name.split('.').pop()}` } as any);
  }
  const token = await getToken();
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.detail || 'Envoi impossible');
  return j.path;
}
