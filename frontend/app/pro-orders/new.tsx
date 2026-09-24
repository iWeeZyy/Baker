import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { isPlanLimitError } from '@/src/plan';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { Button } from '@/src/Button';
import { EmptyState } from '@/src/EmptyState';
import { ActionSheet, type ActionSheetOption } from '@/src/ActionSheet';

type Recipe = { id: string; title: string; category: string; yield_pieces?: number | null };
type Item = { key: string; recipe_id: string; quantity: string; mode: 'pieces' | 'batches' };
type Status = 'pending' | 'confirmed' | 'ready' | 'picked_up' | 'cancelled';

const STATUS_LABELS: Record<Status, string> = {
  pending: 'En attente', confirmed: 'Confirmée', ready: 'Prête',
  picked_up: 'Récupérée', cancelled: 'Annulée',
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Créer/modifier une commande pro — même écran pour les deux (`isEdit`,
 * même convention que `production/new.tsx`). Les articles reprennent
 * exactement le patron recette+quantité+mode de `production/new.tsx`
 * (même forme de ligne côté serveur), jamais réinventé.
 */
export default function ProOrderForm() {
  const { colors, mode: themeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, themeMode), [colors, themeMode]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id && id !== 'new';

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [pickupDate, setPickupDate] = useState(todayISO());
  const [pickupTime, setPickupTime] = useState('');
  const [status, setStatus] = useState<Status>('pending');
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [priceTotal, setPriceTotal] = useState('');
  const [depositPaid, setDepositPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await api('/recipes');
      setRecipes(list);
      if (isEdit) {
        const o = await api(`/pro-orders/${id}`);
        setClientName(o.client_name || '');
        setClientContact(o.client_contact || '');
        setPickupDate(o.pickup_date);
        setPickupTime(o.pickup_time || '');
        setStatus(o.status);
        setPriceTotal(o.price_total != null ? String(o.price_total) : '');
        setDepositPaid(o.deposit_paid != null ? String(o.deposit_paid) : '');
        setNotes(o.notes || '');
        setItems((o.items || []).map((it: any, i: number) => ({
          key: `${it.item_id || i}`,
          recipe_id: it.recipe_id,
          quantity: String(it.quantity),
          mode: it.mode,
        })));
      }
    } catch (e: any) {
      setLoadError(e.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => { loadForm(); }, [loadForm]);

  const recipeById = (rid: string) => recipes.find(r => r.id === rid);

  const addRecipe = (r: Recipe) => {
    setPicking(false);
    setItems(prev => [...prev, {
      key: `${r.id}-${Date.now()}`,
      recipe_id: r.id,
      quantity: '1',
      mode: r.yield_pieces && r.yield_pieces > 0 ? 'pieces' : 'batches',
    }]);
  };

  const updateItem = (key: string, patch: Partial<Item>) =>
    setItems(prev => prev.map(it => (it.key === key ? { ...it, ...patch } : it)));

  const removeItem = (key: string) => setItems(prev => prev.filter(it => it.key !== key));

  const statusOptions: ActionSheetOption[] = (Object.keys(STATUS_LABELS) as Status[]).map(s => ({
    key: s, icon: s === 'cancelled' ? 'x-circle' : 'circle',
    label: STATUS_LABELS[s], onPress: () => setStatus(s), destructive: s === 'cancelled',
  }));

  const save = async () => {
    setError(null);
    const name = clientName.trim();
    if (!name) { setError('Le nom du client est obligatoire.'); return; }
    if (items.length === 0) { setError('Ajoutez au moins un article.'); return; }
    const payload = {
      client_name: name,
      client_contact: clientContact.trim(),
      pickup_date: pickupDate.trim(),
      pickup_time: pickupTime.trim() || null,
      status,
      price_total: priceTotal.trim() ? parseFloat(priceTotal.replace(',', '.')) : null,
      deposit_paid: depositPaid.trim() ? parseFloat(depositPaid.replace(',', '.')) : null,
      notes: notes.trim(),
      items: items.map(it => ({
        recipe_id: it.recipe_id,
        quantity: parseFloat(it.quantity.replace(',', '.')) || 0,
        mode: it.mode,
      })),
    };
    if (payload.items.some(it => it.quantity <= 0)) {
      setError('Chaque article doit avoir une quantité supérieure à 0.');
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit
        ? await api(`/pro-orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/pro-orders', { method: 'POST', body: JSON.stringify(payload) });
      router.replace(`/pro-orders/${saved.id}` as any);
    } catch (e: any) {
      if (isPlanLimitError(e)) router.push('/pro?feature=pro_orders' as any);
      else setError(e.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState icon="wifi-off" title="Chargement impossible" subtitle={loadError} ctaLabel="Réessayer" onCta={loadForm} testID="order-load-retry" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="order-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEdit ? 'Modifier la commande' : 'Nouvelle commande'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>CLIENT</Text>
          <TextInput
            testID="order-client-name" value={clientName} onChangeText={setClientName}
            placeholder="Nom du client" placeholderTextColor={colors.muted} style={styles.input}
          />
          <TextInput
            testID="order-client-contact" value={clientContact} onChangeText={setClientContact}
            placeholder="Téléphone ou e-mail" placeholderTextColor={colors.muted}
            style={[styles.input, { marginTop: 14 }]}
          />

          <View style={[styles.row, { marginTop: 26 }]}>
            <View style={{ flex: 1.4 }}>
              <Text style={styles.label}>DATE DE RETRAIT</Text>
              <TextInput
                testID="order-date" value={pickupDate} onChangeText={setPickupDate}
                placeholder="AAAA-MM-JJ" placeholderTextColor={colors.muted} style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>HEURE</Text>
              <TextInput
                testID="order-time" value={pickupTime} onChangeText={setPickupTime}
                placeholder="09:00" placeholderTextColor={colors.muted} style={styles.input}
              />
            </View>
          </View>

          {isEdit && (
            <>
              <Text style={[styles.label, { marginTop: 26 }]}>STATUT</Text>
              <Pressable testID="order-status-open" onPress={() => setStatusSheetOpen(true)} style={styles.statusPicker}>
                <Text style={styles.statusPickerText}>{STATUS_LABELS[status]}</Text>
                <Feather name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
            </>
          )}

          <Text style={[styles.label, { marginTop: 26 }]}>ARTICLES</Text>
          {items.length === 0 && (
            <Text style={styles.emptyLines}>Aucun article. Ajoutez-en un ci-dessous.</Text>
          )}

          {items.map(it => {
            const r = recipeById(it.recipe_id);
            const canUsePieces = !!(r?.yield_pieces && r.yield_pieces > 0);
            return (
              <View key={it.key} style={styles.lineCard} testID={`item-${it.recipe_id}`}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineTitle} numberOfLines={1}>{r?.title || 'Recette'}</Text>
                  <Pressable
                    testID={`remove-${it.recipe_id}`}
                    onPress={() => removeItem(it.key)}
                    style={styles.removeBtn}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Retirer ${r?.title || 'cet article'}`}
                  >
                    <Feather name="x" size={18} color={colors.muted} />
                  </Pressable>
                </View>

                <View style={styles.lineControls}>
                  <TextInput
                    testID={`qty-${it.recipe_id}`}
                    value={it.quantity}
                    onChangeText={v => updateItem(it.key, { quantity: v })}
                    keyboardType="numeric"
                    style={styles.qtyInput}
                  />
                  <View style={styles.modeSwitch}>
                    <Pressable
                      testID={`mode-pieces-${it.recipe_id}`}
                      onPress={() => canUsePieces && updateItem(it.key, { mode: 'pieces' })}
                      style={[styles.modeBtn, it.mode === 'pieces' && styles.modeBtnOn, !canUsePieces && { opacity: 0.35 }]}
                    >
                      <Text style={[styles.modeText, it.mode === 'pieces' && styles.modeTextOn]}>pièces</Text>
                    </Pressable>
                    <Pressable
                      testID={`mode-batches-${it.recipe_id}`}
                      onPress={() => updateItem(it.key, { mode: 'batches' })}
                      style={[styles.modeBtn, it.mode === 'batches' && styles.modeBtnOn]}
                    >
                      <Text style={[styles.modeText, it.mode === 'batches' && styles.modeTextOn]}>fournées</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}

          <Pressable testID="add-recipe" onPress={() => setPicking(v => !v)} style={styles.addBtn}>
            <Feather name={picking ? 'x' : 'plus'} size={16} color={colors.brand} />
            <Text style={styles.addBtnText}>{picking ? 'Fermer' : 'Ajouter un article'}</Text>
          </Pressable>

          {picking && (
            <View style={styles.picker}>
              {recipes.map(r => (
                <Pressable key={r.id} testID={`pick-${r.id}`} onPress={() => addRecipe(r)} style={styles.pickRow}>
                  <Text style={styles.pickTitle} numberOfLines={1}>{r.title}</Text>
                  <Feather name="plus-circle" size={18} color={colors.brand} />
                </Pressable>
              ))}
            </View>
          )}

          <View style={[styles.row, { marginTop: 26 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>PRIX TOTAL (€)</Text>
              <TextInput
                testID="order-price" value={priceTotal} onChangeText={setPriceTotal}
                keyboardType="numeric" placeholder="—" placeholderTextColor={colors.muted} style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>ACOMPTE (€)</Text>
              <TextInput
                testID="order-deposit" value={depositPaid} onChangeText={setDepositPaid}
                keyboardType="numeric" placeholder="—" placeholderTextColor={colors.muted} style={styles.input}
              />
            </View>
          </View>

          <Text style={[styles.label, { marginTop: 26 }]}>NOTES</Text>
          <TextInput
            testID="order-notes" value={notes} onChangeText={setNotes} multiline
            placeholder="Instructions spéciales…" placeholderTextColor={colors.muted}
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          />

          {error && <Text style={styles.error} testID="order-error">{error}</Text>}

          <Button
            testID="order-save"
            onPress={save}
            disabled={saving}
            loading={saving}
            icon="check"
            label={isEdit ? 'Enregistrer' : 'Créer la commande'}
            style={{ marginTop: 26 }}
          />

          {isEdit && (
            <Pressable testID="order-delete" onPress={confirmDelete} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel="Supprimer cette commande">
              <Text style={styles.deleteText}>Supprimer cette commande</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet visible={statusSheetOpen} title="Statut de la commande" options={statusOptions} onClose={() => setStatusSheetOpen(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 14 },
  label: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 6 },
  input: { fontSize: 16, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 9 },
  statusPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  statusPickerText: { fontSize: 15, color: colors.onSurface, fontWeight: '600' },
  emptyLines: { fontSize: 13, color: colors.muted, fontStyle: 'italic', marginBottom: 4 },
  lineCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 14, marginBottom: 10,
    ...cardElevation(mode, colors),
  },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineTitle: { flex: 1, fontFamily: theme.serif, fontSize: 17, color: colors.onSurface },
  removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  qtyInput: { width: 78, fontSize: 20, fontFamily: theme.serif, color: colors.onSurface, backgroundColor: colors.surface, borderRadius: theme.radius.md, paddingVertical: 10, paddingHorizontal: 12, textAlign: 'center' },
  modeSwitch: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: theme.radius.md, padding: 3 },
  modeBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.md },
  modeBtnOn: { backgroundColor: colors.brand },
  modeText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  modeTextOn: { color: colors.onBrandPrimary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: theme.radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, marginTop: 4 },
  addBtnText: { fontSize: 14, color: colors.brand, fontWeight: '600' },
  picker: { marginTop: 10, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickTitle: { flex: 1, fontSize: 15, color: colors.onSurface },
  error: { color: colors.error, fontSize: 13, marginTop: 16, lineHeight: 18 },
  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 6 },
  deleteText: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
