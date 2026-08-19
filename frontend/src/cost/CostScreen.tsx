import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api';
import { scaleIngredientLine } from '@/src/ingredientScale';
import { QuantitySelector } from '@/src/QuantitySelector';
import { confirmAsync } from '@/src/confirm';
import { theme } from '@/src/theme';
import {
  computeRecipeCost, computeSaleMetrics, formatCurrency, formatCurrencyPrecise, formatPercent,
  normalizeName, type RawMaterial, type SaleMetrics, type RecipeCostResult,
} from '@/src/cost/costCalc';

type CostLineItem = { id: string; label: string; costText: string };
const newItem = (): CostLineItem => ({ id: String(Math.random()), label: '', costText: '' });

const VAT_PRESETS = ['5,5', '10', '20'];

type Snapshot = { result: RecipeCostResult; sale: SaleMetrics };

export function CostScreen({ recipeId }: { recipeId?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<any>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [segment, setSegment] = useState<'calcul' | 'historique'>('calcul');
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Recette liée : le multiplicateur de quantité du sélecteur déjà présent sur
  // la fiche recette (§12 de la demande précédente — "le multiplicateur doit
  // être partagé avec le calculateur de coût").
  const [quantity, setQuantity] = useState(1);

  // Hors recette : saisie libre, même convention que le formulaire de partage
  // (une ligne par ingrédient).
  const [manualText, setManualText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [allRecipes, setAllRecipes] = useState<any[]>([]);

  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({});
  const [pieces, setPieces] = useState('');
  const piecesTouched = useRef(false);
  const [packaging, setPackaging] = useState<CostLineItem[]>([]);
  const [otherCosts, setOtherCosts] = useState<CostLineItem[]>([]);
  const [salePriceHt, setSalePriceHt] = useState('');
  const [vatRate, setVatRate] = useState('');

  const [comparing, setComparing] = useState(false);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mats, r] = await Promise.all([
        api('/raw-materials'),
        recipeId ? api(`/recipes/${recipeId}`) : Promise.resolve(null),
      ]);
      setMaterials(mats);
      setRecipe(r);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [recipeId]);

  // useFocusEffect, pas useEffect : revenir de "Ajouter le prix" ou de la
  // gestion des matières premières doit rafraîchir les prix affichés — un
  // simple useEffect ne se redéclenche pas au retour sur un écran déjà monté.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { setQuantity(1); piecesTouched.current = false; }, [recipeId]);

  useEffect(() => {
    if (!piecesTouched.current) {
      setPieces(recipe?.yield_pieces ? String(Math.round(recipe.yield_pieces * quantity * 100) / 100) : '');
    }
  }, [recipe, quantity]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const q = recipeId ? `?recipe_id=${recipeId}` : '';
      setHistory(await api(`/cost/history${q}`));
    } catch (e) { console.warn(e); }
    finally { setHistoryLoading(false); }
  }, [recipeId]);

  useEffect(() => { if (segment === 'historique') loadHistory(); }, [segment, loadHistory]);

  const openPicker = async () => {
    setShowPicker(true);
    if (allRecipes.length === 0) {
      try { setAllRecipes(await api('/recipes')); } catch (e) { console.warn(e); }
    }
  };

  const ingredientLines: string[] = useMemo(() => {
    if (recipe) return (recipe.ingredients as string[]).map(l => scaleIngredientLine(l, quantity));
    return manualText.split('\n').map(s => s.trim()).filter(Boolean);
  }, [recipe, quantity, manualText]);

  const overridesNum: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, text] of Object.entries(priceOverrides)) {
      const n = parseFloat((text || '').replace(',', '.'));
      if (Number.isFinite(n)) out[key] = n;
    }
    return out;
  }, [priceOverrides]);

  const packagingNum = useMemo(
    () => packaging.map(p => ({ label: p.label || 'Emballage', cost: parseFloat((p.costText || '0').replace(',', '.')) || 0 })),
    [packaging],
  );
  const otherCostsNum = useMemo(
    () => otherCosts.map(o => ({ label: o.label || 'Autre coût', cost: parseFloat((o.costText || '0').replace(',', '.')) || 0 })),
    [otherCosts],
  );
  const piecesNum = useMemo(() => {
    const n = parseFloat(pieces.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [pieces]);
  const salePriceHtNum = useMemo(() => {
    const n = parseFloat(salePriceHt.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }, [salePriceHt]);
  const vatRateNum = useMemo(() => {
    const n = parseFloat(vatRate.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }, [vatRate]);

  const result = useMemo(
    () => computeRecipeCost(ingredientLines, materials, packagingNum, otherCostsNum, piecesNum, overridesNum),
    [ingredientLines, materials, packagingNum, otherCostsNum, piecesNum, overridesNum],
  );
  const sale = useMemo(
    () => computeSaleMetrics(result.costPerPiece, piecesNum, salePriceHtNum, vatRateNum),
    [result.costPerPiece, piecesNum, salePriceHtNum, vatRateNum],
  );

  const toggleCompare = () => {
    if (comparing) { setComparing(false); setBaseline(null); }
    else { setBaseline({ result, sale }); setComparing(true); }
  };

  const saveCalculation = async () => {
    setSaving(true);
    try {
      await api('/cost/history', {
        method: 'POST',
        body: JSON.stringify({
          recipe_id: recipeId || null,
          recipe_title: recipe?.title || 'Calcul libre',
          ingredients: ingredientLines,
          pieces: piecesNum,
          packaging: packagingNum,
          other_costs: otherCostsNum,
          price_overrides: overridesNum,
          sale_price_ht: salePriceHtNum,
          vat_rate: vatRateNum,
        }),
      });
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2200);
      if (segment === 'historique') loadHistory();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const deleteHistoryEntry = async (entryId: string) => {
    const ok = await confirmAsync('Supprimer ce calcul ?', 'Cette entrée de l\'historique sera définitivement supprimée.', 'Supprimer', true);
    if (!ok) return;
    await api(`/cost/history/${entryId}`, { method: 'DELETE' });
    setHistory(prev => prev.filter(h => h.id !== entryId));
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="cost-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{recipe ? recipe.title : 'Coût de revient'}</Text>
        <Pressable testID="cost-materials-link" onPress={() => router.push('/cost/materials')} style={styles.iconBtn}>
          <Feather name="shopping-bag" size={20} color={theme.color.onSurface} />
        </Pressable>
      </View>

      <View style={styles.segment}>
        {([['calcul', 'Calcul'], ['historique', 'Historique']] as const).map(([key, label]) => (
          <Pressable key={key} testID={`cost-segment-${key}`} onPress={() => setSegment(key)} style={[styles.segBtn, segment === key && styles.segBtnOn]}>
            <Text style={[styles.segText, segment === key && styles.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {segment === 'historique' ? (
          <ScrollView contentContainerStyle={styles.body}>
            {historyLoading ? <ActivityIndicator color={theme.color.brand} style={{ marginTop: 30 }} /> : history.length === 0 ? (
              <Text style={styles.emptyText}>Aucun calcul enregistré pour l&apos;instant.</Text>
            ) : history.map(h => (
              <View key={h.id} testID={`history-${h.id}`} style={styles.historyCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTitle}>{h.recipe_title}</Text>
                  <Text style={styles.historyMeta}>
                    {new Date(h.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {h.result.pieces ? ` · ${h.result.pieces} pièces` : ''}
                  </Text>
                  <Text style={styles.historyCost}>
                    Coût total : {formatCurrency(h.result.total_cost)} · /pièce : {formatCurrencyPrecise(h.result.cost_per_piece)}
                  </Text>
                  {h.sale.sale_price_ht != null && (
                    <Text style={styles.historyMeta}>
                      Vente : {formatCurrency(h.sale.sale_price_ht)} · Marge : {formatCurrencyPrecise(h.sale.margin_per_piece)}/pièce
                    </Text>
                  )}
                </View>
                <Pressable testID={`history-delete-${h.id}`} onPress={() => deleteHistoryEntry(h.id)} hitSlop={10}>
                  <Feather name="trash-2" size={16} color={theme.color.muted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!recipe && (
            <View style={styles.card}>
              <Pressable testID="cost-load-recipe" onPress={openPicker} style={styles.loadRecipeBtn}>
                <Feather name="book-open" size={16} color={theme.color.brand} />
                <Text style={styles.loadRecipeText}>Charger une recette</Text>
              </Pressable>
              {showPicker && (
                <View style={{ marginTop: 12 }}>
                  <TextInput
                    testID="cost-picker-search"
                    value={pickerQuery}
                    onChangeText={setPickerQuery}
                    placeholder="Rechercher une recette…"
                    placeholderTextColor={theme.color.muted}
                    style={styles.input}
                  />
                  <ScrollView style={{ maxHeight: 220, marginTop: 8 }}>
                    {allRecipes
                      .filter(r => r.title.toLowerCase().includes(pickerQuery.toLowerCase()))
                      .slice(0, 30)
                      .map(r => (
                        <Pressable key={r.id} testID={`cost-picker-${r.id}`} onPress={() => router.replace(`/cost/${r.id}`)} style={styles.pickerRow}>
                          <Text style={styles.pickerRowText}>{r.title}</Text>
                        </Pressable>
                      ))}
                  </ScrollView>
                </View>
              )}
              <Text style={styles.orText}>ou saisissez vos ingrédients ci-dessous</Text>
              <TextInput
                testID="cost-manual-ingredients"
                value={manualText}
                onChangeText={setManualText}
                placeholder={"500 g de farine T65\n2 œufs\n..."}
                placeholderTextColor={theme.color.muted}
                style={[styles.input, { minHeight: 90, marginTop: 8 }]}
                multiline
              />
            </View>
          )}

          {recipe && (
            <QuantitySelector testID="cost-quantity-selector" value={quantity} onChange={setQuantity} />
          )}

          {/* ---------- Ingrédients ---------- */}
          <SectionTitle icon="list" label="Ingrédients" />
          <View style={styles.card}>
            {result.items.length === 0 ? (
              <Text style={styles.emptyText}>Aucun ingrédient à chiffrer pour l&apos;instant.</Text>
            ) : result.items.map((item, i) => {
              const key = item.name ? normalizeName(item.name) : `_${i}`;
              return (
                <View key={i} testID={`cost-ing-${i}`} style={styles.ingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ingRaw} numberOfLines={2}>{item.raw}</Text>
                    {item.status === 'unparsed' && (
                      <Text style={styles.ingNote}>Quantité non reconnue — non inclus dans le total</Text>
                    )}
                    {item.status === 'price_missing' && (
                      <View style={styles.missingRow}>
                        <Feather name="alert-triangle" size={12} color={theme.color.warning} />
                        <Text style={styles.missingText}>Prix manquant</Text>
                        <Pressable
                          testID={`cost-add-price-${i}`}
                          onPress={() => router.push({ pathname: '/cost/material-form', params: { prefillName: item.name } })}
                        >
                          <Text style={styles.addPriceLink}>Ajouter le prix</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                  {item.status !== 'unparsed' && (
                    <View style={styles.ingRight}>
                      <TextInput
                        testID={`cost-ing-price-${i}`}
                        value={priceOverrides[key] ?? (item.status === 'ok' ? String(item.unitPrice).replace('.', ',') : '')}
                        onChangeText={(v) => setPriceOverrides(prev => ({ ...prev, [key]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="prix"
                        placeholderTextColor={theme.color.muted}
                        style={styles.ingPriceInput}
                      />
                      <Text style={styles.ingCost}>{item.status === 'ok' ? formatCurrencyPrecise(item.cost) : '—'}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* ---------- Emballage ---------- */}
          <SectionTitle icon="package" label="Emballage" />
          <CostItemList items={packaging} setItems={setPackaging} testPrefix="pack" placeholder="Sachet" />

          {/* ---------- Autres coûts ---------- */}
          <SectionTitle icon="plus-circle" label="Autres coûts directs" />
          <CostItemList items={otherCosts} setItems={setOtherCosts} testPrefix="other" placeholder="Décoration" />

          {/* ---------- Coût de revient ---------- */}
          <View style={styles.totalCard}>
            <Row label="Matières premières" value={formatCurrency(result.rawMaterialsCost)} />
            <Row label="Emballage" value={formatCurrency(result.packagingCost)} />
            <Row label="Autres coûts" value={formatCurrency(result.otherCost)} />
            <View style={styles.divider} />
            <Row label="COÛT DE REVIENT TOTAL" value={formatCurrency(result.totalCost)} big />
            {result.hasMissingPrices && (
              <Text style={styles.missingBanner}>
                ⚠️ {result.missingCount} ingrédient{result.missingCount > 1 ? 's' : ''} sans prix — le total ne peut pas être calculé.
              </Text>
            )}
          </View>

          {/* ---------- Pièces & coût / pièce ---------- */}
          <SectionTitle icon="hash" label="Production" />
          <View style={styles.card}>
            <Field label="Nombre de pièces">
              <TextInput
                testID="cost-pieces"
                value={pieces}
                onChangeText={(v) => { piecesTouched.current = true; setPieces(v); }}
                keyboardType="decimal-pad"
                placeholder="100"
                placeholderTextColor={theme.color.muted}
                style={styles.input}
              />
            </Field>
            <View style={styles.bigResultRow}>
              <Text style={styles.bigResultLabel}>COÛT / PIÈCE</Text>
              <Text style={styles.bigResultValue}>{formatCurrencyPrecise(result.costPerPiece)}</Text>
            </View>
          </View>

          {/* ---------- Prix de vente ---------- */}
          <SectionTitle icon="tag" label="Prix de vente" />
          <View style={styles.card}>
            <Field label="Prix de vente HT / pièce">
              <TextInput testID="cost-sale-price" value={salePriceHt} onChangeText={setSalePriceHt} keyboardType="decimal-pad" placeholder="1,30" placeholderTextColor={theme.color.muted} style={styles.input} />
            </Field>
            <Text style={styles.label}>TVA</Text>
            <View style={styles.unitRow}>
              <Pressable testID="cost-vat-none" onPress={() => setVatRate('')} style={[styles.vatChip, vatRate === '' && styles.vatChipActive]}>
                <Text style={[styles.vatChipText, vatRate === '' && styles.vatChipTextActive]}>Non définie</Text>
              </Pressable>
              {VAT_PRESETS.map(v => (
                <Pressable key={v} testID={`cost-vat-${v}`} onPress={() => setVatRate(v)} style={[styles.vatChip, vatRate === v && styles.vatChipActive]}>
                  <Text style={[styles.vatChipText, vatRate === v && styles.vatChipTextActive]}>{v} %</Text>
                </Pressable>
              ))}
              <TextInput
                testID="cost-vat-custom"
                value={VAT_PRESETS.includes(vatRate) ? '' : vatRate}
                onChangeText={setVatRate}
                keyboardType="decimal-pad"
                placeholder="autre %"
                placeholderTextColor={theme.color.muted}
                style={[styles.input, { flex: 1, minWidth: 90 }]}
              />
            </View>

            <View style={styles.dividerLight} />
            <Row light label="Prix HT" value={formatCurrency(sale.salePriceHt)} />
            <Row light label="TVA" value={vatRateNum != null ? formatPercent(vatRateNum) : 'Non définie'} />
            <Row light label="Prix TTC" value={formatCurrency(sale.salePriceTtc)} />
          </View>

          {/* ---------- Résultats ---------- */}
          <SectionTitle icon="trending-up" label="Résultat" />
          <View style={styles.totalCard}>
            <Row label="Chiffre d'affaires potentiel" value={formatCurrency(sale.revenueHt)} />
            <View style={styles.divider} />
            <Row label="MARGE / PIÈCE" value={formatCurrencyPrecise(sale.marginPerPiece)} big />
            <Row label="Marge totale" value={formatCurrency(sale.marginTotal)} />
            <Row label="Taux de marge" value={formatPercent(sale.marginRatePct)} />
            <Row label="Taux de marque" value={formatPercent(sale.markupRatePct)} />
          </View>

          {/* ---------- Comparaison de scénario (secondaire) ---------- */}
          <Pressable testID="cost-compare-toggle" onPress={toggleCompare} style={styles.compareToggle}>
            <Feather name="columns" size={14} color={theme.color.brand} />
            <Text style={styles.compareToggleText}>{comparing ? 'Arrêter la comparaison' : 'Comparer un scénario'}</Text>
          </Pressable>
          {comparing && baseline && (
            <View style={styles.card} testID="cost-compare-card">
              <Text style={styles.compareHint}>
                Scénario de référence figé au moment de l&apos;activation. Modifiez les prix, la quantité ou le prix de vente ci-dessus pour voir l&apos;écart.
              </Text>
              <CompareRow label="Coût total" before={formatCurrency(baseline.result.totalCost)} after={formatCurrency(result.totalCost)} />
              <CompareRow label="Coût / pièce" before={formatCurrencyPrecise(baseline.result.costPerPiece)} after={formatCurrencyPrecise(result.costPerPiece)} />
              <CompareRow label="Marge / pièce" before={formatCurrencyPrecise(baseline.sale.marginPerPiece)} after={formatCurrencyPrecise(sale.marginPerPiece)} />
              <CompareRow label="Taux de marge" before={formatPercent(baseline.sale.marginRatePct)} after={formatPercent(sale.marginRatePct)} />
              <CompareRow label="Taux de marque" before={formatPercent(baseline.sale.markupRatePct)} after={formatPercent(sale.markupRatePct)} />
            </View>
          )}

          <Pressable testID="cost-save" onPress={saveCalculation} disabled={saving || result.items.length === 0} style={[styles.saveBtn, (saving || result.items.length === 0) && { opacity: 0.5 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={styles.saveBtnText}>{saveFlash ? 'Calcul enregistré ✓' : 'Enregistrer ce calcul'}</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionTitle({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Feather name={icon} size={14} color={theme.color.muted} />
      <Text style={styles.sectionTitle}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, big, light }: { label: string; value: string; big?: boolean; light?: boolean }) {
  return (
    <View style={styles.resultRow}>
      <Text style={[light ? styles.resultLabelLight : styles.resultLabel, big && styles.resultLabelBig]}>{label}</Text>
      <Text style={[light ? styles.resultValueLight : styles.resultValue, big && styles.resultValueBig]}>{value}</Text>
    </View>
  );
}

function CompareRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.compareBefore}>{before}</Text>
      <Feather name="arrow-right" size={12} color={theme.color.muted} />
      <Text style={styles.compareAfter}>{after}</Text>
    </View>
  );
}

function CostItemList({ items, setItems, testPrefix, placeholder }: {
  items: CostLineItem[];
  setItems: (fn: (prev: CostLineItem[]) => CostLineItem[]) => void;
  testPrefix: string;
  placeholder: string;
}) {
  return (
    <View style={styles.card}>
      {items.map((item, i) => (
        <View key={item.id} style={styles.itemRow}>
          <TextInput
            testID={`${testPrefix}-label-${i}`}
            value={item.label}
            onChangeText={(v) => setItems(prev => prev.map(p => p.id === item.id ? { ...p, label: v } : p))}
            placeholder={placeholder}
            placeholderTextColor={theme.color.muted}
            style={[styles.input, { flex: 1 }]}
          />
          <TextInput
            testID={`${testPrefix}-cost-${i}`}
            value={item.costText}
            onChangeText={(v) => setItems(prev => prev.map(p => p.id === item.id ? { ...p, costText: v } : p))}
            keyboardType="decimal-pad"
            placeholder="0,00"
            placeholderTextColor={theme.color.muted}
            style={[styles.input, { width: 80, textAlign: 'right' }]}
          />
          <Pressable testID={`${testPrefix}-remove-${i}`} onPress={() => setItems(prev => prev.filter(p => p.id !== item.id))} hitSlop={10}>
            <Feather name="x" size={16} color={theme.color.muted} />
          </Pressable>
        </View>
      ))}
      <Pressable testID={`${testPrefix}-add`} onPress={() => setItems(prev => [...prev, newItem()])} style={styles.addItemBtn}>
        <Feather name="plus" size={14} color={theme.color.brand} />
        <Text style={styles.addItemText}>Ajouter</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginHorizontal: 8 },
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 12 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary },
  segBtnOn: { backgroundColor: theme.color.brand },
  segText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  segTextOn: { color: '#fff' },
  body: { padding: 24, paddingBottom: 60 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginBottom: 8 },
  sectionTitle: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  label: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, marginBottom: 6, fontWeight: '600' },
  input: { fontSize: 15, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, paddingVertical: 8 },
  emptyText: { fontSize: 13, color: theme.color.muted, fontStyle: 'italic' },
  loadRecipeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brandTertiary, paddingVertical: 12, borderRadius: 8 },
  loadRecipeText: { color: theme.color.onBrandTertiary, fontSize: 14, fontWeight: '600' },
  orText: { fontSize: 12, color: theme.color.muted, marginTop: 16, textAlign: 'center' },
  pickerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  pickerRowText: { fontSize: 14, color: theme.color.onSurface },
  ingRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 10 },
  ingRaw: { fontSize: 14, color: theme.color.onSurface },
  ingNote: { fontSize: 11, color: theme.color.muted, marginTop: 2, fontStyle: 'italic' },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  missingText: { fontSize: 12, color: theme.color.warning, fontWeight: '600' },
  addPriceLink: { fontSize: 12, color: theme.color.brand, fontWeight: '600', textDecorationLine: 'underline' },
  ingRight: { alignItems: 'flex-end', gap: 4 },
  ingPriceInput: { width: 64, fontSize: 13, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, textAlign: 'right', paddingVertical: 2 },
  ingCost: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addItemText: { fontSize: 13, color: theme.color.brand, fontWeight: '600' },
  totalCard: { backgroundColor: theme.color.surfaceInverse, borderRadius: 8, padding: 20, marginTop: 8 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 10 },
  dividerLight: { height: 1, backgroundColor: theme.color.borderStrong, marginVertical: 10 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  resultLabel: { fontSize: 13, color: 'rgba(250,248,245,0.75)' },
  resultLabelLight: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  resultLabelBig: { fontSize: 13, letterSpacing: 1, color: theme.color.onSurfaceInverse, fontWeight: '700' },
  resultValue: { fontSize: 15, color: theme.color.onSurfaceInverse, fontFamily: theme.serif },
  resultValueLight: { fontSize: 15, color: theme.color.onSurface, fontFamily: theme.serif },
  resultValueBig: { fontSize: 26, color: theme.color.brandSecondary },
  missingBanner: { fontSize: 12, color: theme.color.warning, marginTop: 10, lineHeight: 17 },
  bigResultRow: { alignItems: 'center', marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.color.border },
  bigResultLabel: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  bigResultValue: { fontFamily: theme.serif, fontSize: 34, color: theme.color.brand, marginTop: 4 },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  vatChip: { paddingHorizontal: 14, height: 34, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  vatChipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  vatChipText: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  vatChipTextActive: { color: theme.color.onSurfaceInverse },
  compareToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 10 },
  compareToggleText: { fontSize: 13, color: theme.color.brand, fontWeight: '600' },
  compareHint: { fontSize: 12, color: theme.color.muted, marginBottom: 10, lineHeight: 17 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  compareLabel: { flex: 1, fontSize: 12, color: theme.color.onSurfaceSecondary },
  compareBefore: { fontSize: 12, color: theme.color.muted },
  compareAfter: { fontSize: 12, color: theme.color.onSurface, fontWeight: '700' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brand, paddingVertical: 15, borderRadius: 8, marginTop: 28 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  historyCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 12 },
  historyTitle: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
  historyMeta: { fontSize: 12, color: theme.color.muted, marginTop: 3 },
  historyCost: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 6, fontWeight: '600' },
});
