import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { theme } from '@/src/theme';
import type { RawMaterial } from '@/src/cost/costCalc';

function unitPriceOf(m: RawMaterial): { value: number; label: string } | null {
  if (m.price_per_kg != null) return { value: m.price_per_kg, label: '/kg' };
  if (m.price_per_l != null) return { value: m.price_per_l, label: '/L' };
  if (m.price_per_piece != null) return { value: m.price_per_piece, label: '/pièce' };
  return null;
}

/**
 * La liste des matières premières, prix centralisés : une modification ici
 * vaut pour tous les calculs futurs (mais jamais pour un calcul déjà
 * enregistré dans l'historique, qui reste figé à son propre prix).
 */
export default function RawMaterials() {
  const router = useRouter();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const docs = await api('/raw-materials');
      setMaterials(docs);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (m: RawMaterial) => {
    const confirmed = await confirmAsync(
      'Supprimer cette matière première ?',
      `« ${m.name} » ne sera plus proposée dans les calculs de coût.`,
      'Supprimer', true,
    );
    if (!confirmed) return;
    await api(`/raw-materials/${m.id}`, { method: 'DELETE' });
    setMaterials(prev => prev.filter(x => x.id !== m.id));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="materials-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Matières premières</Text>
        <Pressable testID="materials-add" onPress={() => router.push('/cost/material-form')} style={styles.iconBtn}>
          <Feather name="plus" size={22} color={theme.color.brand} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : materials.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="shopping-bag" size={38} color={theme.color.muted} />
          <Text style={styles.emptyTitle}>Aucune matière première</Text>
          <Text style={styles.emptyText}>
            Enregistrez vos prix d&apos;achat : farine, beurre, sucre…{'\n'}
            Bakers calcule le prix au kilo, au litre ou à la pièce.
          </Text>
          <Pressable testID="materials-add-empty" onPress={() => router.push('/cost/material-form')} style={styles.addBtn}>
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.addBtnText}>Ajouter une matière première</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 16, paddingBottom: 60, gap: 12 }}>
          {materials.map(m => {
            const unit = unitPriceOf(m);
            return (
              <Pressable
                key={m.id}
                testID={`material-${m.id}`}
                onPress={() => router.push(`/cost/material-form?id=${m.id}`)}
                style={styles.card}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{m.name}</Text>
                  <Text style={styles.meta}>
                    Achat : {m.purchase_quantity} {m.purchase_unit === 'piece' ? 'pièce(s)' : m.purchase_unit} · {m.purchase_price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </Text>
                  {(m.category || m.supplier) && (
                    <Text style={styles.metaSecondary}>
                      {[m.category, m.supplier].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                <View style={styles.right}>
                  {unit && (
                    <Text style={styles.unitPrice}>
                      {unit.value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €{unit.label}
                    </Text>
                  )}
                  <Pressable testID={`material-delete-${m.id}`} onPress={() => remove(m)} hitSlop={10} style={{ marginTop: 10 }}>
                    <Feather name="trash-2" size={16} color={theme.color.muted} />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, textAlign: 'center' },
  emptyText: { fontSize: 14, color: theme.color.muted, textAlign: 'center', lineHeight: 20 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.brand, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 999, marginTop: 8 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 16 },
  name: { fontSize: 16, fontWeight: '600', color: theme.color.onSurface },
  meta: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  metaSecondary: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  unitPrice: { fontFamily: theme.serif, fontSize: 17, color: theme.color.brand },
});
