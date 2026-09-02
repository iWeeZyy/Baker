import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { ProgressBar } from '@/src/gamification/ProgressBar';
import type { Badge } from '@/src/gamification/types';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

export default function BadgeDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [badge, setBadge] = useState<Badge | null>(null);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api(`/users/${user.user_id}/badges`).then((data) => {
      if (cancelled) return;
      setBadge((data.badges as Badge[]).find(b => b.id === id) || null);
      setFavoriteId(data.favorite_badge_id);
    }).catch(console.warn).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, id]);

  const isFavorite = favoriteId === id;

  const toggleFavorite = async () => {
    if (!badge?.unlocked_at || saving) return;
    setSaving(true);
    const nextId = isFavorite ? null : (id as string);
    try {
      await api('/users/me/badges/favorite', { method: 'PUT', body: JSON.stringify({ badge_id: nextId }) });
      setFavoriteId(nextId);
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="badge-detail-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Badge</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !badge ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.iconWrap}>
            {/* Le verrou ne masque que les badges cachés — un badge verrouillé
                mais non caché montre sa vraie icône, comme dans la grille de
                badges.tsx, pas un cadenas générique ; même atténuation que
                cette grille (`cardIconLocked`) pour un badge non obtenu. */}
            <Text style={[styles.icon, !badge.unlocked_at && styles.iconLocked]}>{!badge.unlocked_at && badge.hidden ? '🔒' : badge.icon}</Text>
          </View>
          <Text style={styles.name}>{badge.name}</Text>

          {badge.unlocked_at ? (
            <>
              <Text style={styles.unlockedAt}>Débloqué le {formatDate(badge.unlocked_at)}</Text>
              <Text style={styles.description}>{badge.description}</Text>
              <Pressable testID="badge-favorite-toggle" onPress={toggleFavorite} disabled={saving} style={[styles.favoriteBtn, isFavorite && styles.favoriteBtnOn]}>
                <Feather name="star" size={16} color={isFavorite ? colors.onBrandPrimary : colors.onSurface} />
                <Text style={[styles.favoriteText, isFavorite && { color: colors.onBrandPrimary }]}>
                  {isFavorite ? 'Badge affiché sur le profil' : 'Mettre en avant sur mon profil'}
                </Text>
              </Pressable>
            </>
          ) : badge.hidden ? (
            <Text style={styles.description}>Ce badge est caché — sa condition n’est révélée qu’après son obtention.</Text>
          ) : (
            <>
              <Text style={styles.conditionLabel}>Condition :</Text>
              <Text style={styles.description}>{badge.description}</Text>
              {badge.progress?.threshold != null && (
                <View style={{ width: '100%', marginTop: 16 }}>
                  <ProgressBar ratio={(badge.progress.current || 0) / badge.progress.threshold} height={8} />
                  <Text style={styles.progressText}>{badge.progress.current} / {badge.progress.threshold}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  body: { padding: 24, alignItems: 'center' },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 16,
  },
  icon: { fontSize: 44 },
  iconLocked: { opacity: 0.6 },
  name: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface, textAlign: 'center' },
  unlockedAt: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 16 },
  conditionLabel: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary, marginTop: 20, marginBottom: 4 },
  description: { fontSize: 14, color: colors.onSurfaceSecondary, textAlign: 'center', lineHeight: 20 },
  progressText: { fontSize: 12, color: colors.muted, marginTop: 6, textAlign: 'center' },
  favoriteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary,
  },
  favoriteBtnOn: { backgroundColor: colors.brand },
  favoriteText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
});
