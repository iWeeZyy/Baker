import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth";
import { AdsProvider } from "@/src/ads";
import { TimerProvider } from "@/src/TimerContext";
import { ThemeProvider, useTheme } from "@/src/ThemeContext";
import TimerBar from "@/src/TimerBar";
import { UnlockToast } from "@/src/gamification/UnlockToast";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Séparé de RootLayout pour pouvoir lire useTheme() : le Provider doit être
// monté au-dessus de ce composant, pas dans le même corps de fonction.
function AppShell() {
  const { colors, mode } = useTheme();
  return (
    <AuthProvider>
      {/* Inside AuthProvider: the ad layer reads the signed-in user's plan. */}
      <AdsProvider>
        <TimerProvider>
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
          <TimerBar />
          <UnlockToast />
        </TimerProvider>
      </AdsProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
