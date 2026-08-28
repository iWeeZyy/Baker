import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { filterTips, pickRandomTip, summarize, type Tip } from '@/src/tips/tipsSearch';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const CATEGORIES = [
  'Toutes', 'Pétrissage', 'Farines', 'Hydratation', 'Température', 'Fermentation',
  'Façonnage', 'Cuisson', 'Viennoiserie', 'Conservation', 'Problèmes & solutions', 'Général',
];

/**
 * La bibliothèque « Astuces » : toutes les astuces de l'application (les
 * originales, celles des deux ouvrages, migrées vers ce même écran) plutôt
 * que dispersées entre l'accueil et les fiches recette.
 */
export default function Tips() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const TipCard = ({ tip, favorited, onToggleFavorite, onPress }: { tip: Tip; favorited: boolean; onToggleFavorite: () => void; onPress: () => void }) => (
    <Pressable testID={`tip-card-${tip.id}`} onPress={onPress} style={styles.card}>
      <View style={styles.cardIcon}>
        <Feather name={(tip.icon as any) || 'star'} size={18} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardCategory}>{tip.category.toUpperCase()}</Text>
          {tip.problem && <View style={styles.problemBadge}><Text style={styles.problemBadgeText}>⚠️ PROBLÈME</Text></View>}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{tip.title}</Text>
        <Text style={styles.cardSummary} numberOfLines={2}>{summarize(tip.content)}</Text>
        {tip.keywords.length > 0 && (
          <View style={styles.keywordRow}>
            {tip.keywords.slice(0, 3).map(k => (
              <View key={k} style={styles.keywordPill}><Text style={styles.keywordText}>{k}</Text></View>
            ))}
          </View>
        )}
      </View>
      <Pressable testID={`tip-fav-${tip.id}`} onPress={onToggleFavorite} hitSlop={10} style={styles.favBtn}>
        <Feather name="star" size={18} color={favorited ? colors.brandSecondary : colors.border} />
      </Pressable>
    </Pressable>
  );

  const router = useRouter();
  const [tips, setTips] = useState<Tip[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Toutes');
  const [view, setView] = useState<'toutes' | 'favoris'>('toutes');
  const [lastRandomId, setLastRandomId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [allTips, favIds] = await Promise.all([
        api('/tips'),
        api('/tips/favorite-ids').catch(() => []),
      ]);
      setTips(allTips);
      setFavoriteIds(new Set(favIds));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Impossible de charger les astuces');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const base = view === 'favoris' ? tips.filter(t => favoriteIds.has(t.id)) : tips;
  const shown = useMemo(() => filterTips(base, query, category), [base, query, category]);

  const toggleFavorite = async (tip: Tip) => {
    const willFavorite = !favoriteIds.has(tip.id);
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (willFavorite) next.add(tip.id); else next.delete(tip.id);
      return next;
    });
    try {
      await api(`/tips/${tip.id}/favorite`, { method: 'POST' });
    } catch {
      // rollback on failure
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (willFavorite) next.delete(tip.id); else next.add(tip.id);
        return next;
      });
    }
  };

  const openRandom = () => {
    const pick = pickRandomTip(tips, lastRandomId);
    if (!pick) return;
    setLastRandomId(pick.id);
    router.push(`/tip/${pick.id}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.stickyHeader}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandLabel}>LE SAVOIR-FAIRE</Text>
            <Text style={styles.title}>Astuces</Text>
          </View>
          <Pressable testID="tips-random" onPress={openRandom} style={styles.randomBtn}>
            <Text style={styles.randomEmoji}>💡</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            testID="tips-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher une astuce…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable testID="tips-search-clear" onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <View style={styles.segment}>
          {([['toutes', 'Toutes les astuces'], ['favoris', 'Mes favoris']] as const).map(([key, label]) => (
            <Pressable key={key} testID={`tips-view-${key}`} onPress={() => setView(key)} style={[styles.segBtn, view === key && styles.segBtnOn]}>
              <Text style={[styles.segText, view === key && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {CATEGORIES.map(c => (
            <Pressable
              key={c}
              testID={`tips-chip-${c}`}
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
      ) : error ? (
        <View style={styles.emptyBox}>
          <Feather name="wifi-off" size={34} color={colors.muted} />
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable testID="tips-retry" onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : shown.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name={view === 'favoris' ? 'star' : 'search'} size={34} color={colors.muted} />
          {view === 'favoris' && base.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>Aucune astuce enregistrée</Text>
              <Text style={styles.emptyText}>Ajoutez vos astuces favorites pour les retrouver rapidement.</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>Aucune astuce trouvée</Text>
              <Text style={styles.emptyText}>Essayez un autre mot-clé.</Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 24, paddingTop: 16, paddingBottom: 40, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <TipCard tip={item} favorited={favoriteIds.has(item.id)} onToggleFavorite={() => toggleFavorite(item)} onPress={() => router.push(`/tip/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stickyHeader: { backgroundColor: colors.surface, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, marginBottom: 16 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: colors.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  randomBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  randomEmoji: { fontSize: 18 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginBottom: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginBottom: 14 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '600' },
  segTextOn: { color: colors.onBrandPrimary },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.onSurfaceInverse },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong },
  retryText: { fontSize: 14, color: colors.onSurface, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 16 },
  cardIcon: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardCategory: { fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontWeight: '600' },
  problemBadge: { backgroundColor: colors.warning, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  problemBadgeText: { fontSize: 9, color: colors.onBrandPrimary, fontWeight: '700' },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface, marginTop: 4 },
  cardSummary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 18 },
  keywordRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  keywordPill: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  keywordText: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '500' },
  favBtn: { paddingTop: 2 },
});
