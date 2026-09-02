import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, API_BASE, getToken } from '@/src/api';
import { useAuth } from '@/src/auth';
import { ActionSheet } from '@/src/ActionSheet';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { showGamificationToast } from '@/src/gamification/UnlockToast';
import { Chip } from '@/src/Chip';
import { Button } from '@/src/Button';

const CREATION_CATEGORIES = ['Pain', 'Viennoiserie', 'Pâtisserie', 'Traiteur', 'Autre'];
const DESCRIPTION_MAX_LENGTH = 500;
const MAX_PHOTOS = 6;

type PhotoItem = { key: string; uri: string; path: string | null; uploading?: boolean };
type Recipe = { id: string; title: string };

function Field({ label, children }: { label: string; children: any }) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export default function CreationForm() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);

  const router = useRouter();
  const { refreshUser } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Pain');
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [recipeTitle, setRecipeTitle] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [pickingRecipe, setPickingRecipe] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api('/recipes').then(setRecipes).catch(() => {});
    if (isEdit) {
      api(`/creations/${id}`).then((c: any) => {
        setTitle(c.title);
        setDescription(c.description || '');
        setCategory(c.category);
        if (c.recipe) { setRecipeId(c.recipe.id); setRecipeTitle(c.recipe.title); }
        setPhotos((c.photos || []).map((path: string) => ({
          key: path, uri: `${API_BASE}/files/${path}`, path,
        })));
      }).catch((e: any) => setError(e.message || 'Chargement impossible'))
        .finally(() => setLoading(false));
    }
  }, [id, isEdit]);

  const uploadOne = async (uri: string, key: string) => {
    try {
      const form = new FormData();
      const name = `photo.${(uri.split('.').pop() || 'jpg').toLowerCase()}`;
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        form.append('file', blob, name);
      } else {
        form.append('file', { uri, name, type: `image/${name.split('.').pop()}` } as any);
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'Envoi de la photo impossible.');
      setPhotos(prev => prev.map(p => p.key === key ? { ...p, path: j.path, uploading: false } : p));
    } catch (e: any) {
      setError(e.message || 'Envoi de la photo impossible.');
      setPhotos(prev => prev.filter(p => p.key !== key));
    }
  };

  const addAssets = (assets: { uri: string }[]) => {
    const room = MAX_PHOTOS - photos.length;
    const chosen = assets.slice(0, room);
    const items: PhotoItem[] = chosen.map(a => ({ key: `${a.uri}-${Date.now()}-${Math.random()}`, uri: a.uri, path: null, uploading: true }));
    setPhotos(prev => [...prev, ...items]);
    items.forEach(item => uploadOne(item.uri, item.key));
  };

  const pickFromLibrary = async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert('Accès à la photothèque refusé', 'Autorisez l\'accès dans Réglages › Baker › Photos.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError('Permission photothèque refusée');
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any, quality: 0.7, allowsMultipleSelection: true,
      selectionLimit: Math.max(1, MAX_PHOTOS - photos.length),
    });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets);
  };

  const pickFromCamera = async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert('Accès à la caméra refusé', 'Autorisez l\'accès dans Réglages › Baker › Appareil photo.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError('Permission caméra refusée');
      }
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    addAssets([result.assets[0]]);
  };

  const removePhoto = (key: string) => setPhotos(prev => prev.filter(p => p.key !== key));

  const filteredRecipes = recipeSearch.trim()
    ? recipes.filter(r => r.title.toLowerCase().includes(recipeSearch.trim().toLowerCase()))
    : recipes;

  const stillUploading = photos.some(p => p.uploading);

  const save = async () => {
    setError(null);
    if (!title.trim()) { setError('Le nom de la création est obligatoire.'); return; }
    if (photos.length === 0) { setError('Ajoutez au moins une photo.'); return; }
    if (stillUploading) { setError('Patientez, une photo est encore en cours d\'envoi.'); return; }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(), description: description.trim(), category,
        recipe_id: recipeId, photos: photos.map(p => p.path).filter(Boolean) as string[],
      };
      const saved = isEdit
        ? await api(`/creations/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/creations', { method: 'POST', body: JSON.stringify(payload) });
      showGamificationToast(saved.gamification);
      refreshUser();
      router.replace(`/creation/${saved.id}` as any);
    } catch (e: any) {
      setError(e.message || 'Publication impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="creation-form-close" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? 'Modifier' : 'Nouvelle création'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>PHOTOS</Text>
          <View style={styles.photoGrid}>
            {photos.map(p => (
              <View key={p.key} style={styles.photoThumbWrap} testID={`creation-photo-${p.key}`}>
                <Image source={{ uri: p.uri }} style={styles.photoThumb} contentFit="cover" />
                {p.uploading && (
                  <View style={styles.uploadOverlay}><ActivityIndicator color={colors.onBrandPrimary} size="small" /></View>
                )}
                <Pressable testID={`remove-photo-${p.key}`} onPress={() => removePhoto(p.key)} style={styles.removePhotoBtn}>
                  <Feather name="x" size={12} color={colors.onBrandPrimary} />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS && (
              <Pressable testID="add-photos-btn" onPress={() => setPhotoMenuOpen(true)} style={styles.addPhotoTile}>
                <Feather name="plus" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>

          <Field label="Nom de la création *">
            <TextInput testID="creation-title" value={title} onChangeText={setTitle} placeholder="Ex : Pain au levain" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>

          <Field label="Description">
            <TextInput
              testID="creation-description" value={description} onChangeText={setDescription}
              placeholder="T80, levain liquide, fermentation 18 h, cuisson sur sole." placeholderTextColor={colors.muted}
              style={[styles.input, styles.textArea]} multiline maxLength={DESCRIPTION_MAX_LENGTH}
            />
            <Text style={styles.charCount}>{description.length} / {DESCRIPTION_MAX_LENGTH}</Text>
          </Field>

          <Field label="Catégorie">
            <View style={styles.chipsRow}>
              {CREATION_CATEGORIES.map(c => (
                <Chip key={c} testID={`creation-cat-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          </Field>

          <Field label="Recette associée (facultatif)">
            {recipeId ? (
              <View style={styles.recipeChosenRow}>
                <Text style={styles.recipeChosenText} numberOfLines={1}>{recipeTitle}</Text>
                <Pressable testID="clear-recipe" onPress={() => { setRecipeId(null); setRecipeTitle(null); }}>
                  <Feather name="x" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ) : (
              <Pressable testID="pick-recipe-toggle" onPress={() => setPickingRecipe(v => !v)} style={styles.addBtn}>
                <Feather name={pickingRecipe ? 'x' : 'plus'} size={16} color={colors.brand} />
                <Text style={styles.addBtnText}>{pickingRecipe ? 'Fermer' : 'Associer une recette'}</Text>
              </Pressable>
            )}
            {pickingRecipe && !recipeId && (
              <View style={styles.picker}>
                <TextInput
                  testID="recipe-search" value={recipeSearch} onChangeText={setRecipeSearch}
                  placeholder="Rechercher une recette…" placeholderTextColor={colors.muted}
                  style={[styles.input, { marginBottom: 8 }]}
                />
                <ScrollView style={{ maxHeight: 220 }}>
                  {filteredRecipes.slice(0, 50).map(r => (
                    <Pressable
                      key={r.id} testID={`pick-recipe-${r.id}`}
                      onPress={() => { setRecipeId(r.id); setRecipeTitle(r.title); setPickingRecipe(false); }}
                      style={styles.pickRow}
                    >
                      <Text style={styles.pickTitle} numberOfLines={1}>{r.title}</Text>
                      <Feather name="plus-circle" size={18} color={colors.brand} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </Field>

          {error && <Text style={styles.error} testID="creation-error">{error}</Text>}

          <Button
            testID="publish-creation-btn" onPress={save} disabled={saving || stillUploading} loading={saving}
            label={isEdit ? 'Enregistrer' : 'Publier'} style={{ marginTop: 8 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={photoMenuOpen}
        title="Ajouter des photos"
        onClose={() => setPhotoMenuOpen(false)}
        options={[
          { key: 'camera', icon: 'camera', label: 'Prendre une photo', onPress: pickFromCamera },
          { key: 'library', icon: 'image', label: 'Choisir dans la photothèque', onPress: pickFromLibrary },
        ]}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  form: { padding: 24, paddingBottom: 40 },
  label: { fontSize: 11, letterSpacing: 2, color: colors.muted, marginBottom: 8, fontWeight: '600' },
  input: { fontSize: 15, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 10 },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: colors.muted, textAlign: 'right', marginTop: 4 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: colors.error, fontSize: 13, marginBottom: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  photoThumbWrap: { width: 84, height: 84, borderRadius: 8, overflow: 'hidden', position: 'relative', backgroundColor: colors.surfaceSecondary },
  photoThumb: { width: '100%', height: '100%' },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  removePhotoBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, backgroundColor: 'rgba(42,31,26,0.7)', alignItems: 'center', justifyContent: 'center' },
  addPhotoTile: { width: 84, height: 84, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  addBtnText: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  recipeChosenRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceSecondary,
    borderRadius: theme.radius.lg, paddingHorizontal: 14, paddingVertical: 12,
    ...cardElevation(mode, colors),
  },
  recipeChosenText: { flex: 1, fontSize: 14, color: colors.onSurface, fontWeight: '500' },
  picker: { marginTop: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 10 },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 6 },
  pickTitle: { flex: 1, fontSize: 14, color: colors.onSurface },
});
