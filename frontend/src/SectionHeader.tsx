/**
 * En-tête de section (titre + sous-titre optionnel + lien d'action
 * optionnel) — aligné sur le pattern déjà en place sur l'accueil
 * (`sectionTitle`, `theme.serif` 24px), remplace les variantes divergentes
 * recréées à la main sur plusieurs écrans (Profil, fiche recette,
 * Classement, Badges, Collections...).
 */
import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable testID={testID} onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 16 },
  texts: { flex: 1 },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4 },
  action: { fontSize: 13, color: colors.brand, fontWeight: '600' },
});
