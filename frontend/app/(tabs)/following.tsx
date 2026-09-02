import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { recipeImageSource } from '@/src/products';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { EmptyState } from '@/src/EmptyState';

type FeedItem = {
  kind: 'recipe' | 'creation';
  id: string;
  title: string;
  author_id: string;
  author_name?: string | null;
  author_picture?: string | null;
  like_count: number;
  liked: boolean;
  comment_count?: number;
  created_at: string;
  image_path?: string | null;
  image_url?: string | null;
  product?: string | null;
  photos?: string[];
};

/**
 * Le fil des abonnements : recettes et créations récentes des personnes
 * suivies, fusionnées côté serveur (GET /feed) et triées par date — jamais
 * de deuxième copie du contenu, la carte ne fait que référencer la recette
 * ou la création existante.
 */
export default function Following() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useAuth();

  const Avatar = ({ name, picture }: { name?: string | null; picture?: string | null }) => {
    const uri = avatarUrl(picture, API_BASE);
    return (
      <View style={styles.avatar}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={styles.avatarText}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [feed, profile] = await Promise.all([
        api('/feed'),
        user ? api(`/users/${user.user_id}/profile`) : Promise.resolve(null),
      ]);
      setItems(feed.items);
      setHasMore(feed.has_more);
      if (profile) setFollowingCount(profile.following_count);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const before = encodeURIComponent(items[items.length - 1].created_at);
      const res = await api(`/feed?before=${before}`);
      setItems(prev => [...prev, ...res.items]);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMore(false); }
  };

  const openItem = (item: FeedItem) => {
    router.push(item.kind === 'recipe' ? `/recipe/${item.id}` : `/creation/${item.id}` as any);
  };

  const openComments = (item: FeedItem) => {
    router.push(`/recipe/${item.id}?tab=community` as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.brandLabel}>LE FOURNIL</Text>
        <Text style={styles.title}>Abonnements</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={item => `${item.kind}-${item.id}`}
          contentContainerStyle={items.length === 0 ? { flex: 1 } : { padding: 24, paddingTop: 16, gap: 20, paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.brand} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          ListEmptyComponent={
            followingCount === 0 ? (
              <EmptyState
                icon="rss"
                title="Votre fil est vide"
                subtitle="Suivez des boulangers et créateurs pour retrouver leurs nouvelles recettes et créations ici."
                ctaLabel="Découvrir des profils"
                onCta={() => router.push('/(tabs)/friends' as any)}
                testID="discover-profiles-btn"
              />
            ) : (
              <EmptyState icon="check-circle" title="Aucune nouvelle publication" subtitle="Vous êtes à jour !" />
            )
          }
          renderItem={({ item }) => (
            <View style={styles.card} testID={`feed-item-${item.kind}-${item.id}`}>
              <Pressable testID={`feed-author-${item.id}`} onPress={() => router.push(`/baker/${item.author_id}` as any)} style={styles.authorRow}>
                <Avatar name={item.author_name} picture={item.author_picture} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.authorName}>{item.author_name || 'Boulanger'}</Text>
                  <Text style={styles.kindLabel}>
                    {item.kind === 'recipe' ? '🥖 Nouvelle recette' : '📸 Nouvelle création'}
                  </Text>
                </View>
              </Pressable>

              <Pressable testID={`feed-body-${item.id}`} onPress={() => openItem(item)}>
                <Image
                  source={item.kind === 'recipe'
                    ? recipeImageSource(item, API_BASE)
                    : (item.photos && item.photos[0] ? { uri: `${API_BASE}/files/${item.photos[0]}` } : undefined)}
                  style={styles.cardImage}
                  contentFit="cover"
                />
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              </Pressable>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Feather name="heart" size={14} color={item.liked ? colors.error : colors.muted} />
                  <Text style={styles.metaText}>{item.like_count}</Text>
                </View>
                {item.kind === 'recipe' && (
                  <Pressable testID={`feed-comments-${item.id}`} onPress={() => openComments(item)} style={styles.metaItem}>
                    <Feather name="message-circle" size={14} color={colors.muted} />
                    <Text style={styles.metaText}>{item.comment_count ?? 0}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: colors.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 12 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 14, color: colors.onBrandTertiary, fontFamily: theme.serif },
  authorName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  kindLabel: { fontSize: 12, color: colors.muted, marginTop: 1 },
  cardImage: { width: '100%', aspectRatio: 16 / 10, borderRadius: 8, backgroundColor: colors.surfaceTertiary, marginTop: 4 },
  cardTitle: { fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, marginTop: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
});
