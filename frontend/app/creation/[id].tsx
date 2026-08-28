import { useCallback, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { ActionSheet } from '@/src/ActionSheet';
import { avatarUrl } from '@/src/avatar';
import { useAuth } from '@/src/auth';
import { confirmAsync } from '@/src/confirm';
import { formatRelativeDate } from '@/src/relativeDate';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Creation = {
  id: string; user_id: string; user_name: string; user_picture?: string | null;
  title: string; description: string; category: string; photos: string[];
  created_at: string; like_count: number; liked: boolean;
  recipe?: { id: string; title: string };
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CreationDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<Creation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/creations/${id}`));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Création introuvable');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleLike = async () => {
    if (!data || likePending) return;
    const previous = data;
    const optimistic = { ...data, liked: !data.liked, like_count: data.like_count + (data.liked ? -1 : 1) };
    setData(optimistic);
    setLikePending(true);
    try {
      const res = await api(`/creations/${id}/like`, { method: 'POST' });
      setData(d => d ? { ...d, liked: res.liked, like_count: res.count } : d);
    } catch (e: any) {
      setData(previous);
      setError(e.message || 'Erreur');
    } finally {
      setLikePending(false);
    }
  };

  const doDelete = async () => {
    const ok = await confirmAsync('Supprimer cette création ?', 'Cette action est définitive.', 'Supprimer', true);
    if (!ok) return;
    try {
      await api(`/creations/${id}`, { method: 'DELETE' });
      router.back();
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Feather name="alert-circle" size={34} color={colors.muted} />
          <Text style={styles.emptyText}>{error || 'Création introuvable'}</Text>
          <Pressable testID="creation-back" onPress={() => router.back()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isOwner = user?.user_id === data.user_id;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.heroWrap}>
          {data.photos.length > 1 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {data.photos.map((path, i) => (
                <Image key={i} source={{ uri: `${API_BASE}/files/${path}` }} style={{ width: SCREEN_WIDTH, height: 340 }} contentFit="cover" />
              ))}
            </ScrollView>
          ) : (
            <Image source={{ uri: `${API_BASE}/files/${data.photos[0]}` }} style={{ width: SCREEN_WIDTH, height: 340 }} contentFit="cover" />
          )}
          <SafeAreaView edges={['top']} style={styles.heroTop}>
            <Pressable testID="creation-detail-back" onPress={() => router.back()} style={styles.iconBtn}>
              <Feather name="arrow-left" size={20} color={colors.onBrandPrimary} />
            </Pressable>
            {isOwner && (
              <Pressable testID="creation-menu-btn" onPress={() => setMenuOpen(true)} style={styles.iconBtn}>
                <Feather name="more-horizontal" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            )}
          </SafeAreaView>
        </View>

        <View style={styles.content}>
          <Text style={styles.categoryLabel}>{data.category.toUpperCase()}</Text>
          <Text style={styles.title}>{data.title}</Text>

          <Pressable testID="creation-author-row" onPress={() => router.push(`/baker/${data.user_id}` as any)} style={styles.authorRow}>
            <View style={styles.authorAvatar}>
              {avatarUrl(data.user_picture, API_BASE) ? (
                <Image source={{ uri: avatarUrl(data.user_picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Text style={styles.authorAvatarText}>{(data.user_name || '?').slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.authorName}>{data.user_name}</Text>
            <Text style={styles.dateText}>· {formatRelativeDate(data.created_at)}</Text>
          </Pressable>

          {!!data.description && <Text style={styles.description}>{data.description}</Text>}

          <Pressable testID="creation-like-btn" onPress={toggleLike} style={styles.likeRow}>
            <Ionicons name={data.liked ? 'heart' : 'heart-outline'} size={22} color={data.liked ? colors.error : colors.onSurfaceSecondary} />
            <Text style={styles.likeCount}>{data.like_count}</Text>
          </Pressable>

          {data.recipe && (
            <View style={styles.recipeCard}>
              <Text style={styles.recipeCardLabel}>🥖 Recette utilisée</Text>
              <Text style={styles.recipeCardTitle}>{data.recipe.title}</Text>
              <Pressable testID="see-recipe-btn" onPress={() => router.push(`/recipe/${data.recipe!.id}` as any)} style={styles.recipeCardBtn}>
                <Text style={styles.recipeCardBtnText}>Voir la recette</Text>
                <Feather name="chevron-right" size={16} color={colors.brand} />
              </Pressable>
            </View>
          )}

          {error && <Text style={styles.errorText} testID="creation-detail-error">{error}</Text>}
        </View>
      </ScrollView>

      <ActionSheet
        visible={menuOpen}
        title="Cette création"
        onClose={() => setMenuOpen(false)}
        options={[
          { key: 'edit', emoji: '✏️', label: 'Modifier', onPress: () => router.push({ pathname: '/creation/new', params: { id: data.id } } as any) },
          { key: 'delete', emoji: '🗑️', label: 'Supprimer', onPress: doDelete, destructive: true },
        ]}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heroWrap: { height: 340, backgroundColor: colors.surfaceSecondary },
  heroTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(42,31,26,0.5)', alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 20 },
  categoryLabel: { fontSize: 11, letterSpacing: 3, color: colors.brand, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 28, color: colors.onSurface, marginTop: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  authorAvatar: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  authorAvatarText: { fontSize: 12, color: colors.onBrandTertiary, fontFamily: theme.serif },
  authorName: { fontSize: 14, color: colors.onSurface, fontWeight: '600' },
  dateText: { fontSize: 13, color: colors.muted },
  description: { fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 22, marginTop: 18 },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 },
  likeCount: { fontSize: 16, color: colors.onSurface, fontWeight: '600' },
  recipeCard: { marginTop: 24, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 16 },
  recipeCardLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  recipeCardTitle: { fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, marginTop: 4 },
  recipeCardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
  recipeCardBtnText: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  errorText: { color: colors.error, fontSize: 13, marginTop: 16 },
  emptyText: { color: colors.muted, marginTop: 12, marginBottom: 16 },
  retryBtn: { backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 4 },
  retryText: { color: colors.onBrandPrimary, fontWeight: '600' },
});
