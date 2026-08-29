import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { ProgressBar } from '@/src/gamification/ProgressBar';
import type { Badge, BadgeCategory } from '@/src/gamification/types';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const CATEGORIES: [BadgeCategory, string, string][] = [
  ['boulanger', '🥖', 'Boulanger'],
  ['createur', '📸', 'Créateur'],
  ['communaute', '❤️', 'Communauté'],
  ['social', '👥', 'Social'],
  ['classement', '🏆', 'Classement'],
  ['regularite', '🔥', 'Régularité'],
];

export default function Badges() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api(`/users/${user.user_id}/badges`).then((data) => {
      if (!cancelled) setBadges(data.badges);
    }).catch(console.warn).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const unlockedCount = badges.filter(b => b.unlocked_at).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="badges-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Mes badges</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.countLine}>{unlockedCount} / {badges.length} badges obtenus</Text>
          {CATEGORIES.map(([key, emoji, label]) => {
            const items = badges.filter(b => b.category === key);
            if (items.length === 0) return null;
            return (
              <View key={key} style={styles.section}>
                <Text style={styles.sectionTitle}>{emoji} {label}</Text>
                <View style={styles.grid}>
                  {items.map((b) => (
                    <Pressable
                      key={b.id}
                      testID={`badge-${b.id}`}
                      onPress={() => router.push(`/badge/${b.id}` as any)}
                      style={[styles.card, !b.unlocked_at && styles.cardLocked]}
                    >
                      <Text style={[styles.cardIcon, !b.unlocked_at && styles.cardIconLocked]}>{b.icon}</Text>
                      <Text style={styles.cardName} numberOfLines={1}>{b.name}</Text>
                      {b.unlocked_at ? (
                        <Text style={styles.cardStatus}>Obtenu</Text>
                      ) : b.progress?.threshold ? (
                        <View style={{ width: '100%' }}>
                          <ProgressBar ratio={(b.progress.current || 0) / b.progress.threshold} height={5} />
                          <Text style={styles.cardProgress}>{b.progress.current} / {b.progress.threshold}</Text>
                        </View>
                      ) : (
                        <Text style={styles.cardStatus}>Verrouillé</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
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
  body: { padding: 24, paddingTop: 16, paddingBottom: 60 },
  countLine: { fontSize: 13, color: colors.muted, marginBottom: 20, textAlign: 'center' },
  section: { marginBottom: 24 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '31%', minWidth: 100, alignItems: 'center', gap: 4, padding: 10,
    borderRadius: theme.radius.lg, backgroundColor: colors.surfaceSecondary,
  },
  cardLocked: { opacity: 0.55 },
  cardIcon: { fontSize: 28 },
  cardIconLocked: { opacity: 0.6 },
  cardName: { fontSize: 12, fontWeight: '600', color: colors.onSurface, textAlign: 'center' },
  cardStatus: { fontSize: 10, color: colors.muted },
  cardProgress: { fontSize: 10, color: colors.muted, marginTop: 3, textAlign: 'center' },
});
