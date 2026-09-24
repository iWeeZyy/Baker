import { View, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  interpolateColor,
  Extrapolation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/**
 * Points de progression — la puce active est plus large et de la couleur de
 * marque, les autres restent de simples ronds neutres. Même minimalisme à
 * deux tons que ProgressBar.tsx, réutilisé ici pour la découverte ET
 * l'inscription par étapes (un seul composant, deux écrans).
 *
 * Deux modes, tous les deux animés :
 * - continu (`scrollX`/`screenWidth` fournis, l'onboarding) : chaque puce
 *   interpole sa largeur/couleur directement depuis la position réelle du
 *   scroll, image par image — aussi fluide en swipe qu'au bouton "Continuer",
 *   jamais désynchronisée de `activeIndex`.
 * - discret (`signup.tsx`, qui n'a pas de scroll horizontal) : une valeur
 *   partagée transitionne en douceur (`withTiming`) vers le nouvel index,
 *   au lieu du swap de style instantané d'origine.
 */
export function StepDots({
  count,
  activeIndex,
  scrollX,
  screenWidth,
}: {
  count: number;
  activeIndex: number;
  scrollX?: SharedValue<number>;
  screenWidth?: number;
}) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <View style={styles.row} testID="step-dots">
      {Array.from({ length: count }).map((_, i) => (
        <Dot
          key={i}
          index={i}
          activeIndex={activeIndex}
          scrollX={scrollX}
          screenWidth={screenWidth}
          colors={colors}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}

function Dot({
  index,
  activeIndex,
  scrollX,
  screenWidth,
  colors,
  reducedMotion,
}: {
  index: number;
  activeIndex: number;
  scrollX?: SharedValue<number>;
  screenWidth?: number;
  colors: ThemeColors;
  reducedMotion: boolean;
}) {
  const continuous = !!scrollX && !!screenWidth;
  const fallback = useSharedValue(activeIndex === index ? 1 : 0);

  useEffect(() => {
    if (continuous) return;
    fallback.value = reducedMotion ? (activeIndex === index ? 1 : 0) : withTiming(activeIndex === index ? 1 : 0, { duration: 200 });
  }, [activeIndex, index, continuous, reducedMotion, fallback]);

  const style = useAnimatedStyle(() => {
    let progress: number;
    if (continuous) {
      const distance = Math.abs(scrollX!.value / screenWidth! - index);
      progress = reducedMotion ? (index === activeIndex ? 1 : 0) : interpolate(distance, [0, 1], [1, 0], Extrapolation.CLAMP);
    } else {
      progress = fallback.value;
    }
    return {
      width: interpolate(progress, [0, 1], [7, 20]),
      backgroundColor: interpolateColor(progress, [0, 1], [colors.surfaceTertiary, colors.brand]),
    };
  });

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
});
