import { useEffect, useState } from 'react';
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
import { theme } from '@/src/theme';

type Recipe = { id: string; title: string; category: string; yield_pieces?: number | null };
type Line = { key: string; recipe_id: string; quantity: string; mode: 'pieces' | 'batches' };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProductionForm() {
  const router = useRouter();
  // Same screen for both: `id` present means we are editing.
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id && id !== 'new';

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [date, setDate] = useState(todayISO());
  const [targetTime, setTargetTime] = useState('06:00');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api('/recipes');
        setRecipes(list);
        if (isEdit) {
          const p = await api(`/productions/${id}`);
          setDate(p.date);
          setTargetTime(p.target_time || '');
          setNotes(p.notes || '');
          setLines((p.lines || []).map((l: any, i: number) => ({
            key: `${l.line_id || i}`,
            recipe_id: l.recipe_id,
            quantity: String(l.quantity),
            mode: l.mode,
          })));
        }
      } catch (e: any) {
        setError(e.message || 'Chargement impossible');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  const recipeById = (rid: string) => recipes.find(r => r.id === rid);

  const addRecipe = (r: Recipe) => {
    setPicking(false);
    setLines(prev => [...prev, {
      key: `${r.id}-${Date.now()}`,
      recipe_id: r.id,
      quantity: '1',
      // Pieces only make sense when the recipe declares what a batch yields.
      mode: r.yield_pieces && r.yield_pieces > 0 ? 'pieces' : 'batches',
    }]);
  };

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  const save = async () => {
    setError(null);
    const payload = {
      date: date.trim(),
      target_time: targetTime.trim() || null,
      notes: notes.trim(),
      lines: lines.map(l => ({
        recipe_id: l.recipe_id,
        quantity: parseFloat(l.quantity.replace(',', '.')) || 0,
        mode: l.mode,
      })),
    };
    if (payload.lines.some(l => l.quantity <= 0)) {
      setError('Chaque recette doit avoir une quantité supérieure à 0.');
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit
        ? await api(`/productions/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/productions', { method: 'POST', body: JSON.stringify(payload) });
      router.replace(`/production/${saved.id}` as any);
    } catch (e: any) {
      // Hitting the Free ceiling is not a failure — it is the moment to explain Pro.
      if (isPlanLimitError(e)) router.push('/pro' as any);
      else setError(e.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync('Supprimer cette production', 'Cette action est définitive.', 'Supprimer', true);
    if (!ok) return;
    try {
      await api(`/productions/${id}`, { method: 'DELETE' });
      router.replace('/(tabs)/planning' as any);
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="prod-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEdit ? 'Modifier' : 'Nouvelle production'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.row}>
            <View style={{ flex: 1.4 }}>
              <Text style={styles.label}>DATE</Text>
              <TextInput
                testID="prod-date" value={date} onChangeText={setDate}
                placeholder="AAAA-MM-JJ" placeholderTextColor={theme.color.muted} style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>PRÊT À</Text>
              <TextInput
                testID="prod-time" value={targetTime} onChangeText={setTargetTime}
                placeholder="06:00" placeholderTextColor={theme.color.muted} style={styles.input}
              />
            </View>
          </View>
          <Text style={styles.hint}>
            L'heure cible sert à calculer à rebours l'horaire de chaque étape.
          </Text>

          <Text style={[styles.label, { marginTop: 26 }]}>RECETTES</Text>
          {lines.length === 0 && (
            <Text style={styles.emptyLines}>Aucune recette. Ajoutez-en une ci-dessous.</Text>
          )}

          {lines.map(line => {
            const r = recipeById(line.recipe_id);
            const canUsePieces = !!(r?.yield_pieces && r.yield_pieces > 0);
            return (
              <View key={line.key} style={styles.lineCard} testID={`line-${line.recipe_id}`}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineTitle} numberOfLines={1}>{r?.title || 'Recette'}</Text>
                  <Pressable testID={`remove-${line.recipe_id}`} onPress={() => removeLine(line.key)} style={styles.removeBtn}>
                    <Feather name="x" size={18} color={theme.color.muted} />
                  </Pressable>
                </View>

                <View style={styles.lineControls}>
                  <TextInput
                    testID={`qty-${line.recipe_id}`}
                    value={line.quantity}
                    onChangeText={v => updateLine(line.key, { quantity: v })}
                    keyboardType="numeric"
                    style={styles.qtyInput}
                  />
                  <View style={styles.modeSwitch}>
                    <Pressable
                      testID={`mode-pieces-${line.recipe_id}`}
                      onPress={() => canUsePieces && updateLine(line.key, { mode: 'pieces' })}
                      style={[styles.modeBtn, line.mode === 'pieces' && styles.modeBtnOn, !canUsePieces && { opacity: 0.35 }]}
                    >
                      <Text style={[styles.modeText, line.mode === 'pieces' && styles.modeTextOn]}>pièces</Text>
                    </Pressable>
                    <Pressable
                      testID={`mode-batches-${line.recipe_id}`}
                      onPress={() => updateLine(line.key, { mode: 'batches' })}
                      style={[styles.modeBtn, line.mode === 'batches' && styles.modeBtnOn]}
                    >
                      <Text style={[styles.modeText, line.mode === 'batches' && styles.modeTextOn]}>fournées</Text>
                    </Pressable>
                  </View>
                </View>

                {!canUsePieces && (
                  <Text style={styles.lineHint}>
                    Cette recette n'indique pas combien de pièces elle produit : la quantité se compte en fournées.
                  </Text>
                )}
              </View>
            );
          })}

          <Pressable testID="add-recipe" onPress={() => setPicking(v => !v)} style={styles.addBtn}>
            <Feather name={picking ? 'x' : 'plus'} size={16} color={theme.color.brand} />
            <Text style={styles.addBtnText}>{picking ? 'Fermer' : 'Ajouter une recette'}</Text>
          </Pressable>

          {picking && (
            <View style={styles.picker}>
              {recipes.map(r => (
                <Pressable key={r.id} testID={`pick-${r.id}`} onPress={() => addRecipe(r)} style={styles.pickRow}>
                  <Text style={styles.pickTitle} numberOfLines={1}>{r.title}</Text>
                  <Feather name="plus-circle" size={18} color={theme.color.brand} />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.label, { marginTop: 26 }]}>NOTES</Text>
          <TextInput
            testID="prod-notes" value={notes} onChangeText={setNotes} multiline
            placeholder="Livraison, client, remarques…" placeholderTextColor={theme.color.muted}
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          />

          {error && <Text style={styles.error} testID="prod-error">{error}</Text>}

          <Pressable
            testID="prod-save" onPress={save} disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Feather name="check" size={17} color="#fff" />
                <Text style={styles.saveText}>{isEdit ? 'Enregistrer' : 'Créer la production'}</Text>
              </>
            )}
          </Pressable>

          {isEdit && (
            <Pressable testID="prod-delete" onPress={confirmDelete} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>Supprimer cette production</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 14 },
  label: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, fontWeight: '600', marginBottom: 6 },
  input: { fontSize: 16, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, paddingVertical: 9 },
  hint: { fontSize: 12, color: theme.color.muted, marginTop: 8, lineHeight: 17 },
  emptyLines: { fontSize: 13, color: theme.color.muted, fontStyle: 'italic', marginBottom: 4 },
  lineCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 14, marginBottom: 10 },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineTitle: { flex: 1, fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface },
  removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  qtyInput: { width: 78, fontSize: 20, fontFamily: theme.serif, color: theme.color.onSurface, backgroundColor: theme.color.surface, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, textAlign: 'center' },
  modeSwitch: { flexDirection: 'row', backgroundColor: theme.color.surface, borderRadius: 6, padding: 3 },
  modeBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 5 },
  modeBtnOn: { backgroundColor: theme.color.brand },
  modeText: { fontSize: 13, color: theme.color.muted, fontWeight: '600' },
  modeTextOn: { color: '#fff' },
  lineHint: { fontSize: 11, color: theme.color.muted, marginTop: 9, lineHeight: 16 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.borderStrong, marginTop: 4 },
  addBtnText: { fontSize: 14, color: theme.color.brand, fontWeight: '600' },
  picker: { marginTop: 10, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  pickTitle: { flex: 1, fontSize: 15, color: theme.color.onSurface },
  error: { color: theme.color.error, fontSize: 13, marginTop: 16, lineHeight: 18 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: 8, marginTop: 26 },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 6 },
  deleteText: { color: theme.color.error, fontSize: 13, fontWeight: '600' },
});
