/**
 * Barre de progression au scroll — un fin trait sous l'en-tête de l'écran
 * qui se remplit à mesure qu'on descend dans le contenu, comme un article
 * qu'on lit jusqu'au bout. Volontairement générique : `useScrollProgress()`
 * retourne un `onScroll` à poser sur n'importe quel `ScrollView`/`FlatList`
 * existant (fusionné avec un `onScroll` déjà présent, jamais en remplacer
 * un) et une valeur `progress` (0→1) à passer à `<ScrollProgressBar>`.
 *
 * État React simple (`useState`), pas Reanimated — reconvertir chaque
 * `ScrollView`/`FlatList` de l'app en `Animated.ScrollView` juste pour ce
 * fil de progression aurait été un changement bien plus large que ce que
 * demande une barre purement décorative ; `scrollEventThrottle={16}` suffit
 * largement à un remplissage fluide pour ce composant seul (il ne pilote
 * rien d'autre).
 */
import { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export function useScrollProgress() {
  const [progress, setProgress] = useState(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const scrollable = contentSize.height - layoutMeasurement.height;
    // Contenu plus court que l'écran (rien à faire défiler) : jamais de
    // division par une valeur nulle/négative, la barre reste vide plutôt
    // que de sauter à 100 %.
    setProgress(scrollable > 1 ? Math.min(1, Math.max(0, contentOffset.y / scrollable)) : 0);
  }, []);

  return { progress, onScroll };
}

export function ScrollProgressBar({ progress, testID }: { progress: number; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.track} pointerEvents="none" testID={testID}>
      <View style={[styles.fill, { width: `${progress * 100}%` }]} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  track: { height: 2, width: '100%', backgroundColor: colors.divider, overflow: 'hidden' },
  fill: { height: 2, backgroundColor: colors.brand, borderRadius: theme.radius.pill },
});
