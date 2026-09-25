import { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, FlatList, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  HYGIENE_CATEGORIES, HYGIENE_FICHES, HYGIENE_SOURCE_NAME, HYGIENE_SOURCE_URL,
  type HygieneCategoryKey, type HygieneDocKind, type HygieneFiche,
} from '@/src/hygiene/fiches';
import { filterFiches } from '@/src/hygiene/hygieneSearch';
import { Chip } from '@/src/Chip';
import { EmptyState } from '@/src/EmptyState';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { ScrollProgressBar, useScrollProgress } from '@/src/ScrollProgressBar';

const CATEGORY_ICON: Record<HygieneCategoryKey, keyof typeof Feather.glyphMap> = {
  temperatures: 'thermometer',
  nettoyage: 'droplet',
  reception: 'truck',
  allergenes: 'alert-octagon',
  personnel: 'user',
  nonconformites: 'alert-triangle',
  pilotage: 'clipboard',
  bonnespratiques: 'check-circle',
  reglementaire: 'file-text',
};

const DOC_KIND_LABEL: Record<HygieneDocKind, string> = {
  fiche: 'Fiche pratique',
  registre: 'Registre',
  plan: 'Plan',
  checklist: 'Checklist',
  protocole: 'Protocole',
  affiche: 'Affiche',
  reglementaire: 'Document réglementaire',
};

/**
 * Composant de module, pas défini dans le corps de l'écran — même raison
 * que `TipCard` dans `tips.tsx` : son identité ne doit pas changer à chaque
 * frappe dans la recherche, sinon React démonte/remonte chaque carte visible
 * au lieu de simplement la re-rendre.
 */
function FicheCard({ fiche, colors, styles, onPress }: {
  fiche: HygieneFiche; colors: ThemeColors; styles: ReturnType<typeof makeStyles>; onPress: () => void;
}) {
  const categoryLabel = HYGIENE_CATEGORIES.find(c => c.key === fiche.category)?.label || '';
  return (
    <Pressable testID={`hygiene-card-${fiche.id}`} onPress={onPress} style={styles.card}>
      <View style={styles.cardIcon}>
        <Feather name={CATEGORY_ICON[fiche.category]} size={18} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardCategory}>{categoryLabel.toUpperCase()}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{fiche.title}</Text>
        <Text style={styles.cardSummary} numberOfLines={2}>{fiche.description}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{DOC_KIND_LABEL[fiche.docKind]}</Text>
          </View>
          {fiche.files.map(f => (
            <View key={f.format} style={styles.formatBadge}>
              <Text style={styles.formatBadgeText}>{f.format === 'pdf' ? 'PDF' : 'EXCEL'}</Text>
            </View>
          ))}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

/**
 * Bibliothèque HACCP : une seule liste filtrable (recherche + catégories),
 * jamais un écran séparé par catégorie — à cette échelle (35 fiches), le
 * même patron que la bibliothèque Astuces (`tips.tsx`) sert très bien, sans
 * qu'il soit nécessaire d'inventer un concept de "fiches mises en avant".
 */
export default function Hygiene() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HygieneCategoryKey | 'toutes'>('toutes');
  const { progress, onScroll } = useScrollProgress();

  const shown = useMemo(() => filterFiches(HYGIENE_FICHES, query, category), [query, category]);

  const clearSearch = () => { setQuery(''); setCategory('toutes'); };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="hygiene-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Hygiène</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.stickyHeader}>
        <Text style={styles.subtitle}>Les bonnes pratiques d’hygiène et les ressources HACCP pour votre boulangerie.</Text>

        <View style={styles.searchRow}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            testID="hygiene-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher une règle, un sujet…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable testID="hygiene-search-clear" onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Chip testID="hygiene-chip-toutes" label="Toutes" active={category === 'toutes'} onPress={() => setCategory('toutes')} />
          {HYGIENE_CATEGORIES.map(c => (
            <Chip key={c.key} testID={`hygiene-chip-${c.key}`} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </ScrollView>
      </View>
      <ScrollProgressBar progress={progress} />

      {shown.length === 0 ? (
        <EmptyState
          icon="search"
          title="Aucun résultat"
          subtitle="Nous n’avons trouvé aucune fiche correspondant à votre recherche."
          ctaLabel={query || category !== 'toutes' ? 'Effacer la recherche' : undefined}
          onCta={clearSearch}
          testID="hygiene-clear-search"
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={f => f.id}
          contentContainerStyle={{ padding: 24, paddingTop: 16, paddingBottom: 16, gap: 12 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <FicheCard fiche={item} colors={colors} styles={styles} onPress={() => router.push(`/hygiene/${item.id}`)} />
          )}
          ListFooterComponent={
            <View style={styles.attribution}>
              <Text style={styles.attributionText}>Documents fournis avec l’autorisation de Méthode HACCP.</Text>
              <Pressable testID="hygiene-source-link" onPress={() => Linking.openURL(HYGIENE_SOURCE_URL).catch(() => {})}>
                <Text style={styles.attributionLink}>Visiter {HYGIENE_SOURCE_NAME}</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  stickyHeader: { backgroundColor: colors.surface, paddingTop: 16 },
  subtitle: { fontSize: 13, color: colors.onSurfaceSecondary, paddingHorizontal: 24, marginBottom: 14, lineHeight: 18 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginBottom: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: colors.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: 16, minHeight: 44,
    ...cardElevation(mode, colors),
  },
  cardIcon: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  cardCategory: { fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontWeight: '600' },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface, marginTop: 4 },
  cardSummary: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  kindBadge: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  kindBadgeText: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '500' },
  formatBadge: { backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  formatBadgeText: { fontSize: 10, color: colors.onBrandTertiary, fontWeight: '700', letterSpacing: 0.5 },
  attribution: { alignItems: 'center', paddingTop: 12, paddingBottom: 24, gap: 4 },
  attributionText: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  attributionLink: { fontSize: 13, color: colors.brand, fontWeight: '600' },
});
