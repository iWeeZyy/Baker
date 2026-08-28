import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Row = { user_id: string; name: string; picture?: string | null; profession?: string | null; following: boolean; since: string };

/**
 * Écran « Abonnés » / « Abonnements », partagé par les deux routes
 * (`app/followers/[userId].tsx`, `app/following/[userId].tsx`) — même
 * requête paginée, même ligne, seule la nature de la relation (kind)
 * change le libellé, l'état vide et l'icône. Calque direct de
 * `team/[userId].tsx`.
 */
export function FollowListScreen({ userId, kind }: { userId: string; kind: 'followers' | 'following' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useAuth();
  const isMine = user?.user_id === userId;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/users/${userId}/${kind}`);
      setRows(res.users);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [userId, kind]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const before = encodeURIComponent(rows[rows.length - 1].since);
      const res = await api(`/users/${userId}/${kind}?before=${before}`);
      setRows(prev => [...prev, ...res.users]);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMore(false); }
  };

  const toggleFollow = async (row: Row) => {
    if (busyId) return;
    if (row.following) {
      const ok = await confirmAsync(
        'Ne plus suivre',
        `Vous ne verrez plus les nouvelles publications de ${row.name} dans votre fil.`,
        'Ne plus suivre',
        true,
      );
      if (!ok) return;
    }
    setBusyId(row.user_id);
    const prevFollowing = row.following;
    setRows(prev => prev.map(r => r.user_id === row.user_id ? { ...r, following: !r.following } : r));
    try {
      const res = await api(`/users/${row.user_id}/follow`, { method: 'POST' });
      // Sur ma propre liste d'abonnements, se désabonner retire la ligne —
      // elle n'a plus sa place ici. Ailleurs, la pastille change simplement d'état.
      if (isMine && kind === 'following' && !res.following) {
        setRows(prev => prev.filter(r => r.user_id !== row.user_id));
      } else {
        setRows(prev => prev.map(r => r.user_id === row.user_id ? { ...r, following: res.following } : r));
      }
    } catch (e) {
      console.warn(e);
      setRows(prev => prev.map(r => r.user_id === row.user_id ? { ...r, following: prevFollowing } : r));
    } finally {
      setBusyId(null);
    }
  };

  const title = kind === 'followers'
    ? (isMine ? 'Mes abonnés' : 'Abonnés')
    : (isMine ? 'Mes abonnements' : 'Abonnements');

  const emptyText = kind === 'followers'
    ? (isMine ? "Vous n'avez pas encore d'abonnés." : "Cette personne n'a pas encore d'abonnés.")
    : (isMine ? 'Vous ne suivez personne pour le moment.' : 'Cette personne ne suit personne pour le moment.');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="follow-list-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Feather name={kind === 'followers' ? 'users' : 'user-check'} size={34} color={colors.muted} />
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={r => r.user_id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          renderItem={({ item }) => (
            <Pressable testID={`follow-list-row-${item.user_id}`} onPress={() => router.push(`/baker/${item.user_id}` as any)} style={styles.row}>
              <View style={styles.avatar}>
                {avatarUrl(item.picture, API_BASE) ? (
                  <Image source={{ uri: avatarUrl(item.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>{(item.name || '?').slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                {!!item.profession && <Text style={styles.rowSub}>{item.profession}</Text>}
              </View>
              {item.user_id === user?.user_id ? null : busyId === item.user_id ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : item.following ? (
                <Pressable testID={`follow-list-following-${item.user_id}`} onPress={() => toggleFollow(item)} style={styles.statusBtnMuted}>
                  <Feather name="check" size={14} color={colors.onSurfaceSecondary} />
                  <Text style={styles.statusTextMuted}>Suivi</Text>
                </Pressable>
              ) : (
                <Pressable testID={`follow-list-follow-${item.user_id}`} onPress={() => toggleFollow(item)} style={styles.statusBtn}>
                  <Feather name="user-plus" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.statusText}>Suivre</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 18, color: colors.onBrandTertiary, fontFamily: theme.serif },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  statusText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  statusBtnMuted: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  statusTextMuted: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
});
