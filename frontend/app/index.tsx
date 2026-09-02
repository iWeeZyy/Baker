import { useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth';
import { type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { storage } from '@/src/utils/storage';
import { ONBOARDING_COMPLETED_KEY } from '@/src/onboarding/storageKeys';

export default function Index() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, loading } = useAuth();
  // Préférence d'appareil, jamais liée au compte — lue une seule fois, comme
  // `levanea_theme_preference` dans ThemeContext, jamais réinitialisée à la
  // déconnexion (section 2 : se déconnecter ne relance pas la découverte).
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    storage.getItem<boolean>(ONBOARDING_COMPLETED_KEY, false).then((v) => setOnboardingCompleted(!!v));
  }, []);

  if (loading || (!user && onboardingCompleted === null)) {
    return (
      <View style={styles.center} testID="root-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (user) return <Redirect href="/(tabs)" />;
  return <Redirect href={onboardingCompleted ? '/auth' : '/onboarding'} />;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
