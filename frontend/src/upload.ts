import { Platform } from 'react-native';
import { API_BASE, getToken } from './api';

export async function uploadImage(uri: string): Promise<string> {
  const form = new FormData();
  const ext = (uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0];
  const name = `photo.${ext}`;
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, name);
  } else {
    form.append('file', { uri, name, type: `image/${ext}` } as any);
  }
  const token = await getToken();
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.detail || 'Upload failed');
  return j.path;
}
