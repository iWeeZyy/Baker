/**
 * L'écran des quatre offres — Gratuit / Pro / Pro+ / Équipe — entièrement
 * piloté par `plan.plans` (le catalogue renvoyé par `/me/plan`,
 * `entitlements.plan_catalogue()` côté serveur) : changer un prix ou une
 * fonctionnalité d'offre ne demande aucune livraison de l'app, seulement un
 * déploiement backend. Ce fichier ne fait que mettre en forme ce que le
 * serveur envoie ; les libellés de fonctionnalité et les taglines
 * ci-dessous sont la seule chose écrite en dur ici — la même répartition
 * que l'ancien écran (prix/plafonds venaient déjà du serveur, les phrases
 * de présentation étaient déjà écrites dans ce fichier).
 *
 * Remplace l'ancien écran Free/Pro à deux offres. `?feature=` (optionnel,
 * `useLocalSearchParams`) est le point d'entrée depuis un `LockedFeatureNotice`
 * ailleurs dans l'app (`src/PlanChip.tsx`) : quand présent, la carte du
 * palier qui débloque cette fonctionnalité est mise en avant à l'ouverture.
 */
import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAds } from '@/src/ads';
import { useEntitlements, type PlanTier } from '@/src/entitlements';
import { PlanChip } from '@/src/PlanChip';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/** Libellé court de chaque fonctionnalité — la seule traduction dont ce
 * fichier a besoin, `entitlements.MIN_TIER` (backend) reste la seule
 * source de quel palier la débloque. Une clé absente d'ici (une
 * fonctionnalité future non encore présentée) s'affiche sous son
 * identifiant technique plutôt que de faire disparaître la ligne. */
const FEATURE_LABELS: Record<string, string> = {
  recipes_unlimited: 'Recettes illimitées',
  recipe_scan: 'Scan de recette (photo → fiche)',
  recipe_adapt: 'Adaptation de recette',
  recipe_history: 'Historique des recettes',
  sub_recipes: 'Sous-recettes',
  ai_assistant: 'Assistant IA',
  ai_advanced: 'Assistant IA avancé (données réelles)',
  cost_basic: 'Calculateur de coût',
  cost_materials: 'Matières premières & fournisseurs',
  cost_profitability: 'Rentabilité & historique de coût',
  production_advanced: 'Besoins matières automatiques',
  staff_schedule: 'Planning du personnel',
  fournil_mode: 'Mode Fournil',
  org_team: "Comptes employés & rôles",
  org_tasks: 'Attribution de tâches',
  pro_orders: 'Commandes professionnelles',
  org_dashboard: 'Tableau de bord',
  org_multi_shop: 'Multi-boutiques',
};

const QUOTA_LABELS: Record<string, (n: number) => string> = {
  recipes_total: (n) => `${n} recette${n > 1 ? 's' : ''} personnelle${n > 1 ? 's' : ''}`,
  productions_per_month: (n) => `${n} production${n > 1 ? 's' : ''} / mois`,
  ai_messages_per_month: (n) => `${n} message${n > 1 ? 's' : ''} IA / mois`,
  scans_per_month: (n) => `${n} scan${n > 1 ? 's' : ''} / mois`,
  schedule_employees: (n) => `${n} employé${n > 1 ? 's' : ''} au planning`,
  org_members: (n) => `${n} membre${n > 1 ? 's' : ''} d'équipe`,
};

const TAGLINES: Record<PlanTier, string> = {
  free: "L'essentiel : la bibliothèque de recettes, un planning simple, l'assistant IA.",
  pro: 'Sans limite de recettes ni de productions, avec le scan et le calculateur de coût.',
  pro_plus: 'La production avancée : besoins matières automatiques, rentabilité, IA sur vos données.',
  team: "L'atelier au complet : comptes employés, tâches, commandes et tableau de bord.",
};

