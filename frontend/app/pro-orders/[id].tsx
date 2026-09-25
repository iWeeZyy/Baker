import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { EmptyState } from '@/src/EmptyState';
import { ActionSheet, type ActionSheetOption } from '@/src/ActionSheet';
import { ScrollProgressBar, useScrollProgress } from '@/src/ScrollProgressBar';

type Status = 'pending' | 'confirmed' | 'ready' | 'picked_up' | 'cancelled';
type Item = { item_id: string; recipe_id: string; recipe_title: string; quantity: number; mode: 'pieces' | 'batches' };
type Ingredient = { name: string; quantity: number; unit: string };
type OrderDetail = {
  id: string; client_name: string; client_contact: string; pickup_date: string; pickup_time: string | null;
  status: Status; items: Item[]; price_total: number | null; deposit_paid: number | null;
  balance_due: number | null; notes: string; ingredients: { items: Ingredient[]; unparsed: string[] };
};

const STATUS_LABELS: Record<Status, string> = {
  pending: 'En attente', confirmed: 'Confirmée', ready: 'Prête',
  picked_up: 'Récupérée', cancelled: 'Annulée',
};

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
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatEuros(v: number | null) {
  if (v == null) return '—';
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/**
 * Détail d'une commande pro : client, articles, agrégat de matières (même
 * calcul que le tableau de bord/la production), prix/acompte/reste dû,
 * changement rapide de statut sans passer par le formulaire complet.
 */
export default function ProOrderDetail() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [data, setData] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { progress, onScroll } = useScrollProgress();
  const [error, setError] = useState<string | null>(null);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/pro-orders/${id}`));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Commande introuvable');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeStatus = async (status: Status) => {
    setChangingStatus(true);
    try {
      setData(await api(`/pro-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }));
    } catch (e: any) {
      setError(e.message || 'Changement de statut impossible');
    } finally {
      setChangingStatus(false);
    }
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync('Supprimer cette commande', 'Cette action est définitive.', 'Supprimer', true);
    if (!ok) return;
    try {
      await api(`/pro-orders/${id}`, { method: 'DELETE' });
      router.replace('/pro-orders' as any);
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
    }
  };

  const statusOptions: ActionSheetOption[] = (Object.keys(STATUS_LABELS) as Status[]).map(s => ({
    key: s, icon: s === 'cancelled' ? 'x-circle' : 'circle',
    label: STATUS_LABELS[s], onPress: () => changeStatus(s), destructive: s === 'cancelled',
  }));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState icon="alert-circle" title="Commande introuvable" subtitle={error || undefined} ctaLabel="Retour" onCta={() => router.back()} testID="order-back-empty" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="order-detail-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{data.client_name}</Text>
        <Pressable testID="order-edit" onPress={() => router.push(`/pro-orders/new?id=${data.id}` as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Modifier">
          <Feather name="edit-2" size={20} color={colors.brand} />
        </Pressable>
      </View>
      <ScrollProgressBar progress={progress} />

      <ScrollView contentContainerStyle={styles.body} onScroll={onScroll} scrollEventThrottle={16}>
        {error && <Text style={styles.error} testID="order-detail-error">{error}</Text>}

        <View style={styles.topRow}>
          <View>
            <Text style={styles.pickupDate}>{formatDate(data.pickup_date)}</Text>
            {data.pickup_time && <Text style={styles.pickupTime}>{data.pickup_time}</Text>}
            {!!data.client_contact && <Text style={styles.contact}>{data.client_contact}</Text>}
          </View>
          <Pressable
            testID="order-status-chip"
            onPress={() => setStatusSheetOpen(true)}
            disabled={changingStatus}
            style={[styles.statusChip, { backgroundColor: statusBg(data.status, colors) }]}
          >
            {changingStatus
              ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} />
              : <Text style={styles.statusChipText}>{STATUS_LABELS[data.status]}</Text>}
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Articles</Text>
          {data.items.map(it => (
            <View key={it.item_id} style={styles.itemRow}>
              <Text style={styles.itemName} numberOfLines={1}>{it.recipe_title}</Text>
              <Text style={styles.itemQty}>{it.quantity} {it.mode === 'pieces' ? 'pièces' : 'fournées'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Besoin matières</Text>
          {data.ingredients.items.length === 0 ? (
            <Text style={styles.emptyLine}>Aucun ingrédient identifiable.</Text>
          ) : (
            data.ingredients.items.map(item => (
              <View key={`${item.name}-${item.unit}`} style={styles.ingredientRow}>
                <Text style={styles.ingredientName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.ingredientQty}>{item.quantity} {item.unit}</Text>
              </View>
            ))
          )}
        </View>

        {(data.price_total != null || data.deposit_paid != null) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Paiement</Text>
            <View style={styles.statsRow}>
              <View>
                <Text style={styles.stat}>{formatEuros(data.price_total)}</Text>
                <Text style={styles.statLabel}>prix total</Text>
              </View>
              <View>
                <Text style={styles.stat}>{formatEuros(data.deposit_paid)}</Text>
                <Text style={styles.statLabel}>acompte versé</Text>
              </View>
              <View>
                <Text style={styles.stat}>{formatEuros(data.balance_due)}</Text>
                <Text style={styles.statLabel}>reste à payer</Text>
              </View>
            </View>
          </View>
        )}

        {!!data.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notes}>{data.notes}</Text>
          </View>
        )}

        <Pressable testID="order-detail-delete" onPress={confirmDelete} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel="Supprimer cette commande">
          <Text style={styles.deleteText}>Supprimer cette commande</Text>
        </Pressable>
      </ScrollView>

      <ActionSheet visible={statusSheetOpen} title="Statut de la commande" options={statusOptions} onClose={() => setStatusSheetOpen(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, marginHorizontal: 8 },
  body: { padding: 24, paddingBottom: 60, gap: 16 },
  error: { color: colors.error, fontSize: 13, lineHeight: 18 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  pickupDate: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, textTransform: 'capitalize' },
  pickupTime: { fontSize: 14, color: colors.muted, marginTop: 2 },
  contact: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 6 },
  statusChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, minWidth: 90, alignItems: 'center' },
  statusChipText: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceSecondary },
  section: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
  sectionTitle: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  itemName: { flex: 1, fontSize: 15, color: colors.onSurface, marginRight: 8 },
  itemQty: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  emptyLine: { fontSize: 13, color: colors.muted },
  ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  ingredientName: { flex: 1, fontSize: 14, color: colors.onSurface, marginRight: 8 },
  ingredientQty: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  notes: { fontSize: 14, color: colors.onSurface, lineHeight: 20 },
  deleteBtn: { alignItems: 'center', paddingVertical: 16 },
  deleteText: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
