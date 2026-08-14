import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, API_BASE, getToken } from '@/src/api';
import { theme } from '@/src/theme';

const CATEGORIES = ['Pains', 'Viennoiseries', 'Pâtisseries'];
const DIFFICULTIES = ['Facile', 'Intermédiaire', 'Avancé'];

export default function ShareRecipe() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prefillTitle?: string; prefillHydration?: string; prefillIngredients?: string; prefillDescription?: string }>();
  const [title, setTitle] = useState(params.prefillTitle || '');
  const [category, setCategory] = useState('Pains');
  const [difficulty, setDifficulty] = useState('Facile');
  const [time, setTime] = useState('');
  const [hydration, setHydration] = useState(params.prefillHydration || '');
  const [description, setDescription] = useState(params.prefillDescription || '');
  const [ingredients, setIngredients] = useState(params.prefillIngredients || '');
  const [steps, setSteps] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError('Permission galerie refusée'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setImageUri(asset.uri);
    setUploading(true);
    try {
      const form = new FormData();
      const name = `photo.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}`;
      if (Platform.OS === 'web') {
        const blob = await (await fetch(asset.uri)).blob();
        form.append('file', blob, name);
      } else {
        form.append('file', { uri: asset.uri, name, type: `image/${name.split('.').pop()}` } as any);
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'Upload failed');
      setImagePath(j.path);
    } catch (e: any) {
      setError('Upload photo: ' + e.message);
      setImageUri(null);
    } finally { setUploading(false); }
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || !description.trim() || !ingredients.trim() || !steps.trim() || !time) {
      setError('Merci de remplir tous les champs obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/recipes', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          category,
          difficulty,
          time_minutes: parseInt(time) || 0,
          hydration: parseInt(hydration) || 0,
          description: description.trim(),
          ingredients: ingredients.split('\n').map(s => s.trim()).filter(Boolean),
          steps: steps.split('\n').map(s => s.trim()).filter(Boolean),
          image_path: imagePath,
        }),
      });
      router.replace('/(tabs)/profile');
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="close-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Partager</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Pressable testID="pick-image" onPress={pickImage} style={styles.imagePicker}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Feather name="camera" size={28} color={theme.color.muted} />
                <Text style={styles.imageText}>Ajouter une photo</Text>
              </View>
            )}
            {uploading && (
              <View style={styles.uploadOverlay}><ActivityIndicator color="#fff" /></View>
            )}
          </Pressable>

          <Field label="Titre de la recette *">
            <TextInput testID="input-title" value={title} onChangeText={setTitle} placeholder="Ex: Ma baguette maison" placeholderTextColor={theme.color.muted} style={styles.input} />
          </Field>

          <Field label="Catégorie">
            <View style={styles.chipsRow}>
              {CATEGORIES.map(c => (
                <Pressable key={c} testID={`cat-${c}`} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
                  <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          <Field label="Difficulté">
            <View style={styles.chipsRow}>
              {DIFFICULTIES.map(d => (
                <Pressable key={d} testID={`diff-${d}`} onPress={() => setDifficulty(d)} style={[styles.chip, difficulty === d && styles.chipActive]}>
                  <Text style={[styles.chipText, difficulty === d && styles.chipTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Field label="Temps (min) *">
                <TextInput testID="input-time" value={time} onChangeText={setTime} placeholder="120" placeholderTextColor={theme.color.muted} style={styles.input} keyboardType="numeric" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Hydratation %">
                <TextInput testID="input-hydration" value={hydration} onChangeText={setHydration} placeholder="65" placeholderTextColor={theme.color.muted} style={styles.input} keyboardType="numeric" />
              </Field>
            </View>
          </View>

          <Field label="Description *">
            <TextInput testID="input-description" value={description} onChangeText={setDescription} placeholder="Une belle recette de..." placeholderTextColor={theme.color.muted} style={[styles.input, { minHeight: 60 }]} multiline />
          </Field>

          <Field label="Ingrédients * (un par ligne)">
            <TextInput testID="input-ingredients" value={ingredients} onChangeText={setIngredients} placeholder="500 g de farine T65&#10;10 g de sel&#10;..." placeholderTextColor={theme.color.muted} style={[styles.input, { minHeight: 100 }]} multiline />
          </Field>

          <Field label="Étapes * (une par ligne)">
            <TextInput testID="input-steps" value={steps} onChangeText={setSteps} placeholder="Mélanger la farine et l'eau&#10;Laisser reposer 30 min&#10;..." placeholderTextColor={theme.color.muted} style={[styles.input, { minHeight: 140 }]} multiline />
          </Field>

          {error && <Text style={styles.error} testID="share-error">{error}</Text>}

          <Pressable testID="publish-btn" onPress={submit} disabled={submitting || uploading} style={[styles.publishBtn, (submitting || uploading) && { opacity: 0.6 }]}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishText}>Publier ma recette</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface },
  form: { padding: 24, paddingBottom: 40 },
  imagePicker: { height: 200, borderRadius: 4, borderWidth: 1, borderColor: theme.color.borderStrong, borderStyle: 'dashed', overflow: 'hidden', marginBottom: 24, position: 'relative' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  imageText: { color: theme.color.muted, fontSize: 14 },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, marginBottom: 8, fontWeight: '600' },
  input: { fontSize: 15, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, paddingVertical: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong },
  chipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  chipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: theme.color.onSurfaceInverse },
  error: { color: theme.color.error, fontSize: 13, marginBottom: 12 },
  publishBtn: { backgroundColor: theme.color.brand, paddingVertical: 16, alignItems: 'center', borderRadius: 4, marginTop: 8 },
  publishText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
