import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import {
  QUANTITY_MAX, QUANTITY_MIN, formatMultiplierForInput, resolveManualQuantity, stepDown, stepUp,
} from '@/src/ingredientScale';

type Props = {
  value: number;
  onChange: (value: number) => void;
  testID?: string;
};

/**
 * Le sélecteur de quantité d'une fiche technique : −, un champ de saisie, +.
 *
 * Boutons et champ partagent le même état — `value`, chez l'appelant — pour
 * qu'aucun des deux ne puisse se désynchroniser de l'autre. Les boutons ne
 * connaissent que les entiers de 1 à 1000 ; 0,5 n'existe que pour qui le
 * tape, et seulement à la validation (`resolveManualQuantity`) — pas à
 * chaque frappe, sinon il serait impossible de taper "0,5" caractère par
 * caractère sans se faire corriger avant d'avoir fini.
 */
export function QuantitySelector({ value, onChange, testID }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const [text, setText] = useState(formatMultiplierForInput(value));
  const focused = useRef(false);

  // Le champ suit la valeur committée tant que l'utilisateur ne le modifie
  // pas lui-même — sinon un appui sur "+" pendant qu'il tape écraserait sa
  // saisie en cours.
  useEffect(() => {
    if (!focused.current) setText(formatMultiplierForInput(value));
  }, [value]);

  const commit = (next: number) => {
    onChange(next);
    setText(formatMultiplierForInput(next));
  };

  const handleChangeText = (raw: string) => {
    setText(raw);
    // Recalcul instantané pendant la frappe, mais seulement pour une valeur
    // déjà plausible en l'état (≥ 1, ou 0,5 pile) : une saisie encore
    // incomplète comme "0" ou "0," ne doit pas faire retomber la fiche à
    // zéro le temps que l'utilisateur termine "0,5".
    const parsed = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(parsed) && (parsed === 0.5 || parsed >= QUANTITY_MIN)) {
      onChange(Math.min(QUANTITY_MAX, parsed));
    }
  };

  const handleBlur = () => {
    focused.current = false;
    commit(resolveManualQuantity(text));
  };

  const canDec = value > QUANTITY_MIN;
  const canInc = value < QUANTITY_MAX;

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.label}>QUANTITÉ</Text>
      <View style={styles.row}>
        <Pressable
          testID="qty-minus"
          onPress={() => commit(stepDown(value))}
          disabled={!canDec}
          style={[styles.btn, !canDec && styles.btnDisabled]}
        >
          <Feather name="minus" size={18} color={canDec ? colors.brand : colors.muted} />
        </Pressable>
        <TextInput
          testID="qty-input"
          value={text}
          onChangeText={handleChangeText}
          onFocus={() => { focused.current = true; }}
          onBlur={handleBlur}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={styles.input}
        />
        <Pressable
          testID="qty-plus"
          onPress={() => commit(stepUp(value))}
          disabled={!canInc}
          style={[styles.btn, !canInc && styles.btnDisabled]}
        >
          <Feather name="plus" size={18} color={canInc ? colors.brand : colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  card: {
    marginTop: theme.spacing.xl, marginHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg,
    alignItems: 'center',
    ...cardElevation(mode, colors),
  },
  label: { fontSize: 10, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
  btn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { backgroundColor: colors.border },
  input: {
    minWidth: 64, textAlign: 'center', fontFamily: theme.serif,
    fontSize: theme.fontSize.xxl, color: colors.onSurface, paddingVertical: 4,
  },
});
