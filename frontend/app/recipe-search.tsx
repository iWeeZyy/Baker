import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { CATEGORY_ORDER } from '@/app/(tabs)/recipes';
import { Chip } from '@/src/Chip';
import { EmptyState } from '@/src/EmptyState';
import { formatDuration } from '@/src/format';
import { recipeImageSource } from '@/src/products';
import { searchRecipes, suggestTerms, type RecipeSearchable } from '@/src/recipeSearch';
import { getRecentSearches, addRecentSearch, removeRecentSearch } from '@/src/recentRecipeSearches';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Recipe = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  family?: string | null;
  product?: string | null;
  ingredients?: string[] | null;
  technical?: Record<string, any> | null;
  difficulty?: string;
  time_minutes?: number;
  image_path?: string | null;
  image_url?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  is_user_submitted?: boolean;
  like_count?: number;
  coup_de_coeur?: boolean;
};

type Family = { key: string; label: string; category: string };

type Origin = 'tous' | 'mine' | 'community';

/**
 * Moteur de recherche de recettes.
 *
 * Un seul aller-retour réseau à l'ouverture (`/recipes` + `/recipes/favoris`
 * + `/families`, comme `family/[key].tsx` le fait déjà pour une famille) puis
 * tout le filtrage/classement se fait en mémoire via `recipeSearch.ts` —
 * jamais un appel serveur par frappe, la bibliothèque tient en quelques
 * centaines de fiches. Les filtres (Type/Origine/Favoris) restreignent la
 * liste avant que le moteur ne la classe par pertinence.
 */
