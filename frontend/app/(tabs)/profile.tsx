import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList, Modal, Alert, Linking, Platform } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/src/auth';
import { api, API_BASE, getToken } from '@/src/api';
import { ActionSheet } from '@/src/ActionSheet';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { recipeImageSource } from '@/src/products';
import { theme } from '@/src/theme';

type PendingImage = { uri: string; name: string };

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'favorites'>('mine');
  const [mine, setMine] = useState<any[]>([]);
  const [favs, setFavs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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

  const pickAvatar = async (kind: 'camera' | 'library') => {
    setAvatarError(null);
    const perm = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert(
          kind === 'camera' ? 'Accès à la caméra refusé' : 'Accès à la photothèque refusé',
          `Autorisez l'accès dans Réglages › Baker › ${kind === 'camera' ? 'Appareil photo' : 'Photos'}.`,
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
          ],
        );
      } else {
        setAvatarError(kind === 'camera' ? 'Permission caméra refusée' : 'Permission photothèque refusée');
      }
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'] as any, quality: 0.8, allowsEditing: true, aspect: [1, 1] };
    const result = kind === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPendingImage({ uri: asset.uri, name: `avatar.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}` });
  };

  const confirmUpload = async () => {
    if (!pendingImage) return;
    setUploading(true);
    setAvatarError(null);
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(pendingImage.uri)).blob();
        form.append('file', blob, pendingImage.name);
      } else {
        form.append('file', { uri: pendingImage.uri, name: pendingImage.name, type: `image/${pendingImage.name.split('.').pop()}` } as any);
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE}/auth/me/picture`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'Impossible de modifier votre photo. Vérifiez votre connexion et réessayez.');
      await refreshUser();
      setPendingImage(null);
    } catch (e: any) {
      setAvatarError(e.message || 'Impossible de modifier votre photo. Vérifiez votre connexion et réessayez.');
    } finally {
      setUploading(false);
    }
  };

  const deleteAvatar = async () => {
    const ok = await confirmAsync('Supprimer votre photo de profil ?', 'Un avatar par défaut sera affiché à la place.', 'Supprimer', true);
    if (!ok) return;
    setAvatarError(null);
    try {
      await api('/auth/me/picture', { method: 'DELETE' });
      await refreshUser();
    } catch (e: any) {
      setAvatarError(e.message || 'Impossible de modifier votre photo. Vérifiez votre connexion et réessayez.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable testID="avatar-btn" onPress={() => setAvatarMenuOpen(true)} style={styles.avatar}>
            {avatarUrl(user?.picture, API_BASE) ? (
              <Image source={{ uri: avatarUrl(user?.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </Pressable>
          <Pressable testID="logout-btn" onPress={logout} style={styles.logoutBtn}>
            <Feather name="log-out" size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>
        <Text style={styles.name}>{user?.name || 'Boulanger'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.avatarLinksRow}>
          <Pressable testID="edit-avatar-link" onPress={() => setAvatarMenuOpen(true)}>
            <Text style={styles.avatarLink}>Modifier la photo</Text>
          </Pressable>
          {user?.picture && (
            <Pressable testID="delete-avatar-link" onPress={deleteAvatar}>
              <Text style={[styles.avatarLink, { color: theme.color.error }]}>Supprimer la photo</Text>
            </Pressable>
          )}
        </View>
        {avatarError && <Text style={styles.avatarError} testID="avatar-error">{avatarError}</Text>}

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
              <Image source={recipeImageSource(item, API_BASE)} style={styles.cardImage} contentFit="cover" />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.difficulty} · {item.like_count ?? 0} {"j'aime"}</Text>
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

      <ActionSheet
        visible={avatarMenuOpen}
        title="Photo de profil"
        onClose={() => setAvatarMenuOpen(false)}
        options={[
          { key: 'camera', emoji: '📷', label: 'Prendre une photo', onPress: () => pickAvatar('camera') },
          { key: 'library', emoji: '🖼️', label: 'Choisir dans la photothèque', onPress: () => pickAvatar('library') },
          ...(user?.picture ? [{ key: 'delete', emoji: '🗑️', label: 'Supprimer la photo', onPress: deleteAvatar, destructive: true }] : []),
        ]}
      />

      <Modal visible={!!pendingImage} transparent animationType="fade" onRequestClose={() => !uploading && setPendingImage(null)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewCard}>
            {pendingImage && (
              <Image source={{ uri: pendingImage.uri }} style={styles.previewImage} contentFit="cover" />
            )}
            {avatarError && <Text style={styles.avatarError} testID="avatar-preview-error">{avatarError}</Text>}
            <Pressable
              testID="avatar-confirm-btn"
              onPress={confirmUpload}
              disabled={uploading}
              style={[styles.previewConfirmBtn, uploading && { opacity: 0.6 }]}
            >
              {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.previewConfirmText}>Utiliser cette photo</Text>}
            </Pressable>
            <Pressable testID="avatar-cancel-btn" disabled={uploading} onPress={() => { setPendingImage(null); setAvatarError(null); }} style={styles.previewCancelBtn}>
              <Text style={styles.previewCancelText}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: theme.color.surfaceSecondary },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 14, color: theme.color.muted, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: { marginTop: 16, backgroundColor: theme.color.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 4 },
  emptyBtnText: { color: '#fff', fontWeight: '600' },
  avatarLinksRow: { flexDirection: 'row', gap: 20, marginTop: 10 },
  avatarLink: { fontSize: 13, color: theme.color.brand, fontWeight: '600' },
  avatarError: { fontSize: 13, color: theme.color.error, marginTop: 8 },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  previewCard: { backgroundColor: theme.color.surface, borderRadius: 16, padding: 24, alignItems: 'center', width: '100%', maxWidth: 340 },
  previewImage: { width: 200, height: 200, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, marginBottom: 20 },
  previewConfirmBtn: { backgroundColor: theme.color.brand, borderRadius: 999, paddingVertical: 14, alignItems: 'center', width: '100%' },
  previewConfirmText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  previewCancelBtn: { paddingVertical: 14, alignItems: 'center', width: '100%' },
  previewCancelText: { color: theme.color.muted, fontWeight: '500', fontSize: 14 },
});
