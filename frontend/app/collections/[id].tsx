/**
 * Détail d'une collection : compteur, tri, recherche (dans cette collection
 * uniquement), grille paginée de recettes, retrait par glissement. Le
 * pseudo-dossier "Toutes les recettes enregistrées" (`__favorites__`) partage
 * cet écran — même composant, lecture seule pour la collection elle-même
 * (pas d'édition/suppression, pas de retrait par glissement : le save global
 * se gère depuis le bouton bookmark de la fiche recette).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { formatDuration } from '@/src/format';
import { recipeImageSource } from '@/src/products';
import { SwipeableRow } from '@/src/SwipeableRow';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const FAVORITES_ID = '__favorites__';

type Sort = 'recent' | 'oldest' | 'popular';
const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Plus récentes' },
  { key: 'oldest', label: 'Plus anciennes' },
  { key: 'popular', label: 'Plus populaires' },
];

type RecipeItem = {
  id: string; title: string; difficulty: string; time_minutes: number;
  like_count?: number; coup_de_coeur?: boolean; added_at: string;
  image_path?: string | null; image_url?: string | null; product?: string | null;
};

export default function CollectionDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isFavorites = id === FAVORITES_ID;

  const [meta, setMeta] = useState<{ name: string; description: string; recipe_count: number } | null>(null);
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const queryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMeta = useCallback(() => {
    api(`/collections/${id}`).then(setMeta).catch(() => setMeta(null));
  }, [id]);

  const loadRecipes = useCallback((opts: { before?: string } = {}) => {
    const params = new URLSearchParams();
    params.set('sort', sort);
    if (query.trim()) params.set('q', query.trim());
    if (opts.before) params.set('before', opts.before);
    return api(`/collections/${id}/recipes?${params.toString()}`);
  }, [id, sort, query]);

  useEffect(() => {
    setLoading(true);
    loadMeta();
    loadRecipes().then(r => {
      setItems(r.items);
      setHasMore(r.has_more);
    }).catch(() => { setItems([]); setHasMore(false); }).finally(() => setLoading(false));
    // `loadRecipes`/`loadMeta` volontairement absents : ils changent aussi
    // avec `query` (débouncée séparément ci-dessous) — les inclure ici
    // relancerait cet effet à chaque frappe, en plus du debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sort]);

  // Recherche : petit débounce pour ne pas relancer l'appel à chaque frappe.
  useEffect(() => {
    if (queryDebounce.current) clearTimeout(queryDebounce.current);
    queryDebounce.current = setTimeout(() => {
      setLoading(true);
      loadRecipes().then(r => {
        setItems(r.items);
        setHasMore(r.has_more);
      }).catch(() => { setItems([]); setHasMore(false); }).finally(() => setLoading(false));
    }, 300);
    return () => { if (queryDebounce.current) clearTimeout(queryDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadMore = () => {
    if (loadingMore || !hasMore || !items.length) return;
    setLoadingMore(true);
    loadRecipes({ before: items[items.length - 1].added_at }).then(r => {
      setItems(prev => [...prev, ...r.items]);
      setHasMore(r.has_more);
    }).catch(() => {}).finally(() => setLoadingMore(false));
  };

  const removeRecipe = async (recipeId: string) => {
    setItems(prev => prev.filter(r => r.id !== recipeId));
    try {
      await api(`/collections/${id}/recipes/${recipeId}`, { method: 'DELETE' });
    } catch {}
    loadMeta();
  };

  const openEdit = () => {
    if (!meta) return;
    setEditName(meta.name);
    setEditDescription(meta.description);
    setEditing(true);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api(`/collections/${id}`, { method: 'PUT', body: JSON.stringify({ name, description: editDescription.trim() }) });
      setEditing(false);
      loadMeta();
    } catch {} finally {
      setSaving(false);
    }
  };

  const deleteCollection = async () => {
    const ok = await confirmAsync(
      'Supprimer cette collection',
      'Les recettes qu’elle contient resteront enregistrées et disponibles ailleurs.',
      'Supprimer',
      true,
    );
    if (!ok) return;
    try {
      await api(`/collections/${id}`, { method: 'DELETE' });
      router.back();
    } catch {}
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="collection-detail-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{meta?.name ?? ''}</Text>
          {meta && <Text style={styles.count}>{meta.recipe_count} recette{meta.recipe_count > 1 ? 's' : ''}</Text>}
        </View>
        {isFavorites ? (
          <View style={{ width: 40 }} />
        ) : (
          <View style={styles.headerActions}>
            <Pressable testID="collection-detail-edit" onPress={openEdit} style={styles.iconBtn}>
              <Feather name="edit-2" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="collection-detail-delete" onPress={deleteCollection} style={styles.iconBtn}>
              <Feather name="trash-2" size={18} color={colors.error} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput
          testID="collection-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher dans cette collection"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.sortRow}>
        {SORT_OPTIONS.map(opt => (
          <Pressable
            key={opt.key}
            testID={`collection-sort-${opt.key}`}
            onPress={() => setSort(opt.key)}
            style={[styles.chip, sort === opt.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, sort === opt.key && styles.chipTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand} /> : null}
          renderItem={({ item }) => {
            const src = recipeImageSource(item, API_BASE);
            const row = (
              <Pressable testID={`collection-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.row}>
                <View style={styles.thumb}>
                  {src ? <Image source={src} style={styles.thumbImage} contentFit="cover" /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowMeta}>{item.difficulty} · {formatDuration(item.time_minutes)} · {item.like_count ?? 0} {"j'aime"}</Text>
                </View>
                {item.coup_de_coeur && <Feather name="award" size={16} color={colors.brand} />}
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            );
            return isFavorites ? row : (
              <SwipeableRow deleteLabel="Retirer" onDelete={() => removeRecipe(item.id)}>
                {row}
              </SwipeableRow>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>Aucune recette{query ? ' pour cette recherche' : ' pour l’instant'}.</Text>}
        />
      )}

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditing(false)}>
          <Pressable style={styles.formSheet} onPress={() => {}}>
            <Text style={styles.formTitle}>Modifier la collection</Text>
            <TextInput
              testID="collection-edit-name"
              value={editName}
              onChangeText={setEditName}
              placeholder="Nom"
              placeholderTextColor={colors.muted}
              style={styles.input}
              maxLength={80}
            />
            <TextInput
              testID="collection-edit-description"
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Description (optionnelle)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { height: 80 }]}
              maxLength={300}
              multiline
            />
            <Pressable
              testID="collection-edit-submit"
              onPress={saveEdit}
              disabled={saving || !editName.trim()}
              style={[styles.submitBtn, (saving || !editName.trim()) && { opacity: 0.5 }]}
            >
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Enregistrer</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerActions: { flexDirection: 'row' },
  title: { fontFamily: theme.serif, fontSize: 19, color: colors.onSurface },
  count: { fontSize: 12, color: colors.muted, marginTop: 2 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 12, height: 40, borderRadius: theme.radius.md, backgroundColor: colors.surfaceSecondary,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12, marginBottom: 4 },
  chip: { paddingHorizontal: 14, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.onSurfaceInverse },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  thumb: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: colors.surfaceSecondary, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: theme.serif, fontSize: 16, color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  backdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.5)', justifyContent: 'center', padding: 24 },
  formSheet: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 12 },
  formTitle: { fontFamily: theme.serif, fontSize: 19, color: colors.onSurface },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary, textAlignVertical: 'top',
  },
  submitBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.md, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 15 },
});
