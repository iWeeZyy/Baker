import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useReducedMotion,
  interpolate,
  Extrapolation,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { storage } from '@/src/utils/storage';
import { ONBOARDING_COMPLETED_KEY } from '@/src/onboarding/storageKeys';
import { StepDots } from '@/src/onboarding/StepDots';
import { Button } from '@/src/Button';
import { BackgroundShapes } from '@/src/BackgroundShapes';
import { usePressScale } from '@/src/usePressScale';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Même emblème que l'écran de connexion (déjà détouré, sans carré ni fond) —
// affiché uniquement sur la toute première diapositive ("Bienvenue sur
// Levanea", le même message que l'écran de connexion), pour la cohérence de
// marque ; les autres diapositives gardent leur icône Feather existante,
// inchangée.
const LOGO = require('../assets/images/auth-logo.png');

type Slide = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  bullets?: string[];
};

const SLIDES: Slide[] = [
  {
    icon: 'sunrise',
    title: 'Bienvenue sur Levanea',
    subtitle: 'L’application pensée pour les artisans boulangers et pâtissiers.',
  },
  {
    icon: 'book-open',
    title: 'Toutes vos recettes au même endroit',
    subtitle: 'Créez, calculez et adaptez vos recettes en quelques instants.',
    bullets: ['Création de recettes', 'Quantités et pourcentage boulanger', 'Adaptation d’une recette existante', 'Recettes de la communauté'],
  },
  {
    icon: 'calendar',
    title: 'Préparez votre production plus facilement',
    subtitle: 'Planifiez vos journées et votre équipe sans effort.',
    bullets: ['Planning de production', 'Planning du personnel', 'Calcul automatique des quantités', 'Organisation au quotidien'],
  },
  {
    icon: 'zap',
    title: 'Votre assistant boulanger',
    subtitle: 'Un coup de main IA quand vous en avez besoin.',
    bullets: ['Adapter une recette', 'Comprendre un souci de pâte', 'Obtenir une suggestion', 'Transformer une recette'],
  },
  {
    icon: 'users',
    title: 'Échangez avec d’autres boulangers',
    subtitle: 'Une vraie communauté de métier, pas juste une appli.',
    bullets: ['Profils et Team', 'Amis et abonnements', 'Messagerie et commentaires', 'Créations partagées'],
  },
  {
    icon: 'user',
    title: 'Construisez votre profil Levanea',
    subtitle: 'Montrez votre travail et suivez votre progression.',
    bullets: ['Photo et description', 'Instagram', 'Recettes, créations, collections', 'Badges et niveau'],
  },
  {
    icon: 'check-circle',
    title: 'Prêt à découvrir Levanea ?',
    subtitle: 'Créez votre compte pour commencer, ou jetez un premier coup d’œil.',
  },
];

const CIRCLE_COLORS = ['brand', 'brandSecondary'] as const;

/**
 * Une diapositive suit en continu sa distance au centre de l'écran
 * (`scrollX`) plutôt qu'un état React discret — la même transformation
 * pilote aussi bien un swipe manuel qu'un `scrollTo` programmatique (bouton
 * "Continuer"), donc les deux se ressentent de façon identique, y compris en
 * arrière. Le visuel (logo/icône) reçoit une mise à l'échelle en plus du
 * texte — « les éléments visuels peuvent avoir une animation légèrement plus
 * expressive que le texte » — jamais de translateX, qui entrerait en
 * conflit avec le déplacement horizontal déjà porté par le scroll natif.
 */
