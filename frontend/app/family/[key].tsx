import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { AdSlot, buildListRows, useAds } from '@/src/ads';
import { type Family } from '@/src/families';
import { formatDuration } from '@/src/format';
import { theme } from '@/src/theme';

type Recipe = { id: string; title: string; difficulty: string; time_minutes: number; coup_de_coeur?: boolean };

/**
 * Une famille et ses recettes.
 *
 * Liste à une colonne et sans image, à dessein : les fiches importées n'ont pas
 * de photo, et coller la même vignette sur dix-neuf tartes ferait croire à une
 * illustration de chacune. Le titre en serif porte l'écran ; les intitulés longs
 * — « Gâteau aux dattes et sa sauce au sucre à la crème » — tiennent sur la
 * largeur au lieu d'être hachés en deux colonnes.
 */
export default function FamilyScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const { canShowAds, config } = useAds();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`/recipes?family=${encodeURIComponent(key)}`),
      api('/families'),
    ])
      .then(([list, families]: [Recipe[], Family[]]) => {
        setRecipes(list);
        setFamily(families.find(f => f.key === key) ?? null);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [key]);

  const rows = useMemo(
    () => buildListRows(
      recipes,
      canShowAds ? { first: config.list_first_slot, interval: config.list_interval } : null,
      1,
    ),
    [recipes, canShowAds, config.list_first_slot, config.list_interval],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={theme.color.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.brandLabel}>FAMILLE</Text>
          <Text style={styles.title}>{family?.label ?? ''}</Text>
          {!loading && (
            <Text style={styles.count}>
              {recipes.length} recette{recipes.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item: row }) => {
            if (row.type === 'ad') {
              return <View style={styles.adRow}><AdSlot placement="recipe_list" /></View>;
            }
            return (
              <>
                {row.items.map(item => (
                  <Pressable
                    key={item.id}
                    testID={`recipe-card-${item.id}`}
                    onPress={() => router.push(`/recipe/${item.id}`)}
                    style={styles.row}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{item.title}</Text>
                      <Text style={styles.rowMeta}>{item.difficulty} · {formatDuration(item.time_minutes)}</Text>
                    </View>
                    {item.coup_de_coeur && <Feather name="award" size={16} color={theme.color.brand} />}
                    <Feather name="chevron-right" size={18} color={theme.color.muted} />
                  </Pressable>
                ))}
              </>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>Aucune recette dans cette famille.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 999, marginTop: 4,
    backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
  },
  headerText: { flex: 1 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: theme.color.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 28, color: theme.color.onSurface, marginTop: 4 },
  count: { fontSize: 13, color: theme.color.muted, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: theme.serif, fontSize: 19, color: theme.color.onSurface },
  rowMeta: { fontSize: 12, color: theme.color.muted, marginTop: 4 },
  adRow: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  empty: { textAlign: 'center', color: theme.color.muted, marginTop: 60 },
});
