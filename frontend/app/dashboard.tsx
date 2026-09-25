import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { LockedFeatureNotice } from '@/src/PlanChip';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { EmptyState } from '@/src/EmptyState';
import { Chip } from '@/src/Chip';
import { ScrollProgressBar, useScrollProgress } from '@/src/ScrollProgressBar';

type Period = 'week' | 'month' | 'year' | 'all';
const PERIODS: [Period, string][] = [
  ['week', 'Cette semaine'], ['month', 'Ce mois-ci'], ['year', 'Cette année'], ['all', 'Depuis toujours'],
];

type Ingredient = { name: string; quantity: number; unit: string };
type TaskMember = {
  user_id: string; name: string; picture?: string | null; role: string | null;
  todo: number; doing: number; done: number;
};
type DashboardData = {
  period: Period;
  production: { production_count: number; ingredients: { items: Ingredient[]; unparsed: string[] } };
  staff: { schedule_count: number; worked_minutes: number; overtime_minutes: number; total_minutes: number };
  cost: {
    calculation_count: number; priced_count: number; total_cost: number | null;
    margin_count: number; total_margin: number | null;
  };
  tasks: { members: TaskMember[]; unassigned_steps: number };
};

function formatMinutes(m: number) {
  if (m <= 0) return '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

function formatEuros(v: number | null) {
  if (v == null) return '—';
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/**
 * Tableau de bord manager d'une organisation (phase 7d) : vue d'ensemble
 * Production / Personnel / Coûts et marges / Tâches sur une fenêtre
 * glissante, réservée au propriétaire et à l'encadrement — voir
 * `backend/dashboard.py`. Écran plat, même coquille que
 * `classement.tsx`/`organisation.tsx` (en-tête flèche retour, pas d'onglet).
 *
 * Trois issues distinctes pour `GET /organisations/dashboard`, jamais
 * confondues : 422 (pas d'organisation active) renvoie vers l'écran
 * Organisation, 403 `plan_feature_locked` affiche le verrou de palier
 * habituel, un 403 ordinaire (rôle insuffisant) affiche un message dédié —
 * ce ne sont pas la même situation pour l'utilisateur.
 */
export default function DashboardScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const router = useRouter();

  const [period, setPeriod] = useState<Period>('week');
  const { progress, onScroll } = useScrollProgress();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'ok' | 'no_org' | 'locked' | 'forbidden' | 'error'>('ok');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const body: DashboardData = await api(`/organisations/dashboard?period=${p}`);
      setData(body);
      setStatus('ok');
    } catch (e: any) {
      setData(null);
      if (e.status === 422) {
        setStatus('no_org');
      } else if (e.status === 403 && e.detail?.error === 'plan_feature_locked') {
        setStatus('locked');
      } else if (e.status === 403) {
        setStatus('forbidden');
      } else {
        setStatus('error');
        setErrorMessage(e.message || 'Chargement impossible');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(period); }, [load, period]));

  const Avatar = ({ member }: { member: TaskMember }) => {
    const uri = avatarUrl(member.picture, API_BASE);
    return (
      <View style={styles.avatar}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={styles.avatarText}>{(member.name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="dashboard-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Tableau de bord</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollProgressBar progress={progress} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {PERIODS.map(([key, label]) => (
          <Chip key={key} testID={`dashboard-period-${key}`} label={label} active={period === key} onPress={() => setPeriod(key)} />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : status === 'no_org' ? (
        <EmptyState
          icon="briefcase"
          title="Aucune organisation active"
          subtitle="Le tableau de bord suppose une organisation active. Créez-en une ou rejoignez celle d'un collègue."
          ctaLabel="Aller à Organisation"
          onCta={() => router.push('/organisation' as any)}
          testID="dashboard-go-organisation"
        />
      ) : status === 'locked' ? (
        <View style={styles.body}>
          <LockedFeatureNotice
            minPlan="team"
            label="Le tableau de bord est réservé à l'offre Équipe"
            onPress={() => router.push('/pro?feature=org_dashboard' as any)}
          />
        </View>
      ) : status === 'forbidden' ? (
        <EmptyState
          icon="lock"
          title="Réservé à l'encadrement"
          subtitle="Le tableau de bord n'est visible que par le propriétaire et l'encadrement de l'organisation."
        />
      ) : status === 'error' ? (
        <EmptyState
          icon="wifi-off"
          title="Impossible de charger le tableau de bord"
          subtitle={errorMessage || undefined}
          ctaLabel="Réessayer"
          onCta={() => load(period)}
          testID="dashboard-retry"
        />
      ) : data ? (
        <ScrollView contentContainerStyle={styles.body} onScroll={onScroll} scrollEventThrottle={16}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Production</Text>
            <Text style={styles.sectionStat}>{data.production.production_count}</Text>
            <Text style={styles.sectionStatLabel}>production{data.production.production_count > 1 ? 's' : ''} planifiée{data.production.production_count > 1 ? 's' : ''}</Text>
            {data.production.ingredients.items.length === 0 ? (
              <Text style={styles.emptyLine}>Aucune matière à agréger sur cette période.</Text>
            ) : (
              data.production.ingredients.items.slice(0, 8).map(item => (
                <View key={`${item.name}-${item.unit}`} style={styles.ingredientRow}>
                  <Text style={styles.ingredientName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.ingredientQty}>{item.quantity} {item.unit}</Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Personnel</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.sectionStat}>{formatMinutes(data.staff.worked_minutes)}</Text>
                <Text style={styles.sectionStatLabel}>travaillées</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.sectionStat}>{formatMinutes(data.staff.overtime_minutes)}</Text>
                <Text style={styles.sectionStatLabel}>supplémentaires</Text>
              </View>
            </View>
            <Text style={styles.emptyLine}>
              {data.staff.schedule_count} planning{data.staff.schedule_count > 1 ? 's' : ''} sur la période
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Coûts et marges</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.sectionStat}>{formatEuros(data.cost.total_cost)}</Text>
                <Text style={styles.sectionStatLabel}>coût matières</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.sectionStat}>{formatEuros(data.cost.total_margin)}</Text>
                <Text style={styles.sectionStatLabel}>marge</Text>
              </View>
            </View>
            <Text style={styles.emptyLine}>
              {data.cost.calculation_count} calcul{data.cost.calculation_count > 1 ? 's' : ''} enregistré{data.cost.calculation_count > 1 ? 's' : ''}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tâches</Text>
            {data.tasks.members.length === 0 ? (
              <Text style={styles.emptyLine}>Aucune étape assignée sur la période.</Text>
            ) : (
              data.tasks.members.map(member => (
                <View key={member.user_id} style={styles.memberRow} testID={`dashboard-member-${member.user_id}`}>
                  <Avatar member={member} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.memberMeta}>
                      {member.done} faite{member.done > 1 ? 's' : ''} · {member.doing} en cours · {member.todo} à faire
                    </Text>
                  </View>
                </View>
              ))
            )}
            {data.tasks.unassigned_steps > 0 && (
              <Text style={styles.emptyLine}>
                {data.tasks.unassigned_steps} étape{data.tasks.unassigned_steps > 1 ? 's' : ''} non assignée{data.tasks.unassigned_steps > 1 ? 's' : ''}
              </Text>
            )}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingVertical: 16 },
  body: { padding: 24, paddingTop: 8, paddingBottom: 60, gap: 16 },
  section: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
  sectionTitle: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase' },
  sectionStat: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface },
  sectionStatLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 8 },
  statBlock: {},
  emptyLine: { fontSize: 13, color: colors.muted, marginTop: 8, lineHeight: 19 },
  ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 6 },
  ingredientName: { flex: 1, fontSize: 14, color: colors.onSurface, marginRight: 8 },
  ingredientQty: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 6 },
  avatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif, fontSize: 15 },
  memberName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  memberMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
