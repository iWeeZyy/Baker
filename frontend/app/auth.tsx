import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withRepeat,
  withSequence,
  interpolateColor,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { Button } from '@/src/Button';

// La grande photo de four (`auth-hero.jpg`, fournie par Lucas) a été retirée
// de cet écran lors de la refonte premium/minimaliste — sa présence en
// bannière avec un gros titre par-dessus contredisait l'objectif « aéré,
// logo et formulaire au centre ». Le fichier reste sur le disque, inutilisé,
// au cas où — même logique que les .svg/.png de secours laissés en place
// ailleurs dans le projet (voir CLAUDE.md, section « Recipe families »).
//
// `auth-background.png`/`auth-background-dark.png` (fournis par Lucas, une
// paire assortie) portent l'identité de marque de cet écran — contrairement
// au premier essai (une seule image, l'écran forcé en clair via
// `LIGHT_COLORS`), l'écran redevient ici pleinement réactif au thème
// puisqu'une vraie variante sombre existe désormais des deux côtés.
const BACKGROUNDS = {
  light: require('../assets/images/auth-background.png'),
  dark: require('../assets/images/auth-background-dark.png'),
};

// Emblème Levanea seul (le nœud terracotta), détouré à partir du fichier
// fourni par Lucas (qui contenait aussi le nom "LEVANEA" et un épi — retirés
// ici car le titre "Bienvenue sur Levanea" juste en dessous les rendrait
// redondants). Fond crème d'origine retiré par seuillage colorimétrique —
// y compris les creux internes du nœud, jamais connectés au bord — donc pas
// de carré ni de halo derrière le motif, sur aucun des deux thèmes.
const LOGO = require('../assets/images/auth-logo.png');

const SPRING = { damping: 14, stiffness: 150, mass: 0.9 } as const;

/**
 * Un seul petit hook pour toute la choréographie d'entrée : fade + léger
 * déplacement vertical (et, pour le logo, une très légère mise à l'échelle).
 * Sous `prefers-reduced-motion`, la valeur part directement à son état
 * final — l'écran reste identique, simplement statique.
 */
function useEntranceStyle(delayMs: number, reducedMotion: boolean, opts: { distance?: number; withScale?: boolean } = {}) {
  const { distance = 18, withScale = false } = opts;
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    progress.value = withDelay(delayMs, withSpring(1, SPRING));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => {
    if (withScale) {
      return {
        opacity: progress.value,
        transform: [{ translateY: (1 - progress.value) * distance }, { scale: 0.92 + progress.value * 0.08 }],
      };
    }
    return {
      opacity: progress.value,
      transform: [{ translateY: (1 - progress.value) * distance }],
    };
  });
}

// Formes organiques très discrètes derrière le contenu — jamais interactives
// (`pointerEvents="none"`), uniquement `transform`/`opacity` (aucun coût de
// mise en page), dérive lente (7 à 9,5 s par cycle) désactivée sous reduced
// motion. Couleurs exclusivement issues des tokens du thème.
function BackgroundShapes({ colors, reducedMotion }: { colors: ThemeColors; reducedMotion: boolean }) {
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);
  const t3 = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    t1.value = withRepeat(withTiming(1, { duration: 8200, easing: Easing.inOut(Easing.sin) }), -1, true);
    t2.value = withRepeat(withTiming(1, { duration: 9600, easing: Easing.inOut(Easing.sin) }), -1, true);
    t3.value = withRepeat(withTiming(1, { duration: 7100, easing: Easing.inOut(Easing.sin) }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style1 = useAnimatedStyle(() => ({
    opacity: 0.32 + t1.value * 0.26,
    transform: [{ translateX: t1.value * 24 }, { translateY: t1.value * -18 }],
  }));
  const style2 = useAnimatedStyle(() => ({
    opacity: 0.26 + t2.value * 0.22,
    transform: [{ translateX: t2.value * -20 }, { translateY: t2.value * 22 }],
  }));
  const style3 = useAnimatedStyle(() => ({
    opacity: 0.2 + t3.value * 0.18,
    transform: [{ translateX: t3.value * 16 }, { translateY: t3.value * 14 }],
  }));

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Animated.View style={[blobLayout.a, { backgroundColor: colors.brandTertiary }, style1]} />
      <Animated.View style={[blobLayout.b, { backgroundColor: colors.brandSecondary }, style2]} />
      <Animated.View style={[blobLayout.c, { backgroundColor: colors.surfaceTertiary }, style3]} />
    </View>
  );
}

