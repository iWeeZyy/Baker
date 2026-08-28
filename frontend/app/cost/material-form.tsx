import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const UNITS: { key: string; label: string }[] = [
  { key: 'kg', label: 'kg' },
  { key: 'g', label: 'g' },
  { key: 'l', label: 'L' },
  { key: 'ml', label: 'ml' },
  { key: 'cl', label: 'cl' },
  { key: 'piece', label: 'pièce' },
];

/** Ajouter ou modifier une matière première : le prix au kg/L/pièce se déduit, jamais saisi directement. */
export default function MaterialForm() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );

  const router = useRouter();
  const { id, prefillName } = useLocalSearchParams<{ id?: string; prefillName?: string }>();
  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(prefillName || '');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseQuantity, setPurchaseQuantity] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('kg');

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const all = await api('/raw-materials');
        const m = all.find((x: any) => x.id === id);
        if (m) {
          setName(m.name);
          setCategory(m.category || '');
          setSupplier(m.supplier || '');
          setPurchasePrice(String(m.purchase_price).replace('.', ','));
          setPurchaseQuantity(String(m.purchase_quantity).replace('.', ','));
          setPurchaseUnit(m.purchase_unit);
        }
      } finally { setLoading(false); }
    })();
  }, [id, isEdit]);

  const preview = useMemo(() => {
    const price = parseFloat(purchasePrice.replace(',', '.'));
    const qty = parseFloat(purchaseQuantity.replace(',', '.'));
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return null;
    const toKgOrL: Record<string, number> = { kg: 1, g: 0.001, l: 1, ml: 0.001, cl: 0.01, piece: 1 };
    const perBase = price / (qty * toKgOrL[purchaseUnit]);
    const label = purchaseUnit === 'piece' ? '/pièce' : (purchaseUnit === 'kg' || purchaseUnit === 'g') ? '/kg' : '/L';
    return `${perBase.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €${label}`;
  }, [purchasePrice, purchaseQuantity, purchaseUnit]);

  const save = async () => {
    setError(null);
    const price = parseFloat(purchasePrice.replace(',', '.'));
    const qty = parseFloat(purchaseQuantity.replace(',', '.'));
    if (!name.trim()) return setError('Le nom est obligatoire.');
    if (!Number.isFinite(price) || price < 0) return setError('Le prix doit être un nombre positif.');
    if (!Number.isFinite(qty) || qty <= 0) return setError('La quantité achetée doit être supérieure à 0.');

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        category: category.trim() || null,
        supplier: supplier.trim() || null,
        purchase_price: price,
        purchase_quantity: qty,
        purchase_unit: purchaseUnit,
      };
      if (isEdit) {
        await api(`/raw-materials/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/raw-materials', { method: 'POST', body: JSON.stringify(body) });
      }
      router.back();
    } catch (e: any) {
      setError(e.message || "Impossible d'enregistrer cette matière première.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="material-form-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? 'Modifier le prix' : 'Nouvelle matière première'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Field label="Nom">
            <TextInput testID="material-name" value={name} onChangeText={setName} placeholder="Farine T65" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>
          <Field label="Catégorie (optionnel)">
            <TextInput testID="material-category" value={category} onChangeText={setCategory} placeholder="Farines" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>
          <Field label="Fournisseur (optionnel)">
            <TextInput testID="material-supplier" value={supplier} onChangeText={setSupplier} placeholder="Moulin local" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>

          <Text style={styles.sectionLabel}>ACHAT</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Quantité achetée">
                <TextInput testID="material-quantity" value={purchaseQuantity} onChangeText={setPurchaseQuantity} keyboardType="decimal-pad" placeholder="25" placeholderTextColor={colors.muted} style={styles.input} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Prix payé (€)">
                <TextInput testID="material-price" value={purchasePrice} onChangeText={setPurchasePrice} keyboardType="decimal-pad" placeholder="21,25" placeholderTextColor={colors.muted} style={styles.input} />
              </Field>
            </View>
          </View>

          <Text style={styles.sectionLabel}>UNITÉ D&apos;ACHAT</Text>
          <View style={styles.unitRow}>
            {UNITS.map(u => (
              <Pressable
                key={u.key}
                testID={`material-unit-${u.key}`}
                onPress={() => setPurchaseUnit(u.key)}
                style={[styles.unitChip, purchaseUnit === u.key && styles.unitChipActive]}
              >
                <Text style={[styles.unitChipText, purchaseUnit === u.key && styles.unitChipTextActive]}>{u.label}</Text>
              </Pressable>
            ))}
          </View>

          {preview && (
            <View style={styles.previewCard}>
              <Text style={styles.previewLabel}>Prix unitaire calculé</Text>
              <Text testID="material-preview" style={styles.previewValue}>{preview}</Text>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable testID="material-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  field: { marginBottom: 18 },
  label: { fontSize: 11, letterSpacing: 2, color: colors.muted, marginBottom: 6, fontWeight: '600' },
  input: { fontSize: 16, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 16 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginTop: 8, marginBottom: 12 },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  unitChip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  unitChipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  unitChipText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500' },
  unitChipTextActive: { color: colors.onSurfaceInverse },
  previewCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 20 },
  previewLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600' },
  previewValue: { fontFamily: theme.serif, fontSize: 24, color: colors.brand, marginTop: 6 },
  error: { color: colors.error, fontSize: 13, marginBottom: 16 },
  saveBtn: { backgroundColor: colors.brand, paddingVertical: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '600' },
});
