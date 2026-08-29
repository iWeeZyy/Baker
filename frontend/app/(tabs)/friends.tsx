import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { subscribeRealtime } from '@/src/realtime';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { showGamificationToast } from '@/src/gamification/UnlockToast';

// Fallback poll in case the realtime socket is down; the socket refreshes
// this list near-instantly when a message arrives while connected.
const POLL_FALLBACK_MS = 20000;

type UserRow = { user_id: string; name: string; picture?: string; friend_status?: string; following?: boolean };
type FriendRow = UserRow & { last_message?: { content: string; from_me: boolean; created_at: string } | null; unread: number };
type RequestRow = { id: string; from_user: UserRow };

export default function Friends() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const Avatar = ({ user, size = 44 }: { user: UserRow; size?: number }) => {
    const uri = avatarUrl(user.picture, API_BASE);
    return (
      <View style={[styles.avatar, { width: size, height: size }]}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{(user.name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  const router = useRouter();
  const { refreshUser } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followBusyId, setFollowBusyId] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([api('/friends/requests'), api('/friends')]);
      setRequests(r); setFriends(f);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const iv = setInterval(load, POLL_FALLBACK_MS);
    const unsubscribe = subscribeRealtime((evt) => {
      if (evt.type === 'new_message') load();
    });
    return () => { clearInterval(iv); unsubscribe(); };
  }, [load]));

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try { setResults(await api(`/users/search?q=${encodeURIComponent(q)}`)); }
      catch (e) { console.warn(e); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const sendRequest = async (u: UserRow) => {
    try {
      const res = await api('/friends/request', { method: 'POST', body: JSON.stringify({ user_id: u.user_id }) });
      setResults(prev => prev.map(r => r.user_id === u.user_id ? { ...r, friend_status: res.status === 'friends' ? 'friends' : 'pending_sent' } : r));
      if (res.status === 'friends') { load(); showGamificationToast(res.gamification); refreshUser(); }
    } catch (e) { console.warn(e); }
  };

  const toggleFollow = async (u: UserRow) => {
    if (followBusyId) return;
    setFollowBusyId(u.user_id);
    const prev = u.following;
    setResults(list => list.map(r => r.user_id === u.user_id ? { ...r, following: !r.following } : r));
    try {
      const res = await api(`/users/${u.user_id}/follow`, { method: 'POST' });
      setResults(list => list.map(r => r.user_id === u.user_id ? { ...r, following: res.following } : r));
    } catch (e) {
      console.warn(e);
      setResults(list => list.map(r => r.user_id === u.user_id ? { ...r, following: prev } : r));
    } finally {
      setFollowBusyId(null);
    }
  };

  const respond = async (req: RequestRow, accept: boolean) => {
    try {
      const res = await api(`/friends/requests/${req.id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
      setRequests(prev => prev.filter(r => r.id !== req.id));
      if (accept) { load(); showGamificationToast(res.gamification); refreshUser(); }
    } catch (e) { console.warn(e); }
  };

  const SearchAction = ({ u }: { u: UserRow }) => {
    if (u.friend_status === 'friends') return <Feather name="check-circle" size={20} color={colors.success} />;
    if (u.friend_status === 'pending_sent') return <Text style={styles.pendingText}>Envoyée</Text>;
    return (
      <Pressable testID={`add-friend-${u.user_id}`} onPress={() => sendRequest(u)} style={styles.addBtn}>
        <Feather name="user-plus" size={15} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>{u.friend_status === 'pending_received' ? 'Accepter' : 'Ajouter'}</Text>
      </Pressable>
    );
  };

  const FollowPill = ({ u }: { u: UserRow }) => {
    if (followBusyId === u.user_id) return <ActivityIndicator size="small" color={colors.brand} />;
    if (u.following) {
      return (
        <Pressable testID={`unfollow-${u.user_id}`} onPress={() => toggleFollow(u)} style={styles.followBtnMuted}>
          <Feather name="check" size={13} color={colors.onSurfaceSecondary} />
          <Text style={styles.followBtnMutedText}>Suivi</Text>
        </Pressable>
      );
    }
    return (
      <Pressable testID={`follow-${u.user_id}`} onPress={() => toggleFollow(u)} style={styles.followBtn}>
        <Feather name="plus" size={13} color={colors.onBrandPrimary} />
        <Text style={styles.followBtnText}>Suivre</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <Text style={styles.brandLabel}>LE FOURNIL</Text>
          <Text style={styles.title}>Amis</Text>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={18} color={colors.muted} />
          <TextInput
            testID="friend-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un boulanger par nom…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable testID="clear-search" onPress={() => setQuery('')}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>

        {query.trim().length >= 2 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Résultats</Text>
            {searching ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: 12 }} />
            ) : results.length === 0 ? (
              <Text style={styles.emptyText}>Aucun boulanger trouvé pour « {query.trim()} »</Text>
            ) : results.map(u => (
              <View key={u.user_id} style={styles.row} testID={`search-result-${u.user_id}`}>
                <Pressable onPress={() => router.push(`/baker/${u.user_id}`)} style={styles.rowLeft}>
                  <Avatar user={u} />
                  <Text style={styles.rowName}>{u.name}</Text>
                </Pressable>
                <View style={styles.rowActions}>
                  <FollowPill u={u} />
                  <SearchAction u={u} />
                </View>
              </View>
            ))}
          </View>
        )}

        {requests.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Demandes d'amis</Text>
              <View style={styles.countBadge}><Text style={styles.countBadgeText}>{requests.length}</Text></View>
            </View>
            {requests.map(r => (
              <View key={r.id} style={styles.row} testID={`request-${r.id}`}>
                <Pressable onPress={() => router.push(`/baker/${r.from_user.user_id}`)} style={styles.rowLeft}>
                  <Avatar user={r.from_user} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{r.from_user.name}</Text>
                    <Text style={styles.rowSub}>souhaite devenir votre ami</Text>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable testID={`accept-${r.id}`} onPress={() => respond(r, true)} style={styles.acceptBtn}>
                    <Feather name="check" size={18} color={colors.onBrandPrimary} />
                  </Pressable>
                  <Pressable testID={`decline-${r.id}`} onPress={() => respond(r, false)} style={styles.declineBtn}>
                    <Feather name="x" size={18} color={colors.onSurfaceSecondary} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mes amis</Text>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 12 }} />
          ) : friends.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="users" size={36} color={colors.muted} />
              <Text style={styles.emptyText}>Vous n'avez pas encore d'amis.{'\n'}Recherchez un boulanger par son nom pour l'ajouter !</Text>
            </View>
          ) : friends.map(f => (
            <Pressable
              key={f.user_id}
              testID={`friend-${f.user_id}`}
              onPress={() => router.push({ pathname: `/chat/${f.user_id}` as any, params: { name: f.name } })}
              style={styles.row}
            >
              <Pressable onPress={() => router.push(`/baker/${f.user_id}`)}>
                <Avatar user={f} size={48} />
              </Pressable>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.rowName}>{f.name}</Text>
                <Text style={[styles.rowSub, f.unread > 0 && styles.rowSubUnread]} numberOfLines={1}>
                  {f.last_message ? `${f.last_message.from_me ? 'Vous : ' : ''}${f.last_message.content}` : 'Dites bonjour 👋'}
                </Text>
              </View>
              {f.unread > 0 ? (
                <View style={styles.unreadBadge} testID={`unread-${f.user_id}`}>
                  <Text style={styles.unreadText}>{f.unread}</Text>
                </View>
              ) : (
                <Feather name="chevron-right" size={18} color={colors.muted} />
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 16, marginBottom: 16 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: colors.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  section: { paddingHorizontal: 24, marginTop: 28 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  countBadge: { backgroundColor: colors.brand, borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countBadgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  followBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '600' },
  followBtnMuted: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  followBtnMutedText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowSubUnread: { color: colors.onSurface, fontWeight: '600' },
  avatar: { borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  pendingText: { fontSize: 13, color: colors.muted, fontStyle: 'italic' },
  acceptBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  unreadBadge: { backgroundColor: colors.brand, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, marginTop: 12 },
});