/**
 * Champ e-mail/mot de passe avec transition de bordure animée au focus —
 * remplace le changement de style instantané d'origine. La bordure et le
 * fond vivent sur le `Animated.View` englobant (jamais sur le `TextInput`
 * lui-même, difficile à animer proprement) ; le `TextInput` reste
 * transparent par-dessus.
 */
function AnimatedField({
  label,
  colors,
  focused,
  entranceStyle,
  inputStyle,
  labelStyle,
  wrapperStyle,
  ...inputProps
}: {
  label: string;
  colors: ThemeColors;
  focused: boolean;
  entranceStyle: any;
  inputStyle: any;
  labelStyle: any;
  wrapperStyle: any;
} & React.ComponentProps<typeof TextInput>) {
  const focusProgress = useSharedValue(0);

  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, { duration: 150 });
  }, [focused, focusProgress]);

  const animatedBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focusProgress.value, [0, 1], [colors.border, colors.brand]),
    backgroundColor: interpolateColor(focusProgress.value, [0, 1], [colors.surfaceSecondary, colors.surface]),
  }));

  return (
    <Animated.View style={entranceStyle}>
      <Text style={labelStyle}>{label}</Text>
      <Animated.View style={[wrapperStyle, animatedBorder]}>
        <TextInput
          placeholderTextColor={colors.muted}
          style={inputStyle}
          {...inputProps}
        />
      </Animated.View>
    </Animated.View>
  );
}

