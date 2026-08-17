import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { usePlan } from '@/src/plan';
import { theme } from '@/src/theme';

type FeatureKey = 'productions' | 'multi_day' | 'recurring' | 'sharing' | 'full_history';

const FEATURES: { key: FeatureKey; icon: any; title: string; body: string; available: boolean }[] = [
  {
    key: 'productions',
    icon: 'calendar',
    title: 'Productions illimitées',
    body: "Planifiez autant de journées que nécessaire. L'offre gratuite en autorise 3 par mois.",
    available: true,
  },
  {
    key: 'multi_day',
    icon: 'layers',
    title: 'Planification sur plusieurs jours',
    body: 'Enchaînez pousses lentes et fabrications réparties sur deux ou trois jours.',
    available: false,
  },
  {
    key: 'recurring',
    icon: 'repeat',
    title: 'Productions récurrentes',
    body: 'Rejouez une journée type sans la ressaisir.',
    available: false,
  },
  {
    key: 'sharing',
    icon: 'users',
    title: 'Partage du planning',
    body: "Transmettez le déroulé de la journée à l'équipe du fournil.",
    available: false,
  },
  {
    key: 'full_history',
    icon: 'archive',
    title: 'Historique complet',
    body: 'Retrouvez toutes vos productions passées et leurs quantités.',
    available: false,
  },
];

export default function Pro() {
  const router = useRouter();
  const { plan, loading } = usePlan();
  const isPro = plan?.plan === 'pro';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="pro-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.brandLabel}>LE FOURNIL</Text>
        <Text style={styles.title}>Baker Pro</Text>

        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 24 }} />
        ) : isPro ? (
          <View style={styles.statusBox} testID="pro-active">
            <Feather name="check-circle" size={16} color={theme.color.success} />
            <Text style={styles.statusText}>Votre compte est en Baker Pro. Aucune limite de production.</Text>
          </View>
        ) : (
          <View style={styles.statusBox} testID="pro-quota">
            <Feather name="info" size={16} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.statusText}>
              {plan?.productions_limit != null
                ? `Vous avez utilisé ${plan.productions_used} production${plan.productions_used > 1 ? 's' : ''} sur ${plan.productions_limit} ce mois-ci.`
                : 'Offre gratuite : 3 productions par mois.'}
            </Text>
          </View>
        )}

        <Text style={styles.intro}>
          L'offre gratuite couvre l'essentiel : planifier une journée, calculer les quantités et
          suivre le déroulé. Baker Pro lève la limite mensuelle et prépare le travail en équipe.
        </Text>

        {FEATURES.map(f => (
          <View key={f.key} style={styles.feature} testID={`feature-${f.key}`}>
            <View style={styles.featureIcon}>
              <Feather name={f.icon} size={17} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.featureTitleRow}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                {!f.available && (
                  <View style={styles.soonPill}>
                    <Text style={styles.soonText}>À VENIR</Text>
                  </View>
                )}
              </View>
              <Text style={styles.featureBody}>{f.body}</Text>
            </View>
          </View>
        ))}

        {/*
          No purchase button: there is no billing provider connected. Showing a
          fake one would take money-shaped decisions from the user for nothing.
        */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>Abonnement pas encore ouvert</Text>
          <Text style={styles.noticeBody}>
            Baker Pro n'est pas encore commercialisé : aucun paiement n'est possible aujourd'hui,
            et rien ne vous sera facturé. Les limites de l'offre gratuite restent en place d'ici là.
          </Text>
        </View>

        <Pressable testID="pro-close" onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>Revenir au planning</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 60 },
  brandLabel: { fontSize: 11, letterSpacing: 4, color: theme.color.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 34, color: theme.color.onSurface, marginTop: 4 },
  statusBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8 },
  statusText: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  intro: { fontSize: 14, color: theme.color.onSurfaceSecondary, lineHeight: 21, marginTop: 20, marginBottom: 8 },
  feature: { flexDirection: 'row', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  featureIcon: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.brandTertiary },
  featureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  featureTitle: { fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface },
  soonPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.surfaceTertiary },
  soonText: { fontSize: 9, letterSpacing: 1, color: theme.color.onSurfaceTertiary, fontWeight: '700' },
  featureBody: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19, marginTop: 4 },
  noticeBox: { marginTop: 26, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.color.border },
  noticeTitle: { fontFamily: theme.serif, fontSize: 16, color: theme.color.onSurface },
  noticeBody: { fontSize: 13, color: theme.color.muted, lineHeight: 19, marginTop: 6 },
  closeBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong, marginTop: 22 },
  closeText: { fontSize: 15, color: theme.color.onSurface, fontWeight: '600' },
});
