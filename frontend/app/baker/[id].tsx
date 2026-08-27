import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { confirmAsync } from '@/src/confirm';
import { recipeImageSource } from '@/src/products';
import { theme } from '@/src/theme';

export default function BakerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/users/${id}/profile`);
      setData(d);
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

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;
  if (!data) return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
      </Pressable>
      <Text style={styles.emptyTitle}>Profil introuvable</Text>
    </SafeAreaView>
  );

  const { user, recipes, recipe_count, total_likes, friend_status } = data;
  const initial = (user.name || '?').slice(0, 1).toUpperCase();
  const memberSince = user.created_at ? new Date(user.created_at.endsWith?.('Z') || user.created_at.includes?.('+') ? user.created_at : user.created_at + 'Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null;

  const FriendAction = () => {
    if (friend_status === 'me') return null;
    if (friend_status === 'friends') {
      return (
        <View style={{ alignItems: 'center' }}>
          <Pressable testID="message-btn" onPress={() => router.push({ pathname: `/chat/${user.user_id}` as any, params: { name: user.name } })} style={styles.actionBtn}>
            <Feather name="message-circle" size={16} color="#fff" />
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
          <Feather name="clock" size={16} color={theme.color.muted} />
          <Text style={[styles.actionText, { color: theme.color.muted }]}>Demande envoyée</Text>
        </View>
      );
    }
    // none or pending_received (accept directly)
    return (
      <Pressable testID="add-friend-btn" onPress={sendRequest} disabled={actionLoading} style={[styles.actionBtn, actionLoading && { opacity: 0.6 }]}>
        <Feather name="user-plus" size={16} color="#fff" />
        <Text style={styles.actionText}>{friend_status === 'pending_received' ? 'Accepter la demande' : 'Ajouter en ami'}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={recipes}
        keyExtractor={(r) => r.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 16, paddingHorizontal: 24 }}
        contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
            </Pressable>
            <View style={styles.avatar}>
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <Text style={styles.name} testID="baker-name">{user.name}</Text>
            {memberSince && <Text style={styles.since}>Boulanger depuis {memberSince}</Text>}

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
            </View>

            <FriendAction />

            <Text style={styles.sectionTitle}>Ses recettes</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable testID={`baker-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.card}>
            <View>
              <Image source={recipeImageSource(item, API_BASE)} style={styles.cardImage} contentFit="cover" />
              {item.coup_de_coeur && <View style={styles.cardBadge}><Feather name="award" size={12} color="#fff" /></View>}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 24, paddingTop: 8, alignItems: 'center' },
  backBtn: { alignSelf: 'flex-start', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  avatar: { width: 88, height: 88, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 4 },
  avatarText: { fontSize: 34, color: theme.color.onBrandTertiary, fontFamily: theme.serif },
  name: { fontFamily: theme.serif, fontSize: 28, color: theme.color.onSurface, marginTop: 14 },
  since: { fontSize: 13, color: theme.color.muted, marginTop: 4, fontStyle: 'italic' },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 28 },
  stat: { alignItems: 'center' },
  statVal: { fontFamily: theme.serif, fontSize: 26, color: theme.color.onSurface },
  statLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: theme.color.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999, marginTop: 20 },
  actionBtnMuted: { backgroundColor: theme.color.surfaceSecondary },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  removeFriendBtn: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  removeFriendText: { color: theme.color.error, fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface, alignSelf: 'flex-start', marginTop: 32, marginBottom: 8 },
  card: { flex: 1 },
  cardBadge: { position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: theme.color.surfaceSecondary },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.color.muted, marginTop: 30, fontStyle: 'italic' },
  emptyTitle: { textAlign: 'center', color: theme.color.muted, marginTop: 60 },
});
