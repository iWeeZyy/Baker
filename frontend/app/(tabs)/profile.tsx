import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList, Modal, Alert, Linking, TextInput, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/src/auth';
import { api, API_BASE } from '@/src/api';
import { uploadAvatar } from '@/src/avatarUpload';
import { ActionSheet } from '@/src/ActionSheet';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { openInstagram, parseInstagramUsername } from '@/src/instagram';
import { recipeImageSource } from '@/src/products';
import { formatRelativeDate } from '@/src/relativeDate';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { ProgressBar } from '@/src/gamification/ProgressBar';
import { LevelBadge } from '@/src/gamification/LevelBadge';
import type { Badge } from '@/src/gamification/types';
import { useUsernameAvailability } from '@/src/onboarding/useUsernameAvailability';
import { EmptyState } from '@/src/EmptyState';

const BIO_MAX_LENGTH = 300;
const PROFESSION_MAX_LENGTH = 60;
const TEAM_VISIBILITY_OPTIONS: [string, string][] = [['public', 'Publique'], ['authenticated', 'Connectés'], ['private', 'Privée']];

type PendingImage = { uri: string; name: string };

type MyComment = {
  id: string; recipe_id: string; recipe_title: string; recipe_product?: string | null;
  recipe_image_path?: string | null; recipe_image_url?: string | null;
  content: string; created_at: string; edited_at?: string | null; like_count: number;
  parent_id?: string | null; reply_to_user_name?: string | null;
};

