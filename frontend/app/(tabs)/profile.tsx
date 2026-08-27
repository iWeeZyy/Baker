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
import { formatRelativeDate } from '@/src/relativeDate';
import { theme } from '@/src/theme';

type PendingImage = { uri: string; name: string };

type MyComment = {
  id: string; recipe_id: string; recipe_title: string; recipe_product?: string | null;
  recipe_image_path?: string | null; recipe_image_url?: string | null;
  content: string; created_at: string; edited_at?: string | null; like_count: number;
  parent_id?: string | null; reply_to_user_name?: string | null;
};

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'favorites' | 'comments'>('mine');
  const [mine, setMine] = useState<any[]>([]);
  const [favs, setFavs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [myComments, setMyComments] = useState<MyComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, f] = await Promise.all([api('/recipes/mine'), api('/recipes/favorites')]);
      setMine(m); setFavs(f);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadComments = useCallback(async () => {
    try {
      const res = await api('/comments/mine');
      setMyComments(res.comments);
      setCommentsHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setCommentsLoaded(true); }
  }, []);

  useEffect(() => {
    if (tab === 'comments' && !commentsLoaded) loadComments();
  }, [tab, commentsLoaded, loadComments]);

  const loadMoreComments = async () => {
    if (commentsLoadingMore || myComments.length === 0) return;
    setCommentsLoadingMore(true);
    try {
      const before = encodeURIComponent(myComments[myComments.length - 1].created_at);
      const res = await api(`/comments/mine?before=${before}`);
      setMyComments(prev => [...prev, ...res.comments]);
      setCommentsHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setCommentsLoadingMore(false); }
  };

  const items = tab === 'favorites' ? favs : mine;
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
          <Pressable testID="tab-comments" onPress={() => setTab('comments')} style={[styles.tab, tab === 'comments' && styles.tabActive]}>
            <Text style={[styles.tabText, tab === 'comments' && styles.tabTextActive]}>Mes commentaires</Text>
          </Pressable>
        </View>
      </View>

      {tab === 'comments' ? (
        !commentsLoaded ? (
          <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
        ) : (
          <FlatList
            data={myComments}
            keyExtractor={c => c.id}
            contentContainerStyle={{ gap: 16, padding: 24, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const isReply = !!item.parent_id;
              return (
                <Pressable
                  testID={`profile-comment-${item.id}`}
                  onPress={() => router.push(`/recipe/${item.recipe_id}?tab=community&highlightComment=${item.id}`)}
                  style={styles.commentCard}
                >
                  <Image
                    source={recipeImageSource({ image_path: item.recipe_image_path, image_url: item.recipe_image_url, product: item.recipe_product }, API_BASE)}
                    style={styles.commentThumb}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentCardKind}>
                      {isReply ? 'Réponse sur' : 'Commentaire sur'} {item.recipe_title}
                    </Text>
                    {isReply && item.reply_to_user_name && (
                      <Text style={styles.commentCardReplyTo}>Réponse à {item.reply_to_user_name}</Text>
                    )}
                    <Text style={styles.commentCardBody} numberOfLines={3}>{item.content}</Text>
                    <View style={styles.commentCardFooter}>
                      <Text style={styles.commentCardMeta}>{formatRelativeDate(item.created_at)}</Text>
                      <Text style={styles.commentCardMeta}>❤ {item.like_count}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather name="message-circle" size={40} color={theme.color.muted} />
                <Text style={styles.emptyTitle}>Aucun commentaire</Text>
                <Text style={styles.emptySubtitle}>Vos commentaires apparaîtront ici lorsque vous participerez aux discussions sur les recettes.</Text>
                <Pressable testID="empty-comments-btn" onPress={() => router.push('/(tabs)/recipes' as any)} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>Découvrir des recettes</Text>
                </Pressable>
              </View>
            }
            ListFooterComponent={commentsHasMore ? (
              <Pressable testID="comments-load-more" onPress={loadMoreComments} disabled={commentsLoadingMore} style={styles.loadMoreBtn}>
                {commentsLoadingMore ? <ActivityIndicator size="small" color={theme.color.brand} /> : <Text style={styles.loadMoreText}>Charger plus</Text>}
              </Pressable>
            ) : null}
          />
        )
      ) : loading ? (
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
  emptySubtitle: { fontSize: 13, color: theme.color.muted, textAlign: 'center', paddingHorizontal: 32, marginTop: -6 },
  emptyBtn: { marginTop: 16, backgroundColor: theme.color.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 4 },
  emptyBtnText: { color: '#fff', fontWeight: '600' },
  commentCard: { flexDirection: 'row', gap: 12, backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, padding: 14 },
  commentThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: theme.color.surfaceTertiary },
  commentCardKind: { fontSize: 13, fontWeight: '600', color: theme.color.onSurface },
  commentCardReplyTo: { fontSize: 12, color: theme.color.brand, fontWeight: '500', marginTop: 2 },
  commentCardBody: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18, marginTop: 4 },
  commentCardFooter: { flexDirection: 'row', gap: 16, marginTop: 8 },
  commentCardMeta: { fontSize: 12, color: theme.color.muted },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 14 },
  loadMoreText: { fontSize: 13, color: theme.color.brand, fontWeight: '600' },
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
