import { Alert, Platform } from 'react-native';

/**
 * Une confirmation qui fonctionne sur web : `Alert.alert` de react-native-web
 * est un no-op complet — aucun bouton n'y est jamais "pressé", donc l'action
 * qu'il devait déclencher ne l'est jamais non plus. `window.confirm` est
 * bloquant et rend sa réponse directement, sans callback à perdre.
 */
export async function confirmAsync(
  title: string,
  message: string,
  confirmLabel = 'Confirmer',
  destructive = false,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
