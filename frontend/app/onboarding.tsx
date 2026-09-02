import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { storage } from '@/src/utils/storage';
import { ONBOARDING_COMPLETED_KEY } from '@/src/onboarding/storageKeys';
import { StepDots } from '@/src/onboarding/StepDots';
import { Button } from '@/src/Button';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

export default function Onboarding() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finishOnboarding = async () => {
    await storage.setItem(ONBOARDING_COMPLETED_KEY, true);
  };

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * SCREEN_WIDTH, animated: true });
    setIndex(i);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setIndex(i);
  };

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <View />
        <Pressable testID="onboarding-login" onPress={goToLogin} hitSlop={10}>
          <Text style={styles.loginText}>Se connecter</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View
            key={slide.title}
            style={[styles.slide, { width: SCREEN_WIDTH }, !slide.bullets && styles.slideCentered]}
          >
            <View style={[styles.iconCircle, { backgroundColor: colors[CIRCLE_COLORS[i % 2]] }]}>
              <Feather name={slide.icon} size={48} color={colors.onBrandPrimary} />
            </View>
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
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <StepDots count={SLIDES.length} activeIndex={index} />
        {isLast ? (
          <View style={styles.footerButtons}>
            <Button testID="onboarding-create-account" onPress={createAccount} label="Créer mon compte" />
            <Button testID="onboarding-discover" onPress={discoverApp} variant="text" label="Découvrir l’application" />
          </View>
        ) : (
          <Button testID="onboarding-continue" onPress={() => goTo(index + 1)} label="Continuer" />
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
  title: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface, textAlign: 'center', lineHeight: 32, marginBottom: 12 },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  bullets: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletText: { fontSize: 14, color: colors.onSurfaceSecondary, flex: 1 },
  footer: { paddingHorizontal: 24, paddingTop: 16, gap: 20 },
  footerButtons: { gap: 12 },
});