function OnboardingSlide({
  slide,
  index,
  isFirst,
  scrollX,
  colors,
  styles,
  reducedMotion,
}: {
  slide: Slide;
  index: number;
  isFirst: boolean;
  scrollX: SharedValue<number>;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  reducedMotion: boolean;
}) {
  const visualStyle = useAnimatedStyle(() => {
    if (reducedMotion) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    const distance = scrollX.value / SCREEN_WIDTH - index;
    return {
      opacity: interpolate(distance, [-1, 0, 1], [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(distance, [-1, 0, 1], [16, 0, 16], Extrapolation.CLAMP) },
        { scale: interpolate(distance, [-1, 0, 1], [0.88, 1, 0.88], Extrapolation.CLAMP) },
      ],
    };
  });
  const textStyle = useAnimatedStyle(() => {
    if (reducedMotion) return { opacity: 1, transform: [{ translateY: 0 }] };
    const distance = scrollX.value / SCREEN_WIDTH - index;
    return {
      opacity: interpolate(distance, [-1, 0, 1], [0, 1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(distance, [-1, 0, 1], [10, 0, 10], Extrapolation.CLAMP) }],
    };
  });

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }, !slide.bullets && styles.slideCentered]}>
      <Animated.View style={visualStyle}>
        {isFirst ? (
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
        ) : (
          <View style={[styles.iconCircle, { backgroundColor: colors[CIRCLE_COLORS[index % 2]] }]}>
            <Feather name={slide.icon} size={48} color={colors.onBrandPrimary} />
          </View>
        )}
      </Animated.View>
      <Animated.View style={textStyle}>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.subtitle}>{slide.subtitle}</Text>
        {slide.bullets && (
          <View style={styles.bullets}>
            {slide.bullets.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Feather name="check" size={16} color={colors.brand} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

export default function Onboarding() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finishOnboarding = async () => {
    await storage.setItem(ONBOARDING_COMPLETED_KEY, true);
  };

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * SCREEN_WIDTH, animated: !reducedMotion });
    setIndex(i);
  };

  // Dérivé de `onScroll` (pas seulement `onMomentumEnd`) : sur le web,
  // `react-native-web` n'émet pas toujours cet événement de fin d'inertie
  // pour un ScrollView paginé (un swipe rapide peut ne jamais le
  // déclencher), ce qui laissait les points de progression figés sur le
  // premier bien que les diapositives défilaient normalement. La garde
  // évite un re-render quand l'index affiché n'a pas changé.
  const updateIndexIfChanged = (i: number) => setIndex((prev) => (prev === i ? prev : i));
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
      runOnJS(updateIndexIfChanged)(Math.round(e.contentOffset.x / SCREEN_WIDTH));
    },
    onMomentumEnd: (e) => {
      runOnJS(updateIndexIfChanged)(Math.round(e.contentOffset.x / SCREEN_WIDTH));
    },
  });

  const goToLogin = async () => {
    await finishOnboarding();
    router.replace('/auth');
  };

  const createAccount = async () => {
    await finishOnboarding();
    router.replace('/signup');
  };

  const discoverApp = async () => {
    await finishOnboarding();
    router.replace('/auth');
  };

  // Une seule compression au toucher, réutilisée par les trois boutons de
  // l'écran (même réglage que "Se connecter" sur l'écran de connexion) —
  // et une version plus discrète pour le lien "Se connecter" en haut à
  // droite, qui ne doit jamais rivaliser visuellement avec l'action
  // principale.
  const continuePress = usePressScale(reducedMotion);
  const createAccountPress = usePressScale(reducedMotion);
  const discoverPress = usePressScale(reducedMotion);
  const loginLinkPress = usePressScale(reducedMotion, 0.94);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <BackgroundShapes colors={colors} reducedMotion={reducedMotion} />
      <View style={styles.topRow}>
        <View />
        <Animated.View style={loginLinkPress.style}>
          <Pressable
            testID="onboarding-login"
            onPress={goToLogin}
            onPressIn={loginLinkPress.onPressIn}
            onPressOut={loginLinkPress.onPressOut}
            hitSlop={10}
          >
            <Text style={styles.loginText}>Se connecter</Text>
          </Pressable>
        </Animated.View>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <OnboardingSlide
            key={slide.title}
            slide={slide}
            index={i}
            isFirst={i === 0}
            scrollX={scrollX}
            colors={colors}
            styles={styles}
            reducedMotion={reducedMotion}
          />
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <StepDots count={SLIDES.length} activeIndex={index} scrollX={scrollX} screenWidth={SCREEN_WIDTH} />
        {isLast ? (
          <View style={styles.footerButtons}>
            <Animated.View style={createAccountPress.style}>
              <Button
                testID="onboarding-create-account"
                onPress={createAccount}
                onPressIn={createAccountPress.onPressIn}
                onPressOut={createAccountPress.onPressOut}
                label="Créer mon compte"
              />
            </Animated.View>
            <Animated.View style={discoverPress.style}>
              <Button
                testID="onboarding-discover"
                onPress={discoverApp}
                onPressIn={discoverPress.onPressIn}
                onPressOut={discoverPress.onPressOut}
                variant="text"
                label="Découvrir l’application"
              />
            </Animated.View>
          </View>
        ) : (
          <Animated.View style={continuePress.style}>
            <Button
              testID="onboarding-continue"
              onPress={() => goTo(index + 1)}
              onPressIn={continuePress.onPressIn}
              onPressOut={continuePress.onPressOut}
              label="Continuer"
            />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, height: 40 },
  loginText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  slide: { flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 24 },
  // Une diapositive sans puces (Bienvenue, dernière diapositive) n'a que le
  // titre et le sous-titre : les centrer verticalement évite le grand vide
  // qui se formait entre le sous-titre et les points de progression quand
  // le contenu restait ancré en haut comme les diapositives à puces.
  slideCentered: { justifyContent: 'center', paddingTop: 0 },
  iconCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  // Même hauteur que iconCircle (120) pour garder le même rythme vertical
  // entre les diapositives ; largeur dérivée du ratio réel de l'asset
  // détouré (300×331) plutôt qu'un carré, pour ne pas le déformer.
  logo: { width: 109, height: 120, marginBottom: 32 },
  title: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface, textAlign: 'center', lineHeight: 32, marginBottom: 12 },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  bullets: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletText: { fontSize: 14, color: colors.onSurfaceSecondary, flex: 1 },
  footer: { paddingHorizontal: 24, paddingTop: 16, gap: 20 },
  footerButtons: { gap: 12 },
});
