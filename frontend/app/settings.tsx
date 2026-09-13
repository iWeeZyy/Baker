import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemePreference } from '@/src/ThemeContext';

const OPTIONS: { key: ThemePreference; icon: any; label: string; body: string }[] = [
  { key: 'system', icon: 'smartphone', label: 'Système', body: "Suit le réglage d'apparence de l'appareil." },
  { key: 'light', icon: 'sun', label: 'Clair', body: 'Toujours le thème clair, quel que soit le réglage système.' },
  { key: 'dark', icon: 'moon', label: 'Sombre', body: 'Toujours le thème sombre, quel que soit le réglage système.' },
];

type PrivacyKey = 'friends_only' | 'followers' | 'friends_and_followers' | 'everyone';

const PRIVACY_OPTIONS: { key: PrivacyKey; icon: any; label: string; body: string }[] = [
  { key: 'friends_only', icon: 'users', label: 'Amis uniquement', body: 'Seuls vos amis peuvent vous envoyer un message.' },
  { key: 'followers', icon: 'rss', label: 'Personnes qui me suivent', body: 'Toute personne qui vous suit peut vous envoyer un message.' },
  { key: 'friends_and_followers', icon: 'user-check', label: 'Amis et abonnés', body: 'Vos amis et vos abonnés peuvent vous envoyer un message.' },
  { key: 'everyone', icon: 'globe', label: 'Tout le monde', body: 'Tout utilisateur peut vous envoyer un message.' },
];

type NotifKey = 'notify_new_follower' | 'notify_new_recipe' | 'notify_new_creation';

const NOTIF_OPTIONS: { key: NotifKey; icon: any; label: string; body: string }[] = [
  { key: 'notify_new_follower', icon: 'user-plus', label: 'Nouveaux abonnés', body: "Être notifié quand quelqu'un commence à vous suivre." },
  { key: 'notify_new_recipe', icon: 'book-open', label: 'Nouvelles recettes', body: 'Être notifié quand une personne suivie publie une recette.' },
  { key: 'notify_new_creation', icon: 'camera', label: 'Nouvelles créations', body: 'Être notifié quand une personne suivie publie une création.' },
];

export default function Settings() {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, updateProfile, logoutAllDevices } = useAuth();
  const [busyKey, setBusyKey] = useState<NotifKey | null>(null);
  const [busyPrivacy, setBusyPrivacy] = useState(false);
  const [busyLogoutAll, setBusyLogoutAll] = useState(false);

  const handleLogoutAllDevices = async () => {
    const confirmed = await confirmAsync(
      'Se déconnecter de tous les appareils ?',
      'Tous les appareils actuellement connectés à votre compte, y compris celui-ci, devront se reconnecter.',
      'Déconnecter tout', true,
    );
    if (!confirmed) return;
    setBusyLogoutAll(true);
    try {
      await logoutAllDevices();
      // Plus rien à faire ensuite : logoutAllDevices() met `user` à null, ce
      // qui déclenche la redirection vers /auth déjà gérée par
      // (tabs)/_layout.tsx — même mécanisme qu'un logout() normal.
    } catch (e) {
      console.warn(e);
      setBusyLogoutAll(false);
    }
  };

  const toggleNotif = async (key: NotifKey) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await updateProfile({ [key]: !(user?.[key] ?? true) });
    } catch (e) { console.warn(e); }
    finally { setBusyKey(null); }
  };

  const setPrivacy = async (key: PrivacyKey) => {
    if (busyPrivacy || user?.message_privacy === key) return;
    setBusyPrivacy(true);
    try {
      await updateProfile({ message_privacy: key });
    } catch (e) { console.warn(e); }
    finally { setBusyPrivacy(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="settings-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Réglages</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>APPARENCE</Text>
        <View style={styles.card}>
          {OPTIONS.map((opt, i) => {
            const active = preference === opt.key;
            return (
              <Pressable
                key={opt.key}
                testID={`theme-option-${opt.key}`}
                onPress={() => setPreference(opt.key)}
                style={[styles.row, i < OPTIONS.length - 1 && styles.rowDivider]}
              >
                <View style={styles.rowIcon}>
                  <Feather name={opt.icon} size={17} color={active ? colors.brand : colors.onSurfaceSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{opt.label}</Text>
                  <Text style={styles.rowBody}>{opt.body}</Text>
                </View>
                {active && <Feather name="check" size={18} color={colors.brand} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>CONFIDENTIALITÉ DES MESSAGES</Text>
        <View style={styles.card}>
          {PRIVACY_OPTIONS.map((opt, i) => {
            const active = (user?.message_privacy || 'friends_and_followers') === opt.key;
            return (
              <Pressable
                key={opt.key}
                testID={`privacy-option-${opt.key}`}
                onPress={() => setPrivacy(opt.key)}
                disabled={busyPrivacy}
                style={[styles.row, i < PRIVACY_OPTIONS.length - 1 && styles.rowDivider]}
              >
                <View style={styles.rowIcon}>
                  <Feather name={opt.icon} size={17} color={active ? colors.brand : colors.onSurfaceSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{opt.label}</Text>
                  <Text style={styles.rowBody}>{opt.body}</Text>
                </View>
                {busyPrivacy && active ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : active ? (
                  <Feather name="check" size={18} color={colors.brand} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          {NOTIF_OPTIONS.map((opt, i) => {
            const active = user?.[opt.key] ?? true;
            return (
              <Pressable
                key={opt.key}
                testID={`notif-option-${opt.key}`}
                onPress={() => toggleNotif(opt.key)}
                disabled={busyKey === opt.key}
                style={[styles.row, i < NOTIF_OPTIONS.length - 1 && styles.rowDivider]}
              >
                <View style={styles.rowIcon}>
                  <Feather name={opt.icon} size={17} color={active ? colors.brand : colors.onSurfaceSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{opt.label}</Text>
                  <Text style={styles.rowBody}>{opt.body}</Text>
                </View>
                {busyKey === opt.key ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : active ? (
                  <Feather name="check" size={18} color={colors.brand} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>SÉCURITÉ</Text>
        <View style={styles.card}>
          <Pressable
            testID="logout-all-devices"
            onPress={handleLogoutAllDevices}
            disabled={busyLogoutAll}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel="Se déconnecter de tous les appareils"
          >
            <View style={styles.rowIcon}>
              <Feather name="shield-off" size={17} color={colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.error }]}>Se déconnecter de tous les appareils</Text>
              <Text style={styles.rowBody}>Invalide immédiatement toute session ouverte ailleurs — utile si un appareil a été perdu ou volé.</Text>
            </View>
            {busyLogoutAll && <ActivityIndicator size="small" color={colors.error} />}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 10 },
  card: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: colors.surface },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  rowLabel: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowBody: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
});
