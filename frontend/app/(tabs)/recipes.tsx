import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { ActionSheet } from '@/src/ActionSheet';
import { familyTile, type Family } from '@/src/families';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

// Ordre canonique. Les puces réellement affichées sont celles qui ont au moins
// une famille : « Pains » disparaît tant que le catalogue n'a pas de pain, et
// revient de lui-même au premier ajout — mieux qu'une puce qui n'ouvre sur rien.
const CATEGORY_ORDER = ['Pains', 'Levains', 'Snacking', 'Viennoiseries', 'Brioches', 'Pâtisseries'];

/**
 * L'entrée du catalogue : les familles, pas les deux cents fiches.
 *
 * Trois catégories pour tout ranger ne suffisaient plus — quatre-vingts fiches
 * tombaient sous « Pâtisseries ». La famille est le rang qu'un boulanger emploie
 * déjà : on ne cherche pas « une pâtisserie », on cherche « un biscuit ». Les
 * puces de catégorie restent, mais réduisent désormais les familles affichées.
 */
export default function Recipes() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [category, setCategory] = useState('Tous');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setFamilies(await api('/families'));
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const present = new Set(families.map(f => f.category));
    return ['Tous', ...CATEGORY_ORDER.filter(c => present.has(c))];
  }, [families]);

  // Le filtre se fait ici : la liste tient en une quinzaine d'entrées, un
  // aller-retour au serveur par puce ne servirait à rien.
  const shown = useMemo(
    () => (category === 'Tous' ? families : families.filter(f => f.category === category)),
    [families, category],
  );

  // Deux par ligne, la dernière seule au besoin — une grille explicite plutôt
  // que `numColumns`, pour que la ligne incomplète garde la largeur d'une carte
  // au lieu de s'étirer.
  const rows = useMemo(() => {
    const out: Family[][] = [];
    for (let i = 0; i < shown.length; i += 2) out.push(shown.slice(i, i + 2));
    return out;
  }, [shown]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.stickyHeader}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandLabel}>LA BIBLIOTHÈQUE</Text>
            <Text style={styles.title}>Recettes</Text>
          </View>
          <Pressable testID="share-recipe-btn" onPress={() => setCreateMenuOpen(true)} style={styles.shareBtn}>
            <Feather name="plus" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {categories.map(c => (
            <Pressable
              key={c}
              testID={`chip-${c}`}
              onPress={() => setCategory(c)}
              style={[styles.chip, category === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(row) => row.map(f => f.key).join('+')}
          contentContainerStyle={{ gap: 24, paddingVertical: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map(family => (
                <Pressable
                  key={family.key}
                  testID={`family-card-${family.key}`}
                  onPress={() => router.push(`/family/${family.key}`)}
                  style={styles.card}
                >
                  <Image source={familyTile(family.key)} style={styles.cardImage} contentFit="cover" />
                  <Text style={styles.cardTitle} numberOfLines={2}>{family.label}</Text>
                  <Text style={styles.cardMeta}>
                    {family.count} recette{family.count > 1 ? 's' : ''}
                  </Text>
                </Pressable>
              ))}
              {row.length === 1 && <View style={styles.card} />}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Aucune famille dans cette catégorie.</Text>}
        />
      )}

      <ActionSheet
        visible={createMenuOpen}
        title="Nouvelle recette"
        onClose={() => setCreateMenuOpen(false)}
        options={[
          { key: 'scan', emoji: '📷', label: 'Scanner une recette', onPress: () => router.push('/scan') },
          { key: 'manual', emoji: '✏️', label: 'Créer manuellement', onPress: () => router.push('/share') },
        ]}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stickyHeader: { backgroundColor: colors.surface, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, marginBottom: 20 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: colors.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  shareBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.onSurfaceInverse },
  gridRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 24 },
  card: { flex: 1 },
  cardImage: {
    width: '100%', aspectRatio: 4 / 3, borderRadius: 4,
    // Le fond de la vignette frôle celui de l'écran : sans ce filet, la carte
    // n'a pas de bord.
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
});