export default function RecipeSearchScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user } = useAuth();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [familyLabelByKey, setFamilyLabelByKey] = useState<Record<string, string>>({});
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<any>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [category, setCategory] = useState('Tous');
  const [origin, setOrigin] = useState<Origin>('tous');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([api('/recipes'), api('/recipes/favorites'), api('/families')])
      .then(([all, favs, families]: [Recipe[], Recipe[], Family[]]) => {
        setRecipes(all);
        setFavoriteIds(new Set(favs.map(r => r.id)));
        const map: Record<string, string> = {};
        for (const f of families) map[f.key] = f.label;
        setFamilyLabelByKey(map);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
    getRecentSearches().then(setRecentSearches);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const categories = useMemo(() => {
    const present = new Set(recipes.map(r => r.category));
    return ['Tous', ...CATEGORY_ORDER.filter(c => present.has(c))];
  }, [recipes]);

  const filteredBase = useMemo(() => {
    return recipes.filter(r => {
      if (category !== 'Tous' && r.category !== category) return false;
      if (origin === 'mine' && r.author_id !== user?.user_id) return false;
      if (origin === 'community' && !(r.is_user_submitted && r.author_id !== user?.user_id)) return false;
      if (favoritesOnly && !favoriteIds.has(r.id)) return false;
      return true;
    });
  }, [recipes, category, origin, favoritesOnly, user?.user_id, favoriteIds]);

  const searchable: (Recipe & RecipeSearchable)[] = useMemo(
    () => filteredBase.map(r => ({ ...r, familyLabel: r.family ? familyLabelByKey[r.family] : null })),
    [filteredBase, familyLabelByKey],
  );

  const trimmedQuery = debouncedQuery.trim();
  const results = useMemo(
    () => (trimmedQuery ? searchRecipes(searchable, trimmedQuery) : []),
    [searchable, trimmedQuery],
  );
  const suggestion = useMemo(
    () => (trimmedQuery && results.length === 0 ? suggestTerms(trimmedQuery, recipes)[0] : null),
    [trimmedQuery, results.length, recipes],
  );

  const commitSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) return;
    addRecentSearch(trimmed).then(setRecentSearches);
  }, []);

  const runFromRecent = (term: string) => {
    setQuery(term);
    setDebouncedQuery(term);
  };

  const dismissRecent = (term: string) => {
    removeRecentSearch(term).then(setRecentSearches);
  };

  const hasActiveFilters = category !== 'Tous' || origin !== 'tous' || favoritesOnly;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={styles.searchWrap}>
          <Feather name="search" size={18} color={colors.muted} />
          <TextInput
            testID="recipe-search-input"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => commitSearch(query)}
            autoFocus
            placeholder="Rechercher une recette, un ingrédient…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable testID="clear-search" onPress={() => { setQuery(''); setDebouncedQuery(''); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Effacer la recherche">
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          testID="toggle-filters"
          onPress={() => setFiltersOpen(v => !v)}
          style={[styles.filtersBtn, hasActiveFilters && styles.filtersBtnActive]}
          accessibilityRole="button"
          accessibilityLabel="Filtres"
        >
          <Feather name="sliders" size={18} color={hasActiveFilters ? colors.onBrandPrimary : colors.onSurface} />
        </Pressable>
      </View>

      {filtersOpen && (
        <View style={styles.filtersPanel}>
          <View style={styles.filterRow}>
            {categories.map(c => (
              <Chip key={c} testID={`search-chip-category-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
          <View style={styles.filterRow}>
            <Chip testID="search-chip-origin-tous" label="Toutes les recettes" active={origin === 'tous'} onPress={() => setOrigin('tous')} tone="brand" />
            <Chip testID="search-chip-origin-mine" label="Mes recettes" active={origin === 'mine'} onPress={() => setOrigin('mine')} tone="brand" />
            <Chip testID="search-chip-origin-community" label="Communauté" active={origin === 'community'} onPress={() => setOrigin('community')} tone="brand" />
          </View>
          <View style={styles.filterRow}>
            <Chip testID="search-chip-favorites" label="Favoris uniquement" active={favoritesOnly} onPress={() => setFavoritesOnly(v => !v)} tone="brand" />
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : !trimmedQuery ? (
        <View style={styles.recentWrap}>
          {recentSearches.length > 0 ? (
            <>
              <Text style={styles.recentTitle}>Recherches récentes</Text>
              {recentSearches.map(term => (
                <View key={term} style={styles.recentRow}>
                  <Pressable testID={`recent-search-${term}`} onPress={() => runFromRecent(term)} style={styles.recentTermBtn}>
                    <Feather name="clock" size={14} color={colors.muted} />
                    <Text style={styles.recentTermText}>{term}</Text>
                  </Pressable>
                  <Pressable testID={`remove-recent-${term}`} onPress={() => dismissRecent(term)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Supprimer « ${term} » des recherches récentes`}>
                    <Feather name="x" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </>
          ) : (
            <EmptyState icon="search" title="Recherchez une recette" subtitle="Nom, ingrédient, catégorie… tapez pour commencer." />
          )}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              testID={`search-result-${item.id}`}
              onPress={() => { commitSearch(trimmedQuery); router.push(`/recipe/${item.id}`); }}
              style={styles.row}
            >
              <Image source={recipeImageSource(item, API_BASE)} style={styles.thumb} contentFit="cover" />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[item.category, item.difficulty, item.time_minutes ? formatDuration(item.time_minutes) : null].filter(Boolean).join(' · ')}
                </Text>
                {item.is_user_submitted && item.author_name && (
                  <Text style={styles.rowAuthor} numberOfLines={1}>Par {item.author_name}</Text>
                )}
              </View>
              {item.coup_de_coeur && <Feather name="award" size={16} color={colors.brand} />}
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="frown"
              title="Aucune recette trouvée"
              subtitle={suggestion ? `Essayez un autre mot-clé, ou vouliez-vous dire « ${suggestion} » ?` : 'Essayez un autre mot-clé ou une autre catégorie.'}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  filtersBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  filtersBtnActive: { backgroundColor: colors.brand },
  filtersPanel: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentWrap: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg },
  recentTitle: { fontSize: 13, color: colors.muted, fontWeight: '500', marginBottom: 8, letterSpacing: 0.3, textTransform: 'uppercase' },
  recentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  recentTermBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  recentTermText: { fontSize: 15, color: colors.onSurface },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  thumb: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: colors.surfaceSecondary },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  rowAuthor: { fontSize: 12, color: colors.muted, marginTop: 2, fontStyle: 'italic' },
});
