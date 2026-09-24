import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/**
 * Politique de confidentialité — brouillon.
 *
 * NE PAS considérer ce texte comme définitif : c'est un premier jet écrit
 * pour couvrir ce que Levanea fait réellement aujourd'hui (comptes,
 * contenu communautaire, IA de chat, pubs AdMob Free-only), à faire relire
 * et valider par Lucas (ou un juriste) avant toute publication réelle sur
 * l'App Store / Play Store. Voir le rapport final pour ce point.
 */
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Ce document',
    body: "Cette politique décrit les données que Levanea collecte et pourquoi. Elle couvre l'ensemble de l'application — compte, recettes, communauté, assistant IA — ainsi que les publicités, qui ne sont montrées qu'aux comptes Gratuit et jamais aux comptes Pro.",
  },
  {
    title: 'Données de compte',
    body: "Adresse e-mail, mot de passe (jamais stocké en clair), nom, nom d'utilisateur et, si vous les renseignez, votre photo de profil, votre biographie et votre identifiant Instagram. Ces informations servent à faire fonctionner votre compte et à afficher votre profil aux autres utilisateurs de l'application.",
  },
  {
    title: 'Contenu que vous publiez',
    body: 'Recettes, commentaires, créations, messages, plannings et notes personnelles que vous créez dans Levanea. Les notes personnelles ne sont jamais visibles par les autres utilisateurs.',
  },
  {
    title: "Assistant IA et scan de recettes",
    body: "Vos messages à l'assistant et les photos de fiches recette que vous scannez sont envoyés à l'API Anthropic pour générer une réponse. Les photos de scan ne sont jamais enregistrées sur nos serveurs : elles sont analysées puis immédiatement supprimées.",
  },
  {
    title: 'Publicités (comptes Gratuit uniquement)',
    body: "Levanea utilise Google AdMob pour afficher des bannières publicitaires aux utilisateurs du plan Gratuit. Les comptes Pro ne voient jamais de publicité. Selon votre choix de consentement (formulaire Google affiché si vous êtes concerné par le RGPD) et, sur iOS, votre autorisation de suivi (App Tracking Transparency), les publicités peuvent être personnalisées ou non. Vous pouvez refuser le suivi sans que cela affecte le fonctionnement de l'application.",
  },
  {
    title: 'Prestataires tiers',
    body: 'Google AdMob (publicités), Sightengine (détection automatique de contenu sensible sur les photos de messages), Pexels (photographies de recettes) et Anthropic (assistant IA, scan de recettes). Chacun ne reçoit que les données strictement nécessaires à son rôle.',
  },
  {
    title: 'Vos droits',
    body: 'Vous pouvez modifier ou supprimer votre biographie, votre photo, votre identifiant Instagram et vos publications à tout moment depuis votre profil. Pour toute autre demande concernant vos données, contactez-nous.',
  },
];

export default function PrivacyPolicy() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="privacy-policy-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Confidentialité</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.draftBanner}>
          <Feather name="alert-triangle" size={16} color={colors.warning} />
          <Text style={styles.draftBannerText}>
            Brouillon en attente de relecture — ce texte n&apos;a pas encore de valeur légale définitive.
          </Text>
        </View>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}
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
  draftBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 12, marginBottom: 24 },
  draftBannerText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  section: { marginBottom: 22 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface, marginBottom: 6 },
  sectionBody: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19 },
});
