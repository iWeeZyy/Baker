import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { familyTile, type Family } from '@/src/families';
import { theme } from '@/src/theme';

// Ordre canonique. Les puces réellement affichées sont celles qui ont au moins
// une famille : « Pains » disparaît tant que le catalogue n'a pas de pain, et
// revient de lui-même au premier ajout — mieux qu'une puce qui n'ouvre sur rien.
const CATEGORY_ORDER = ['Pains', 'Viennoiseries', 'Pâtisseries'];

/**
 * L'entrée du catalogue : les familles, pas les 117 fiches.
 *
 * Trois catégories pour tout ranger ne suffisaient plus — quatre-vingts fiches
 * tombaient sous « Pâtisseries ». La famille est le rang qu'un boulanger emploie
 * déjà : on ne cherche pas « une pâtisserie », on cherche « un biscuit ». Les
 * puces de catégorie restent, mais réduisent désormais les familles affichées.
 */
export default function Recipes() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [category, setCategory] = useState('Tous');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api('/families').then(setFamilies).catch(console.warn).finally(() => setLoading(false));
  }, []);

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
          <Pressable testID="share-recipe-btn" onPress={() => router.push('/share')} style={styles.shareBtn}>
            <Feather name="plus" size={20} color="#fff" />
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
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.map(f => f.key).join('+')}
          contentContainerStyle={{ gap: 24, paddingVertical: 20, paddingBottom: 40 }}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stickyHeader: { backgroundColor: theme.color.surface, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, marginBottom: 20 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: theme.color.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: theme.color.onSurface, marginTop: 4 },
  shareBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  chipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: theme.color.onSurfaceInverse },
  gridRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 24 },
  card: { flex: 1 },
  cardImage: {
    width: '100%', aspectRatio: 4 / 3, borderRadius: 4,
    // Le fond de la vignette frôle celui de l'écran : sans ce filet, la carte
    // n'a pas de bord.
    borderWidth: 1, borderColor: theme.color.border,
  },
  cardTitle: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.color.muted, marginTop: 60 },
});
