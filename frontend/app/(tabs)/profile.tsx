import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'favorites'>('mine');
  const [mine, setMine] = useState<any[]>([]);
  const [favs, setFavs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, f] = await Promise.all([api('/recipes/mine'), api('/recipes/favorites')]);
      setMine(m); setFavs(f);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = tab === 'mine' ? mine : favs;
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.avatar}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <Pressable testID="logout-btn" onPress={logout} style={styles.logoutBtn}>
            <Feather name="log-out" size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>
        <Text style={styles.name}>{user?.name || 'Boulanger'}</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <View style={styles.tabs}>
          <Pressable testID="tab-mine" onPress={() => setTab('mine')} style={[styles.tab, tab === 'mine' && styles.tabActive]}>
            <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>Mes recettes</Text>
          </Pressable>
          <Pressable testID="tab-favs" onPress={() => setTab('favorites')} style={[styles.tab, tab === 'favorites' && styles.tabActive]}>
            <Text style={[styles.tabText, tab === 'favorites' && styles.tabTextActive]}>Sauvegardées</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={r => r.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 16, paddingHorizontal: 24 }}
          contentContainerStyle={{ gap: 24, paddingVertical: 20, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable testID={`profile-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.card}>
              <Image source={{ uri: item.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600' }} style={styles.cardImage} contentFit="cover" />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.difficulty}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name={tab === 'mine' ? 'edit-3' : 'bookmark'} size={40} color={theme.color.muted} />
              <Text style={styles.emptyTitle}>{tab === 'mine' ? "Vous n'avez pas encore partagé de recette" : 'Aucune recette sauvegardée'}</Text>
              {tab === 'mine' && (
                <Pressable testID="empty-share-btn" onPress={() => router.push('/share')} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>Partager une recette</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 28, color: theme.color.onBrandTertiary, fontFamily: theme.serif },
  logoutBtn: { width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: theme.serif, fontSize: 28, color: theme.color.onSurface, marginTop: 14 },
  email: { fontSize: 13, color: theme.color.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', marginTop: 24, gap: 24 },
  tab: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: theme.color.brand },
  tabText: { fontSize: 14, color: theme.color.muted, fontWeight: '500' },
  tabTextActive: { color: theme.color.onSurface },
  card: { flex: 1 },
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: 4 },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 14, color: theme.color.muted, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: { marginTop: 16, backgroundColor: theme.color.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 4 },
  emptyBtnText: { color: '#fff', fontWeight: '600' },
});
