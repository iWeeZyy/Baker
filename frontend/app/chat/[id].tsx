import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { subscribeRealtime } from '@/src/realtime';
import { theme } from '@/src/theme';

type Message = { id: string; from_user_id: string; to_user_id: string; content: string; created_at: string };

// Fallback poll in case the realtime socket is down; the socket delivers
// new messages near-instantly when connected.
const POLL_FALLBACK_MS = 15000;

function fmtTime(s: string) {
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function Chat() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFriends, setNotFriends] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const didInitialScroll = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api(`/messages/${id}`);
      setMessages(res.messages);
      setHasMore(res.has_more);
      setError(null);
      setNotFriends(false);
    } catch (e: any) {
      if (e.status === 403) setNotFriends(true);
      else setError(e.message || 'Erreur');
    }
  }, [id]);

  const loadOlder = async () => {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const res = await api(`/messages/${id}?before=${encodeURIComponent(messages[0].created_at)}`);
      setMessages(prev => [...res.messages, ...prev]);
      setHasMore(res.has_more);
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
    const iv = setInterval(load, POLL_FALLBACK_MS);
    return () => clearInterval(iv);
  }, [load]);

  // Instant delivery when the realtime socket is connected; falls back to
  // the poll above (POLL_FALLBACK_MS) if the socket drops.
  useEffect(() => {
    const unsubscribe = subscribeRealtime((evt) => {
      if (evt.type !== 'new_message') return;
      const m: Message = evt.message;
      if (m.from_user_id !== id && m.to_user_id !== id) return;
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      setNotFriends(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!loading && !didInitialScroll.current && messages.length > 0) {
      didInitialScroll.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, [loading, messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    setSending(true);
    try {
      const m = await api(`/messages/${id}`, { method: 'POST', body: JSON.stringify({ content }) });
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      if (e.status === 403) setNotFriends(true);
      else setError(e.message || 'Erreur envoi');
      setText(content);
    } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push(`/baker/${id}`)} style={{ flex: 1 }}>
          <Text style={styles.headerName}>{name || 'Discussion'}</Text>
          <Text style={styles.headerSub}>Voir le profil</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            ListHeaderComponent={hasMore ? (
              <Pressable testID="chat-load-older" onPress={loadOlder} disabled={loadingMore} style={styles.loadMoreBtn}>
                {loadingMore ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Text style={styles.loadMoreText}>Charger les messages précédents</Text>}
              </Pressable>
            ) : null}
            renderItem={({ item }) => {
              const mine = item.from_user_id === user?.user_id;
              return (
                <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]} testID={`msg-${item.id}`}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && { color: '#fff' }]}>{item.content}</Text>
                    <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{fmtTime(item.created_at)}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="message-circle" size={36} color={theme.color.muted} />
                <Text style={styles.emptyText}>Commencez la conversation !{'\n'}Parlez levain, façonnage, cuisson…</Text>
              </View>
            }
          />
        )}

        {error && !notFriends && <Text style={styles.error} testID="chat-error">{error}</Text>}

        {notFriends ? (
          <View style={styles.notFriendsBox} testID="chat-not-friends">
            <Feather name="user-x" size={16} color={theme.color.muted} />
            <Text style={styles.notFriendsText}>Vous n'êtes plus amis avec cette personne — impossible d'échanger des messages.</Text>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              testID="chat-input"
              value={text}
              onChangeText={setText}
              placeholder="Votre message…"
              placeholderTextColor={theme.color.muted}
              style={styles.input}
              multiline
            />
            <Pressable testID="chat-send" onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
              <Feather name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface },
  headerSub: { fontSize: 11, color: theme.color.muted },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: theme.color.brand, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: theme.color.onSurface, lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: theme.color.muted, marginTop: 4, alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: theme.color.surface },
  input: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: theme.color.onSurface, minHeight: 44, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: theme.color.muted, textAlign: 'center', lineHeight: 20 },
  error: { color: theme.color.error, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  notFriendsBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  notFriendsText: { flex: 1, fontSize: 13, color: theme.color.muted, lineHeight: 18 },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  loadMoreText: { fontSize: 13, color: theme.color.brand, fontWeight: '600' },
});