export default function AuthScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, login } = useAuth();
  const reducedMotion = useReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Purement visuel — le contour terracotta au focus d'un champ. N'affecte
  // ni la validation, ni la soumission.
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  const backgroundOpacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) return;
    backgroundOpacity.value = withTiming(1, { duration: 320 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const backgroundStyle = useAnimatedStyle(() => ({ opacity: backgroundOpacity.value }));

  const logoStyle = useEntranceStyle(60, reducedMotion, { distance: 22, withScale: true });
  const titleStyle = useEntranceStyle(160, reducedMotion, { distance: 20 });
  const subtitleStyle = useEntranceStyle(230, reducedMotion, { distance: 16 });
  const emailFieldStyle = useEntranceStyle(300, reducedMotion, { distance: 16 });
  const passwordFieldStyle = useEntranceStyle(350, reducedMotion, { distance: 16 });
  const buttonEntranceStyle = useEntranceStyle(420, reducedMotion, { distance: 14 });
  const signupLinkStyle = useEntranceStyle(480, reducedMotion, { distance: 10 });

  // Compression au toucher du bouton principal — Button.tsx expose
  // désormais onPressIn/onPressOut en passthrough (voir ce fichier), utilisé
  // ici seulement : le composant partagé n'anime rien par lui-même ailleurs
  // dans l'app.
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  const onButtonPressIn = () => {
    if (reducedMotion) return;
    pressScale.value = withTiming(0.97, { duration: 90 });
  };
  const onButtonPressOut = () => {
    if (reducedMotion) return;
    pressScale.value = withSpring(1, { damping: 12, stiffness: 220 });
  };

  // Secousse courte du formulaire sur une erreur de connexion — n'accompagne
  // jamais le message d'erreur, ne le remplace jamais (il reste affiché tel
  // quel juste en dessous).
  const shakeX = useSharedValue(0);
  useEffect(() => {
    if (!error || reducedMotion) return;
    shakeX.value = withSequence(
      withTiming(-6, { duration: 45 }),
      withTiming(6, { duration: 90 }),
      withTiming(-4, { duration: 90 }),
      withTiming(0, { duration: 70 }),
    );
  }, [error, reducedMotion, shakeX]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  if (user) return <Redirect href="/(tabs)" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Animated.View style={[styles.background, backgroundStyle]} pointerEvents="none">
        <Image
          source={mode === 'dark' ? BACKGROUNDS.dark : BACKGROUNDS.light}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
        <BackgroundShapes colors={colors} reducedMotion={reducedMotion} />
      </Animated.View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandBlock}>
            <Animated.View style={logoStyle}>
              <Image source={LOGO} style={styles.logo} contentFit="contain" />
            </Animated.View>
            <Animated.Text style={[styles.title, titleStyle]}>Bienvenue sur Levanea</Animated.Text>
            <Animated.Text style={[styles.subtitle, subtitleStyle]}>L&apos;art de la boulangerie française</Animated.Text>
          </View>

          <Animated.View style={[styles.form, shakeStyle]}>
            <AnimatedField
              testID="input-email"
              label="Adresse e-mail"
              colors={colors}
              focused={focusedField === 'email'}
              entranceStyle={emailFieldStyle}
              labelStyle={styles.label}
              wrapperStyle={styles.inputWrapper}
              inputStyle={styles.input}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              placeholder="Votre adresse e-mail"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              {...(Platform.OS === 'web' ? { dataSet: { autofillThemed: 'true' } } : null)}
            />
            <AnimatedField
              testID="input-password"
              label="Mot de passe"
              colors={colors}
              focused={focusedField === 'password'}
              entranceStyle={passwordFieldStyle}
              labelStyle={styles.label}
              wrapperStyle={styles.inputWrapper}
              inputStyle={styles.input}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              placeholder="Votre mot de passe"
              secureTextEntry
              autoComplete="password"
              {...(Platform.OS === 'web' ? { dataSet: { autofillThemed: 'true' } } : null)}
            />

            {error ? <Text style={styles.error} testID="auth-error">{error}</Text> : null}

            <Animated.View style={buttonEntranceStyle}>
              <Animated.View style={pressStyle}>
                <Button
                  testID="submit-auth"
                  onPress={submit}
                  onPressIn={onButtonPressIn}
                  onPressOut={onButtonPressOut}
                  loading={loading}
                  label="Se connecter"
                  style={styles.submitBtn}
                />
              </Animated.View>
            </Animated.View>
          </Animated.View>

          <Animated.View style={signupLinkStyle}>
            <Pressable
              testID="go-to-signup"
              onPress={() => router.push('/signup')}
              style={({ pressed }) => [styles.signupLink, pressed && styles.signupLinkPressed]}
            >
              <Text style={styles.signupLinkText}>Pas encore de compte ? <Text style={styles.signupLinkStrong}>Créer un compte</Text></Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Géométrie des formes de fond — indépendante du thème (seule la couleur
// est injectée en ligne), donc hors de `makeStyles`.
const blobLayout = StyleSheet.create({
  a: { position: 'absolute', top: '-9%', right: '-14%', width: 300, height: 300, borderRadius: 999 },
  b: { position: 'absolute', bottom: '-8%', left: '-16%', width: 340, height: 340, borderRadius: 999 },
  c: { position: 'absolute', top: '28%', left: '58%', width: 200, height: 200, borderRadius: 999 },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  // Plein écran, derrière tout le reste (premier enfant du SafeAreaView) —
  // jamais interactif : pointerEvents="none".
  background: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  brandBlock: { alignItems: 'center', marginBottom: 44 },
  logo: { width: 88, height: 88, marginBottom: 16 },
  title: { fontFamily: theme.serif, fontSize: 30, color: colors.onSurface, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 8 },
  form: { gap: 20 },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500', letterSpacing: 0.2, marginBottom: 8 },
  inputWrapper: {
    borderRadius: theme.radius.xl,
    borderWidth: 1,
  },
  input: {
    fontSize: 16,
    color: colors.onSurface,
    paddingHorizontal: 18,
    paddingVertical: 16,
    // react-native-web dessine sinon le contour de focus natif du navigateur
    // (un anneau noir) par-dessus notre bordure terracotta au focus.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
  },
  error: { color: colors.error, fontSize: 13, textAlign: 'center' },
  submitBtn: { borderRadius: theme.radius.xl, marginTop: 4 },
  signupLink: { marginTop: 32, alignItems: 'center' },
  signupLinkPressed: { opacity: 0.6 },
  signupLinkText: { fontSize: 14, color: colors.muted },
  signupLinkStrong: { color: colors.brand, fontWeight: '600' },
});
