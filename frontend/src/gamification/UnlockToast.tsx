/**
 * Toast léger "🎉 Niveau supérieur !" / "🏅 Nouveau badge !" — monté une
 * seule fois à la racine de l'app (app/_layout.tsx), à côté de `TimerBar`,
 * même principe d'overlay global mais son propre état, pas de prop-drilling.
 *
 * Deux canaux d'alimentation, cohérents avec la direction de chaque type
 * d'XP (voir gamification.py côté serveur) :
 *  - `showGamificationToast(result)` — appelé par un écran juste après une
 *    action qui vient de renvoyer un champ `gamification` non vide (publier,
 *    commenter, devenir ami, suivre, créer une collection) : l'acteur voit
 *    son propre gain immédiatement, à partir de la réponse qu'il a déjà.
 *  - l'événement WebSocket `notification` (type `level_up`/`badge_unlocked`)
 *    — pour un gain causé par un tiers (recevoir un like/un commentaire/un
 *    abonné), la seule façon de prévenir l'utilisateur qui progresse,
 *    exactement comme les autres types de notification déjà en place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeRealtime } from '@/src/realtime';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import type { GamificationResult } from './types';

type ToastEvent =
  | { kind: 'level_up'; level: number; title: string }
  | { kind: 'badge_unlocked'; id: string; name: string; icon: string; description?: string | null };

const listeners = new Set<(e: ToastEvent) => void>();

function emit(e: ToastEvent) {
  listeners.forEach((l) => l(e));
}

/** Appelé par un écran juste après une action qui a renvoyé un `gamification`
 * non vide — voir `hasGamificationToShow`. */
export function showGamificationToast(result?: GamificationResult | null) {
  if (!result) return;
  if (result.leveled_up) emit({ kind: 'level_up', level: result.leveled_up.level, title: result.leveled_up.title });
  for (const b of result.badges_unlocked) {
    emit({ kind: 'badge_unlocked', id: b.id, name: b.name, icon: b.icon });
  }
}

const AUTO_DISMISS_MS = 3500;

export function UnlockToast() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastEvent | null>(null);
  const queue = useRef<ToastEvent[]>([]);
  const anim = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNext = () => {
    const next = queue.current.shift();
    if (!next) return;
    setCurrent(next);
  };

  useEffect(() => {
    const onEvent = (e: ToastEvent) => {
      queue.current.push(e);
      if (!current) showNext();
    };
    listeners.add(onEvent);
    const unsubscribe = subscribeRealtime((evt) => {
      if (evt.type !== 'notification') return;
      const n = evt.notification;
      if (n.type === 'level_up' && n.data) {
        onEvent({ kind: 'level_up', level: n.data.level, title: n.data.title });
      } else if (n.type === 'badge_unlocked' && n.data) {
        onEvent({ kind: 'badge_unlocked', id: n.target_id, name: n.data.name, icon: n.data.icon, description: n.data.description });
      }
    });
    return () => { listeners.delete(onEvent); unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!current) return;
    Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const dismiss = () => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setCurrent(null);
      showNext();
    });
  };

  if (!current) return null;

  const onPress = () => {
    if (current.kind === 'badge_unlocked') {
      dismiss();
      router.push(`/badge/${current.id}` as any);
    }
  };

  return (
    <Animated.View
      testID="gamification-toast"
      style={[
        styles.wrap,
        { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
      ]}
    >
      <Pressable onPress={onPress} style={styles.card}>
        {current.kind === 'level_up' ? (
          <>
            <Text style={styles.emoji}>🎉</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Niveau supérieur !</Text>
              <Text style={styles.subtitle}>Niveau {current.level} — {current.title}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.emoji}>{current.icon || '🏅'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Nouveau badge !</Text>
              <Text style={styles.subtitle}>{current.name}</Text>
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 999, alignItems: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: theme.radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.border, width: '100%', maxWidth: 420,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  emoji: { fontSize: 26 },
  title: { fontSize: theme.fontSize.base, fontWeight: '700', color: colors.onSurface },
  subtitle: { fontSize: theme.fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
});
