import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTimer, formatTime } from '@/src/TimerContext';
import { theme } from '@/src/theme';

export default function TimerBar() {
  const { timer, paused, pause, resume, stop } = useTimer();
  const insets = useSafeAreaInsets();
  if (!timer.active) return null;

  const done = timer.remaining <= 0;

  return (
    <View testID="timer-bar" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.inner}>
        <View style={[styles.iconWrap, done && { backgroundColor: theme.color.success }]}>
          <Feather name={done ? 'check' : 'clock'} size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label} numberOfLines={1}>{done ? 'Minuteur terminé !' : timer.label}</Text>
          <Text style={styles.time}>{done ? '00:00' : formatTime(timer.remaining)}</Text>
        </View>
        {!done && (
          <Pressable testID="timer-toggle" onPress={paused ? resume : pause} style={styles.ctrlBtn}>
            <Feather name={paused ? 'play' : 'pause'} size={18} color={theme.color.onSurface} />
          </Pressable>
        )}
        <Pressable testID="timer-stop" onPress={stop} style={styles.ctrlBtn}>
          <Feather name="x" size={18} color={theme.color.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 90 },
  inner: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.color.surface, borderRadius: 12, padding: 12, gap: 12, borderWidth: 1, borderColor: theme.color.borderStrong, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  iconWrap: { width: 34, height: 34, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, color: theme.color.muted },
  time: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface },
  ctrlBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
});
