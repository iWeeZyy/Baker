import { Platform, Vibration } from 'react-native';
import { createAudioPlayer } from 'expo-audio';

let Notifications: any = null;
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // In foreground the app plays its own sound + shows the TimerBar
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {}
}

let permissionAsked = false;
export async function ensureNotifPermissions() {
  if (!Notifications || permissionAsked) return;
  permissionAsked = true;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return;
    if (cur.canAskAgain) await Notifications.requestPermissionsAsync();
  } catch {}
}

export async function scheduleTimerNotification(label: string, seconds: number): Promise<string | null> {
  if (!Notifications || seconds <= 0) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Minuteur terminé !',
        body: `${label} — c'est prêt, retournez à votre pâte !`,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval',
        seconds,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelTimerNotification(id: string | null) {
  if (!Notifications || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}

let player: any = null;
export function timerFinishedFeedback() {
  try {
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 400, 200, 400, 200, 600]);
    }
    if (!player) player = createAudioPlayer(require('../assets/sounds/timer-done.wav'));
    player.seekTo(0);
    player.play();
  } catch {}
}