export default function Pro() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { feature: highlightFeature } = useLocalSearchParams<{ feature?: string }>();
  const { plan, loading } = useEntitlements();
  const { config: ads } = useAds();
  const scrollRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});

  // Le catalogue est la seule source des paliers eux-mêmes (prix, ordre,
  // fonctionnalités par offre) — la forme vient directement de
  // `PlanState['plans']` (src/plan.ts), qui mirore `entitlements.plan_catalogue()`.
  const catalogue = plan?.plans ?? [];
  const currentTier = plan?.plan;

  // La carte du palier qui débloque `?feature=` — le point d'entrée d'un
  // LockedFeatureNotice ailleurs dans l'app.
  const highlightTier = highlightFeature
    ? plan?.features?.[highlightFeature]?.min_plan
    : undefined;

  useEffect(() => {
    if (!highlightTier) return;
    const y = cardOffsets.current[highlightTier];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, [highlightTier, catalogue.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="pro-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        <Text style={styles.brandLabel}>LEVANEA</Text>
        <Text style={styles.title}>Nos offres</Text>
        <Text style={styles.intro}>
          Quatre offres, de l&apos;essentiel gratuit à l&apos;atelier au complet. Choisissez celle qui
          correspond à votre activité aujourd&apos;hui — rien de ce que vous avez créé n&apos;est jamais
          perdu en changeant d&apos;offre.
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
        ) : (
          catalogue.map((entry, i) => {
            const previous = catalogue[i - 1];
            const incremental = previous
              ? entry.features.filter(f => !previous.features.includes(f))
              : entry.features;
            const finiteQuotas = Object.entries(entry.quotas).filter(([, v]) => v != null && v > 0) as [string, number][];
            const isCurrent = entry.plan === currentTier;
            const isRecommended = entry.plan === 'pro_plus';
            const isHighlighted = entry.plan === highlightTier;

            return (
              <View
                key={entry.plan}
                testID={`plan-card-${entry.plan}`}
                onLayout={(e) => { cardOffsets.current[entry.plan] = e.nativeEvent.layout.y; }}
                style={[
                  styles.card,
                  isRecommended && styles.cardRecommended,
                  isHighlighted && styles.cardHighlighted,
                ]}
              >
                {isRecommended && (
                  <View style={styles.ribbon}>
                    <Text style={styles.ribbonText}>RECOMMANDÉ</Text>
                  </View>
                )}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{entry.label}</Text>
                    <Text style={styles.cardPrice}>
                      {entry.price_eur > 0 ? `${entry.price_eur.toFixed(2).replace('.', ',')} € / mois` : 'Gratuit'}
                    </Text>
                  </View>
                  {entry.plan !== 'free' && <PlanChip tier={entry.plan} />}
                  {isCurrent && (
                    <View style={styles.currentPill} testID={`plan-current-${entry.plan}`}>
                      <Feather name="check" size={12} color={colors.success} />
                      <Text style={styles.currentPillText}>Votre offre</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.tagline}>{TAGLINES[entry.plan]}</Text>

                {previous && (
                  <Text style={styles.everythingIn}>Tout {previous.label}, plus :</Text>
                )}
                {incremental.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Feather name="check" size={14} color={colors.brand} />
                    <Text style={styles.featureText}>{FEATURE_LABELS[f] ?? f}</Text>
                  </View>
                ))}

                {finiteQuotas.length > 0 && (
                  <View style={styles.quotaRow}>
                    {finiteQuotas.map(([key, n]) => (
                      <View key={key} style={styles.quotaChip}>
                        <Text style={styles.quotaChipText}>{QUOTA_LABELS[key]?.(n) ?? `${n} ${key}`}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/*
          Ni ce chantier ni le précédent n'ont installé de fournisseur de
          paiement (voir CLAUDE.md, "Offres et droits") : aucun bouton
          d'achat n'est affiché, il ne ferait qu'imiter une décision d'argent
          sans rien pouvoir déclencher derrière.
        */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>Abonnement pas encore ouvert</Text>
          <Text style={styles.noticeBody}>
            {plan?.enforced
              ? "Les offres payantes sont actives sur ce compte, mais aucun paiement en ligne n'est encore possible : le palier est accordé manuellement."
              : "Aucune offre n'est encore commercialisée : aucun paiement n'est possible aujourd'hui, et rien ne vous sera facturé. Toutes les fonctionnalités listées ci-dessus restent accessibles d'ici là."}
            {ads.available === false && ' Aucune publicité ne sera jamais affichée aux offres payantes une fois la publicité activée.'}
          </Text>
        </View>

        <Pressable testID="pro-close" onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>Revenir</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 60 },
  brandLabel: { fontSize: 11, letterSpacing: 4, color: colors.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 34, color: colors.onSurface, marginTop: 4 },
  intro: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 21, marginTop: 12, marginBottom: 8 },

  card: {
    marginTop: 18, padding: 18, borderRadius: theme.radius.xl,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  cardRecommended: { borderColor: colors.brand, borderWidth: 1.5 },
  cardHighlighted: { borderColor: colors.brand, borderWidth: 2 },
  ribbon: { alignSelf: 'flex-start', backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 10 },
  ribbonText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardLabel: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  cardPrice: { fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 },
  currentPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  currentPillText: { fontSize: 10, fontWeight: '700', color: colors.success },
  tagline: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19, marginTop: 12 },
  everythingIn: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: 14, marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  featureText: { flex: 1, fontSize: 13, color: colors.onSurface },
  quotaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  quotaChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  quotaChipText: { fontSize: 11, color: colors.onSurfaceTertiary },

  noticeBox: { marginTop: 26, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  noticeTitle: { fontFamily: theme.serif, fontSize: 16, color: colors.onSurface },
  noticeBody: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 6 },
  closeBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, marginTop: 22 },
  closeText: { fontSize: 15, color: colors.onSurface, fontWeight: '600' },
});
