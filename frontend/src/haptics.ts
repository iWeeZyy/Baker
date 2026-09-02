/**
 * Petit enrobage autour d'`expo-haptics` — dépendance déjà installée mais
 * jamais câblée nulle part avant cette passe. Même garde `Platform.OS !==
 * 'web'` + try/catch que `notifications.ts`'s `timerFinishedFeedback()`,
 * le seul autre retour physique existant dans l'app (Vibration sur la fin
 * d'un minuteur) : un geste tactile ne doit jamais faire planter l'action
 * qu'il accompagne.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Un tap léger — j'aime, favori, abonnement : une bascule rapide et réversible. */
export function tapFeedback() {
  try {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

/** Une réussite notable — déblocage de niveau ou de badge. */
export function successFeedback() {
  try {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}
