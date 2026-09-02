import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
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
const MIN_CAPTION_LENGTH = 20;

const ANALYSIS_MESSAGES = ['Lecture de la légende…', 'Extraction de la recette…', 'Vérification des données…'];

/**
 * Import d'une recette depuis une légende Instagram collée par
 * l'utilisateur — jamais une récupération automatique depuis un lien :
 * Instagram ne fournit aucune API publique non authentifiée pour ça
 * (l'oEmbed nécessite une revue d'app Meta). Même chantier que scan.tsx
 * (extraction assistée par IA → vérification éditable → POST /recipes,
 * réutilisant la même modération/famille/gamification), simplement à
 * partir d'un texte collé plutôt que d'une photo — d'où le partage de
 * `src/recipeVerify/*` entre les deux écrans plutôt que deux implémentations
 * séparées du même formulaire de vérification.
 */
export default function InstagramImport() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const router = useRouter();
  const { refreshUser } = useAuth();
  const [phase, setPhase] = useState<'paste' | 'analyzing' | 'verify'>('paste');
  const [caption, setCaption] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
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
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [coverImagePath, setCoverImagePath] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (phase !== 'analyzing') return;
    const t = setInterval(() => setAnalysisMsgIndex(i => Math.min(i + 1, ANALYSIS_MESSAGES.length - 1)), 1200);
    return () => clearInterval(t);
  }, [phase]);

  // ---------- Analyse ----------
  const analyze = async () => {
    const trimmed = caption.trim();
    if (trimmed.length < MIN_CAPTION_LENGTH) return;
    setPasteError(null);
    setPhase('analyzing');
    setAnalysisMsgIndex(0);
    try {
      const j = await api('/recipes/instagram-import/analyze', {
        method: 'POST',
        body: JSON.stringify({ caption: trimmed }),
      });
      applyExtraction(j as RecipeExtraction);
      setPhase('verify');
    } catch (e: any) {
      setPasteError(e.message || "L'analyse a échoué");
      setPhase('paste');
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

  // Pas de photo source pour une légende collée (contrairement au scan, qui
  // a les pages photographiées) — un unique bouton optionnel, upload direct
  // dès le choix plutôt qu'un différé à la soumission comme dans share.tsx,
  // pour donner un retour immédiat si l'envoi échoue.
  const pickCoverImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setSubmitError('Permission photothèque refusée');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.8, allowsEditing: true, aspect: [4, 3] });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setCoverImageUri(asset.uri);
    setCoverUploading(true);
    setSubmitError(null);
    try {
      const name = `cover.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}`;
      const path = await uploadImage(asset.uri, name);
      setCoverImagePath(path);
    } catch (e: any) {
      setSubmitError(e.message || "Envoi de la photo impossible");
      setCoverImageUri(null);
    } finally {
      setCoverUploading(false);
    }
  };

  const removeCoverImage = () => {
    setCoverImageUri(null);
    setCoverImagePath(null);
  };

  const submit = async () => {
    if (!title.trim() || !description.trim() || !timeMinutes.trim() || ingredients.length === 0 || steps.length === 0) {
      setSubmitError('Merci de compléter le nom, la durée totale, la description, au moins un ingrédient et une étape.');
      return;
    }
    if (coverUploading) {
      setSubmitError('Patientez, la photo est encore en cours d’envoi.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const technicalDict: Record<string, string> = { ...technical, imported_via: 'instagram_caption' };
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
          image_path: coverImagePath,
          source: sourceUrl.trim() || null,
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
              <Pressable testID="instagram-back-to-paste" onPress={() => setPhase('paste')}>
                <Feather name="arrow-left" size={22} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.title}>Vérifiez votre recette</Text>
            </View>

            <FieldLabel label="Nom" confidence={titleConfidence} />
            <TextInput testID="instagram-verify-title" value={title} onChangeText={setTitle} style={styles.input} placeholder="Nom de la recette" />

            <Text style={styles.label}>Catégorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {CATEGORIES.map(c => (
                <Chip key={c} testID={`instagram-verify-category-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </ScrollView>

            <Text style={styles.label}>Difficulté</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {DIFFICULTIES.map(d => (
                <Chip key={d} testID={`instagram-verify-difficulty-${d}`} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
              ))}
            </ScrollView>

            <Text style={styles.label}>Durée totale (minutes)</Text>
            <TextInput testID="instagram-verify-time" value={timeMinutes} onChangeText={setTimeMinutes} keyboardType="number-pad" style={styles.input} placeholder="Non détectée — à compléter" />

            <Text style={styles.label}>Nombre de pièces</Text>
            <TextInput testID="instagram-verify-yield" value={yieldPieces} onChangeText={setYieldPieces} keyboardType="number-pad" style={styles.input} placeholder="Non détecté" />

            <FieldLabel label="Description / méthode" confidence={descriptionConfidence} />
            <TextInput testID="instagram-verify-description" value={description} onChangeText={setDescription} multiline style={[styles.input, styles.multiline]} placeholder="Non détectée — à compléter" />

            <Text style={styles.sectionTitle}>Ingrédients</Text>
            {stats.hydration > 0 && <Text style={styles.statLine}>Hydratation calculée : {stats.hydration}%</Text>}
            {ingredients.map((row, i) => (
              <View key={row.id} style={styles.ingredientRow} testID={`instagram-verify-ingredient-${i}`}>
                <View style={{ flex: 1 }}>
                  <View style={styles.ingredientTopRow}>
                    <TextInput
                      testID={`instagram-verify-ingredient-name-${i}`}
                      value={row.name}
                      onChangeText={t => updateIngredient(row.id, { name: t })}
                      style={[styles.input, { flex: 1, marginBottom: 6 }]}
                      placeholder="Nom"
                    />
                    {row.confidence && <ConfidenceBadge confidence={row.confidence} />}
                  </View>
                  <View style={styles.ingredientBottomRow}>
                    <TextInput
                      testID={`instagram-verify-ingredient-qty-${i}`}
                      value={row.quantity}
                      onChangeText={t => updateIngredient(row.id, { quantity: t })}
                      keyboardType="numeric"
                      style={[styles.input, styles.qtyInput]}
                      placeholder="Qté"
                    />
                    <TextInput
                      testID={`instagram-verify-ingredient-unit-${i}`}
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
                  <Pressable testID={`instagram-verify-ingredient-up-${i}`} onPress={() => moveIngredient(row.id, -1)}><Feather name="chevron-up" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`instagram-verify-ingredient-down-${i}`} onPress={() => moveIngredient(row.id, 1)}><Feather name="chevron-down" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`instagram-verify-ingredient-remove-${i}`} onPress={() => removeIngredient(row.id)}><Feather name="trash-2" size={18} color={colors.error} /></Pressable>
                </View>
              </View>
            ))}
            <Pressable testID="instagram-verify-add-ingredient" onPress={addIngredient} style={styles.addBtn}>
              <Feather name="plus" size={16} color={colors.brand} />
              <Text style={styles.addBtnText}>Ajouter un ingrédient</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Étapes</Text>
            {steps.map((row, i) => (
              <View key={row.id} style={styles.ingredientRow} testID={`instagram-verify-step-${i}`}>
                <View style={styles.stepTextRow}>
                  <Text style={styles.stepNumber}>{i + 1}.</Text>
                  <TextInput
                    testID={`instagram-verify-step-text-${i}`}
                    value={row.text}
                    onChangeText={t => updateStep(row.id, t)}
                    multiline
                    style={[styles.input, { flex: 1 }]}
                  />
                  {row.confidence && <ConfidenceBadge confidence={row.confidence} />}
                </View>
                <View style={styles.rowActions}>
                  <Pressable testID={`instagram-verify-step-up-${i}`} onPress={() => moveStep(row.id, -1)}><Feather name="chevron-up" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`instagram-verify-step-down-${i}`} onPress={() => moveStep(row.id, 1)}><Feather name="chevron-down" size={18} color={colors.muted} /></Pressable>
                  <Pressable testID={`instagram-verify-step-remove-${i}`} onPress={() => removeStep(row.id)}><Feather name="trash-2" size={18} color={colors.error} /></Pressable>
                </View>
              </View>
            ))}
            <Pressable testID="instagram-verify-add-step" onPress={addStep} style={styles.addBtn}>
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
                      testID={`instagram-verify-technical-${key}`}
                      value={technical[key]}
                      onChangeText={t => setTechnical(prev => ({ ...prev, [key]: t }))}
                      style={styles.input}
                    />
                  </View>
                ))}
              </>
            )}

            <Text style={styles.sectionTitle}>Photo de la recette</Text>
            {coverImageUri ? (
              <View style={styles.coverThumbWrap}>
                <Image source={{ uri: coverImageUri }} style={styles.coverThumb} contentFit="cover" />
                {coverUploading && (
                  <View style={styles.coverUploadingOverlay}><ActivityIndicator color={colors.onBrandPrimary} /></View>
                )}
                <Pressable testID="instagram-verify-remove-cover" onPress={removeCoverImage} style={styles.coverRemoveBtn}>
                  <Feather name="x" size={14} color={colors.onBrandPrimary} />
                </Pressable>
              </View>
            ) : (
              <Pressable testID="instagram-verify-pick-cover" onPress={pickCoverImage} style={styles.addBtn}>
                <Feather name="image" size={16} color={colors.brand} />
                <Text style={styles.addBtnText}>Ajouter une photo</Text>
              </Pressable>
            )}

            {submitError && <Text style={styles.error}>{submitError}</Text>}

            <Pressable testID="instagram-verify-submit" onPress={submit} disabled={submitting} style={[styles.submitBtn, submitting && { opacity: 0.6 }]}>
              {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>Ajouter à mes recettes</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---------- Paste phase ----------
  const canAnalyze = caption.trim().length >= MIN_CAPTION_LENGTH;
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Pressable testID="instagram-close" onPress={() => router.back()}>
            <Feather name="x" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Importer depuis Instagram</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <Text style={styles.subtitle}>
            L&apos;application ne peut pas récupérer une légende automatiquement depuis un lien —
            copiez-la depuis l&apos;app Instagram, puis collez-la ci-dessous.
          </Text>

          <Text style={styles.label}>Légende de la publication</Text>
          <TextInput
            testID="instagram-caption-input"
            value={caption}
            onChangeText={setCaption}
            multiline
            style={[styles.input, styles.captionInput]}
            placeholder="Collez ici la légende de la publication…"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Lien de la publication (facultatif)</Text>
          <TextInput
            testID="instagram-source-url-input"
            value={sourceUrl}
            onChangeText={setSourceUrl}
            style={styles.input}
            placeholder="https://www.instagram.com/p/…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            Affiché comme crédit sur la recette, jamais utilisé pour aller chercher des informations automatiquement.
          </Text>

          {pasteError && <Text style={styles.error}>{pasteError}</Text>}

          <Pressable
            testID="instagram-analyze"
            onPress={analyze}
            disabled={!canAnalyze}
            style={[styles.submitBtn, !canAnalyze && { opacity: 0.4 }]}
          >
            <Text style={styles.submitBtnText}>Analyser</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  subtitle: { fontSize: 14, color: colors.onSurfaceSecondary, marginBottom: 20, lineHeight: 20 },
  analysisText: { fontSize: 16, color: colors.onSurface, fontWeight: '500' },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 16 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, marginTop: 28, marginBottom: 8 },
  statLine: { fontSize: 13, color: colors.brand, fontWeight: '600', marginBottom: 10 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.onSurface },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  captionInput: { minHeight: 160, textAlignVertical: 'top' },
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
  submitBtn: { backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { fontSize: 15, fontWeight: '600', color: colors.onBrandPrimary },
  error: { color: colors.error, fontSize: 13, marginTop: 8 },
  coverThumbWrap: { position: 'relative', width: 140, height: 105, marginTop: 4 },
  coverThumb: { width: 140, height: 105, borderRadius: 8, backgroundColor: colors.surfaceSecondary },
  coverUploadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(42,31,26,0.5)', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  coverRemoveBtn: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 999, backgroundColor: colors.surfaceInverse, alignItems: 'center', justifyContent: 'center' },
});
