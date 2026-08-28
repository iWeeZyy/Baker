import { useEffect, useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export default function Index() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center} testID="root-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  return <Redirect href={user ? '/(tabs)' : '/auth'} />;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
