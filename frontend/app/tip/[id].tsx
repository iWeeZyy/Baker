import { useCallback, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import type { Tip } from '@/src/tips/tipsSearch';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/**
 * La fiche détaillée d'une astuce. Deux présentations selon la nature du
 * contenu : problème/causes/solutions pour le dépannage, explication simple
 * pour le reste — jamais une section vide affichée pour le principe.
 */
export default function TipDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );

  const BulletRow = ({ text }: { text: string }) => (
    <View style={styles.bulletRow}>
      <View style={styles.dot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );

  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tip, setTip] = useState<Tip | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tips, favIds] = await Promise.all([
        api('/tips'),
        api('/tips/favorite-ids').catch(() => []),
      ]);
      const found = (tips as Tip[]).find(t => t.id === id) || null;
      setTip(found);
      setNotFound(!found);
      setFavorited((favIds as string[]).includes(id));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleFavorite = async () => {
    setFavorited(v => !v);
    try {
      await api(`/tips/${id}/favorite`, { method: 'POST' });
    } catch {
      setFavorited(v => !v);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  if (notFound || !tip) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable testID="tip-back" onPress={() => router.back()} style={styles.iconBtn}>
            <Feather name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Feather name="alert-circle" size={34} color={colors.muted} />
          <Text style={styles.emptyText}>Astuce introuvable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="tip-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="tip-favorite" onPress={toggleFavorite} style={styles.favHeaderBtn}>
          <Feather name="star" size={18} color={favorited ? colors.brandSecondary : colors.onSurface} />
          <Text style={[styles.favHeaderText, favorited && { color: colors.brandSecondary }]}>
            {favorited ? 'Favori' : 'Ajouter aux favoris'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconCircle}>
          <Feather name={(tip.icon as any) || 'star'} size={26} color={colors.brand} />
        </View>
        <Text style={styles.category}>{tip.category.toUpperCase()}</Text>
        <Text style={styles.title}>{tip.title}</Text>

        {tip.problem ? (
          <>
            <Section label="PROBLÈME">
              <Text style={styles.paragraph}>{tip.problem}</Text>
            </Section>
            {tip.causes && tip.causes.length > 0 && (
              <Section label="CAUSES POSSIBLES">
                {tip.causes.map((c, i) => <BulletRow key={i} text={c} />)}
              </Section>
            )}
            {tip.solutions && tip.solutions.length > 0 && (
              <Section label="SOLUTIONS">
                {tip.solutions.map((s, i) => <BulletRow key={i} text={s} />)}
              </Section>
            )}
          </>
        ) : (
          <Section label="EXPLICATION">
            <Text style={styles.paragraph}>{tip.content}</Text>
          </Section>
        )}

        {tip.keywords.length > 0 && (
          <Section label="MOTS-CLÉS">
            <View style={styles.keywordRow}>
              {tip.keywords.map(k => (
                <View key={k} style={styles.keywordPill}><Text style={styles.keywordText}>{k}</Text></View>
              ))}
            </View>
          </Section>
        )}

        {!!tip.source && <Text style={styles.source}>D&apos;après {tip.source}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  favHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 40 },
  favHeaderText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  emptyText: { fontSize: 14, color: colors.muted },
  body: { padding: 24, paddingBottom: 60, alignItems: 'center' },
  iconCircle: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  category: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface, textAlign: 'center', marginTop: 8, lineHeight: 32 },
  section: { width: '100%', marginTop: 28 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 10 },
  paragraph: { fontSize: 15, color: colors.onSurface, lineHeight: 23 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 15, color: colors.onSurface, lineHeight: 21 },
  keywordRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keywordPill: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  keywordText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '500' },
  source: { width: '100%', marginTop: 32, fontSize: 12, color: colors.muted, fontStyle: 'italic', textAlign: 'center' },
});
