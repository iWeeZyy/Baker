import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth";
import { AdsProvider } from "@/src/ads";
import { TimerProvider } from "@/src/TimerContext";
import TimerBar from "@/src/TimerBar";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* Inside AuthProvider: the ad layer reads the signed-in user's plan. */}
          <AdsProvider>
            <TimerProvider>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAF8F5' } }} />
              <TimerBar />
            </TimerProvider>
          </AdsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
