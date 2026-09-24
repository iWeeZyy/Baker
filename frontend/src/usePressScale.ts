import { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';

// Amortissement serré (ζ ≈ 0,93), mis au point sur l'écran de connexion :
// un ressort plus lâche faisait dépasser le bouton de 1,4 % de sa taille et
// osciller plus de 500 ms après le relâchement, perceptible comme un effet
// "élastique" plutôt qu'une pression premium.
const RELEASE_SPRING = { damping: 28, stiffness: 320, mass: 0.7 } as const;

/**
 * Compression au toucher réutilisée par tout élément pressable qui veut la
 * même interaction que le bouton "Se connecter" — un seul endroit pour ces
 * constantes plutôt qu'une copie par écran (auth.tsx, onboarding.tsx).
 */
export function usePressScale(reducedMotion: boolean, pressedScale = 0.97) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = () => {
    if (reducedMotion) return;
    scale.value = withTiming(pressedScale, { duration: 90 });
  };
  const onPressOut = () => {
    if (reducedMotion) return;
    scale.value = withSpring(1, RELEASE_SPRING);
  };

  return { style, onPressIn, onPressOut };
}
