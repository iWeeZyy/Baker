/**
 * Feuille "Ajouter à une collection" : une case à cocher par collection de
 * l'utilisateur, chacune togglant indépendamment sa propre route — jamais un
 * endpoint batch, cohérent avec le fait qu'aucune route de cette app n'accepte
 * un tableau de mutations en un seul appel. `__favorites__` n'apparaît jamais
 * ici : le save global reste le bouton bookmark existant sur la fiche
 * recette, cette feuille ne gère que les collections personnalisées.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { showGamificationToast } from '@/src/gamification/UnlockToast';

type Row = { id: string; name: string; recipe_count: number; in_collection: boolean };

export function AddToCollectionModal({
  visible,
  recipeId,
  onClose,
}: {
  visible: boolean;
  recipeId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refreshUser } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api(`/collections?recipe_id=${recipeId}`)
      .then((list: any[]) => setRows(list.filter(c => c.id !== '__favorites__')))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [visible, recipeId]);

  const toggle = async (row: Row) => {
    setBusyId(row.id);
    const want = !row.in_collection;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, in_collection: want } : r)));
    try {
      await api(`/collections/${row.id}/recipes/${recipeId}`, { method: want ? 'POST' : 'DELETE' });
    } catch {
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, in_collection: !want } : r)));
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await api('/collections', { method: 'POST', body: JSON.stringify({ name }) });
      await api(`/collections/${created.id}/recipes/${recipeId}`, { method: 'POST' });
      setRows(prev => [{ id: created.id, name: created.name, recipe_count: 1, in_collection: true }, ...prev]);
      setNewName('');
      setCreating(false);
      showGamificationToast(created.gamification);
      refreshUser();
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Ajouter à une collection</Text>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
          ) : (
            <View style={{ maxHeight: 340 }}>
              {rows.map(row => (
                <Pressable
                  key={row.id}
                  testID={`add-to-collection-${row.id}`}
                  onPress={() => toggle(row)}
                  disabled={busyId === row.id}
                  style={styles.row}
                >
                  <Feather
                    name={row.in_collection ? 'check-square' : 'square'}
                    size={20}
                    color={row.in_collection ? colors.brand : colors.muted}
                  />
                  <Text style={styles.rowText}>{row.name}</Text>
                  <Text style={styles.rowCount}>{row.recipe_count}</Text>
                </Pressable>
              ))}
              {!rows.length && <Text style={styles.empty}>Aucune collection pour l&apos;instant.</Text>}
            </View>
          )}

          {creating ? (
            <View style={styles.newRow}>
              <TextInput
                testID="new-collection-name"
                value={newName}
                onChangeText={setNewName}
                placeholder="Nom de la collection"
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoFocus
              />
              <Pressable testID="new-collection-confirm" onPress={createAndAdd} style={styles.newRowBtn}>
                <Feather name="check" size={18} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
          ) : (
            <Pressable testID="add-to-collection-new" onPress={() => setCreating(true)} style={styles.option}>
              <Feather name="plus" size={18} color={colors.brand} />
              <Text style={[styles.optionText, { color: colors.brand }]}>Nouvelle collection</Text>
            </Pressable>
          )}

          <Pressable testID="add-to-collection-done" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Terminé</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, paddingBottom: 40, gap: 4 },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, marginBottom: 12 },
  center: { paddingVertical: 24, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowText: { flex: 1, fontSize: 16, color: colors.onSurface, fontWeight: '500' },
  rowCount: { fontSize: 13, color: colors.muted },
  empty: { color: colors.muted, paddingVertical: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, marginTop: 4 },
  optionText: { fontSize: 16, fontWeight: '500' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surfaceSecondary,
  },
  newRowBtn: { width: 40, height: 40, borderRadius: theme.radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  cancelText: { fontSize: 15, color: colors.muted, fontWeight: '500' },
});
