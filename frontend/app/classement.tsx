import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { recipeImageSource } from '@/src/products';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { LevelBadge } from '@/src/gamification/LevelBadge';
import { Chip } from '@/src/Chip';
import { EmptyState } from '@/src/EmptyState';
import { SegmentedControl } from '@/src/SegmentedControl';

type Period = 'week' | 'month' | 'year' | 'all';
type Category = 'creators' | 'recipes' | 'creations';

const PERIODS: [Period, string][] = [['week', 'Cette semaine'], ['month', 'Ce mois-ci'], ['year', 'Cette année'], ['all', 'Depuis toujours']];
const CATEGORIES: [Category, string][] = [['creators', 'Créateurs'], ['recipes', 'Recettes'], ['creations', 'Créations']];

type CreatorRow = { user_id: string; name: string; picture?: string | null; following: boolean; score: number; rank: number; level?: { level: number; title: string } };
type MyRank = { rank: number; score: number } | null;
type RecipeRow = { id: string; title: string; category?: string; image_path?: string | null; image_url?: string | null; product?: string | null; author_id: string; author_name?: string; author_picture?: string | null; like_count: number; rank: number };
type CreationRow = { id: string; title: string; category?: string; photos: string[]; user_id: string; user_name?: string; user_picture?: string | null; like_count: number; rank: number };

