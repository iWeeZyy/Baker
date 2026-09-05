/**
 * Système/Clair/Sombre — une préférence locale à l'appareil, jamais liée au
 * compte (donc jamais réinitialisée à la déconnexion), persistée avec le
 * même patron que src/revealedPhotos.ts : cache en mémoire, écriture
 * optimiste, échec de lecture/écriture silencieusement absorbé et retombant
 * sur 'light' (défaut choisi plutôt que 'system' pour un premier lancement
 * prévisible). Le mode "Système" reste un choix explicite disponible dans
 * Réglages et s'appuie sur useColorScheme() de react-native, déjà réactif
 * à un changement d'apparence iOS sans code supplémentaire.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK_COLORS, LIGHT_COLORS, type ThemeColors } from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';

const KEY = 'levanea_theme_preference';

type ThemeCtx = {
  colors: ThemeColors;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
};

const Ctx = createContext<ThemeCtx>({
  colors: LIGHT_COLORS,
  mode: 'light',
  preference: 'light',
  setPreference: () => {},
});

export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('light');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') setPreferenceState(raw);
      } catch {
        // Reste sur 'light' par défaut.
      }
    })();
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(KEY, pref).catch(() => {
      // Best-effort : au pire le réglage revient à 'system' à la prochaine ouverture.
    });
  }, []);

  const mode: ThemeMode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  // Le CSS n'a aucun moyen d'exprimer la pseudo-classe :-webkit-autofill via
  // le style inline de React Native Web — la règle qui neutralise le jaune
  // d'autofill du navigateur vit dans public/index.html et lit ces variables
  // pour rester synchronisée avec le thème actif, y compris lors d'une
  // bascule à chaud (Réglages), sans rechargement de page.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.setProperty('--rn-input-bg', colors.surfaceSecondary);
    document.documentElement.style.setProperty('--rn-input-fg', colors.onSurface);
  }, [colors]);

  return (
    <Ctx.Provider value={{ colors, mode, preference, setPreference }}>
      {children}
    </Ctx.Provider>
  );
}
