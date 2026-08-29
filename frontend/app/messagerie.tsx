import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { formatRelativeDate } from '@/src/relativeDate';
import { subscribeRealtime } from '@/src/realtime';
import { SwipeableRow } from '@/src/SwipeableRow';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { showGamificationToast } from '@/src/gamification/UnlockToast';

type Peer = { user_id: string; name: string; picture?: string | null };
type Conversation = { peer: Peer; last_message: { content: string; type: string; from_me: boolean; created_at: string } | null; unread: number };

type NotifType =
  | 'new_follower' | 'new_recipe' | 'new_creation'
  | 'new_friend_request' | 'friend_request_accepted'
  | 'new_comment' | 'new_comment_reply' | 'new_like'
  | 'level_up' | 'badge_unlocked';

type Notification = {
  id: string; type: NotifType; actor_id: string; actor_name?: string | null; target_id?: string | null;
  data?: { recipe_id?: string; comment_id?: string; content_kind?: 'recipe' | 'creation'; level?: number; title?: string; name?: string; icon?: string } | null;
  count?: number; read: boolean; created_at: string;
};

// Switch explicite plutôt qu'un rendu générique — même choix déjà fait pour
// le fil recette/création, cohérent avec le reste de ce code plutôt que de
// sur-généraliser un affichage à 8 formes différentes.
const ICONS: Record<NotifType, keyof typeof Feather.glyphMap> = {
  new_follower: 'user-plus', new_recipe: 'book-open', new_creation: 'camera',
  new_friend_request: 'users', friend_request_accepted: 'user-check',
  new_comment: 'message-circle', new_comment_reply: 'corner-up-left', new_like: 'heart',
  level_up: 'trending-up', badge_unlocked: 'award',
};

function label(n: Notification): string {
  const name = n.actor_name || 'Quelqu\'un';
  switch (n.type) {
    case 'new_follower': return `${name} vous suit maintenant.`;
    case 'new_recipe': return `${name} a publié une nouvelle recette.`;
    case 'new_creation': return `${name} a publié une nouvelle création.`;
    case 'new_friend_request': return `${name} souhaite devenir votre ami.`;
    case 'friend_request_accepted': return `${name} a accepté votre demande d'ami.`;
    case 'new_comment': return `${name} a commenté votre recette.`;
    case 'new_comment_reply': return `${name} a répondu à votre commentaire.`;
    case 'new_like': {
      const kind = n.data?.content_kind === 'creation' ? 'création' : 'recette';
      const extra = (n.count || 1) - 1;
      if (extra > 0) return `${name} et ${extra} autre${extra > 1 ? 's' : ''} ont aimé votre ${kind}.`;
      return `${name} a aimé votre ${kind}.`;
    }
    case 'level_up': return `Niveau supérieur ! Niveau ${n.data?.level} — ${n.data?.title}.`;
    case 'badge_unlocked': return `Vous avez obtenu le badge « ${n.data?.name} ».`;
  }
}

