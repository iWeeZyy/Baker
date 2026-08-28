import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { formatRelativeDate } from '@/src/relativeDate';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Notification = {
  id: string; type: 'new_follower' | 'new_recipe' | 'new_creation';
  actor_id: string; actor_name?: string | null; target_id?: string | null;
  read: boolean; created_at: string;
};

const ICONS: Record<Notification['type'], any> = {
  new_follower: 'user-plus', new_recipe: 'book-open', new_creation: 'camera',
};

function label(n: Notification): string {
  const name = n.actor_name || 'Quelqu\'un';
  if (n.type === 'new_follower') return `${name} vous suit maintenant.`;
  if (n.type === 'new_recipe') return `${name} a publié une nouvelle recette.`;
  return `${name} a publié une nouvelle création.`;
}

export default function Notifications() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/notifications');
      setItems(res.notifications);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const before = encodeURIComponent(items[items.length - 1].created_at);
      const res = await api(`/notifications?before=${before}`);
      setItems(prev => [...prev, ...res.notifications]);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMore(false); }
  };

  const markAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    try { await api('/notifications/read-all', { method: 'POST' }); } catch (e) { console.warn(e); }
  };

  const openNotification = async (n: Notification) => {
    if (!n.read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    }
    if (n.type === 'new_follower') router.push(`/baker/${n.actor_id}` as any);
    else if (n.type === 'new_recipe' && n.target_id) router.push(`/recipe/${n.target_id}` as any);
    else if (n.type === 'new_creation' && n.target_id) router.push(`/creation/${n.target_id}` as any);
  };

  const hasUnread = items.some(n => !n.read);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="notifications-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        {hasUnread ? (
          <Pressable testID="notifications-mark-all-read" onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Tout lire</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell" size={34} color={colors.muted} />
          <Text style={styles.emptyText}>Aucune notification pour le moment.</Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={n => n.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          renderItem={({ item }) => (
            <Pressable
              testID={`notification-${item.id}`}
              onPress={() => openNotification(item)}
              style={[styles.row, !item.read && styles.rowUnread]}
            >
              <View style={styles.iconCircle}>
                <Feather name={ICONS[item.type]} size={16} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>{label(item)}</Text>
                <Text style={styles.rowMeta}>{formatRelativeDate(item.created_at)}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
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
  markAllBtn: { paddingHorizontal: 10, height: 40, alignItems: 'center', justifyContent: 'center' },
  markAllText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowUnread: { backgroundColor: colors.surfaceSecondary },
  iconCircle: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowText: { fontSize: 14, color: colors.onSurface, lineHeight: 19 },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brand },
});
