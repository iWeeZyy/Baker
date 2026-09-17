import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, API_BASE, getToken } from '@/src/api';
import { useAuth } from '@/src/auth';
import { useEntitlements } from '@/src/entitlements';
import { LockedFeatureNotice } from '@/src/PlanChip';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { showGamificationToast } from '@/src/gamification/UnlockToast';
import { Chip } from '@/src/Chip';
import { ConfidenceBadge, FieldLabel } from '@/src/recipeVerify/ConfidenceBadge';
import { computeBakerStats, ingredientToLine } from '@/src/recipeVerify/bakerStats';
import { TECHNICAL_FIELDS, type Confidence, type IngredientRow, type RecipeExtraction, type StepRow } from '@/src/recipeVerify/types';
import { uploadImage } from '@/src/recipeVerify/uploadImage';

const CATEGORIES = ['Pains', 'Levains', 'Snacking', 'Viennoiseries', 'Brioches', 'Pâtisseries'];
const DIFFICULTIES = ['Facile', 'Intermédiaire', 'Avancé'];
const MAX_PAGES = 6;

type Page = { uri: string; name: string };

const ANALYSIS_MESSAGES = ['Analyse de votre fiche…', 'Extraction des ingrédients…', 'Vérification des données…'];

export default function ScanRecipe() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const router = useRouter();
  const { refreshUser } = useAuth();
  const { can } = useEntitlements();
  const locked = !can('recipe_scan');
  const [phase, setPhase] = useState<'capture' | 'analyzing' | 'verify'>('capture');
  const [pages, setPages] = useState<Page[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [analysisMsgIndex, setAnalysisMsgIndex] = useState(0);

  const idCounter = useRef(0);
  const newId = () => `r${idCounter.current++}`;

  // ---------- Verification-screen state ----------
  const [title, setTitle] = useState('');
  const [titleConfidence, setTitleConfidence] = useState<Confidence>('absent');
  const [category, setCategory] = useState('Pains');
  const [difficulty, setDifficulty] = useState('Facile');
  const [timeMinutes, setTimeMinutes] = useState('');
  const [yieldPieces, setYieldPieces] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionConfidence, setDescriptionConfidence] = useState<Confidence>('absent');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [technical, setTechnical] = useState<Record<string, string>>({});
  const [coverPageIndex, setCoverPageIndex] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (phase !== 'analyzing') return;
    const t = setInterval(() => setAnalysisMsgIndex(i => Math.min(i + 1, ANALYSIS_MESSAGES.length - 1)), 1200);
    return () => clearInterval(t);
  }, [phase]);

  // ---------- Capture ----------
  const requestAndPick = async (kind: 'camera' | 'library') => {
    setCaptureError(null);
    const perm = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert(
          kind === 'camera' ? 'Accès à la caméra refusé' : 'Accès à la photothèque refusé',
          `Autorisez l'accès dans Réglages › Baker › ${kind === 'camera' ? 'Appareil photo' : 'Photos'}.`,
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
          ],
        );
      } else {
        setCaptureError(kind === 'camera' ? 'Permission caméra refusée' : 'Permission photothèque refusée');
      }
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'] as any, quality: 0.8, allowsEditing: true, aspect: [3, 4] };
    const result = kind === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (pages.length >= MAX_PAGES) {
      setCaptureError(`${MAX_PAGES} pages maximum par scan`);
      return;
    }
    const name = `page.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}`;
    setPages(prev => [...prev, { uri: asset.uri, name }]);
  };

  const removePage = (index: number) => {
    setPages(prev => prev.filter((_, i) => i !== index));
    setCoverPageIndex(idx => (idx === index ? null : idx != null && idx > index ? idx - 1 : idx));
  };

  const movePage = (index: number, dir: -1 | 1) => {
    setPages(prev => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const analyze = async () => {
    if (pages.length === 0) return;
    setCaptureError(null);
    setPhase('analyzing');
    setAnalysisMsgIndex(0);
    try {
      const form = new FormData();
      for (const p of pages) {
        if (Platform.OS === 'web') {
          const blob = await (await fetch(p.uri)).blob();
          form.append('files', blob, p.name);
        } else {
          form.append('files', { uri: p.uri, name: p.name, type: `image/${p.name.split('.').pop()}` } as any);
        }
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE}/recipes/scan/analyze`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || "L'analyse a échoué");
      applyExtraction(j as RecipeExtraction);
      setPhase('verify');
    } catch (e: any) {
      setCaptureError(e.message || "L'analyse a échoué");
      setPhase('capture');
    }
  };

  const applyExtraction = (data: RecipeExtraction) => {
    setTitle(data.title?.value || '');
    setTitleConfidence(data.title?.confidence || 'absent');
    if (data.category?.value && CATEGORIES.includes(data.category.value)) setCategory(data.category.value);
    setYieldPieces(data.yield_pieces?.value != null ? String(data.yield_pieces.value) : '');
    setDescription(data.description?.value || '');
    setDescriptionConfidence(data.description?.confidence || 'absent');
    setIngredients((data.ingredients || []).map(ing => ({
      id: newId(),
      name: ing.name || '',
      quantity: ing.quantity != null ? String(ing.quantity) : '',
      unit: ing.unit && ing.unit !== 'piece' ? ing.unit : '',
      confidence: ing.confidence,
    })));
    setSteps((data.steps || []).map(s => ({ id: newId(), text: s.text || '', confidence: s.confidence })));
    const tech: Record<string, string> = {};
    for (const [key] of TECHNICAL_FIELDS) {
      const v = data.technical?.[key]?.value;
      if (v) tech[key] = v;
    }
    setTechnical(tech);
  };

  // ---------- Verify screen actions ----------
  const addIngredient = () => setIngredients(prev => [...prev, { id: newId(), name: '', quantity: '', unit: '' }]);
  const removeIngredient = (id: string) => setIngredients(prev => prev.filter(r => r.id !== id));
  const moveIngredient = (id: string, dir: -1 | 1) => setIngredients(prev => {
    const i = prev.findIndex(r => r.id === id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[target]] = [next[target], next[i]];
    return next;
  });
  const updateIngredient = (id: string, patch: Partial<IngredientRow>) =>
    setIngredients(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const addStep = () => setSteps(prev => [...prev, { id: newId(), text: '' }]);
  const removeStep = (id: string) => setSteps(prev => prev.filter(r => r.id !== id));
  const moveStep = (id: string, dir: -1 | 1) => setSteps(prev => {
    const i = prev.findIndex(r => r.id === id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[target]] = [next[target], next[i]];
    return next;
  });
  const updateStep = (id: string, text: string) => setSteps(prev => prev.map(r => (r.id === id ? { ...r, text } : r)));

  const stats = computeBakerStats(ingredients);

  const submit = async () => {
    if (!title.trim() || !description.trim() || !timeMinutes.trim() || ingredients.length === 0 || steps.length === 0) {
      setSubmitError('Merci de compléter le nom, la durée totale, la description, au moins un ingrédient et une étape.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      let imagePath: string | null = null;
      if (coverPageIndex != null && pages[coverPageIndex]) {
        imagePath = await uploadImage(pages[coverPageIndex].uri, pages[coverPageIndex].name);
      }
      const technicalDict: Record<string, string> = { ...technical, imported_via: 'scan' };
      const doc = await api('/recipes', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          category,
          difficulty,
          family: null,
          time_minutes: parseInt(timeMinutes, 10) || 0,
          hydration: stats.hydration,
          yield_pieces: parseInt(yieldPieces, 10) > 0 ? parseInt(yieldPieces, 10) : null,
          description: description.trim(),
          ingredients: ingredients.filter(r => r.name.trim()).map(ingredientToLine),
          steps: steps.map(s => s.text.trim()).filter(Boolean),
          technical: technicalDict,
          image_path: imagePath,
        }),
      });
      showGamificationToast(doc.gamification);
      refreshUser();
      router.replace(`/recipe/${doc.id}`);
    } catch (e: any) {
      setSubmitError(e.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Render ----------
  if (phase === 'analyzing') {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.analysisText}>{ANALYSIS_MESSAGES[analysisMsgIndex]}</Text>
      </SafeAreaView>
    );
  }

  if (phase === 'verify') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
            <View style={styles.headerRow}>
              <Pressable testID="scan-back-to-capture" onPress={() => setPhase('capture')}>
                <Feather name="arrow-left" size={22} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.title}>Vérifiez votre recette</Text>
            </View>

            <FieldLabel label="Nom" confidence={titleConfidence} />
            <TextInput testID="scan-title" value={title} onChangeText={setTitle} style={styles.input} placeholder="Nom de la recette" />

            <Text style={styles.label}>Catégorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {CATEGORIES.map(c => (
                <Chip key={c} testID={`scan-category-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>

            <Text style={styles.label}>Difficulté</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {DIFFICULTIES.map(d => (
                <Chip key={d} testID={`scan-difficulty-${d}`} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
              ))}
            </ScrollView>

            <Text style={styles.label}>Durée totale (minutes)</Text>
            <TextInput testID="scan-time" value={timeMinutes} onChangeText={setTimeMinutes} keyboardType="number-pad" style={styles.input} placeholder="Non détectée — à compléter" />

            <Text style={styles.label}>Nombre de pièces</Text>
            <TextInput testID="scan-yield" value={yieldPieces} onChangeText={setYieldPieces} keyboardType="number-pad" style={styles.input} placeholder="Non détecté" />

            <FieldLabel label="Description / méthode" confidence={descriptionConfidence} />
            <TextInput testID="scan-description" value={description} onChangeText={setDescription} multiline style={[styles.input, styles.multiline]} placeholder="Non détectée — à compléter" />

            <Text style={styles.sectionTitle}>Ingrédients</Text>
            {stats.hydration > 0 && <Text style={styles.statLine}>Hydratation calculée : {stats.hydration}%</Text>}
            {ingredients.map((row, i) => (
              <View key={row.id} style={styles.ingredientRow} testID={`scan-ingredient-${i}`}>
                <View style={{ flex: 1 }}>
                  <View style={styles.ingredientTopRow}>
                    <TextInput
                      testID={`scan-ingredient-name-${i}`}
                      value={row.name}
                      onChangeText={t => updateIngredient(row.id, { name: t })}
                      style={[styles.input, { flex: 1, marginBottom: 6 }]}
                      placeholder="Nom"
                    />
                    {row.confidence && <ConfidenceBadge confidence={row.confidence} />}
                  </View>
                  <View style={styles.ingredientBottomRow}>
                    <TextInput
                      testID={`scan-ingredient-qty-${i}`}
                      value={row.quantity}
                      onChangeText={t => updateIngredient(row.id, { quantity: t })}
                      keyboardType="numeric"
                      style={[styles.input, styles.qtyInput]}
                      placeholder="Qté"
                    />
                    <TextInput
                      testID={`scan-ingredient-unit-${i}`}
                      value={row.unit}
                      onChangeText={t => updateIngredient(row.id, { unit: t })}
                      style={[styles.input, styles.unitInput]}
                      placeholder="g"
                    />
                    {stats.percentages && row.name && stats.percentages[row.name] != null && (
                      <Text style={styles.percentText}>{stats.percentages[row.name]}%</Text>
                    )}
                  </View>
                </View>
                <View style={styles.rowActions}>
                  <Pressable testID={`scan-ingredient-up-${i}`} onPress={() => moveIngredient(row.id, -1)}><Feather name="chevron-up" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`scan-ingredient-down-${i}`} onPress={() => moveIngredient(row.id, 1)}><Feather name="chevron-down" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`scan-ingredient-remove-${i}`} onPress={() => removeIngredient(row.id)}><Feather name="trash-2" size={18} color={colors.error} /></Pressable>
                </View>
              </View>
            ))}
            <Pressable testID="scan-add-ingredient" onPress={addIngredient} style={styles.addBtn}>
              <Feather name="plus" size={16} color={colors.brand} />
              <Text style={styles.addBtnText}>Ajouter un ingrédient</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Étapes</Text>
            {steps.map((row, i) => (
              <View key={row.id} style={styles.ingredientRow} testID={`scan-step-${i}`}>
                <View style={styles.stepTextRow}>
                  <Text style={styles.stepNumber}>{i + 1}.</Text>
                  <TextInput
                    testID={`scan-step-text-${i}`}
                    value={row.text}
                    onChangeText={t => updateStep(row.id, t)}
                    multiline
                    style={[styles.input, { flex: 1 }]}
                  />
                  {row.confidence && <ConfidenceBadge confidence={row.confidence} />}
                </View>
                <View style={styles.rowActions}>
                  <Pressable testID={`scan-step-up-${i}`} onPress={() => moveStep(row.id, -1)}><Feather name="chevron-up" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`scan-step-down-${i}`} onPress={() => moveStep(row.id, 1)}><Feather name="chevron-down" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`scan-step-remove-${i}`} onPress={() => removeStep(row.id)}><Feather name="trash-2" size={18} color={colors.error} /></Pressable>
                </View>
              </View>
            ))}
            <Pressable testID="scan-add-step" onPress={addStep} style={styles.addBtn}>
              <Feather name="plus" size={16} color={colors.brand} />
              <Text style={styles.addBtnText}>Ajouter une étape</Text>
            </Pressable>

            {Object.keys(technical).length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Fabrication</Text>
                {TECHNICAL_FIELDS.filter(([key]) => technical[key] !== undefined).map(([key, label]) => (
                  <View key={key}>
                    <Text style={styles.label}>{label}</Text>
                    <TextInput
                      testID={`scan-technical-${key}`}
                      value={technical[key]}
                      onChangeText={t => setTechnical(prev => ({ ...prev, [key]: t }))}
                      style={styles.input}
                    />
                  </View>
                ))}
              </>
            )}

            {pages.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Photo de la recette</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {pages.map((p, i) => (
                    <Pressable key={i} testID={`scan-cover-${i}`} onPress={() => setCoverPageIndex(idx => (idx === i ? null : i))} style={styles.coverThumbWrap}>
                      <Image source={{ uri: p.uri }} style={[styles.coverThumb, coverPageIndex === i && styles.coverThumbSelected]} contentFit="cover" />
                      {coverPageIndex === i && <View style={styles.coverCheck}><Feather name="check" size={14} color={colors.onBrandPrimary} /></View>}
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            {submitError && <Text style={styles.error}>{submitError}</Text>}

            <Pressable testID="scan-submit" onPress={submit} disabled={submitting} style={[styles.submitBtn, submitting && { opacity: 0.6 }]}>
              {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>Ajouter à mes recettes</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---------- Capture phase ----------
  if (locked) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.headerRow}>
          <Pressable testID="scan-close" onPress={() => router.back()}>
            <Feather name="x" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Scanner une recette</Text>
        </View>
        <View style={{ paddingHorizontal: 24 }}>
          <LockedFeatureNotice
            minPlan="pro"
            label="Le scan de recette est réservé à l'offre Pro"
            onPress={() => router.push('/pro?feature=recipe_scan' as any)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <Pressable testID="scan-close" onPress={() => router.back()}>
          <Feather name="x" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Scanner une recette</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={styles.subtitle}>Photographiez chaque page de la fiche, dans l&apos;ordre.</Text>

        {pages.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {pages.map((p, i) => (
              <View key={i} style={styles.pageThumbWrap} testID={`scan-page-${i}`}>
                <Image source={{ uri: p.uri }} style={styles.pageThumb} contentFit="cover" />
                <View style={styles.pageThumbActions}>
                  <Pressable testID={`scan-page-up-${i}`} onPress={() => movePage(i, -1)} style={styles.pageThumbBtn}><Feather name="chevron-left" size={14} color={colors.onBrandPrimary} /></Pressable>
                  <Pressable testID={`scan-page-remove-${i}`} onPress={() => removePage(i)} style={styles.pageThumbBtn}><Feather name="x" size={14} color={colors.onBrandPrimary} /></Pressable>
                  <Pressable testID={`scan-page-down-${i}`} onPress={() => movePage(i, 1)} style={styles.pageThumbBtn}><Feather name="chevron-right" size={14} color={colors.onBrandPrimary} /></Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        <Pressable testID="scan-take-photo" onPress={() => requestAndPick('camera')} style={styles.actionBtn}>
          <Feather name="camera" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.actionBtnText}>Prendre une photo</Text>
        </Pressable>
        <Pressable testID="scan-pick-library" onPress={() => requestAndPick('library')} style={[styles.actionBtn, styles.actionBtnSecondary]}>
          <Feather name="image" size={20} color={colors.brand} />
          <Text style={[styles.actionBtnText, { color: colors.brand }]}>Choisir depuis la photothèque</Text>
        </Pressable>

        {captureError && <Text style={styles.error}>{captureError}</Text>}

        <Pressable
          testID="scan-analyze"
          onPress={analyze}
          disabled={pages.length === 0}
          style={[styles.submitBtn, pages.length === 0 && { opacity: 0.4 }]}
        >
          <Text style={styles.submitBtnText}>Analyser{pages.length > 0 ? ` (${pages.length} page${pages.length > 1 ? 's' : ''})` : ''}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  subtitle: { fontSize: 14, color: colors.onSurfaceSecondary, marginBottom: 20 },
  analysisText: { fontSize: 16, color: colors.onSurface, fontWeight: '500' },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, marginTop: 28, marginBottom: 8 },
  statLine: { fontSize: 13, color: colors.brand, fontWeight: '600', marginBottom: 10 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.onSurface },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  ingredientRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  ingredientTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ingredientBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyInput: { width: 70 },
  unitInput: { width: 60 },
  percentText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  stepTextRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepNumber: { fontSize: 15, color: colors.muted, fontWeight: '600', paddingTop: 12 },
  rowActions: { flexDirection: 'row', gap: 10, paddingTop: 10 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addBtnText: { fontSize: 14, color: colors.brand, fontWeight: '600' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 16, marginBottom: 12 },
  actionBtnSecondary: { backgroundColor: colors.surfaceSecondary },
  actionBtnText: { fontSize: 15, fontWeight: '600', color: colors.onBrandPrimary },
  submitBtn: { backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { fontSize: 15, fontWeight: '600', color: colors.onBrandPrimary },
  error: { color: colors.error, fontSize: 13, marginTop: 8 },
  pageThumbWrap: { marginRight: 12, alignItems: 'center' },
  pageThumb: { width: 100, height: 130, borderRadius: 8, backgroundColor: colors.surfaceSecondary },
  pageThumbActions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  pageThumbBtn: { width: 24, height: 24, borderRadius: 999, backgroundColor: colors.surfaceInverse, alignItems: 'center', justifyContent: 'center' },
  coverThumbWrap: { marginRight: 12, position: 'relative' },
  coverThumb: { width: 70, height: 90, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  coverThumbSelected: { borderColor: colors.brand },
  coverCheck: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