export default function Classement() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const router = useRouter();

  const [period, setPeriod] = useState<Period>('week');
  const [category, setCategory] = useState<Category>('creators');
  const [loading, setLoading] = useState(true);
  const [creators, setCreators] = useState<{ top: CreatorRow[]; my_rank: MyRank } | null>(null);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [creations, setCreations] = useState<CreationRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const path = category === 'creators' ? '/leaderboard/creators' : category === 'recipes' ? '/leaderboard/recipes' : '/leaderboard/creations';
    api(`${path}?period=${period}`).then((data) => {
      if (cancelled) return;
      if (category === 'creators') setCreators({ top: data.top, my_rank: data.my_rank });
      else if (category === 'recipes') setRecipes(data.items);
      else setCreations(data.items);
    }).catch(console.warn).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, period]);

  const toggleFollow = async (row: CreatorRow) => {
    if (busyId) return;
    setBusyId(row.user_id);
    const prev = row.following;
    setCreators(c => c ? { ...c, top: c.top.map(r => r.user_id === row.user_id ? { ...r, following: !r.following } : r) } : c);
    try {
      const res = await api(`/users/${row.user_id}/follow`, { method: 'POST' });
      setCreators(c => c ? { ...c, top: c.top.map(r => r.user_id === row.user_id ? { ...r, following: res.following } : r) } : c);
    } catch (e) {
      console.warn(e);
      setCreators(c => c ? { ...c, top: c.top.map(r => r.user_id === row.user_id ? { ...r, following: prev } : r) } : c);
    } finally {
      setBusyId(null);
    }
  };

  const Avatar = ({ name, picture, size = 40 }: { name?: string | null; picture?: string | null; size?: number }) => {
    const uri = avatarUrl(picture, API_BASE);
    return (
      <View style={[styles.avatar, { width: size, height: size }]}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  const FollowPill = ({ row }: { row: CreatorRow }) => {
    if (user && row.user_id === user.user_id) return null;
    if (busyId === row.user_id) return <ActivityIndicator size="small" color={colors.brand} />;
    if (row.following) {
      return (
        <Pressable testID={`leaderboard-unfollow-${row.user_id}`} onPress={() => toggleFollow(row)} style={styles.followBtnMuted}>
          <Feather name="check" size={13} color={colors.onSurfaceSecondary} />
          <Text style={styles.followBtnMutedText}>Suivi</Text>
        </Pressable>
      );
    }
    return (
      <Pressable testID={`leaderboard-follow-${row.user_id}`} onPress={() => toggleFollow(row)} style={styles.followBtn}>
        <Feather name="plus" size={13} color={colors.onBrandPrimary} />
        <Text style={styles.followBtnText}>Suivre</Text>
      </Pressable>
    );
  };

  const Empty = () => (
    <EmptyState icon="award" title="Le classement arrive bientôt" subtitle="Publiez des recettes et des créations pour participer au classement." />
  );

  // Trois seules teintes de marque existent dans le thème — jamais un
  // or/argent/bronze inventé pour le podium.
  const podiumTiers = [
    { bg: colors.brand, fg: colors.onBrandPrimary, size: 72 },
    { bg: colors.brandSecondary, fg: colors.onBrandSecondary, size: 60 },
    { bg: colors.brandTertiary, fg: colors.onBrandTertiary, size: 52 },
  ];

  const renderCreators = () => {
    if (!creators || creators.top.length === 0) return <Empty />;
    const podium = creators.top.slice(0, 3);
    const rest = creators.top.slice(3);
    return (
      <>
        <View style={styles.podiumRow}>
          {podium.map((row, i) => {
            const tier = podiumTiers[i];
            return (
              <Pressable key={row.user_id} testID={`leaderboard-user-${row.user_id}`} onPress={() => router.push(`/baker/${row.user_id}` as any)} style={styles.podiumItem}>
                <View style={[styles.podiumAvatarWrap, { backgroundColor: tier.bg, width: tier.size + 8, height: tier.size + 8, borderRadius: (tier.size + 8) / 2 }]}>
                  <Avatar name={row.name} picture={row.picture} size={tier.size} />
                </View>
                <Text style={[styles.podiumRank, { color: tier.bg }]}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</Text>
                <Text style={styles.podiumName} numberOfLines={1}>{row.name}</Text>
                <Text style={styles.podiumScore}>{row.score} pts</Text>
              </Pressable>
            );
          })}
        </View>

        {rest.map(row => (
          <Pressable key={row.user_id} testID={`leaderboard-user-${row.user_id}`} onPress={() => router.push(`/baker/${row.user_id}` as any)} style={styles.row}>
            <Text style={styles.rankNumber}>{row.rank}</Text>
            <Avatar name={row.name} picture={row.picture} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{row.name}</Text>
              <LevelBadge level={row.level} compact />
              <Text style={styles.rowMeta}>{row.score} points</Text>
            </View>
            <FollowPill row={row} />
          </Pressable>
        ))}

        <View style={styles.myRankCard} testID="my-rank-card">
          <Text style={styles.myRankTitle}>Votre classement</Text>
          {creators.my_rank ? (
            <View style={styles.myRankRow}>
              <Text style={styles.myRankNumber}>#{creators.my_rank.rank}</Text>
              <Avatar name={user?.name} picture={user?.picture} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{user?.name}</Text>
                <Text style={styles.rowMeta}>{creators.my_rank.score} points</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.myRankEmpty}>Publiez ou recevez des interactions pour apparaître dans ce classement.</Text>
          )}
        </View>
      </>
    );
  };

  const renderRecipes = () => {
    if (recipes.length === 0) return <Empty />;
    return recipes.map(item => (
      <Pressable key={item.id} testID={`leaderboard-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.contentCard}>
        <Text style={styles.rankNumber}>{item.rank}</Text>
        <Image source={recipeImageSource(item, API_BASE)} style={styles.contentImage} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.rowMeta}>{item.author_name || 'Boulanger'}</Text>
          <View style={styles.metaItem}>
            <Feather name="heart" size={13} color={colors.error} />
            <Text style={styles.rowMeta}>{item.like_count}</Text>
          </View>
        </View>
      </Pressable>
    ));
  };

  const renderCreations = () => {
    if (creations.length === 0) return <Empty />;
    return creations.map(item => (
      <Pressable key={item.id} testID={`leaderboard-creation-${item.id}`} onPress={() => router.push(`/creation/${item.id}` as any)} style={styles.contentCard}>
        <Text style={styles.rankNumber}>{item.rank}</Text>
        <Image source={item.photos?.[0] ? { uri: `${API_BASE}/files/${item.photos[0]}` } : undefined} style={styles.contentImage} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.rowMeta}>{item.user_name || 'Boulanger'}</Text>
          <View style={styles.metaItem}>
            <Feather name="heart" size={13} color={colors.error} />
            <Text style={styles.rowMeta}>{item.like_count}</Text>
          </View>
        </View>
      </Pressable>
    ));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="classement-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Classement</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {PERIODS.map(([key, label]) => (
          <Chip key={key} testID={`period-${key}`} label={label} active={period === key} onPress={() => setPeriod(key)} />
        ))}
      </ScrollView>

      <SegmentedControl
        testID="category"
        options={CATEGORIES.map(([key, label]) => ({ key, label }))}
        value={category}
        onChange={setCategory}
      />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {category === 'creators' && renderCreators()}
          {category === 'recipes' && renderRecipes()}
          {category === 'creations' && renderCreations()}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingVertical: 16 },
  body: { padding: 24, paddingTop: 8, paddingBottom: 60, gap: 12 },
  podiumRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 16, marginBottom: 24 },
  podiumItem: { alignItems: 'center', width: 96 },
  podiumAvatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  podiumRank: { fontSize: 20 },
  podiumName: { fontFamily: theme.serif, fontSize: 14, color: colors.onSurface, marginTop: 4 },
  podiumScore: { fontSize: 12, color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rankNumber: { width: 24, fontFamily: theme.serif, fontSize: 16, color: colors.muted, textAlign: 'center' },
  avatar: { borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  followBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '600' },
  followBtnMuted: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  followBtnMutedText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  contentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  contentImage: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  myRankCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 16, marginTop: 12 },
  myRankTitle: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 10 },
  myRankRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  myRankNumber: { fontFamily: theme.serif, fontSize: 20, color: colors.brand, width: 44 },
  myRankEmpty: { fontSize: 13, color: colors.muted, lineHeight: 19 },
});
