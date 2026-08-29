import { Text, StyleSheet, type TextStyle } from 'react-native';
import { useMemo } from 'react';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import type { CompactLevel } from './types';

/**
 * "🥖 Niveau N — Titre", discret, réutilisé partout où un niveau doit
 * apparaître sans occuper d'espace : profil (propre et public), fiche
 * recette (ligne auteur), commentaires, classement. Ne rend rien si aucun
 * niveau n'est fourni (recette de catalogue sans auteur, par exemple).
 */
export function LevelBadge({ level, compact, style }: { level?: CompactLevel | null; compact?: boolean; style?: TextStyle }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!level) return null;
  return (
    <Text style={[compact ? styles.compact : styles.full, style]} numberOfLines={1}>
      {compact ? `Niveau ${level.level}` : `🥖 Niveau ${level.level} — ${level.title}`}
    </Text>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  full: { fontSize: theme.fontSize.sm, color: colors.onSurfaceSecondary, fontWeight: '600' },
  compact: { fontSize: theme.fontSize.sm, color: colors.muted },
});
