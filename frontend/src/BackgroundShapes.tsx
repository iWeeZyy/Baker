import { View, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withRepeat, Easing } from 'react-native-reanimated';
import { type ThemeColors } from '@/src/theme';

// Formes organiques très discrètes derrière le contenu — jamais interactives
// (`pointerEvents="none"`), uniquement `transform`/`opacity` (aucun coût de
// mise en page), dérive lente (7 à 9,6 s par cycle) désactivée sous reduced
// motion. Couleurs exclusivement issues des tokens du thème. Amplitude
// volontairement modeste (revue produit sur l'écran de connexion : des
// cercles pleins sans flou, même lents, restaient trop graphiques — l'objectif
// est un fond « ressenti plutôt que remarqué »). Partagé par `auth.tsx` et
// `onboarding.tsx` plutôt que dupliqué.
export function BackgroundShapes({ colors, reducedMotion }: { colors: ThemeColors; reducedMotion: boolean }) {
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);
  const t3 = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    t1.value = withRepeat(withTiming(1, { duration: 8200, easing: Easing.inOut(Easing.sin) }), -1, true);
    t2.value = withRepeat(withTiming(1, { duration: 9600, easing: Easing.inOut(Easing.sin) }), -1, true);
    t3.value = withRepeat(withTiming(1, { duration: 7100, easing: Easing.inOut(Easing.sin) }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style1 = useAnimatedStyle(() => ({
    opacity: 0.3 + t1.value * 0.14,
    transform: [{ translateX: t1.value * 15 }, { translateY: t1.value * -11 }],
  }));
  const style2 = useAnimatedStyle(() => ({
    opacity: 0.24 + t2.value * 0.12,
    transform: [{ translateX: t2.value * -13 }, { translateY: t2.value * 14 }],
  }));
  const style3 = useAnimatedStyle(() => ({
    opacity: 0.18 + t3.value * 0.1,
    transform: [{ translateX: t3.value * 10 }, { translateY: t3.value * 9 }],
  }));

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Animated.View style={[blobLayout.a, { backgroundColor: colors.brandTertiary }, style1]} />
      <Animated.View style={[blobLayout.b, { backgroundColor: colors.brandSecondary }, style2]} />
      <Animated.View style={[blobLayout.c, { backgroundColor: colors.surfaceTertiary }, style3]} />
    </View>
  );
}

const blobLayout = StyleSheet.create({
  a: { position: 'absolute', top: '-9%', right: '-14%', width: 300, height: 300, borderRadius: 999 },
  b: { position: 'absolute', bottom: '-8%', left: '-16%', width: 340, height: 340, borderRadius: 999 },
  c: { position: 'absolute', top: '28%', left: '58%', width: 200, height: 200, borderRadius: 999 },
});
