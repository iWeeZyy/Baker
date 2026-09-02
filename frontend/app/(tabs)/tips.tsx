import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, TextInput, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { filterTips, pickRandomTip, summarize, type Tip } from '@/src/tips/tipsSearch';
import { Chip } from '@/src/Chip';
import { SegmentedControl } from '@/src/SegmentedControl';
import { EmptyState } from '@/src/EmptyState';
import { tapFeedback } from '@/src/haptics';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';

const CATEGORIES = [
  'Toutes', 'Pétrissage', 'Farines', 'Hydratation', 'Température', 'Fermentation',
  'Façonnage', 'Cuisson', 'Viennoiserie', 'Conservation', 'Problèmes & solutions', 'Général',
];

/**
 * Composant de module, pas défini dans le corps de `Tips` : sinon son
 * identité changerait à chaque rendu de l'écran (recherche tapée,
 * catégorie choisie, favori togglé...) et React démonterait/remonterait
 * chaque carte visible au lieu de simplement la re-rendre.
 */
function TipCard({ tip, favorited, scale, colors, styles, onToggleFavorite, onPress }: {
  tip: Tip; favorited: boolean; scale: Animated.Value; colors: ThemeColors; styles: ReturnType<typeof makeStyles>;
  onToggleFavorite: () => void; onPress: () => void;
}) {
  return (
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
        <Animated.View style={{ transform: [{ scale }] }}>
          <Feather name="star" size={18} color={favorited ? colors.brandSecondary : colors.border} />
        </Animated.View>
      </Pressable>
    </Pressable>
  );
}

/**
 * La bibliothèque « Astuces » : toutes les astuces de l'application (les
 * originales, celles des deux ouvrages, migrées vers ce même écran) plutôt
 * que dispersées entre l'accueil et les fiches recette.
 */
export default function Tips() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);

  // Une valeur par astuce, sur la durée de vie de l'écran plutôt que du
  // rendu courant : sans ça l'animation n'aurait jamais le temps de jouer
  // avant que React ne re-rende la carte.
  const favScales = useRef<Map<string, Animated.Value>>(new Map());
  const getFavScale = (id: string) => {
    let v = favScales.current.get(id);
    if (!v) { v = new Animated.Value(1); favScales.current.set(id, v); }
    return v;
  };

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
    if (willFavorite) {
      tapFeedback();
      const scale = getFavScale(tip.id);
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      ]).start();
    }
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

        <SegmentedControl
          testID="tips-view"
          options={[{ key: 'toutes', label: 'Toutes les astuces' }, { key: 'favoris', label: 'Mes favoris' }]}
          value={view}
          onChange={setView}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {CATEGORIES.map(c => (
            <Chip key={c} testID={`tips-chip-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : error ? (
        <EmptyState
          icon="wifi-off"
          title="Impossible de charger les astuces"
          subtitle={error}
          ctaLabel="Réessayer"
          onCta={load}
          testID="tips-retry"
        />
      ) : shown.length === 0 ? (
        view === 'favoris' && base.length === 0 ? (
          <EmptyState
            icon="star"
            title="Aucune astuce enregistrée"
            subtitle="Ajoutez vos astuces favorites pour les retrouver rapidement."
          />
        ) : (
          <EmptyState
            icon="search"
            title="Aucune astuce trouvée"
            subtitle="Essayez un autre mot-clé."
          />
        )
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 24, paddingTop: 16, paddingBottom: 40, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <TipCard
              tip={item}
              favorited={favoriteIds.has(item.id)}
              scale={getFavScale(item.id)}
              colors={colors}
              styles={styles}
              onToggleFavorite={() => toggleFavorite(item)}
              onPress={() => router.push(`/tip/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
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
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: colors.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
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
