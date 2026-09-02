/**
 * "Adapter la recette" : quantité, hydratation, pourcentages, substitution,
 * fermentation, ou une demande en langage naturel. Tout le calcul passe par
 * POST /recipes/{id}/adapt/preview (recipe_adapt.py côté serveur) — cet
 * écran ne fait jamais lui-même un calcul de grammage, juste l'affichage et
 * la construction de la requête. Rien n'est enregistré avant "Enregistrer
 * comme nouvelle recette" (qui préremplit /share, le formulaire de création
 * existant) ; "Annuler" ne fait littéralement rien côté serveur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api';
import {
  type AdaptationRequest, type AdaptationResult, type FermentationSuggestion,
  emptyAdaptationRequest, isAdaptationRequestEmpty,
} from '@/src/recipeAdaptTypes';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';

type ChangeRow = { icon: string; label: string };

export function AdaptScreen({ recipeId }: { recipeId: string }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<any>(null);
  const [original, setOriginal] = useState<AdaptationResult | null>(null);
  const [phase, setPhase] = useState<'edit' | 'result'>('edit');

  const [request, setRequest] = useState<AdaptationRequest>(emptyAdaptationRequest());
  const [preview, setPreview] = useState<AdaptationResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [piecesText, setPiecesText] = useState('');
  const [pieceWeightText, setPieceWeightText] = useState('');
  const [totalWeightText, setTotalWeightText] = useState('');
  const [hydrationText, setHydrationText] = useState('');
  const [flourPctTexts, setFlourPctTexts] = useState<Record<string, string>>({});
  const [ingredientPctTexts, setIngredientPctTexts] = useState<Record<string, string>>({});

  const [subFrom, setSubFrom] = useState<string | null>(null);
  const [subTo, setSubTo] = useState('');
  const [subQty, setSubQty] = useState('');

  const [fermentationText, setFermentationText] = useState('');
  const [fermentationSuggestion, setFermentationSuggestion] = useState<FermentationSuggestion | null>(null);
  const [fermentationAccepted, setFermentationAccepted] = useState(false);

  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [comparing, setComparing] = useState(false);

  const hasYield = !!recipe?.yield_pieces;
  const hasFlourBase = !!(original?.ingredients || []).some(i => i.parsed && i.is_flour);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api(`/recipes/${recipeId}`),
      api(`/recipes/${recipeId}/adapt/preview`, { method: 'POST', body: JSON.stringify({}) }),
    ])
      .then(([r, orig]) => {
        setRecipe(r);
        setOriginal(orig);
        setPreview(orig);
        if (r.yield_pieces) {
          setPiecesText(String(r.yield_pieces));
          if (orig.piece_weight_g != null) setPieceWeightText(String(orig.piece_weight_g));
        }
        if (orig.total_weight_g != null) setTotalWeightText(String(orig.total_weight_g));
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [recipeId]);

  useEffect(() => { load(); }, [load]);

  // Débounce court : le calcul lui-même est un aller-retour serveur léger
  // (pas d'IA, pas de DB) — largement assez "instantané" sans dupliquer un
  // moteur de calcul côté client (voir décision 7 du plan).
  useEffect(() => {
    if (!recipe) return;
    const t = setTimeout(() => {
      setPreviewLoading(true);
      api(`/recipes/${recipeId}/adapt/preview`, { method: 'POST', body: JSON.stringify(request) })
        .then(setPreview)
        .catch(() => setPreview({ ok: false, errors: ["Erreur de calcul, réessayez."], warnings: [] }))
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [request, recipe, recipeId]);

  const onPiecesChange = (v: string) => {
    setPiecesText(v);
    const pieces = parseFloat(v.replace(',', '.'));
    const pw = parseFloat(pieceWeightText.replace(',', '.'));
    if (pieces > 0 && pw > 0) {
      setTotalWeightText(String(Math.round(pieces * pw)));
      setRequest(prev => ({ ...prev, target_yield_pieces: pieces, target_piece_weight_g: pw, target_total_weight_g: null }));
    }
  };
  const onPieceWeightChange = (v: string) => {
    setPieceWeightText(v);
    const pieces = parseFloat(piecesText.replace(',', '.'));
    const pw = parseFloat(v.replace(',', '.'));
    if (pieces > 0 && pw > 0) {
      setTotalWeightText(String(Math.round(pieces * pw)));
      setRequest(prev => ({ ...prev, target_yield_pieces: pieces, target_piece_weight_g: pw, target_total_weight_g: null }));
    }
  };
  const onTotalWeightChange = (v: string) => {
    setTotalWeightText(v);
    const total = parseFloat(v.replace(',', '.'));
    if (!(total > 0)) return;
    if (hasYield) {
      const pieces = parseFloat(piecesText.replace(',', '.'));
      if (pieces > 0) {
        setPieceWeightText(String(Math.round((total / pieces) * 10) / 10));
        setRequest(prev => ({ ...prev, target_yield_pieces: pieces, target_piece_weight_g: total / pieces, target_total_weight_g: null }));
      }
    } else {
      setRequest(prev => ({ ...prev, target_total_weight_g: total, target_yield_pieces: null, target_piece_weight_g: null }));
    }
  };

  const onHydrationChange = (v: string) => {
    setHydrationText(v);
    const pct = parseFloat(v.replace(',', '.'));
    setRequest(prev => ({ ...prev, target_hydration_pct: Number.isFinite(pct) ? pct : null }));
  };

  const flourIngredients = useMemo(() => (original?.ingredients || []).filter(i => i.parsed && i.is_flour), [original]);
  const otherIngredients = useMemo(() => (original?.ingredients || []).filter(i => i.parsed && !i.is_flour && !i.is_water), [original]);

  const onFlourPctChange = (name: string, v: string) => {
    setFlourPctTexts(prev => ({ ...prev, [name]: v }));
    const pct = parseFloat(v.replace(',', '.'));
    setRequest(prev => {
      const next = { ...prev.flour_percentage_changes };
      if (Number.isFinite(pct)) next[name] = pct; else delete next[name];
      return { ...prev, flour_percentage_changes: next };
    });
  };
  const onIngredientPctChange = (name: string, v: string) => {
    setIngredientPctTexts(prev => ({ ...prev, [name]: v }));
    const pct = parseFloat(v.replace(',', '.'));
    setRequest(prev => {
      const next = { ...prev.ingredient_percentage_changes };
      if (Number.isFinite(pct)) next[name] = pct; else delete next[name];
      return { ...prev, ingredient_percentage_changes: next };
    });
  };

  const substitutableNames = useMemo(
    () => (original?.ingredients || [])
      .filter(i => i.parsed && !request.substitutions.some(s => s.from_name === i.name))
      .map(i => i.name as string),
    [original, request.substitutions],
  );

  const addSubstitution = () => {
    if (!subFrom || !subTo.trim()) return;
    const qty = parseFloat(subQty.replace(',', '.'));
    setRequest(prev => ({
      ...prev,
      substitutions: [...prev.substitutions, { from_name: subFrom, to_name: subTo.trim(), new_quantity: Number.isFinite(qty) ? qty : null }],
    }));
    setSubFrom(null); setSubTo(''); setSubQty('');
  };
  const removeSubstitution = (fromName: string) => {
    setRequest(prev => ({ ...prev, substitutions: prev.substitutions.filter(s => s.from_name !== fromName) }));
  };

  const askAI = async () => {
    if (!aiText.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const extracted = await api(`/recipes/${recipeId}/adapt/interpret`, {
        method: 'POST', body: JSON.stringify({ text: aiText.trim() }),
      });
      setRequest(prev => {
        const next = { ...prev };
        if (extracted.target_yield_pieces != null) next.target_yield_pieces = extracted.target_yield_pieces;
        if (extracted.target_piece_weight_g != null) next.target_piece_weight_g = extracted.target_piece_weight_g;
        if (extracted.target_total_weight_g != null) next.target_total_weight_g = extracted.target_total_weight_g;
        if (extracted.target_hydration_pct != null) next.target_hydration_pct = extracted.target_hydration_pct;
        if (extracted.flour_percentage_changes) {
          next.flour_percentage_changes = { ...next.flour_percentage_changes, ...extracted.flour_percentage_changes };
        }
        if (extracted.ingredient_percentage_changes) {
          next.ingredient_percentage_changes = { ...next.ingredient_percentage_changes, ...extracted.ingredient_percentage_changes };
        }
        if (Array.isArray(extracted.substitutions) && extracted.substitutions.length) {
          next.substitutions = [
            ...next.substitutions,
            ...extracted.substitutions.map((s: any) => ({ from_name: s.from_name, to_name: s.to_name, new_quantity: null })),
          ];
        }
        return next;
      });
      if (extracted.target_yield_pieces != null) setPiecesText(String(extracted.target_yield_pieces));
      if (extracted.target_piece_weight_g != null) setPieceWeightText(String(extracted.target_piece_weight_g));
      if (extracted.target_hydration_pct != null) setHydrationText(String(extracted.target_hydration_pct));
      if (extracted.fermentation?.mentioned) {
        setFermentationSuggestion(extracted.fermentation);
        setFermentationAccepted(false);
      }
      setAiText('');
    } catch (e: any) {
      setAiError(e.message || "L'interprétation a échoué.");
    } finally {
      setAiLoading(false);
    }
  };

  const changeRows: ChangeRow[] = useMemo(() => {
    const rows: ChangeRow[] = [];
    if (request.target_yield_pieces && request.target_piece_weight_g) {
      rows.push({ icon: '📦', label: `${recipe?.yield_pieces ?? '?'} → ${request.target_yield_pieces} pièces` });
      rows.push({ icon: '⚖️', label: `${original?.piece_weight_g ?? '?'} g → ${request.target_piece_weight_g} g / pièce` });
    } else if (request.target_total_weight_g) {
      rows.push({ icon: '⚖️', label: `Poids total : ${original?.total_weight_g ?? '?'} g → ${request.target_total_weight_g} g` });
    }
    if (request.target_hydration_pct != null) {
      rows.push({ icon: '💧', label: `Hydratation : ${original?.hydration ?? '?'}% → ${request.target_hydration_pct}%` });
    }
    Object.entries(request.flour_percentage_changes).forEach(([name, pct]) => {
      const before = original?.ingredients?.find(i => i.name === name)?.percentage;
      rows.push({ icon: '🌾', label: `${name} : ${before ?? '?'}% → ${pct}%` });
    });
    Object.entries(request.ingredient_percentage_changes).forEach(([name, pct]) => {
      const before = original?.ingredients?.find(i => i.name === name)?.percentage;
      rows.push({ icon: '🌾', label: `${name} : ${before ?? '?'}% → ${pct}%` });
    });
    request.substitutions.forEach(s => rows.push({ icon: '🔄', label: `${s.from_name} → ${s.to_name}` }));
    if (fermentationSuggestion?.mentioned) rows.push({ icon: '⏱️', label: 'Nouvelle proposition de fermentation' });
    return rows;
  }, [request, original, recipe, fermentationSuggestion]);

  const comparisonRows = useMemo(() => {
    if (!original || !preview?.ingredients) return [];
    const before = new Map((original.ingredients || []).filter(i => i.parsed).map(i => [i.name as string, i]));
    const after = new Map((preview.ingredients || []).filter(i => i.parsed).map(i => [i.name as string, i]));
    const names = Array.from(new Set([...before.keys(), ...after.keys()]));
    return names.map(name => ({
      name,
      before: before.get(name) ? `${before.get(name)!.quantity} ${before.get(name)!.unit}` : '—',
      after: after.get(name) ? `${after.get(name)!.quantity} ${after.get(name)!.unit}` : '—',
    }));
  }, [original, preview]);

  const saveAsNewRecipe = () => {
    if (!recipe || !preview?.ok) return;
    const mergedTechnical = fermentationAccepted && fermentationSuggestion?.suggested_technical
      ? {
        ...(recipe.technical || {}),
        ...Object.fromEntries(Object.entries(fermentationSuggestion.suggested_technical).filter(([, v]) => v != null)),
      }
      : recipe.technical;
    router.push({
      pathname: '/share',
      params: {
        prefillTitle: `${recipe.title} — version adaptée`,
        prefillDescription: recipe.description || '',
        prefillIngredients: (preview.ingredients || []).map(i => i.raw).join('\n'),
        prefillSteps: (recipe.steps || []).join('\n'),
        prefillCategory: recipe.category,
        prefillFamily: recipe.family || '',
        prefillDifficulty: recipe.difficulty,
        prefillTime: String(recipe.time_minutes || ''),
        prefillHydration: String(preview.hydration ?? ''),
        prefillYieldPieces: preview.yield_pieces ? String(preview.yield_pieces) : '',
        prefillAdaptedFromId: recipe.id,
        ...(mergedTechnical ? { prefillTechnical: JSON.stringify(mergedTechnical) } : {}),
      } as any,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          testID="adapt-back"
          onPress={() => (phase === 'result' ? setPhase('edit') : router.back())}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {phase === 'result' ? 'Résultat' : 'Adapter la recette'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {phase === 'edit' ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.originalCard}>
              <Text style={styles.originalTitle}>{recipe.title}</Text>
              <Text style={styles.originalMeta}>Recette originale :</Text>
              <Text style={styles.originalMeta}>
                {hasYield
                  ? `${recipe.yield_pieces} pièces × ${original?.piece_weight_g ?? '?'} g`
                  : `${original?.total_weight_g ?? '?'} g de pâte`}
              </Text>
              {hasFlourBase && <Text style={styles.originalMeta}>Hydratation : {original?.hydration}%</Text>}
            </View>

            <Section icon="📦" title="Quantité">
              {hasYield && (
                <Field label="Nombre de pièces">
                  <TextInput testID="adapt-pieces" value={piecesText} onChangeText={onPiecesChange} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={colors.muted} />
                </Field>
              )}
              {hasYield && (
                <Field label="Poids par pièce (g)">
                  <TextInput testID="adapt-piece-weight" value={pieceWeightText} onChangeText={onPieceWeightChange} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={colors.muted} />
                </Field>
              )}
              <Field label="Poids total de pâte (g)">
                <TextInput testID="adapt-total-weight" value={totalWeightText} onChangeText={onTotalWeightChange} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={colors.muted} />
              </Field>
            </Section>

            {hasFlourBase && (
              <Section icon="💧" title="Hydratation">
                <Text style={styles.hint}>Actuelle : {original?.hydration}%</Text>
                <Field label="Nouvelle hydratation (%)">
                  <TextInput testID="adapt-hydration" value={hydrationText} onChangeText={onHydrationChange} keyboardType="decimal-pad" placeholder={String(original?.hydration ?? '')} placeholderTextColor={colors.muted} style={styles.input} />
                </Field>
              </Section>
            )}

            {hasFlourBase && (flourIngredients.length > 1 || otherIngredients.length > 0) && (
              <Section icon="🌾" title="Pourcentages">
                {flourIngredients.length > 1 && flourIngredients.map(i => (
                  <Field key={i.name} label={`${i.name} (actuellement ${i.percentage}%)`}>
                    <TextInput
                      testID={`adapt-flour-pct-${i.name}`}
                      value={flourPctTexts[i.name as string] ?? ''}
                      onChangeText={v => onFlourPctChange(i.name as string, v)}
                      keyboardType="decimal-pad"
                      placeholder={String(i.percentage)}
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />
                  </Field>
                ))}
                {otherIngredients.map(i => (
                  <Field key={i.name} label={`${i.name} (actuellement ${i.percentage}%)`}>
                    <TextInput
                      testID={`adapt-ing-pct-${i.name}`}
                      value={ingredientPctTexts[i.name as string] ?? ''}
                      onChangeText={v => onIngredientPctChange(i.name as string, v)}
                      keyboardType="decimal-pad"
                      placeholder={String(i.percentage)}
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />
                  </Field>
                ))}
              </Section>
            )}

            <Section icon="🔄" title="Remplacer un ingrédient">
              {request.substitutions.map(s => (
                <View key={s.from_name} style={styles.subRow}>
                  <Text style={styles.subText}>{s.from_name} → {s.to_name}</Text>
                  <Pressable testID={`adapt-remove-sub-${s.from_name}`} onPress={() => removeSubstitution(s.from_name)} hitSlop={10}>
                    <Feather name="x" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
              {request.substitutions.length > 0 && (
                <View style={styles.warningBanner}>
                  <Feather name="alert-triangle" size={13} color={colors.warning} />
                  <Text style={styles.warningText}>
                    Un remplacement peut modifier la texture, le goût et le comportement de la pâte.
                  </Text>
                </View>
              )}
              <View style={styles.subPickerRow}>
                {substitutableNames.slice(0, 12).map(name => (
                  <Pressable
                    key={name}
                    testID={`adapt-sub-pick-${name}`}
                    onPress={() => setSubFrom(name)}
                    style={[styles.chip, subFrom === name && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, subFrom === name && styles.chipTextActive]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
              {subFrom && (
                <>
                  <Field label={`Remplacer "${subFrom}" par`}>
                    <TextInput testID="adapt-sub-to" value={subTo} onChangeText={setSubTo} placeholder="ex. margarine" placeholderTextColor={colors.muted} style={styles.input} />
                  </Field>
                  <Field label="Nouvelle quantité (optionnel, sinon inchangée)">
                    <TextInput testID="adapt-sub-qty" value={subQty} onChangeText={setSubQty} keyboardType="decimal-pad" placeholder="ex. 90" placeholderTextColor={colors.muted} style={styles.input} />
                  </Field>
                  <Pressable testID="adapt-sub-add" onPress={addSubstitution} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>Ajouter le remplacement</Text>
                  </Pressable>
                </>
              )}
            </Section>

            <Section icon="⏱️" title="Fermentation">
              <Field label="Décrivez ce que vous souhaitez">
                <TextInput
                  testID="adapt-fermentation-text"
                  value={fermentationText}
                  onChangeText={setFermentationText}
                  placeholder="ex. 18 h au froid au lieu de 2 h à température ambiante"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { minHeight: 60 }]}
                  multiline
                />
              </Field>
              {fermentationSuggestion?.mentioned && (
                <View style={styles.suggestionCard}>
                  <Text style={styles.suggestionTitle}>Suggestion IA</Text>
                  <Text style={styles.suggestionText}>
                    Cette modification est une proposition basée sur les paramètres de la recette. Le résultat peut
                    varier selon la farine, la température, le levain/levure, le pétrissage et les conditions réelles
                    de production.
                  </Text>
                  {Object.entries(fermentationSuggestion.suggested_technical || {})
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <Text key={k} style={styles.suggestionField}>• {k} : {v}</Text>
                    ))}
                  <Pressable
                    testID="adapt-fermentation-accept"
                    onPress={() => setFermentationAccepted(prev => !prev)}
                    style={styles.acceptRow}
                  >
                    <Feather name={fermentationAccepted ? 'check-square' : 'square'} size={18} color={fermentationAccepted ? colors.brand : colors.muted} />
                    <Text style={styles.acceptText}>Accepter cette suggestion</Text>
                  </Pressable>
                </View>
              )}
            </Section>

            <Section icon="🤖" title="Demander une adaptation">
              <TextInput
                testID="adapt-ai-text"
                value={aiText}
                onChangeText={setAiText}
                placeholder='ex. "120 baguettes de 250 g avec 15 % de seigle et une fermentation de 18 h au froid"'
                placeholderTextColor={colors.muted}
                style={[styles.input, { minHeight: 70 }]}
                multiline
              />
              <Pressable testID="adapt-ai-submit" onPress={askAI} disabled={aiLoading || !aiText.trim()} style={[styles.smallBtn, (aiLoading || !aiText.trim()) && { opacity: 0.5 }]}>
                {aiLoading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.smallBtnText}>Adapter</Text>}
              </Pressable>
              {aiError && <Text style={styles.errorText}>{aiError}</Text>}
            </Section>

            {!isAdaptationRequestEmpty(request) && (
              <View style={styles.summaryCard} testID="adapt-summary">
                <Text style={styles.summaryTitle}>Modifications demandées</Text>
                {changeRows.map((row, i) => (
                  <Text key={i} style={styles.summaryRow}>{row.icon} {row.label}</Text>
                ))}
                {preview && !preview.ok && preview.errors.map((e, i) => (
                  <Text key={i} style={styles.errorText}>⚠️ {e}</Text>
                ))}
              </View>
            )}

            <Pressable
              testID="adapt-apply"
              onPress={() => setPhase('result')}
              disabled={!preview?.ok || previewLoading}
              style={[styles.applyBtn, (!preview?.ok || previewLoading) && { opacity: 0.5 }]}
            >
              {previewLoading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.applyBtnText}>Appliquer l&apos;adaptation</Text>}
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.originalCard}>
              <Text style={styles.originalTitle}>Nouvelle version</Text>
              <Text style={styles.originalMeta}>
                {preview?.yield_pieces
                  ? `${preview.yield_pieces} pièces × ${preview.piece_weight_g} g`
                  : `${preview?.total_weight_g} g de pâte`}
              </Text>
              <Text style={styles.originalMeta}>Poids total : {preview?.total_weight_g} g</Text>
            </View>

            <View style={styles.card}>
              {(preview?.ingredients || []).filter(i => i.parsed).map((i, idx) => (
                <View key={idx} style={styles.resultRow} testID={`adapt-result-ing-${idx}`}>
                  <Text style={styles.resultName}>{i.name}</Text>
                  <Text style={styles.resultQty}>{i.quantity} {i.unit}</Text>
                  {i.percentage != null && <Text style={styles.resultPct}>{i.percentage}%</Text>}
                </View>
              ))}
            </View>

            <Pressable testID="adapt-compare-toggle" onPress={() => setComparing(prev => !prev)} style={styles.compareToggle}>
              <Feather name="columns" size={14} color={colors.brand} />
              <Text style={styles.compareToggleText}>{comparing ? 'Masquer la comparaison' : 'Comparer avec l’originale'}</Text>
            </Pressable>
            {comparing && (
              <View style={styles.card} testID="adapt-compare-table">
                <View style={styles.compareHeaderRow}>
                  <Text style={[styles.compareHeaderText, { flex: 1 }]}>Ingrédient</Text>
                  <Text style={styles.compareHeaderText}>Original</Text>
                  <Text style={styles.compareHeaderText}>Adapté</Text>
                </View>
                {comparisonRows.map(row => (
                  <View key={row.name} style={styles.compareRow}>
                    <Text style={[styles.compareCell, { flex: 1 }]}>{row.name}</Text>
                    <Text style={styles.compareCell}>{row.before}</Text>
                    <Text style={styles.compareCellAfter}>{row.after}</Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable testID="adapt-save" onPress={saveAsNewRecipe} style={styles.applyBtn}>
              <Text style={styles.applyBtnText}>Enregistrer comme nouvelle recette</Text>
            </Pressable>
            <Pressable testID="adapt-cancel" onPress={() => router.back()} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{icon} {title}</Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, marginHorizontal: 8 },
  body: { padding: 24, paddingBottom: 60 },
  originalCard: {
    backgroundColor: colors.surfaceInverse, borderRadius: theme.radius.lg, padding: 18, marginBottom: 16,
    ...cardElevation(mode, colors),
  },
  originalTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurfaceInverse },
  originalMeta: { fontSize: 13, color: colors.onSurfaceInverse, opacity: 0.85, marginTop: 4 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface, marginBottom: 10 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: 8 },
  label: { fontSize: 11, letterSpacing: 1, color: colors.muted, marginBottom: 6, fontWeight: '600' },
  input: { fontSize: 15, color: colors.onSurface, borderWidth: 1, borderColor: colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surfaceSecondary },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16, marginBottom: 12,
    ...cardElevation(mode, colors),
  },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  subText: { fontSize: 14, color: colors.onSurface },
  warningBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.surfaceTertiary, borderRadius: 8, padding: 12, marginTop: 8, marginBottom: 8 },
  warningText: { flex: 1, fontSize: 12, color: colors.onSurfaceTertiary, lineHeight: 17 },
  subPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.onSurfaceInverse },
  smallBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.md, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  smallBtnText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 14 },
  suggestionCard: {
    backgroundColor: colors.surfaceTertiary, borderRadius: theme.radius.lg, padding: 14, marginTop: 12,
    ...cardElevation(mode, colors),
  },
  suggestionTitle: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceTertiary, marginBottom: 6 },
  suggestionText: { fontSize: 12, color: colors.onSurfaceTertiary, lineHeight: 17, marginBottom: 8 },
  suggestionField: { fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 2 },
  acceptRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  acceptText: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  errorText: { fontSize: 12, color: colors.error, marginTop: 6, lineHeight: 16 },
  summaryCard: {
    backgroundColor: colors.surfaceInverse, borderRadius: theme.radius.lg, padding: 18, marginBottom: 16,
    ...cardElevation(mode, colors),
  },
  summaryTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurfaceInverse, marginBottom: 8 },
  summaryRow: { fontSize: 13, color: colors.onSurfaceInverse, marginTop: 4 },
  applyBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  applyBtnText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 15 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  cancelBtnText: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  resultName: { flex: 1, fontSize: 14, color: colors.onSurface },
  resultQty: { fontSize: 14, color: colors.onSurfaceSecondary, fontWeight: '600' },
  resultPct: { fontSize: 12, color: colors.muted, width: 40, textAlign: 'right' },
  compareToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginVertical: 16 },
  compareToggleText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  compareHeaderRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  compareHeaderText: { flex: 1, fontSize: 11, letterSpacing: 1, color: colors.muted, fontWeight: '700', textAlign: 'right' },
  compareRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  compareCell: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary, textAlign: 'right' },
  compareCellAfter: { flex: 1, fontSize: 13, color: colors.onSurface, fontWeight: '700', textAlign: 'right' },
});
