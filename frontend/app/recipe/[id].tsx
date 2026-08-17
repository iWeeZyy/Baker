import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useTimer } from '@/src/TimerContext';
import { theme } from '@/src/theme';

type Comment = { id: string; user_name: string; content: string; created_at: string; parent_id?: string | null };

// Parse a duration mentioned in a step text -> seconds (first match)
// Longest alternative first: "heures" must win over "h" so that "2 heures 30"
// is not read as 2 hours followed by the stray letters "eures".
const H_AND_M = /(\d+)\s*(?:heures?|h)\s*(\d+)\s*(?:min\w*)?/i;
const H_ONLY = /(\d+)\s*(?:heures?|h)\b/i;
const M_ONLY = /(\d+)\s*(?:min\w*)\b/i;

/**
 * Seconds found in a free-text step, or null. Mirrors `parse_duration` in
 * backend/production.py so a step is timed identically here and in a planning.
 *
 * The previous version read "1 h 30" as 60 minutes: it only added minutes when
 * the text spelled out "min", so every "1 h 30" timer ran half an hour short.
 */
function parseDuration(text: string): number | null {
  if (!text) return null;
  const hm = text.match(H_AND_M);
  // A "minutes" part of 60+ means we latched onto an unrelated number.
  if (hm && parseInt(hm[2], 10) < 60) {
    return parseInt(hm[1], 10) * 3600 + parseInt(hm[2], 10) * 60;
  }
  const h = text.match(H_ONLY);
  if (h) return parseInt(h[1], 10) * 3600;
  const m = text.match(M_ONLY);
  if (m) return parseInt(m[1], 10) * 60;
  return null;
}

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { start, startSequence } = useTimer();
  const [recipe, setRecipe] = useState<any>(null);
  const [tab, setTab] = useState<'ingredients' | 'steps' | 'community'>('ingredients');
  const [favorited, setFavorited] = useState(false);
  const [likes, setLikes] = useState({ count: 0, liked: false });
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadCommunity = useCallback(async () => {
    try {
      const [l, c, n] = await Promise.all([
        api(`/recipes/${id}/likes`),
        api(`/recipes/${id}/comments`),
        api(`/recipes/${id}/note`),
      ]);
      setLikes(l); setComments(c); setNote(n.content || '');
    } catch (e) { console.warn(e); }
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/recipes/${id}`);
        setRecipe(r);
        try { const f = await api(`/recipes/${id}/favorite`); setFavorited(f.favorited); } catch {}
        await loadCommunity();
      } finally { setLoading(false); }
    })();
  }, [id, loadCommunity]);

  const toggleFav = async () => {
    try { const res = await api(`/recipes/${id}/favorite`, { method: 'POST' }); setFavorited(res.favorited); } catch {}
  };

  const toggleLike = async () => {
    try { const res = await api(`/recipes/${id}/like`, { method: 'POST' }); setLikes(res); } catch {}
  };

  const sendComment = async () => {
    const txt = commentText.trim();
    if (!txt) return;
    setCommentText('');
    const parent = replyTo?.id || null;
    setReplyTo(null);
    try {
      const c = await api(`/recipes/${id}/comments`, { method: 'POST', body: JSON.stringify({ content: txt, parent_id: parent }) });
      setComments(prev => [...prev, c]);
    } catch {}
  };

  const saveNote = async () => {
    try { await api(`/recipes/${id}/note`, { method: 'PUT', body: JSON.stringify({ content: note }) }); setNoteSaved(true); } catch {}
  };

  if (loading || !recipe) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  const imgUri = recipe.image_path ? `${API_BASE}/files/${recipe.image_path}` : recipe.image_url;

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.heroWrap}>
          <Image source={{ uri: imgUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient colors={['rgba(42,31,26,0.4)', 'transparent', 'rgba(42,31,26,0.7)']} style={StyleSheet.absoluteFillObject} />
          <SafeAreaView edges={['top']} style={styles.heroTop}>
            <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Pressable testID="fav-btn" onPress={toggleFav} style={styles.iconBtn}>
              <Feather name="bookmark" size={20} color={favorited ? theme.color.brandSecondary : '#fff'} />
            </Pressable>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <View style={styles.heroBadgeRow}>
              <Text style={styles.category}>{recipe.category.toUpperCase()}</Text>
              {recipe.coup_de_coeur && (
                <View style={styles.cdcBadge} testID="cdc-badge">
                  <Feather name="award" size={11} color={theme.color.onBrandPrimary} />
                  <Text style={styles.cdcText}>COUP DE CŒUR</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>{recipe.title}</Text>
            {recipe.author_name && <Text style={styles.author}>par {recipe.author_name}</Text>}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>DIFFICULTÉ</Text><Text style={styles.metaVal}>{recipe.difficulty}</Text></View>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>TEMPS</Text><Text style={styles.metaVal}>{recipe.time_minutes} min</Text></View>
          {recipe.hydration > 0 && <View style={styles.metaCol}><Text style={styles.metaLabel}>HYDRATATION</Text><Text style={styles.metaVal}>{recipe.hydration}%</Text></View>}
        </View>

        <View style={styles.likeRow}>
          <Pressable testID="like-btn" onPress={toggleLike} style={styles.likeBtn}>
            <Feather name="heart" size={18} color={likes.liked ? theme.color.error : theme.color.onSurfaceSecondary} />
            <Text style={styles.likeText}>{likes.count} j'aime</Text>
          </Pressable>
          <Pressable testID="comment-jump" onPress={() => setTab('community')} style={styles.likeBtn}>
            <Feather name="message-square" size={18} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.likeText}>{comments.length} avis</Text>
          </Pressable>
        </View>

        <Text style={styles.description}>{recipe.description}</Text>

        <View style={styles.segment}>
          <Pressable testID="segment-ingredients" onPress={() => setTab('ingredients')} style={[styles.segBtn, tab === 'ingredients' && styles.segActive]}>
            <Text style={[styles.segText, tab === 'ingredients' && styles.segTextActive]}>Ingrédients</Text>
          </Pressable>
          <Pressable testID="segment-steps" onPress={() => setTab('steps')} style={[styles.segBtn, tab === 'steps' && styles.segActive]}>
            <Text style={[styles.segText, tab === 'steps' && styles.segTextActive]}>Préparation</Text>
          </Pressable>
          <Pressable testID="segment-community" onPress={() => setTab('community')} style={[styles.segBtn, tab === 'community' && styles.segActive]}>
            <Text style={[styles.segText, tab === 'community' && styles.segTextActive]}>Communauté</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          {tab === 'ingredients' && recipe.ingredients.map((ing: string, i: number) => (
            <View key={i} style={styles.ingredientRow} testID={`ing-${i}`}>
              <View style={styles.dot} />
              <Text style={styles.ingredientText}>{ing}</Text>
            </View>
          ))}

          {tab === 'steps' && (() => {
            const seq = recipe.steps
              .map((s: string, i: number) => ({ i, dur: parseDuration(s) }))
              .filter((x: any) => x.dur)
              .map((x: any) => ({ label: `Étape ${x.i + 1}`, seconds: x.dur }));
            return (
              <>
                {seq.length > 1 && (
                  <Pressable testID="start-all-timers" onPress={() => startSequence(seq)} style={styles.seqBtn}>
                    <Feather name="play-circle" size={16} color="#fff" />
                    <Text style={styles.seqBtnText}>Lancer les {seq.length} minuteurs en séquence</Text>
                  </Pressable>
                )}
                {recipe.steps.map((s: string, i: number) => {
                  const dur = parseDuration(s);
                  return (
                    <View key={i} style={styles.stepRow} testID={`step-${i}`}>
                      <Text style={styles.stepNum}>{String(i + 1).padStart(2, '0')}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stepText}>{s}</Text>
                        {dur && (
                          <Pressable testID={`timer-step-${i}`} onPress={() => start(`Étape ${i + 1}`, dur)} style={styles.timerChip}>
                            <Feather name="clock" size={13} color={theme.color.brand} />
                            <Text style={styles.timerChipText}>Lancer le minuteur ({Math.round(dur / 60)} min)</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            );
          })()}

          {tab === 'community' && (
            <View>
              {/* Personal note */}
              <View style={styles.noteCard}>
                <View style={styles.noteHeader}>
                  <Feather name="edit-3" size={15} color={theme.color.brand} />
                  <Text style={styles.noteTitle}>Mes notes personnelles</Text>
                </View>
                <TextInput
                  testID="note-input"
                  value={note}
                  onChangeText={(t) => { setNote(t); setNoteSaved(false); }}
                  placeholder="Vos ajustements, astuces, tour de main…"
                  placeholderTextColor={theme.color.muted}
                  style={styles.noteInput}
                  multiline
                />
                {!noteSaved && (
                  <Pressable testID="save-note" onPress={saveNote} style={styles.saveNoteBtn}>
                    <Text style={styles.saveNoteText}>Enregistrer</Text>
                  </Pressable>
                )}
              </View>

              {/* Comments */}
              <Text style={styles.commentsTitle}>Avis de la communauté</Text>
              {replyTo && (
                <View style={styles.replyBanner} testID="reply-banner">
                  <Text style={styles.replyBannerText}>Réponse à {replyTo.name}</Text>
                  <Pressable testID="cancel-reply" onPress={() => setReplyTo(null)}>
                    <Feather name="x" size={16} color={theme.color.muted} />
                  </Pressable>
                </View>
              )}
              <View style={styles.commentInputRow}>
                <TextInput
                  testID="comment-input"
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder={replyTo ? `Répondre à ${replyTo.name}…` : 'Partagez votre avis…'}
                  placeholderTextColor={theme.color.muted}
                  style={styles.commentInput}
                  multiline
                />
                <Pressable testID="comment-send" onPress={sendComment} disabled={!commentText.trim()} style={[styles.commentSend, !commentText.trim() && { opacity: 0.4 }]}>
                  <Feather name="send" size={18} color="#fff" />
                </Pressable>
              </View>

              {(() => {
                const roots = comments.filter(c => !c.parent_id);
                const repliesFor = (pid: string) => comments.filter(c => c.parent_id === pid);
                if (roots.length === 0) return <Text style={styles.noComments}>Soyez le premier à donner votre avis.</Text>;
                return roots.map((c) => (
                  <View key={c.id} testID={`comment-${c.id}`}>
                    <View style={styles.commentCard}>
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentAvatarText}>{(c.user_name || '?').slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commentName}>{c.user_name}</Text>
                        <Text style={styles.commentBody}>{c.content}</Text>
                        <Pressable testID={`reply-btn-${c.id}`} onPress={() => setReplyTo({ id: c.id, name: c.user_name })} style={styles.replyBtn}>
                          <Feather name="corner-up-left" size={13} color={theme.color.brand} />
                          <Text style={styles.replyBtnText}>Répondre</Text>
                        </Pressable>
                      </View>
                    </View>
                    {repliesFor(c.id).map((r) => (
                      <View key={r.id} style={styles.replyCard} testID={`comment-${r.id}`}>
                        <View style={styles.replyAvatar}>
                          <Text style={styles.replyAvatarText}>{(r.user_name || '?').slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.commentName}>{r.user_name}</Text>
                          <Text style={styles.commentBody}>{r.content}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ));
              })()}
            </View>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  heroWrap: { height: 420, position: 'relative' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(42,31,26,0.5)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cdcBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.color.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  cdcText: { color: theme.color.onBrandPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  category: { color: theme.color.brandSecondary, fontSize: 11, letterSpacing: 3, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: '#fff', marginTop: 6, lineHeight: 36 },
  author: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 32 },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  metaVal: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, marginTop: 4 },
  likeRow: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, gap: 24 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  likeText: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  description: { fontSize: 15, color: theme.color.onSurfaceSecondary, lineHeight: 22, paddingHorizontal: 24, paddingTop: 16, fontStyle: 'italic' },
  segment: { flexDirection: 'row', marginTop: 24, marginHorizontal: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 20 },
  segBtn: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segActive: { borderBottomColor: theme.color.brand },
  segText: { fontSize: 14, color: theme.color.muted, fontWeight: '500' },
  segTextActive: { color: theme.color.onSurface },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.brand },
  ingredientText: { fontSize: 15, color: theme.color.onSurface, flex: 1 },
  stepRow: { flexDirection: 'row', marginBottom: 24, gap: 16 },
  stepNum: { fontFamily: theme.serif, fontSize: 24, color: theme.color.brand, minWidth: 36 },
  stepText: { fontSize: 15, color: theme.color.onSurface, lineHeight: 22 },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start', backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  timerChipText: { fontSize: 12, color: theme.color.onBrandTertiary, fontWeight: '600' },
  seqBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brand, paddingVertical: 12, borderRadius: 8, marginBottom: 24 },
  seqBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  noteCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 28 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  noteTitle: { fontSize: 14, fontWeight: '600', color: theme.color.onSurface },
  noteInput: { fontSize: 15, color: theme.color.onSurface, minHeight: 60, textAlignVertical: 'top' },
  saveNoteBtn: { alignSelf: 'flex-end', marginTop: 10, backgroundColor: theme.color.brand, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 4 },
  saveNoteText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  commentsTitle: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface, marginBottom: 16 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 24 },
  commentInput: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: theme.color.onSurface, minHeight: 44, maxHeight: 120 },
  commentSend: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  noComments: { color: theme.color.muted, fontSize: 14, fontStyle: 'italic' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.color.brandTertiary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, marginBottom: 10 },
  replyBannerText: { fontSize: 13, color: theme.color.onBrandTertiary, fontWeight: '500' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  replyBtnText: { fontSize: 12, color: theme.color.brand, fontWeight: '600' },
  replyCard: { flexDirection: 'row', gap: 10, marginBottom: 16, marginLeft: 34, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: theme.color.border },
  replyAvatar: { width: 30, height: 30, borderRadius: 999, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  replyAvatarText: { color: theme.color.onSurfaceTertiary, fontFamily: theme.serif, fontSize: 14 },
  commentCard: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  commentAvatar: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { color: theme.color.onBrandTertiary, fontFamily: theme.serif, fontSize: 16 },
  commentName: { fontSize: 14, fontWeight: '600', color: theme.color.onSurface, marginBottom: 2 },
  commentBody: { fontSize: 14, color: theme.color.onSurfaceSecondary, lineHeight: 20 },
});