export default function Profile() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, logout, refreshUser, updateProfile } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'favorites' | 'comments'>('mine');
  const [mine, setMine] = useState<any[]>([]);
  const [favs, setFavs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [myComments, setMyComments] = useState<MyComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [instagramDraft, setInstagramDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [creations, setCreations] = useState<{ id: string; title: string; category: string; photos: string[]; like_count: number }[]>([]);
  const [professionDraft, setProfessionDraft] = useState('');
  const [visibilityDraft, setVisibilityDraft] = useState<'public' | 'authenticated' | 'private'>('public');
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; name: string; picture?: string | null; role: string | null }[]>([]);
  const [teamCount, setTeamCount] = useState(0);
  const [teamInvites, setTeamInvites] = useState<{ id: string; from_user: { user_id: string; name: string; picture?: string | null }; role: string | null }[]>([]);
  const [stats, setStats] = useState({ recipe_count: 0, comment_count: 0, total_likes: 0, follower_count: 0, following_count: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const [collectionsCount, setCollectionsCount] = useState(0);
  const [badgesPreview, setBadgesPreview] = useState<Badge[]>([]);
  const [badgesCount, setBadgesCount] = useState(0);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [m, f, c, p, cols] = await Promise.all([
        api('/recipes/mine'), api('/recipes/favorites'), api('/creations/mine'),
        user ? api(`/users/${user.user_id}/profile`) : Promise.resolve(null),
        api('/collections').catch(() => []),
      ]);
      setMine(m); setFavs(f); setCreations(c);
      if (p) {
        setStats({
          recipe_count: p.recipe_count, comment_count: p.comment_count, total_likes: p.total_likes,
          follower_count: p.follower_count, following_count: p.following_count,
        });
      }
      // Exclut le pseudo-dossier "Toutes les recettes enregistrées"
      // (__favorites__), toujours en tête de la réponse — seules les
      // collections que l'utilisateur a réellement créées comptent ici.
      setCollectionsCount(Array.isArray(cols) ? cols.filter((c2: any) => c2.id !== '__favorites__').length : 0);
      if (p) {
        setBadgesPreview(p.badges_preview || []);
        setBadgesCount(p.badge_count || 0);
      }
      setError(false);
    } catch (e) {
      console.warn(e);
      // Un échec ici concerne l'ensemble du profil (recettes, stats, badges,
      // collections partent du même Promise.all) — laisser passer un état
      // silencieusement vide serait indiscernable d'un compte réellement
      // vide. Un vrai état d'erreur avec relance, plutôt qu'un faux "aucune
      // recette".
      setError(true);
    }
    finally { setLoading(false); }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadUnreadCount = useCallback(async () => {
    try { setUnreadCount((await api('/notifications/unread-count')).count); } catch (e) { console.warn(e); }
  }, []);

  useFocusEffect(useCallback(() => { loadUnreadCount(); }, [loadUnreadCount]));

  const loadTeam = useCallback(async () => {
    if (!user) return;
    try {
      const [t, inv] = await Promise.all([
        api(`/users/${user.user_id}/team?limit=6`),
        api('/team/invites'),
      ]);
      setTeamMembers(t.members);
      setTeamCount(t.count);
      setTeamInvites(inv);
    } catch (e) { console.warn(e); }
  }, [user]);

  useFocusEffect(useCallback(() => { loadTeam(); }, [loadTeam]));

  const respondTeamInvite = async (inviteId: string, accept: boolean) => {
    setTeamInvites(prev => prev.filter(i => i.id !== inviteId));
    try {
      await api(`/team/invites/${inviteId}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
      if (accept) loadTeam();
    } catch (e) { console.warn(e); loadTeam(); }
  };

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

  const onRefresh = () => {
    setRefreshing(true);
    const tasks: Promise<any>[] = [load(true), loadTeam(), loadUnreadCount()];
    if (tab === 'comments') tasks.push(loadComments());
    Promise.all(tasks).finally(() => setRefreshing(false));
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
      await uploadAvatar(pendingImage.uri, pendingImage.name);
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

  const openProfileEdit = () => {
    setProfileError(null);
    setBioDraft(user?.bio || '');
    setUsernameDraft(user?.username || '');
    setInstagramDraft(user?.instagram_username ? `@${user.instagram_username}` : '');
    setProfessionDraft(user?.profession || '');
    setVisibilityDraft(user?.team_visibility || 'public');
    setEditingProfile(true);
  };

  const instagramDraftError = !!instagramDraft.trim() && parseInstagramUsername(instagramDraft) === null;
  const usernameStatus = useUsernameAvailability(editingProfile ? usernameDraft : '', user?.username);
  const usernameDraftError = usernameStatus === 'invalid' || usernameStatus === 'taken';

  const saveProfile = async () => {
    if (instagramDraftError || usernameDraftError) {
      setProfileError(usernameDraftError ? 'Nom d’utilisateur invalide ou déjà utilisé.' : 'Nom d’utilisateur ou lien Instagram invalide.');
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      await updateProfile({
        bio: bioDraft.trim(),
        username: usernameDraft.trim() || undefined,
        instagram_username: instagramDraft.trim() ? (parseInstagramUsername(instagramDraft) || '') : '',
        profession: professionDraft.trim(),
        team_visibility: visibilityDraft,
      });
      setEditingProfile(false);
      loadTeam();
    } catch (e: any) {
      setProfileError(e.message || 'Enregistrement impossible. Vérifiez votre connexion et réessayez.');
    } finally {
      setProfileSaving(false);
    }
  };

  // Rendu comme ListHeaderComponent des deux FlatList ci-dessous plutôt que
  // comme un sibling fixe : sur un profil chargé (bio + Instagram + Team +
  // créations + invitations), ce bloc peut désormais dépasser la hauteur de
  // l'écran, et un View non défilant à côté d'un FlatList flex:1 laisse ce
  // dernier s'écraser à hauteur nulle — rien en dessous n'est alors ni
  // visible ni défilable. En passant cet élément JSX (pas une fonction) en
  // ListHeaderComponent, tout scrolle comme une seule liste et React continue
  // de réconcilier les mêmes types de nœuds à chaque rendu (donc les champs
  // de saisie de l'édition de profil ne perdent pas le focus) — même
  // convention déjà utilisée par `app/baker/[id].tsx`.
  const header = (
    <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            testID="avatar-btn" onPress={() => setAvatarMenuOpen(true)} style={styles.avatar}
            accessibilityRole="button" accessibilityLabel="Modifier la photo de profil"
          >
            {avatarUrl(user?.picture, API_BASE) ? (
              <Image source={{ uri: avatarUrl(user?.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable
              testID="notifications-btn" onPress={() => router.push('/messagerie?tab=activity' as any)} style={styles.logoutBtn}
              accessibilityRole="button" accessibilityLabel="Notifications"
            >
              <Feather name="bell" size={18} color={colors.onSurfaceSecondary} />
              {unreadCount > 0 && (
                <View style={styles.notifBadge} testID="notifications-badge">
                  <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              testID="settings-btn" onPress={() => router.push('/settings' as any)} style={styles.logoutBtn}
              accessibilityRole="button" accessibilityLabel="Réglages"
            >
              <Feather name="settings" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
            <Pressable
              testID="logout-btn" onPress={logout} style={styles.logoutBtn}
              accessibilityRole="button" accessibilityLabel="Se déconnecter"
            >
              <Feather name="log-out" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.name}>{user?.name || 'Boulanger'}</Text>
        {!!user?.username && <Text style={styles.username} testID="profile-username">@{user.username}</Text>}
        <Text style={styles.email}>{user?.email}</Text>

        {!editingProfile && !!user?.profession && (
          <Text style={styles.profession} testID="profile-profession">{user.profession}</Text>
        )}

        {/* Bio + Instagram : rien n'est affiché si les deux sont vides,
            jamais un bloc creux. */}
        {!editingProfile && !!user?.bio && (
          <Text style={styles.bio} testID="profile-bio">{user.bio}</Text>
        )}
        {!editingProfile && !!user?.instagram_username && (
          <Pressable
            testID="profile-instagram-link"
            onPress={() => openInstagram(user!.instagram_username as string)}
            style={styles.instagramRow}
          >
            <Feather name="instagram" size={15} color={colors.brand} />
            <Text style={styles.instagramText}>Instagram @{user.instagram_username}</Text>
          </Pressable>
        )}

        {!editingProfile && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{stats.recipe_count}</Text>
              <Text style={styles.statLabel}>RECETTES</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statVal}>{stats.comment_count}</Text>
              <Text style={styles.statLabel}>COMMENTAIRES</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statVal}>{stats.total_likes}</Text>
              <Text style={styles.statLabel}>J'AIME REÇUS</Text>
            </View>
            <View style={styles.statDivider} />
            <Pressable testID="my-followers-stat" onPress={() => user && router.push(`/followers/${user.user_id}` as any)} style={styles.stat}>
              <Text style={styles.statVal}>{stats.follower_count}</Text>
              <Text style={styles.statLabel}>ABONNÉS</Text>
            </Pressable>
            <View style={styles.statDivider} />
            <Pressable testID="my-following-stat" onPress={() => user && router.push(`/following/${user.user_id}` as any)} style={styles.stat}>
              <Text style={styles.statVal}>{stats.following_count}</Text>
              <Text style={styles.statLabel}>ABONNEMENTS</Text>
            </Pressable>
          </ScrollView>
        )}

        {!editingProfile && (
          <Pressable testID="collections-entry-row" onPress={() => router.push('/collections' as any)} style={styles.collectionsRow} hitSlop={8}>
            <Feather name="folder" size={15} color={colors.muted} />
            <Text style={styles.collectionsRowText}>
              {collectionsCount} collection{collectionsCount > 1 ? 's' : ''}
            </Text>
            <Feather name="chevron-right" size={15} color={colors.muted} />
          </Pressable>
        )}

        {!editingProfile && user?.level_detail && (
          <View testID="progression-card" style={styles.progressionCard}>
            <View style={styles.progressionHeader}>
              <LevelBadge level={user.level_detail} />
            </View>
            <ProgressBar
              ratio={user.level_detail.xp_for_next_level ? user.level_detail.xp_into_level / user.level_detail.xp_for_next_level : 1}
            />
            <Text style={styles.progressionXp}>
              {user.level_detail.xp_for_next_level != null
                ? `${user.level_detail.xp_into_level} / ${user.level_detail.xp_for_next_level} XP · ${user.level_detail.xp_remaining} XP avant le niveau ${user.level_detail.level + 1}`
                : `${user.level_detail.xp} XP · niveau maximum atteint`}
            </Text>
          </View>
        )}

        {!editingProfile && badgesPreview.length > 0 && (
          <View style={styles.badgesRow}>
            <Text style={styles.badgesRowLabel}>Badges</Text>
            <View style={styles.badgesIcons}>
              {badgesPreview.map((b) => (
                <Pressable key={b.id} testID={`badge-preview-${b.id}`} onPress={() => router.push(`/badge/${b.id}` as any)} style={styles.badgeIconWrap} hitSlop={4}>
                  <Text style={styles.badgeIcon}>{b.icon}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable testID="badges-see-all" onPress={() => router.push('/badges' as any)} hitSlop={8}>
              <Text style={styles.badgesSeeAll}>Voir tout ({badgesCount})</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.avatarLinksRow}>
          <Pressable testID="edit-avatar-link" onPress={() => setAvatarMenuOpen(true)} hitSlop={8}>
            <Text style={styles.avatarLink}>Modifier la photo</Text>
          </Pressable>
          {user?.picture && (
            <Pressable testID="delete-avatar-link" onPress={deleteAvatar} hitSlop={8}>
              <Text style={[styles.avatarLink, { color: colors.error }]}>Supprimer la photo</Text>
            </Pressable>
          )}
          {!editingProfile && (
            <Pressable testID="edit-profile-link" onPress={openProfileEdit} hitSlop={8}>
              <Text style={styles.avatarLink}>Modifier mon profil</Text>
            </Pressable>
          )}
        </View>
        {avatarError && <Text style={styles.avatarError} testID="avatar-error">{avatarError}</Text>}

        {editingProfile && (
          <View style={styles.editProfileCard}>
            <Text style={styles.editLabel}>Nom d’utilisateur</Text>
            <TextInput
              testID="username-input"
              value={usernameDraft}
              onChangeText={(v) => setUsernameDraft(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="votre_pseudo"
              placeholderTextColor={colors.muted}
              style={styles.editInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!usernameDraft.trim() && usernameStatus === 'taken' && (
              <Text style={styles.avatarError} testID="username-taken-error">Ce nom d’utilisateur est déjà utilisé.</Text>
            )}
            {!!usernameDraft.trim() && usernameStatus === 'invalid' && (
              <Text style={styles.avatarError}>Nom d’utilisateur invalide (3 à 20 caractères : lettres, chiffres, underscore).</Text>
            )}

            <Text style={styles.editLabel}>Description</Text>
            <TextInput
              testID="bio-input"
              value={bioDraft}
              onChangeText={setBioDraft}
              placeholder="Écrire une description…"
              placeholderTextColor={colors.muted}
              style={styles.bioInput}
              multiline
              maxLength={BIO_MAX_LENGTH}
            />
            <Text style={styles.charCount}>{bioDraft.length} / {BIO_MAX_LENGTH}</Text>

            <Text style={styles.editLabel}>Instagram</Text>
            <TextInput
              testID="instagram-input"
              value={instagramDraft}
              onChangeText={setInstagramDraft}
              placeholder="@moncompte"
              placeholderTextColor={colors.muted}
              style={styles.editInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {instagramDraftError && (
              <Text style={styles.avatarError} testID="instagram-format-error">Nom d’utilisateur ou lien Instagram invalide.</Text>
            )}

            <Text style={styles.editLabel}>Profession</Text>
            <TextInput
              testID="profession-input"
              value={professionDraft}
              onChangeText={setProfessionDraft}
              placeholder="Boulanger, Pâtissier…"
              placeholderTextColor={colors.muted}
              style={styles.editInput}
              maxLength={PROFESSION_MAX_LENGTH}
            />

            <Text style={styles.editLabel}>Visibilité de ma Team</Text>
            <View style={styles.visibilitySegment}>
              {TEAM_VISIBILITY_OPTIONS.map(([key, label]) => (
                <Pressable
                  key={key}
                  testID={`team-visibility-${key}`}
                  onPress={() => setVisibilityDraft(key as any)}
                  style={[styles.visibilityBtn, visibilityDraft === key && styles.visibilityBtnOn]}
                >
                  <Text style={[styles.visibilityBtnText, visibilityDraft === key && styles.visibilityBtnTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {profileError && <Text style={styles.avatarError} testID="profile-error">{profileError}</Text>}

            <View style={styles.editActionsRow}>
              <Pressable testID="cancel-profile-edit" disabled={profileSaving} onPress={() => setEditingProfile(false)} style={styles.editCancelBtn}>
                <Text style={styles.editCancelText}>Annuler</Text>
              </Pressable>
              <Pressable testID="save-profile-btn" disabled={profileSaving} onPress={saveProfile} style={[styles.editSaveBtn, profileSaving && { opacity: 0.6 }]}>
                {profileSaving ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.editSaveText}>Enregistrer</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {!editingProfile && (
          <View style={styles.creationsSection}>
            <View style={styles.creationsHeaderRow}>
              <Text style={styles.creationsTitle}>Mes créations</Text>
              {creations.length > 0 && (
                creations.length > 6 ? (
                  <Pressable testID="see-all-creations" onPress={() => router.push(`/creations/${user?.user_id}` as any)}>
                    <Text style={styles.creationsSeeAll}>Voir tout ({creations.length})</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="add-creation-link" onPress={() => router.push('/creation/new' as any)}>
                    <Text style={styles.creationsSeeAll}>+ Ajouter</Text>
                  </Pressable>
                )
              )}
            </View>
            {creations.length === 0 ? (
              <View style={styles.creationsEmpty}>
                <Text style={styles.creationsEmptyText}>Partagez vos réalisations avec la communauté.</Text>
                <Pressable testID="empty-add-creation-btn" onPress={() => router.push('/creation/new' as any)} style={styles.addCreationBtn}>
                  <Feather name="plus" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.addCreationBtnText}>Ajouter une création</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.creationsGrid}>
                {creations.slice(0, 6).map(c => (
                  <Pressable key={c.id} testID={`creation-tile-${c.id}`} onPress={() => router.push(`/creation/${c.id}` as any)} style={styles.creationTile}>
                    <Image source={{ uri: `${API_BASE}/files/${c.photos[0]}` }} style={styles.creationTileImage} contentFit="cover" />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {!editingProfile && teamInvites.length > 0 && (
          <View style={styles.creationsSection}>
            <View style={styles.creationsHeaderRow}>
              <Text style={styles.creationsTitle}>Invitations Team</Text>
              <View style={styles.countBadge}><Text style={styles.countBadgeText}>{teamInvites.length}</Text></View>
            </View>
            {teamInvites.map(inv => (
              <View key={inv.id} style={styles.teamInviteRow} testID={`team-invite-${inv.id}`}>
                <Pressable testID={`team-invite-${inv.id}-open`} onPress={() => router.push(`/baker/${inv.from_user.user_id}` as any)} style={styles.teamInviteLeft}>
                  <View style={styles.teamAvatarSmall}>
                    {avatarUrl(inv.from_user.picture, API_BASE) ? (
                      <Image source={{ uri: avatarUrl(inv.from_user.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    ) : (
                      <Text style={styles.teamAvatarSmallText}>{(inv.from_user.name || '?').slice(0, 1).toUpperCase()}</Text>
                    )}
                  </View>
                  <Text style={styles.teamInviteText} numberOfLines={2}>
                    <Text style={styles.teamInviteName}>{inv.from_user.name}</Text> souhaite vous ajouter à sa Team
                  </Text>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable testID={`team-invite-accept-${inv.id}`} onPress={() => respondTeamInvite(inv.id, true)} style={styles.acceptBtn} hitSlop={6}>
                    <Feather name="check" size={16} color={colors.onBrandPrimary} />
                  </Pressable>
                  <Pressable testID={`team-invite-decline-${inv.id}`} onPress={() => respondTeamInvite(inv.id, false)} style={styles.declineBtn} hitSlop={6}>
                    <Feather name="x" size={16} color={colors.onSurfaceSecondary} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {!editingProfile && (
          <View style={styles.creationsSection}>
            <View style={styles.creationsHeaderRow}>
              <Text style={styles.creationsTitle}>Ma Team</Text>
              {teamCount > 0 && (
                teamCount > 6 ? (
                  <Pressable testID="see-all-team" onPress={() => router.push(`/team/${user?.user_id}` as any)}>
                    <Text style={styles.creationsSeeAll}>Voir toute la Team ({teamCount})</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="add-team-link" onPress={() => router.push('/team/add' as any)}>
                    <Text style={styles.creationsSeeAll}>+ Ajouter</Text>
                  </Pressable>
                )
              )}
            </View>
            {teamCount === 0 ? (
              <View style={styles.creationsEmpty}>
                <Text style={styles.creationsEmptyText}>Votre Team est vide.{'\n'}Ajoutez les personnes avec qui vous travaillez.</Text>
                <Pressable testID="empty-add-team-btn" onPress={() => router.push('/team/add' as any)} style={styles.addCreationBtn}>
                  <Feather name="plus" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.addCreationBtnText}>Ajouter à ma Team</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.teamRow}>
                {teamMembers.map(m => (
                  <Pressable key={m.user_id} testID={`team-member-${m.user_id}`} onPress={() => router.push(`/baker/${m.user_id}` as any)} style={styles.teamChip}>
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
  );

  if (error && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          icon="wifi-off"
          title="Impossible de charger votre profil"
          subtitle="Vérifiez votre connexion et réessayez."
          ctaLabel="Réessayer"
          onCta={() => load()}
          testID="profile-retry"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {tab === 'comments' ? (
          <FlatList
            key="comments-list"
            style={{ flex: 1 }}
            data={myComments}
            keyExtractor={c => c.id}
            contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
            ListHeaderComponent={header}
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
              !commentsLoaded ? (
                <View style={styles.emptyCenter}><ActivityIndicator color={colors.brand} /></View>
              ) : (
                <EmptyState
                  icon="message-circle"
                  title="Aucun commentaire"
                  subtitle="Vos commentaires apparaîtront ici lorsque vous participerez aux discussions sur les recettes."
                  ctaLabel="Découvrir des recettes"
                  onCta={() => router.push('/(tabs)/recipes' as any)}
                  testID="empty-comments-btn"
                />
              )
            }
            ListFooterComponent={commentsHasMore ? (
              <Pressable testID="comments-load-more" onPress={loadMoreComments} disabled={commentsLoadingMore} style={styles.loadMoreBtn}>
                {commentsLoadingMore ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.loadMoreText}>Charger plus</Text>}
              </Pressable>
            ) : null}
          />
      ) : (
        <FlatList
          key="grid-list"
          style={{ flex: 1 }}
          data={loading ? [] : items}
          keyExtractor={r => r.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 16, paddingHorizontal: 24 }}
          contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <Pressable testID={`profile-recipe-${item.id}`} onPress={() => router.push(`/recipe/${item.id}`)} style={styles.card}>
              <Image source={recipeImageSource(item, API_BASE)} style={styles.cardImage} contentFit="cover" />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.difficulty} · {item.like_count ?? 0} {"j'aime"}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.emptyCenter}><ActivityIndicator color={colors.brand} /></View>
            ) : (
              <EmptyState
                icon={tab === 'mine' ? 'edit-3' : 'bookmark'}
                title={tab === 'mine' ? "Vous n'avez pas encore partagé de recette" : 'Aucune recette sauvegardée'}
                ctaLabel={tab === 'mine' ? 'Partager une recette' : undefined}
                onCta={tab === 'mine' ? () => router.push('/share') : undefined}
                testID="empty-share-btn"
              />
            )
          }
        />
      )}

      <ActionSheet
        visible={avatarMenuOpen}
        title="Photo de profil"
        onClose={() => setAvatarMenuOpen(false)}
        options={[
          { key: 'camera', icon: 'camera', label: 'Prendre une photo', onPress: () => pickAvatar('camera') },
          { key: 'library', icon: 'image', label: 'Choisir dans la photothèque', onPress: () => pickAvatar('library') },
          ...(user?.picture ? [{ key: 'delete', icon: 'trash-2' as const, label: 'Supprimer la photo', onPress: deleteAvatar, destructive: true }] : []),
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
              {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.previewConfirmText}>Utiliser cette photo</Text>}
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  emptyCenter: { paddingTop: 60, alignItems: 'center' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerActions: { flexDirection: 'row', gap: 10 },
  avatar: { width: 72, height: 72, borderRadius: theme.radius.pill, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 28, color: colors.onBrandTertiary, fontFamily: theme.serif },
  logoutBtn: { width: 40, height: 40, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  notifBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: theme.radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notifBadgeText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: '700' },
  name: { fontFamily: theme.serif, fontSize: 28, color: colors.onSurface, marginTop: 14 },
  username: { fontSize: 14, color: colors.muted, marginTop: 2 },
  email: { fontSize: 13, color: colors.muted, marginTop: 2 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 20, paddingHorizontal: 4 },
  stat: { alignItems: 'center' },
  // Indicateur compact, jamais une nouvelle section : une seule ligne
  // discrète renvoyant vers Profil ▾ → Collections, qui reste le point
  // d'entrée principal.
  collectionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  collectionsRowText: { flex: 1, fontSize: 13, color: colors.muted },
  progressionCard: { marginTop: 16, padding: 14, borderRadius: theme.radius.xl, backgroundColor: colors.surfaceSecondary },
  progressionHeader: { marginBottom: 8 },
  progressionXp: { fontSize: 12, color: colors.muted, marginTop: 8 },
  badgesRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  badgesRowLabel: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  badgesIcons: { flex: 1, flexDirection: 'row', gap: 6 },
  badgeIconWrap: { width: 32, height: 32, borderRadius: theme.radius.xl, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  badgeIcon: { fontSize: 16 },
  badgesSeeAll: { fontSize: 12, color: colors.brand, fontWeight: '600' },
  statVal: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  statLabel: { fontSize: 10, letterSpacing: 1, color: colors.muted, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border },
  tabs: { flexDirection: 'row', marginTop: 24, gap: 24 },
  tab: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  tabTextActive: { color: colors.onSurface },
  card: { flex: 1 },
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: colors.surfaceSecondary },
  cardTitle: { fontFamily: theme.serif, fontSize: 17, color: colors.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  commentCard: { flexDirection: 'row', gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.xl, padding: 14, marginHorizontal: 24 },
  commentThumb: { width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: colors.surfaceTertiary },
  commentCardKind: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  commentCardReplyTo: { fontSize: 12, color: colors.brand, fontWeight: '500', marginTop: 2 },
  commentCardBody: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 18, marginTop: 4 },
  commentCardFooter: { flexDirection: 'row', gap: 16, marginTop: 8 },
  commentCardMeta: { fontSize: 12, color: colors.muted },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 14 },
  loadMoreText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  avatarLinksRow: { flexDirection: 'row', gap: 20, marginTop: 10, flexWrap: 'wrap' },
  avatarLink: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  avatarError: { fontSize: 13, color: colors.error, marginTop: 8 },
  profession: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 6 },
  bio: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20, marginTop: 10 },
  instagramRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  instagramText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  editProfileCard: { backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.xl, padding: 16, marginTop: 14 },
  editLabel: { fontSize: 12, color: colors.muted, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  bioInput: { fontSize: 14, color: colors.onSurface, minHeight: 70, textAlignVertical: 'top', backgroundColor: colors.surface, borderRadius: theme.radius.lg, padding: 10 },
  charCount: { fontSize: 11, color: colors.muted, textAlign: 'right', marginTop: 4 },
  editInput: { fontSize: 14, color: colors.onSurface, backgroundColor: colors.surface, borderRadius: theme.radius.lg, padding: 10 },
  editActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  editCancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  editCancelText: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  editSaveBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.pill, paddingVertical: 10, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  editSaveText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 14 },
  creationsSection: { marginTop: 20 },
  creationsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  creationsTitle: { fontSize: 13, letterSpacing: 1, color: colors.onSurface, fontWeight: '700' },
  creationsSeeAll: { fontSize: 12, color: colors.brand, fontWeight: '600' },
  creationsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  creationTile: { width: '32%', aspectRatio: 1, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  creationTileImage: { width: '100%', height: '100%' },
  creationsEmpty: { backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.xl, padding: 20, alignItems: 'center', gap: 12 },
  creationsEmptyText: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  addCreationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 16, paddingVertical: 10, borderRadius: theme.radius.pill },
  addCreationBtnText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 13 },
  visibilitySegment: { flexDirection: 'row', gap: 6 },
  visibilityBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: colors.surface },
  visibilityBtnOn: { backgroundColor: colors.brand },
  visibilityBtnText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '600' },
  visibilityBtnTextOn: { color: colors.onBrandPrimary },
  countBadge: { backgroundColor: colors.brand, borderRadius: theme.radius.pill, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countBadgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '700' },
  teamInviteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 10 },
  teamInviteLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  teamAvatarSmall: { width: 34, height: 34, borderRadius: theme.radius.pill, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  teamAvatarSmallText: { fontSize: 14, color: colors.onBrandTertiary, fontFamily: theme.serif },
  teamInviteText: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 18 },
  teamInviteName: { fontWeight: '700', color: colors.onSurface },
  acceptBtn: { width: 34, height: 34, borderRadius: theme.radius.pill, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 34, height: 34, borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  teamRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  teamChip: { alignItems: 'center', width: 72 },
  teamAvatar: { width: 56, height: 56, borderRadius: theme.radius.pill, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  teamAvatarText: { fontSize: 20, color: colors.onBrandTertiary, fontFamily: theme.serif },
  teamChipName: { fontSize: 12, color: colors.onSurface, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  teamChipRole: { fontSize: 10, color: colors.muted, marginTop: 1, textAlign: 'center' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  previewCard: { backgroundColor: colors.surface, borderRadius: theme.radius.xl, padding: 24, alignItems: 'center', width: '100%', maxWidth: 340 },
  previewImage: { width: 200, height: 200, borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary, marginBottom: 20 },
  previewConfirmBtn: { backgroundColor: colors.brand, borderRadius: theme.radius.pill, paddingVertical: 14, alignItems: 'center', width: '100%' },
  previewConfirmText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 15 },
  previewCancelBtn: { paddingVertical: 14, alignItems: 'center', width: '100%' },
  previewCancelText: { color: colors.muted, fontWeight: '500', fontSize: 14 },
});
