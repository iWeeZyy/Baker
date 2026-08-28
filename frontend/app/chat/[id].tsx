import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, API_BASE, getToken } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { useAuth } from '@/src/auth';
import { subscribeRealtime } from '@/src/realtime';
import { isPhotoRevealed, markPhotoRevealed } from '@/src/revealedPhotos';
import { LIGHT_COLORS, theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Moderation = { level: 'normal' | 'sensitive' | 'blocked'; score: number; provider: string; status: string };
type Message = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  content: string;
  created_at: string;
  type?: 'text' | 'photo';
  photo_blur_path?: string | null;
  moderation?: Moderation | null;
};

// Fallback poll in case the realtime socket is down; the socket delivers
// new messages near-instantly when connected.
const POLL_FALLBACK_MS = 15000;

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: 'sexual', label: 'Contenu sexuel' },
  { key: 'illegal', label: 'Contenu illégal' },
  { key: 'violence', label: 'Violence' },
  { key: 'harassment', label: 'Harcèlement' },
  { key: 'spam', label: 'Spam' },
  { key: 'other', label: 'Autre' },
];

function fmtTime(s: string) {
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function reportMessage(messageId: string) {
  Alert.alert(
    'Signaler cette photo',
    'Pour quel motif ?',
    [
      ...REPORT_REASONS.map(r => ({
        text: r.label,
        onPress: () => {
          api(`/messages/${messageId}/report`, { method: 'POST', body: JSON.stringify({ reason: r.key }) })
            .then(() => Alert.alert('Signalement envoyé', "Merci, l'équipe a été prévenue."))
            .catch((e: any) => Alert.alert('Erreur', e.message || "Le signalement n'a pas pu être envoyé."));
        },
      })),
      { text: 'Annuler', style: 'cancel' },
    ],
  );
}

export default function Chat() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const PhotoBubble = ({ item, mine }: { item: Message; mine: boolean }) => {
    const [token, setToken] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(mine); // l'expéditeur voit toujours sa propre photo non floutée
    // « Masquer » ne fait que replier la carte d'avertissement en un petit
    // rappel — la photo reste exactement aussi floutée dans les deux cas,
    // seul « Afficher l'image » change réellement quelque chose.
    const [dismissed, setDismissed] = useState(false);
    const isSensitive = !mine && item.moderation?.level === 'sensitive';

    useEffect(() => { getToken().then(setToken); }, []);

    useEffect(() => {
      if (!isSensitive) return;
      isPhotoRevealed(item.id).then(already => { if (already) setRevealed(true); });
    }, [isSensitive, item.id]);

    const reveal = () => {
      setRevealed(true);
      markPhotoRevealed(item.id);
    };

    if (!token) return <View style={styles.photoBox} />;

    const showBlurred = isSensitive && !revealed;
    const variant = showBlurred ? 'blur' : 'display';
    const uri = `${API_BASE}/messages/photos/${item.id}?variant=${variant}`;
    const headers = { Authorization: `Bearer ${token}` };

    return (
      <View style={styles.photoBox} testID={`photo-${item.id}`}>
        <Image source={{ uri, headers }} style={styles.photoImg} contentFit="cover" />
        {showBlurred && (
          dismissed ? (
            <Pressable style={styles.photoDismissedHint} onPress={() => setDismissed(false)} testID={`photo-dismissed-${item.id}`}>
              <Feather name="eye-off" size={14} color={colors.onBrandPrimary} />
              <Text style={styles.photoDismissedHintText}>Contenu masqué — appuyer pour voir les options</Text>
            </Pressable>
          ) : (
            <View style={styles.photoWarning}>
              <Feather name="alert-triangle" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.photoWarningTitle}>Contenu potentiellement sensible</Text>
              <Text style={styles.photoWarningText}>L'image peut contenir du contenu à caractère sexuel.</Text>
              <View style={styles.photoWarningActions}>
                <Pressable testID={`photo-reveal-${item.id}`} onPress={reveal} style={styles.photoRevealBtn}>
                  <Text style={styles.photoRevealBtnText}>Afficher l'image</Text>
                </Pressable>
                <Pressable testID={`photo-hide-${item.id}`} onPress={() => setDismissed(true)} style={styles.photoHideBtn}>
                  <Text style={styles.photoHideBtnText}>Masquer</Text>
                </Pressable>
              </View>
            </View>
          )
        )}
        {!mine && (
          <Pressable testID={`photo-report-${item.id}`} onPress={() => reportMessage(item.id)} style={styles.photoReportBtn}>
            <Feather name="flag" size={13} color={colors.onBrandPrimary} />
          </Pressable>
        )}
      </View>
    );
  };

  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFriends, setNotFriends] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<{ uri: string; name: string } | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [peerPicture, setPeerPicture] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const didInitialScroll = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api(`/messages/${id}`);
      setMessages(res.messages);
      setHasMore(res.has_more);
      setError(null);
      setNotFriends(false);
    } catch (e: any) {
      if (e.status === 403) setNotFriends(true);
      else setError(e.message || 'Erreur');
    }
  }, [id]);

  const loadOlder = async () => {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const res = await api(`/messages/${id}?before=${encodeURIComponent(messages[0].created_at)}`);
      setMessages(prev => [...res.messages, ...prev]);
      setHasMore(res.has_more);
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // Source unique du profil (nom déjà passé par la navigation, mais pas
    // toujours la photo) — un seul appel léger, jamais répété tant que la
    // conversation reste ouverte.
    api(`/users/${id}/profile`).then(p => setPeerPicture(p.user?.picture ?? null)).catch(() => {});
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const iv = setInterval(load, POLL_FALLBACK_MS);
    return () => clearInterval(iv);
  }, [load]);

  // Instant delivery when the realtime socket is connected; falls back to
  // the poll above (POLL_FALLBACK_MS) if the socket drops.
  useEffect(() => {
    const unsubscribe = subscribeRealtime((evt) => {
      if (evt.type !== 'new_message') return;
      const m: Message = evt.message;
      if (m.from_user_id !== id && m.to_user_id !== id) return;
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      setNotFriends(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return unsubscribe;
  }, [id]);

  useEffect(() => {
    if (!loading && !didInitialScroll.current && messages.length > 0) {
      didInitialScroll.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, [loading, messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    setSending(true);
    try {
      const m = await api(`/messages/${id}`, { method: 'POST', body: JSON.stringify({ content }) });
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      if (e.status === 403) setNotFriends(true);
      else setError(e.message || 'Erreur envoi');
      setText(content);
    } finally { setSending(false); }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError('Permission galerie refusée'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = `photo.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}`;
    setPendingPhoto({ uri: asset.uri, name });
  };

  const cancelPhoto = () => setPendingPhoto(null);

  const sendPhoto = async () => {
    if (!pendingPhoto || sendingPhoto) return;
    setSendingPhoto(true);
    setError(null);
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(pendingPhoto.uri)).blob();
        form.append('file', blob, pendingPhoto.name);
      } else {
        form.append('file', { uri: pendingPhoto.uri, name: pendingPhoto.name, type: `image/${pendingPhoto.name.split('.').pop()}` } as any);
      }
      const token = await getToken();
      const res = await fetch(`${API_BASE}/messages/${id}/photo`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const m = await res.json();
      if (!res.ok) throw new Error(m.detail || 'Envoi impossible');
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      setPendingPhoto(null);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      if (e.status === 403) setNotFriends(true);
      else setError(e.message || "Erreur d'envoi de la photo");
    } finally { setSendingPhoto(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push(`/baker/${id}`)} style={styles.headerNameRow}>
          <View style={styles.headerAvatar}>
            {avatarUrl(peerPicture, API_BASE) ? (
              <Image source={{ uri: avatarUrl(peerPicture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <Text style={styles.headerAvatarText}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <View>
            <Text style={styles.headerName}>{name || 'Discussion'}</Text>
            <Text style={styles.headerSub}>Voir le profil</Text>
          </View>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            ListHeaderComponent={hasMore ? (
              <Pressable testID="chat-load-older" onPress={loadOlder} disabled={loadingMore} style={styles.loadMoreBtn}>
                {loadingMore ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.loadMoreText}>Charger les messages précédents</Text>}
              </Pressable>
            ) : null}
            renderItem={({ item }) => {
              const mine = item.from_user_id === user?.user_id;
              const isPhoto = item.type === 'photo';
              return (
                <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]} testID={`msg-${item.id}`}>
                  {isPhoto ? (
                    <View style={[styles.bubble, styles.bubblePhoto, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <PhotoBubble item={item} mine={mine} />
                      <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{fmtTime(item.created_at)}</Text>
                    </View>
                  ) : (
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.bubbleText, mine && { color: colors.onBrandPrimary }]}>{item.content}</Text>
                      <Text style={[styles.bubbleTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{fmtTime(item.created_at)}</Text>
                    </View>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Feather name="message-circle" size={36} color={colors.muted} />
                <Text style={styles.emptyText}>Commencez la conversation !{'\n'}Parlez levain, façonnage, cuisson…</Text>
              </View>
            }
          />
        )}

        {error && !notFriends && <Text style={styles.error} testID="chat-error">{error}</Text>}

        {pendingPhoto && (
          <View style={styles.previewBox} testID="chat-photo-preview">
            <Image source={{ uri: pendingPhoto.uri }} style={styles.previewImg} contentFit="cover" />
            {sendingPhoto ? (
              <View style={styles.previewOverlay}>
                <ActivityIndicator color={colors.onBrandPrimary} />
                <Text style={styles.previewOverlayText}>Vérification de l'image…</Text>
              </View>
            ) : (
              <View style={styles.previewActions}>
                <Pressable testID="chat-photo-cancel" onPress={cancelPhoto} style={styles.previewCancelBtn}>
                  <Text style={styles.previewCancelText}>Annuler</Text>
                </Pressable>
                <Pressable testID="chat-photo-send" onPress={sendPhoto} style={styles.previewSendBtn}>
                  <Feather name="send" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.previewSendText}>Envoyer</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {notFriends ? (
          <View style={styles.notFriendsBox} testID="chat-not-friends">
            <Feather name="user-x" size={16} color={colors.muted} />
            <Text style={styles.notFriendsText}>Vous n'êtes plus amis avec cette personne — impossible d'échanger des messages.</Text>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <Pressable testID="chat-pick-photo" onPress={pickPhoto} disabled={!!pendingPhoto} style={[styles.photoBtn, !!pendingPhoto && { opacity: 0.4 }]}>
              <Feather name="image" size={20} color={colors.brand} />
            </Pressable>
            <TextInput
              testID="chat-input"
              value={text}
              onChangeText={setText}
              placeholder="Votre message…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
            />
            <Pressable testID="chat-send" onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
              <Feather name="send" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerNameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  headerAvatarText: { fontSize: 15, color: colors.onBrandTertiary, fontFamily: theme.serif },
  headerName: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.muted },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubblePhoto: { padding: 6 },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: colors.onSurface, lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  // Fond d'attente avant chargement de la photo : une teinte de surface
  // adaptée au thème plutôt qu'un noir à faible opacité, invisible sur un
  // fond déjà sombre.
  photoBox: { width: 220, height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  photoImg: { width: '100%', height: '100%' },
  photoWarning: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,14,10,0.72)', alignItems: 'center', justifyContent: 'center', padding: 14, gap: 6 },
  photoWarningTitle: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  photoWarningText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center', lineHeight: 15 },
  photoWarningActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  photoRevealBtn: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  // Un bouton blanc fixe posé sur un voile sombre invariant (au-dessus d'une
  // photo) : son texte doit rester sombre dans les deux thèmes, jamais
  // colors.onSurface qui s'éclaircirait en mode sombre et deviendrait
  // illisible sur ce fond resté blanc.
  photoRevealBtnText: { fontSize: 12, fontWeight: '700', color: LIGHT_COLORS.onSurface },
  photoHideBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  photoHideBtnText: { fontSize: 12, fontWeight: '600', color: colors.onBrandPrimary },
  photoReportBtn: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  photoDismissedHint: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(20,14,10,0.75)', paddingHorizontal: 10, paddingVertical: 8 },
  photoDismissedHintText: { color: colors.onBrandPrimary, fontSize: 10.5, flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  photoBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: colors.onSurface, minHeight: 44, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  error: { color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  notFriendsBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary },
  notFriendsText: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  loadMoreText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  previewBox: { margin: 12, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surfaceTertiary, maxHeight: 220 },
  previewImg: { width: '100%', height: 200 },
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewOverlayText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  previewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 10, position: 'absolute', bottom: 0, right: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  previewCancelBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)' },
  // Même raison que photoRevealBtnText : ce bouton reste blanc dans les deux
  // thèmes (posé sur un voile sombre invariant), donc son texte aussi.
  previewCancelText: { fontSize: 13, fontWeight: '600', color: LIGHT_COLORS.onSurface },
  previewSendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.brand },
  previewSendText: { fontSize: 13, fontWeight: '700', color: colors.onBrandPrimary },
});
