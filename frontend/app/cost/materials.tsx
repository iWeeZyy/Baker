import { useCallback, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { EmptyState } from '@/src/EmptyState';
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
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
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
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Matières premières</Text>
        <Pressable testID="materials-add" onPress={() => router.push('/cost/material-form')} style={styles.iconBtn}>
          <Feather name="plus" size={22} color={colors.brand} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : materials.length === 0 ? (
        <EmptyState
          icon="shopping-bag"
          title="Aucune matière première"
          subtitle={"Enregistrez vos prix d'achat : farine, beurre, sucre…\nLevanea calcule le prix au kilo, au litre ou à la pièce."}
          ctaLabel="Ajouter une matière première"
          onCta={() => router.push('/cost/material-form')}
          testID="materials-add-empty"
        />
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
                    <Feather name="trash-2" size={16} color={colors.muted} />
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

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.onSurface },
  meta: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
  metaSecondary: { fontSize: 12, color: colors.muted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  unitPrice: { fontFamily: theme.serif, fontSize: 17, color: colors.brand },
});
