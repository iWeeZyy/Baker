/**
 * Bouton partagé (primaire/secondaire/texte) — remplace les styles
 * `primaryBtn`/`primaryBtnText` recréés à la main dans une dizaine
 * d'écrans (auth.tsx, signup.tsx, onboarding.tsx, share.tsx...), tous
 * légèrement divergents. `loading` reprend le pattern déjà établi
 * (`submitting ? <ActivityIndicator/> : <Text>`) plutôt que d'en inventer
 * un nouveau.
 */
import { useMemo } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type ButtonVariant = 'primary' | 'secondary' | 'text';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  fullWidth = true,
  icon,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  testID?: string;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDisabled = disabled || loading;
  const textColor = variant === 'primary' ? colors.onBrandPrimary : variant === 'secondary' ? colors.onSurface : colors.brand;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'text' && styles.text,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon && <Feather name={icon} size={18} color={textColor} />}
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 20, borderRadius: theme.radius.lg },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  text: { backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 8 },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.6 },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
