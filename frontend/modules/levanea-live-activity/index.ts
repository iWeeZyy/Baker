/**
 * Module local (non publié) exposant le pont ActivityKit de
 * `ios/LevaneaLiveActivityModule.swift` à `app/production/[id].tsx`. Chaque
 * fonction est un best-effort silencieux : ni la disponibilité de
 * l'ActivityKit natif ni un échec côté iOS ne doivent jamais interrompre la
 * mise à jour du statut d'une étape, qui reste l'action principale.
 */
import { Platform } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';

declare class LevaneaLiveActivityNativeModule extends NativeModule<Record<string, never>> {
  start(recipeTitle: string, stepText: string, endAtIso: string | null): void;
  update(stepText: string, endAtIso: string | null): void;
  end(): void;
}

let native: LevaneaLiveActivityNativeModule | null | undefined;
function getNative(): LevaneaLiveActivityNativeModule | null {
  if (Platform.OS !== 'ios') return null;
  if (native === undefined) {
    try {
      native = requireNativeModule<LevaneaLiveActivityNativeModule>('LevaneaLiveActivity');
    } catch {
      native = null;
    }
  }
  return native;
}

export function startBakeActivity(recipeTitle: string, stepText: string, endAtIso: string | null) {
  try { getNative()?.start(recipeTitle, stepText, endAtIso); } catch {}
}

export function updateBakeActivity(stepText: string, endAtIso: string | null) {
  try { getNative()?.update(stepText, endAtIso); } catch {}
}

export function endBakeActivity() {
  try { getNative()?.end(); } catch {}
}
