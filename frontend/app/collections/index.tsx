/**
 * "Mes collections" — grille des dossiers personnels de recettes enregistrées.
 * Point d'entrée unique : Profil ▾ → Collections (ProfileTabMenu.tsx). Le
 * pseudo-dossier "Toutes les recettes enregistrées" (favoris existants,
 * db.favorites) est toujours épinglé en premier, jamais un vrai document
 * modifiable — même patron que `creations/[userId].tsx` pour la grille,
 * étendu à une mosaïque puisqu'une collection mélange des recettes de
 * familles différentes.
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { recipeImageSource } from '@/src/products';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { showGamificationToast } from '@/src/gamification/UnlockToast';
import { EmptyState } from '@/src/EmptyState';
import { FAVORITES_COLLECTION_ID } from '@/src/collections';

type PreviewRecipe = { id: string; image_path?: string | null; image_url?: string | null; product?: string | null };
type CollectionRow = {
  id: string; name: string; description: string;
  recipe_count: number; preview_recipes: PreviewRecipe[];
};

function Mosaic({ previews, isFavorites }: { previews: PreviewRecipe[]; isFavorites: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!previews.length) {
    return (
      <View style={styles.mosaicEmpty}>
        <Feather name={isFavorites ? 'bookmark' : 'folder'} size={28} color={colors.muted} />
      </View>
    );
  }
  if (previews.length === 1) {
    const src = recipeImageSource(previews[0], API_BASE);
    return src ? <Image source={src} style={styles.mosaicSingle} contentFit="cover" /> : (
      <View style={styles.mosaicEmpty}><Feather name="folder" size={28} color={colors.muted} /></View>
    );
  }
  // Deux lignes explicites plutôt qu'un flexWrap : des cellules en `width:
  // '50%'` à l'intérieur d'un conteneur lui-même en pourcentage se
  // comportent mal sur react-native-web (retour à la ligne imprévisible),
  // deux rangées de deux cellules chacune est robuste sur web et natif.
  const cell = (i: number) => {
    const p = previews[i];
    const src = p ? recipeImageSource(p, API_BASE) : undefined;
    return (
      <View key={i} style={styles.mosaicCell}>
        {src ? <Image source={src} style={styles.mosaicCellImage} contentFit="cover" /> : null}
      </View>
    );
  };
  return (
    <View style={styles.mosaicGrid}>
      <View style={styles.mosaicRow}>{cell(0)}{cell(1)}</View>
      <View style={styles.mosaicRow}>{cell(2)}{cell(3)}</View>
    </View>
  );
}

export default function CollectionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [items, setItems] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return api('/collections')
      .then(res => { setItems(res); setError(false); })
      .catch(() => { setItems([]); setError(true); });
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await api('/collections', { method: 'POST', body: JSON.stringify({ name, description: newDescription.trim() }) });
      setCreating(false);
      setNewName('');
      setNewDescription('');
      load();
      showGamificationToast(created.gamification);
      refreshUser();
    } catch {} finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="collections-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Mes collections</Text>
        <Pressable testID="collections-new-header" onPress={() => setCreating(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Nouvelle collection">
          <Feather name="plus" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : error ? (
        <EmptyState
          icon="wifi-off"
          title="Impossible de charger vos collections"
          subtitle="Vérifiez votre connexion et réessayez."
          ctaLabel="Réessayer"
          onCta={() => { setLoading(true); load().finally(() => setLoading(false)); }}
          testID="collections-retry"
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={c => c.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 12, paddingVertical: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`collection-card-${item.id}`}
              onPress={() => router.push(`/collections/${item.id}` as any)}
              style={styles.card}
            >
              <Mosaic previews={item.preview_recipes} isFavorites={item.id === FAVORITES_COLLECTION_ID} />
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.cardCount}>
                {item.recipe_count} recette{item.recipe_count > 1 ? 's' : ''}
              </Text>
            </Pressable>
          )}
          ListFooterComponent={
            <Pressable testID="collections-new-tile" onPress={() => setCreating(true)} style={[styles.card, styles.newCard]}>
              <View style={styles.mosaicEmpty}>
                <Feather name="plus" size={28} color={colors.brand} />
              </View>
              <Text style={[styles.cardName, { color: colors.brand }]}>Nouvelle collection</Text>
            </Pressable>
          }
        />
      )}

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCreating(false)}>
          <Pressable style={styles.formSheet} onPress={() => {}}>
            <Text style={styles.formTitle}>Nouvelle collection</Text>
            <TextInput
              testID="collection-form-name"
              value={newName}
              onChangeText={setNewName}
              placeholder="Nom (ex. Pains au levain)"
              placeholderTextColor={colors.muted}
              style={styles.input}
              maxLength={80}
              autoFocus
            />
            <TextInput
              testID="collection-form-description"
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder="Description (optionnelle)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { height: 80 }]}
              maxLength={300}
              multiline
            />
            <Pressable
              testID="collection-form-submit"
              onPress={createCollection}
              disabled={saving || !newName.trim()}
              style={[styles.submitBtn, (saving || !newName.trim()) && { opacity: 0.5 }]}
            >
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Créer</Text>}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  card: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 8, gap: 6 },
  newCard: { alignItems: 'center', justifyContent: 'center' },
  mosaicSingle: { width: '100%', aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: colors.surfaceTertiary },
  mosaicGrid: { width: '100%', aspectRatio: 1, borderRadius: theme.radius.md, overflow: 'hidden', gap: 2 },
  mosaicRow: { flex: 1, flexDirection: 'row', gap: 2 },
  mosaicCell: { flex: 1, backgroundColor: colors.surfaceTertiary },
  mosaicCellImage: { width: '100%', height: '100%' },
  mosaicEmpty: { width: '100%', aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontFamily: theme.serif, fontSize: 15, color: colors.onSurface },
  cardCount: { fontSize: 12, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.5)', justifyContent: 'center', padding: 24 },
  formSheet: { backgroundColor: colors.surface, borderRadius: theme.radius.xl, padding: 20, gap: 12 },
  formTitle: { fontFamily: theme.serif, fontSize: 19, color: colors.onSurface },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary, textAlignVertical: 'top',
  },
  submitBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.md, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 15 },
});
