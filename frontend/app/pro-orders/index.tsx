import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useEntitlements } from '@/src/entitlements';
import { LockedFeatureNotice } from '@/src/PlanChip';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { EmptyState } from '@/src/EmptyState';
import { Chip } from '@/src/Chip';

type Status = 'pending' | 'confirmed' | 'ready' | 'picked_up' | 'cancelled';
type OrderSummary = {
  id: string; client_name: string; pickup_date: string; pickup_time: string | null;
  status: Status; item_count: number; recipe_titles: string[];
  price_total: number | null; balance_due: number | null;
};

const STATUS_LABELS: Record<Status, string> = {
  pending: 'En attente', confirmed: 'Confirmée', ready: 'Prête',
  picked_up: 'Récupérée', cancelled: 'Annulée',
};
const STATUS_FILTERS: [Status | 'all', string][] = [
  ['all', 'Toutes'], ['pending', 'En attente'], ['confirmed', 'Confirmée'],
  ['ready', 'Prête'], ['picked_up', 'Récupérée'], ['cancelled', 'Annulée'],
];

// Les trois teintes de marque déjà utilisées par le podium du Classement +
// success/surfaceTertiary — jamais une couleur inventée pour l'occasion.
function statusBg(status: Status, colors: ThemeColors): string {
  switch (status) {
    case 'confirmed': return colors.brandTertiary;
    case 'ready': return colors.brandSecondary;
    case 'picked_up': return colors.success;
    default: return colors.surfaceTertiary;
  }
}

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatEuros(v: number | null) {
  if (v == null) return '—';
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/**
 * Liste des commandes pro (phase 7b), réservée à l'offre Équipe
 * (`pro_orders`). Même coquille que `classement.tsx`/`organisation.tsx` —
 * flat screen, en-tête flèche retour. Le détail d'une commande vit dans
 * `[id].tsx`, la création/édition dans `new.tsx` (même patron que
 * `production/new.tsx` pour les articles recette+quantité+mode).
 */
export default function ProOrdersScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const router = useRouter();
  const { can } = useEntitlements();
  const locked = !can('pro_orders');

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (locked) { setLoading(false); return; }
    setLoading(true);
    try {
      const q = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      setOrders(await api(`/pro-orders${q}`));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, locked]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="orders-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Commandes pro</Text>
        <Pressable
          testID="orders-new"
          onPress={() => router.push('/pro-orders/new' as any)}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Nouvelle commande"
        >
          <Feather name="plus" size={22} color={colors.brand} />
        </Pressable>
      </View>

      {locked ? (
        <View style={styles.body}>
          <LockedFeatureNotice
            minPlan="team"
            label="Les commandes pro sont réservées à l'offre Équipe"
            onPress={() => router.push('/pro?feature=pro_orders' as any)}
          />
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {STATUS_FILTERS.map(([key, label]) => (
              <Chip key={key} testID={`orders-filter-${key}`} label={label} active={statusFilter === key} onPress={() => setStatusFilter(key)} />
            ))}
          </ScrollView>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
          ) : error ? (
            <EmptyState icon="wifi-off" title="Impossible de charger les commandes" subtitle={error} ctaLabel="Réessayer" onCta={load} testID="orders-retry" />
          ) : orders.length === 0 ? (
            <EmptyState
              icon="shopping-bag"
              title="Aucune commande"
              subtitle="Les commandes de vos clients apparaîtront ici."
              ctaLabel="+ Nouvelle commande"
              onCta={() => router.push('/pro-orders/new' as any)}
              testID="orders-empty-cta"
            />
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              {orders.map(o => (
                <Pressable
                  key={o.id}
                  testID={`order-row-${o.id}`}
                  onPress={() => router.push(`/pro-orders/${o.id}` as any)}
                  style={styles.row}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowClient} numberOfLines={1}>{o.client_name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {o.recipe_titles.join(', ') || 'Aucun article'}
                    </Text>
                    <Text style={styles.rowDate}>
                      {formatDate(o.pickup_date)}{o.pickup_time ? ` · ${o.pickup_time}` : ''}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    <View style={[styles.statusBadge, { backgroundColor: statusBg(o.status, colors) }]}>
                      <Text style={styles.statusBadgeText}>{STATUS_LABELS[o.status]}</Text>
                    </View>
                    {o.price_total != null && (
                      <Text style={styles.rowBalance}>{formatEuros(o.balance_due)} restant</Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingVertical: 16 },
  body: { padding: 24, paddingTop: 8, paddingBottom: 60, gap: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
  rowClient: { fontFamily: theme.serif, fontSize: 16, color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  rowDate: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4, fontWeight: '600' },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  statusBadgeText: { fontSize: 11, fontWeight: '700', color: colors.onSurfaceSecondary },
  rowBalance: { fontSize: 12, color: colors.muted },
});