export default function Messagerie() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { refreshUser } = useAuth();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'messages' | 'activity'>(tabParam === 'activity' ? 'activity' : 'messages');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMoreConvos, setLoadingMoreConvos] = useState(false);
  const [hasMoreConvos, setHasMoreConvos] = useState(false);
  const [search, setSearch] = useState('');

  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [loadingMoreNotifs, setLoadingMoreNotifs] = useState(false);
  const [hasMoreNotifs, setHasMoreNotifs] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api('/conversations');
      setConversations(res.conversations);
      setHasMoreConvos(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingConvos(false); }
  }, []);

  const loadMoreConversations = async () => {
    if (loadingMoreConvos || !hasMoreConvos || conversations.length === 0) return;
    const last = conversations[conversations.length - 1].last_message;
    if (!last) return;
    setLoadingMoreConvos(true);
    try {
      const before = encodeURIComponent(last.created_at);
      const res = await api(`/conversations?before=${before}`);
      setConversations(prev => [...prev, ...res.conversations]);
      setHasMoreConvos(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMoreConvos(false); }
  };

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api('/notifications');
      setNotifs(res.notifications);
      setHasMoreNotifs(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingNotifs(false); }
  }, []);

  const loadMoreNotifications = async () => {
    if (loadingMoreNotifs || !hasMoreNotifs || notifs.length === 0) return;
    setLoadingMoreNotifs(true);
    try {
      const before = encodeURIComponent(notifs[notifs.length - 1].created_at);
      const res = await api(`/notifications?before=${before}`);
      setNotifs(prev => [...prev, ...res.notifications]);
      setHasMoreNotifs(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMoreNotifs(false); }
  };

  useFocusEffect(useCallback(() => {
    loadConversations();
    loadNotifications();
    // Même infrastructure que Amis (subscribeRealtime) — un nouveau message
    // rafraîchit les conversations, une nouvelle notification rafraîchit
    // l'activité, sans aucun polling supplémentaire.
    const unsubscribe = subscribeRealtime((evt) => {
      if (evt.type === 'new_message') loadConversations();
      if (evt.type === 'notification') loadNotifications();
    });
    return unsubscribe;
  }, [loadConversations, loadNotifications]));

  const markAllRead = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    try { await api('/notifications/read-all', { method: 'POST' }); } catch (e) { console.warn(e); }
  };

  const openNotification = async (n: Notification) => {
    if (n.type === 'new_friend_request') return; // géré en ligne via Accepter/Refuser
    if (!n.read) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    }
    if (n.type === 'new_follower' || n.type === 'friend_request_accepted') {
      router.push(`/baker/${n.actor_id}` as any);
    } else if (n.type === 'new_recipe' && n.target_id) {
      router.push(`/recipe/${n.target_id}` as any);
    } else if (n.type === 'new_creation' && n.target_id) {
      router.push(`/creation/${n.target_id}` as any);
    } else if ((n.type === 'new_comment' || n.type === 'new_comment_reply') && n.data?.recipe_id) {
      router.push(`/recipe/${n.data.recipe_id}?tab=community&highlightComment=${n.data.comment_id}` as any);
    } else if (n.type === 'new_like' && n.target_id) {
      router.push((n.data?.content_kind === 'creation' ? `/creation/${n.target_id}` : `/recipe/${n.target_id}`) as any);
    } else if (n.type === 'badge_unlocked' && n.target_id) {
      router.push(`/badge/${n.target_id}` as any);
    } else if (n.type === 'level_up') {
      router.push('/(tabs)/profile' as any);
    }
  };

  const respondFriendRequest = async (n: Notification, accept: boolean) => {
    if (!n.target_id || respondingId) return;
    setRespondingId(n.id);
    try {
      const res = await api(`/friends/requests/${n.target_id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      showGamificationToast(res.gamification);
      refreshUser();
    } catch (e) { console.warn(e); }
    finally { setRespondingId(null); }
  };

  const hideConversation = async (peerId: string) => {
    const ok = await confirmAsync('Supprimer cette conversation ?', 'Elle réapparaîtra si un nouveau message est échangé.', 'Supprimer', true);
    if (!ok) return;
    setConversations(prev => prev.filter(c => c.peer.user_id !== peerId));
    try { await api(`/conversations/${peerId}/hide`, { method: 'POST' }); } catch (e) { console.warn(e); }
  };

  // Filtre sur la page déjà chargée, jamais une recherche plein texte des
  // messages — cohérent avec la demande ("ne pas rechercher dans tous les
  // messages si ce n'est pas nécessaire").
  const filteredConversations = search.trim()
    ? conversations.filter(c => c.peer.name.toLowerCase().includes(search.trim().toLowerCase()))
    : conversations;

  const hasUnreadNotifs = notifs.some(n => !n.read);

  const Avatar = ({ user, size = 48 }: { user: Peer; size?: number }) => {
    const uri = avatarUrl(user.picture, API_BASE);
    return (
      <View style={[styles.avatar, { width: size, height: size }]}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(user.name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  // Passé en ListHeaderComponent comme élément JSX (pas une fonction) sur le
  // FlatList des conversations — jamais un View fixe à côté, exactement ce
  // que le correctif du blocage de défilement sur Profil vient d'imposer.
  const messagesHeader = (
    <View style={styles.searchWrap}>
      <Feather name="search" size={18} color={colors.muted} />
      <TextInput
        testID="messagerie-search"
        value={search}
        onChangeText={setSearch}
        placeholder="Rechercher"
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        autoCapitalize="none"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="messagerie-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Messagerie</Text>
        {tab === 'messages' ? (
          <Pressable testID="messagerie-new" onPress={() => router.push('/messagerie/new' as any)} style={styles.iconBtn}>
            <Feather name="edit" size={20} color={colors.onSurface} />
          </Pressable>
        ) : hasUnreadNotifs ? (
          <Pressable testID="messagerie-mark-all-read" onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Tout lire</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <View style={styles.segment}>
        <Pressable testID="messagerie-tab-messages" onPress={() => setTab('messages')} style={[styles.segBtn, tab === 'messages' && styles.segBtnOn]}>
          <Text style={[styles.segText, tab === 'messages' && styles.segTextOn]}>Messages</Text>
        </Pressable>
        <Pressable testID="messagerie-tab-activity" onPress={() => setTab('activity')} style={[styles.segBtn, tab === 'activity' && styles.segBtnOn]}>
          <Text style={[styles.segText, tab === 'activity' && styles.segTextOn]}>Activité</Text>
        </Pressable>
      </View>

      {tab === 'messages' ? (
        <FlatList
          style={{ flex: 1 }}
          data={loadingConvos ? [] : filteredConversations}
          keyExtractor={c => c.peer.user_id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMoreConversations}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={messagesHeader}
          ListFooterComponent={loadingMoreConvos ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          renderItem={({ item }) => (
            <SwipeableRow onDelete={() => hideConversation(item.peer.user_id)}>
              <Pressable
                testID={`conversation-${item.peer.user_id}`}
                onPress={() => router.push({ pathname: `/chat/${item.peer.user_id}` as any, params: { name: item.peer.name } })}
                style={styles.row}
              >
                <Avatar user={item.peer} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.rowName}>{item.peer.name}</Text>
                  <Text style={[styles.rowSub, item.unread > 0 && styles.rowSubUnread]} numberOfLines={1}>
                    {item.last_message
                      ? `${item.last_message.from_me ? 'Vous : ' : ''}${item.last_message.type === 'photo' ? '📷 Photo' : item.last_message.content}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  {item.last_message && <Text style={styles.rowMeta}>{formatRelativeDate(item.last_message.created_at)}</Text>}
                  {item.unread > 0 && (
                    <View style={styles.unreadBadge} testID={`conversation-unread-${item.peer.user_id}`}>
                      <Text style={styles.unreadText}>{item.unread > 9 ? '9+' : item.unread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </SwipeableRow>
          )}
          ListEmptyComponent={
            loadingConvos ? (
              <View style={styles.emptyCenter}><ActivityIndicator color={colors.brand} /></View>
            ) : (
              <View style={styles.empty}>
                <Feather name="message-circle" size={40} color={colors.muted} />
                <Text style={styles.emptyTitle}>Aucun message</Text>
                <Text style={styles.emptySubtitle}>Vous n'avez pas encore de conversation.{'\n'}Ajoutez des amis ou suivez des boulangers pour commencer à échanger.</Text>
              </View>
            )
          }
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={loadingNotifs ? [] : notifs}
          keyExtractor={n => n.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMoreNotifications}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMoreNotifs ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          renderItem={({ item }) => (
            <Pressable
              testID={`notification-${item.id}`}
              onPress={() => openNotification(item)}
              style={[styles.notifRow, !item.read && styles.notifRowUnread]}
            >
              <View style={styles.iconCircle}>
                <Feather name={ICONS[item.type]} size={16} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifText}>{label(item)}</Text>
                <Text style={styles.notifMeta}>{formatRelativeDate(item.created_at)}</Text>
                {item.type === 'new_friend_request' && !item.read && (
                  <View style={styles.requestActions}>
                    {respondingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <>
                        <Pressable testID={`activity-accept-${item.id}`} onPress={() => respondFriendRequest(item, true)} style={styles.acceptBtn}>
                          <Text style={styles.acceptBtnText}>Accepter</Text>
                        </Pressable>
                        <Pressable testID={`activity-decline-${item.id}`} onPress={() => respondFriendRequest(item, false)} style={styles.declineBtn}>
                          <Text style={styles.declineBtnText}>Refuser</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}
              </View>
              {!item.read && <View style={styles.unreadDot} />}
            </Pressable>
          )}
          ListEmptyComponent={
            loadingNotifs ? (
              <View style={styles.emptyCenter}><ActivityIndicator color={colors.brand} /></View>
            ) : (
              <View style={styles.empty}>
                <Feather name="bell" size={40} color={colors.muted} />
                <Text style={styles.emptyTitle}>Aucune activité</Text>
                <Text style={styles.emptySubtitle}>Vous êtes à jour !</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  emptyCenter: { paddingTop: 60, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  markAllBtn: { paddingHorizontal: 10, height: 40, alignItems: 'center', justifyContent: 'center' },
  markAllText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '600' },
  segTextOn: { color: colors.onBrandPrimary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginTop: 8, marginBottom: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.surface },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowSubUnread: { color: colors.onSurface, fontWeight: '600' },
  rowMeta: { fontSize: 11, color: colors.muted },
  avatar: { borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif },
  unreadBadge: { backgroundColor: colors.brand, borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '700' },
  notifRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  notifRowUnread: { backgroundColor: colors.surfaceSecondary },
  iconCircle: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  notifText: { fontSize: 14, color: colors.onSurface, lineHeight: 19 },
  notifMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brand, marginTop: 4 },
  requestActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  acceptBtn: { backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  acceptBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '600' },
  declineBtn: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  declineBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, marginTop: -6 },
});
