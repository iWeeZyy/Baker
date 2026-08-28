import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { openInstagram } from '@/src/instagram';
import { recipeImageSource } from '@/src/products';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export default function BakerProfile() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; name: string; picture?: string | null; role: string | null }[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api(`/users/${id}/profile`);
      setData(d);
      if (d.team_visible && d.team_count > 0) {
        api(`/users/${id}/team?limit=6`).then(t => setTeamMembers(t.members)).catch(() => {});
      } else {
        setTeamMembers([]);
      }
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const sendRequest = async () => {
    setActionLoading(true);
    try {
      const res = await api('/friends/request', { method: 'POST', body: JSON.stringify({ user_id: id }) });
      setData((d: any) => ({ ...d, friend_status: res.status === 'friends' ? 'friends' : 'pending_sent' }));
    } catch (e) { console.warn(e); }
    finally { setActionLoading(false); }
  };

  const doRemoveFriend = async () => {
    setActionLoading(true);
    try {
      await api(`/friends/${id}`, { method: 'DELETE' });
      setData((d: any) => ({ ...d, friend_status: 'none' }));
    } catch (e) { console.warn(e); }
    finally { setActionLoading(false); }
  };

  const removeFriend = async () => {
    const ok = await confirmAsync(
      'Retirer cet ami',
      `Vous ne pourrez plus échanger de messages avec ${data?.user?.name || 'cette personne'}.`,
      'Retirer',
      true,
    );
    if (ok) await doRemoveFriend();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  if (!data) return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.emptyTitle}>Profil introuvable</Text>
    </SafeAreaView>
  );

  const { user, recipes, recipe_count, total_likes, friend_status, creations, team_count, team_visible } = data;
  const initial = (user.name || '?').slice(0, 1).toUpperCase();
  const memberSince = user.created_at ? new Date(user.created_at.endsWith?.('Z') || user.created_at.includes?.('+') ? user.created_at : user.created_at + 'Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null;

  const FriendAction = () => {
    if (friend_status === 'me') return null;
    if (friend_status === 'friends') {
      return (
        <View style={{ alignItems: 'center' }}>
          <Pressable testID="message-btn" onPress={() => router.push({ pathname: `/chat/${user.user_id}` as any, params: { name: user.name } })} style={styles.actionBtn}>
            <Feather name="message-circle" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.actionText}>Envoyer un message</Text>
          </Pressable>
          <Pressable testID="remove-friend-btn" onPress={removeFriend} disabled={actionLoading} style={styles.removeFriendBtn}>
            <Text style={styles.removeFriendText}>Retirer cet ami</Text>
          </Pressable>
        </View>
      );
    }
    if (friend_status === 'pending_sent') {
      return (
        <View style={[styles.actionBtn, styles.actionBtnMuted]}>
          <Feather name="clock" size={16} color={colors.muted} />
          <Text style={[styles.actionText, { color: colors.muted }]}>Demande envoyée</Text>
        </View>
      );
    }
    // none or pending_received (accept directly)
    return (
      <Pressable testID="add-friend-btn" onPress={sendRequest} disabled={actionLoading} style={[styles.actionBtn, actionLoading && { opacity: 0.6 }]}>
        <Feather name="user-plus" size={16} color={colors.onBrandPrimary} />
        <Text style={styles.actionText}>{friend_status === 'pending_received' ? 'Accepter la demande' : 'Ajouter en ami'}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        style={{ flex: 1 }}
        data={recipes}
        keyExtractor={(r) => r.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 16, paddingHorizontal: 24 }}
        contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={colors.onSurface} />
            </Pressable>
            <View style={styles.avatar}>
              {avatarUrl(user.picture, API_BASE) ? (
                <Image source={{ uri: avatarUrl(user.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <Text style={styles.name} testID="baker-name">{user.name}</Text>
            {memberSince && <Text style={styles.since}>Boulanger depuis {memberSince}</Text>}
            {!!user.profession && <Text style={styles.profession} testID="baker-profession">{user.profession}</Text>}
            {!!user.bio && <Text style={styles.bio} testID="baker-bio">{user.bio}</Text>}
            {!!user.instagram_username && (
              <Pressable testID="baker-instagram-link" onPress={() => openInstagram(user.instagram_username)} style={styles.instagramRow}>
                <Feather name="instagram" size={15} color={colors.brand} />
                <Text style={styles.instagramText}>Instagram @{user.instagram_username}</Text>
              </Pressable>
            )}

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{recipe_count}</Text>
                <Text style={styles.statLabel}>RECETTES</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>{total_likes}</Text>
                <Text style={styles.statLabel}>J'AIME REÇUS</Text>
              </View>
              {team_visible && (
                <>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Text style={styles.statVal}>{team_count}</Text>
                    <Text style={styles.statLabel}>TEAM</Text>
                  </View>
                </>
              )}
            </View>

            <FriendAction />

            {creations?.length > 0 && (
              <View style={styles.creationsSection}>
                <View style={styles.creationsHeaderRow}>
                  <Text style={styles.creationsTitle}>Créations</Text>
                  {creations.length > 6 && (
                    <Pressable testID="see-all-baker-creations" onPress={() => router.push(`/creations/${user.user_id}` as any)}>
                      <Text style={styles.creationsSeeAll}>Voir tout ({creations.length})</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.creationsGrid}>
                  {creations.slice(0, 6).map((c: any) => (
                    <Pressable key={c.id} testID={`baker-creation-tile-${c.id}`} onPress={() => router.push(`/creation/${c.id}` as any)} style={styles.creationTile}>
                      <Image source={{ uri: `${API_BASE}/files/${c.photos[0]}` }} style={styles.creationTileImage} contentFit="cover" />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {team_visible && (
              <View style={styles.creationsSection}>
                <View style={styles.creationsHeaderRow}>
                  <Text style={styles.creationsTitle}>Team</Text>
                  {team_count > 6 && (
                    <Pressable testID="see-all-baker-team" onPress={() => router.push(`/team/${user.user_id}` as any)}>
                      <Text style={styles.creationsSeeAll}>Voir tout ({team_count})</Text>
                    </Pressable>
                  )}
                </View>
                {team_count === 0 ? (
                  <Text style={styles.creationsEmptyInline} testID="baker-team-empty">Cette Team est vide.</Text>
                ) : (
                  <View style={styles.teamRow}>
                    {teamMembers.map(m => (
                      <Pressable key={m.user_id} testID={`baker-team-member-${m.user_id}`} onPress={() => router.push(`/baker/${m.user_id}` as any)} style={styles.teamChip}>
                        <View style={styles.teamAvatar}>
                          {avatarUrl(m.picture, API_BASE) ? (
                            <Image source={{ uri: avatarUrl(m.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          ) : (
                            <Text style={styles.teamAvatarText}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>
                          )}
                        </View>
                        <Text style={styles.teamChipName} numberOfLines={1}>{m.name}</Text>
                        {!!m.role && <Text style={styles.teamChipRole} numberOfLines={1}>{m.role}</Text>}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            <Text style={styles.sectionTitle}>Ses recettes</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable testID={`baker-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.card}>
            <View>
              <Image source={recipeImageSource(item, API_BASE)} style={styles.cardImage} contentFit="cover" />
              {item.coup_de_coeur && <View style={styles.cardBadge}><Feather name="award" size={12} color={colors.onBrandPrimary} /></View>}
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.cardMeta}>{item.like_count} ♥ · {item.difficulty}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucune recette partagée pour le moment.</Text>}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, alignItems: 'center' },
  backBtn: { alignSelf: 'flex-start', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  avatar: { width: 88, height: 88, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 4 },
  avatarText: { fontSize: 34, color: colors.onBrandTertiary, fontFamily: theme.serif },
  name: { fontFamily: theme.serif, fontSize: 28, color: colors.onSurface, marginTop: 14 },
  since: { fontSize: 13, color: colors.muted, marginTop: 4, fontStyle: 'italic' },
  profession: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 6 },
  bio: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20, marginTop: 12, textAlign: 'center' },
  instagramRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  instagramText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 28 },
  stat: { alignItems: 'center' },
  statVal: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface },
  statLabel: { fontSize: 10, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  actionBtnMuted: { backgroundColor: colors.surfaceSecondary },
  actionText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '600' },
  removeFriendBtn: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  removeFriendText: { color: colors.error, fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface, alignSelf: 'flex-start', marginTop: 32, marginBottom: 8 },
  creationsSection: { alignSelf: 'stretch', marginTop: 28 },
  creationsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  creationsTitle: { fontSize: 13, letterSpacing: 1, color: colors.onSurface, fontWeight: '700' },
  creationsSeeAll: { fontSize: 12, color: colors.brand, fontWeight: '600' },
  creationsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  creationTile: { width: '32%', aspectRatio: 1, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  creationTileImage: { width: '100%', height: '100%' },
  creationsEmptyInline: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  teamRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  teamChip: { alignItems: 'center', width: 72 },
  teamAvatar: { width: 56, height: 56, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  teamAvatarText: { fontSize: 20, color: colors.onBrandTertiary, fontFamily: theme.serif },
  teamChipName: { fontSize: 12, color: colors.onSurface, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  teamChipRole: { fontSize: 10, color: colors.muted, marginTop: 1, textAlign: 'center' },
  card: { flex: 1 },
  cardBadge: { position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: colors.surfaceSecondary },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 30, fontStyle: 'italic' },
  emptyTitle: { textAlign: 'center', color: colors.muted, marginTop: 60 },
});
