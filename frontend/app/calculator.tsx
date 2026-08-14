import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export default function Calculator() {
  const router = useRouter();
  const [mode, setMode] = useState<'flour' | 'dough'>('flour');
  const [amount, setAmount] = useState('1000');
  const [hydration, setHydration] = useState('68');
  const [salt, setSalt] = useState('2');
  const [yeast, setYeast] = useState('1');
  const [levain, setLevain] = useState('20');
  const [useLevain, setUseLevain] = useState(false);

  const result = useMemo(() => {
    const amt = parseFloat(amount) || 0;
    const h = parseFloat(hydration) || 0;
    const s = parseFloat(salt) || 0;
    const y = parseFloat(yeast) || 0;
    const l = useLevain ? (parseFloat(levain) || 0) : 0;
    // total percentage relative to flour = 100 + h + s + y + l
    const totalPct = 100 + h + s + y + l;
    let flour: number;
    if (mode === 'flour') flour = amt;
    else flour = amt / (totalPct / 100); // dough weight -> flour
    const water = flour * (h / 100);
    const saltG = flour * (s / 100);
    const yeastG = flour * (y / 100);
    const levainG = flour * (l / 100);
    const dough = flour + water + saltG + yeastG + levainG;
    return {
      flour: Math.round(flour),
      water: Math.round(water),
      salt: Math.round(saltG * 10) / 10,
      yeast: Math.round(yeastG * 10) / 10,
      levain: Math.round(levainG),
      dough: Math.round(dough),
    };
  }, [amount, hydration, salt, yeast, levain, useLevain, mode]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="calc-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Calculateur</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>Basé sur la méthode du boulanger (pourcentages relatifs à la farine).</Text>

          <View style={styles.segment}>
            <Pressable testID="mode-flour" onPress={() => setMode('flour')} style={[styles.segBtn, mode === 'flour' && styles.segActive]}>
              <Text style={[styles.segText, mode === 'flour' && styles.segTextActive]}>Poids de farine</Text>
            </Pressable>
            <Pressable testID="mode-dough" onPress={() => setMode('dough')} style={[styles.segBtn, mode === 'dough' && styles.segActive]}>
              <Text style={[styles.segText, mode === 'dough' && styles.segTextActive]}>Poids de pâte</Text>
            </Pressable>
          </View>

          <Row label={mode === 'flour' ? 'Farine (g)' : 'Pâte souhaitée (g)'} value={amount} onChange={setAmount} testID="calc-amount" />
          <Row label="Hydratation (%)" value={hydration} onChange={setHydration} testID="calc-hydration" />
          <Row label="Sel (%)" value={salt} onChange={setSalt} testID="calc-salt" />
          <Row label="Levure (%)" value={yeast} onChange={setYeast} testID="calc-yeast" />

          <Pressable testID="toggle-levain" onPress={() => setUseLevain(v => !v)} style={styles.checkRow}>
            <View style={[styles.checkbox, useLevain && styles.checkboxOn]}>
              {useLevain && <Feather name="check" size={14} color="#fff" />}
            </View>
            <Text style={styles.checkLabel}>Ajouter du levain</Text>
          </Pressable>
          {useLevain && <Row label="Levain (%)" value={levain} onChange={setLevain} testID="calc-levain" />}

          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Votre recette</Text>
            <ResultRow label="Farine" value={`${result.flour} g`} />
            <ResultRow label="Eau" value={`${result.water} g`} />
            <ResultRow label="Sel" value={`${result.salt} g`} />
            <ResultRow label="Levure" value={`${result.yeast} g`} />
            {useLevain && <ResultRow label="Levain" value={`${result.levain} g`} />}
            <View style={styles.divider} />
            <ResultRow label="Poids total de pâte" value={`${result.dough} g`} strong />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange, testID }: any) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType="numeric" style={styles.input} placeholderTextColor={theme.color.muted} />
    </View>
  );
}

function ResultRow({ label, value, strong }: any) {
  return (
    <View style={styles.resultRow}>
      <Text style={[styles.resultLabel, strong && { color: theme.color.onSurface, fontWeight: '600' }]}>{label}</Text>
      <Text style={[styles.resultValue, strong && { fontSize: 22, color: theme.color.brand }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: theme.color.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  intro: { fontSize: 13, color: theme.color.muted, marginBottom: 24, lineHeight: 19 },
  segment: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: 4, padding: 4, marginBottom: 24 },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 4 },
  segActive: { backgroundColor: theme.color.surface },
  segText: { fontSize: 13, color: theme.color.muted, fontWeight: '500' },
  segTextActive: { color: theme.color.onSurface },
  field: { marginBottom: 18 },
  label: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, marginBottom: 6, fontWeight: '600' },
  input: { fontSize: 18, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, paddingVertical: 8, fontFamily: theme.serif },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  checkLabel: { fontSize: 15, color: theme.color.onSurface },
  resultCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 20, marginTop: 12 },
  resultTitle: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface, marginBottom: 16 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  resultLabel: { fontSize: 15, color: theme.color.onSurfaceSecondary },
  resultValue: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface },
  divider: { height: 1, backgroundColor: theme.color.borderStrong, marginVertical: 8 },
});
