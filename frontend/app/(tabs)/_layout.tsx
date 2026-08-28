import { useMemo } from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/src/auth';
import { useTheme } from '@/src/ThemeContext';
import { type ThemeColors } from '@/src/theme';

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  if (!user) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 82,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarLabelStyle: { fontSize: 11, letterSpacing: 0.5, fontWeight: '500' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} /> }} />
      <Tabs.Screen name="recipes" options={{ title: 'Recettes', tabBarIcon: ({ color }) => <Feather name="book-open" size={20} color={color} /> }} />
      <Tabs.Screen name="tips" options={{ title: 'Astuces', tabBarIcon: ({ color }) => <Feather name="zap" size={20} color={color} /> }} />
      <Tabs.Screen name="planning" options={{ title: 'Planning', tabBarIcon: ({ color }) => <Feather name="calendar" size={20} color={color} /> }} />
      <Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: ({ color }) => <Feather name="message-circle" size={20} color={color} /> }} />
      <Tabs.Screen name="friends" options={{ title: 'Amis', tabBarIcon: ({ color }) => <Feather name="users" size={20} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ color }) => <Feather name="user" size={20} color={color} /> }} />
    </Tabs>
  );
}
