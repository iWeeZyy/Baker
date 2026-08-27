import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Linking, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { confirmAsync } from '@/src/confirm';
import { useTimer } from '@/src/TimerContext';
import { formatDuration } from '@/src/format';
import { scaleIngredientLine, scaleStepLine, scaleYieldLabel } from '@/src/ingredientScale';
import { recipeImage } from '@/src/products';
import { QuantitySelector } from '@/src/QuantitySelector';
import { theme } from '@/src/theme';

type Comment = { id: string; user_id: string; user_name: string; content: string; created_at: string; parent_id?: string | null; like_count?: number; liked?: boolean };

type CommentSort = 'likes' | 'newest' | 'oldest';

const COMMENT_SORT_OPTIONS: { key: CommentSort; label: string }[] = [
  { key: 'likes', label: '+ likés' },
  { key: 'newest', label: '+ récents' },
  { key: 'oldest', label: '+ anciens' },
];

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

/**
 * The professional sheet, in the order a baker reads it: what is done first at
 * the top, what comes out of the oven at the bottom.
 *
 * Only the lines the source actually states are rendered — an absent field is
 * absent, never shown empty and never guessed. A recipe with no sheet at all
 * shows nothing rather than an empty frame.
 */
const TECHNICAL_ROWS: [string, string][] = [
  ['yield_label', 'Rendement'],
  ['prep', 'Préparation'],
  ['trempage', 'Trempage'],
  ['petrissage', 'Pétrissage et repos'],
  ['autolyse', 'Autolyse'],
  ['tourage', 'Tourage'],
  ['fermentation', 'Fermentation'],
  ['pointage', 'Pointage'],
  ['detente', 'Détente'],
  ['appret', 'Apprêt'],
  ['repos', 'Repos'],
  ['refrigeration', 'Réfrigération'],
  ['congelation', 'Congélation'],
  ['maceration', 'Macération'],
  ['cuisson', 'Cuisson'],
  ['oven', 'Four'],
  ['dough_temp', 'Températures'],
  ['room_temp', 'Température labo'],
  ['levure', 'Levure'],
  ['conservation', 'Conservation'],
  ['accompagnement', 'Accompagnement'],
  ['observations', 'Observations'],
  ['conseils', 'Conseils'],
];

/** Keeps "205 °C" and "1 h 30" on one line rather than wrapping on the space. */
function unbreakable(text: string) {
  return text.replace(/(\d)\s+(°C|h\b|min\b|g\b|ml\b|cm\b)/g, '$1\u00a0$2');
}

/**
 * Le crédit d'une photo.
 *
 * Les API Guidelines de Pexels vont plus loin que la licence : dès qu'on passe
 * par leur API, il faut nommer le photographe avec un lien vers son profil et
 * renvoyer vers Pexels. Ce n'est donc pas une politesse, c'est la condition
 * d'usage — et c'est aussi pourquoi `recipe_photos.py` refuse une entrée sans
 * auteur ni page source : on ne peut pas créditer ce qu'on n'a pas noté.
 *
 * Rendu discrètement sous la photo, dans le style du « D'après … » qui crédite
 * déjà l'ouvrage en bas de la fiche technique. Aucun écran nouveau.
 */
function PhotoCredit({ credit }: { credit?: Record<string, any> | null }) {
  if (!credit?.author || !credit?.page) return null;
  const open = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };
  return (
    <View style={styles.photoCredit} testID="photo-credit">
      <Feather name="camera" size={11} color={theme.color.muted} />
      <Text style={styles.photoCreditText}>
        Photo{' '}
        <Text style={styles.photoCreditLink} onPress={() => open(credit.author_url)}>
          {credit.author}
        </Text>
        {' · '}
        <Text style={styles.photoCreditLink} onPress={() => open(credit.page)}>
          Pexels
        </Text>
      </Text>
    </View>
  );
}

function TechnicalSheet(
  { technical, source, quantity }:
  { technical?: Record<string, any> | null; source?: string | null; quantity: number },
) {
  // Seul le rendement suit le multiplicateur. Une durée et une température
  // n'en dépendent pas : un pointage de 15 minutes reste 15 minutes qu'on
  // fasse huit pièces ou vingt-quatre, et le four reste à 250 °C.
  const rows = TECHNICAL_ROWS
    .map(([key, label]) => [
      label,
      key === 'yield_label' && typeof technical?.[key] === 'string'
        ? scaleYieldLabel(technical[key], quantity)
        : technical?.[key],
    ] as const)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
  const equipment: string[] = Array.isArray(technical?.equipment) ? technical!.equipment : [];

  if (rows.length === 0 && equipment.length === 0 && !source) return null;

  return (
    <View style={styles.sheet} testID="technical-sheet">
      <Text style={styles.sheetTitle}>FICHE TECHNIQUE</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.sheetRow}>
          <Text style={styles.sheetLabel}>{label}</Text>
          <Text style={styles.sheetValue}>{unbreakable(value as string)}</Text>
        </View>
      ))}
      {equipment.length > 0 && (
        <View style={styles.sheetRow}>
          <Text style={styles.sheetLabel}>Matériel</Text>
          <Text style={styles.sheetValue}>{unbreakable(equipment.join(' · '))}</Text>
        </View>
      )}
      {!!source && <Text style={styles.sheetSource}>D'après {source}</Text>}
    </View>
  );
}

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { start, startSequence } = useTimer();
  const [recipe, setRecipe] = useState<any>(null);
  const [tab, setTab] = useState<'ingredients' | 'steps' | 'community'>('ingredients');
  const [favorited, setFavorited] = useState(false);
  const [likes, setLikes] = useState({ count: 0, liked: false });
  const [likeError, setLikeError] = useState<string | null>(null);
  const [likePending, setLikePending] = useState(false);
  const likeScale = useRef(new Animated.Value(1)).current;
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentSort, setCommentSort] = useState<CommentSort>('likes');
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [costInfo, setCostInfo] = useState<{ available: boolean; cost_per_piece?: number } | null>(null);
  const { user } = useAuth();

  const loadCommunity = useCallback(async () => {
    try {
      const [l, c, n, mine] = await Promise.all([
        api(`/recipes/${id}/likes`),
        api(`/recipes/${id}/comments`),
        api(`/recipes/${id}/note`),
        api(`/recipes/${id}/comments/likes/mine`).catch(() => ({ liked_comment_ids: [] })),
      ]);
      const likedIds = new Set(mine.liked_comment_ids || []);
      setLikes(l);
      setComments(c.map((cm: Comment) => ({ ...cm, liked: likedIds.has(cm.id) })));
      setNote(n.content || '');
    } catch (e) { console.warn(e); }
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/recipes/${id}`);
        setRecipe(r);
        try { const f = await api(`/recipes/${id}/favorite`); setFavorited(f.favorited); } catch {}
        // Le badge de coût est un bonus d'affichage : son échec ne doit jamais
        // bloquer le chargement de la fiche elle-même.
        api(`/recipes/${id}/cost`).then(setCostInfo).catch(() => setCostInfo(null));
        await loadCommunity();
      } finally { setLoading(false); }
    })();
  }, [id, loadCommunity]);

  const toggleFav = async () => {
    try { const res = await api(`/recipes/${id}/favorite`, { method: 'POST' }); setFavorited(res.favorited); } catch {}
  };

  const toggleLike = async () => {
    if (likePending) return;
    setLikeError(null);
    const previous = likes;
    const optimistic = { liked: !previous.liked, count: previous.count + (previous.liked ? -1 : 1) };
    setLikes(optimistic);
    setLikePending(true);
    if (optimistic.liked) {
      Animated.sequence([
        Animated.timing(likeScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: true }),
      ]).start();
    }
    try {
      const res = await api(`/recipes/${id}/like`, { method: 'POST' });
      setLikes(res);
    } catch (e: any) {
      setLikes(previous);
      setLikeError(e.message || 'Erreur');
    } finally {
      setLikePending(false);
    }
  };

  const sendComment = async () => {
    const txt = commentText.trim();
    if (!txt) return;
    setCommentText('');
    setCommentError(null);
    const parent = replyTo?.id || null;
    setReplyTo(null);
    try {
      const c = await api(`/recipes/${id}/comments`, { method: 'POST', body: JSON.stringify({ content: txt, parent_id: parent }) });
      setComments(prev => [...prev, { ...c, like_count: 0, liked: false }]);
    } catch (e: any) {
      setCommentError(e.message || 'Erreur');
    }
  };

  const toggleCommentLike = async (commentId: string) => {
    const previous = comments;
    setComments(prev => prev.map(c => c.id === commentId
      ? { ...c, liked: !c.liked, like_count: (c.like_count || 0) + (c.liked ? -1 : 1) }
      : c));
    try {
      const res = await api(`/comments/${commentId}/like`, { method: 'POST' });
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, liked: res.liked, like_count: res.count } : c));
    } catch (e: any) {
      setComments(previous);
      setCommentError(e.message || 'Erreur');
    }
  };

  const deleteComment = async (comment: Comment) => {
    const ok = await confirmAsync('Supprimer ce commentaire', 'Les réponses qu\'il a reçues seront supprimées avec lui.', 'Supprimer', true);
    if (!ok) return;
    const previous = comments;
    try {
      const res = await api(`/recipes/${id}/comments/${comment.id}`, { method: 'DELETE' });
      const deletedIds: string[] = res.deleted_ids || [comment.id];
      setComments(prev => prev.filter(c => !deletedIds.includes(c.id)));
    } catch (e: any) {
      setComments(previous);
      setCommentError(e.message || 'Erreur');
    }
  };

  const saveNote = async () => {
    try { await api(`/recipes/${id}/note`, { method: 'PUT', body: JSON.stringify({ content: note }) }); setNoteSaved(true); } catch {}
  };

  // Affichage et calculs uniquement : la recette d'origine (recipe.ingredients)
  // n'est jamais réécrite, donc revenir à 1 rend exactement les quantités de
  // départ, sans multiplication cumulative possible.
  const [quantity, setQuantity] = useState(1);
  useEffect(() => { setQuantity(1); }, [id]);
  const scaledIngredients = useMemo(
    () => ((recipe?.ingredients as string[] | undefined) ?? []).map((line) => scaleIngredientLine(line, quantity)),
    [recipe, quantity],
  );

  // Les étapes sont mises à l'échelle une fois, et le texte obtenu sert **aussi**
  // à `parseDuration` : le minuteur d'une étape doit être lu sur le texte que
  // l'utilisateur a sous les yeux, pas sur une autre version. `scaleStepLine` ne
  // touche jamais à une durée, donc les minuteurs sont identiques à 1 et à 3 —
  // mais ils le sont par construction, pas par hasard.
  const scaledSteps = useMemo(
    () => ((recipe?.steps as string[] | undefined) ?? []).map((line) => scaleStepLine(line, quantity)),
    [recipe, quantity],
  );

  if (loading || !recipe) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  // Téléversement, puis photo du produit, puis dessin d'archétype, puis rien.
  // La règle vit dans `src/products.ts` et sert aussi à l'accueil, pour que les
  // deux écrans ne puissent pas diverger.
  const image = recipeImage(recipe, API_BASE);
  const photo = image.kind === 'upload' || image.kind === 'photo' ? image.uri : null;
  const tile = image.kind === 'drawing' ? image.source : null;

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.heroWrap}>
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          ) : (
            // Sans photo, un fond chaud plutôt qu'une bande grise, qui se
            // lirait comme une image qui n'a pas chargé. L'illustration de
            // l'archétype vient par-dessus quand la forme en a une ; sinon la
            // bande reste unie — c'est un état voulu, pas un échec.
            //
            // Un dessin se recadre mal : il se lit entier ou pas du tout, d'où
            // `contain`, remonté pour laisser la bande basse au titre.
            <View style={styles.heroPlain}>
              {tile ? (
                <View style={styles.heroDrawing} testID="recipe-illustration">
                  <Image source={tile} style={{ flex: 1 }} contentFit="contain" />
                </View>
              ) : null}
            </View>
          )}
          <LinearGradient
            // Sans photo, on n'assombrit que le bas : noircir le haut salirait
            // l'illustration sans rien rendre plus lisible, les deux boutons
            // portant déjà leur propre pastille.
            colors={photo
              ? ['rgba(42,31,26,0.4)', 'transparent', 'rgba(42,31,26,0.7)']
              : ['transparent', 'transparent', 'rgba(42,31,26,0.72)']}
            style={StyleSheet.absoluteFillObject}
          />
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

        <PhotoCredit credit={photo ? recipe.image_credit : null} />

        <View style={styles.metaRow}>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>DIFFICULTÉ</Text><Text style={styles.metaVal}>{recipe.difficulty}</Text></View>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>TEMPS</Text><Text style={styles.metaVal}>{formatDuration(recipe.time_minutes)}</Text></View>
          {recipe.hydration > 0 && <View style={styles.metaCol}><Text style={styles.metaLabel}>HYDRATATION</Text><Text style={styles.metaVal}>{recipe.hydration}%</Text></View>}
        </View>

        <View style={styles.likeRow}>
          <Pressable testID="like-btn" onPress={toggleLike} style={styles.likeBtn}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Ionicons name={likes.liked ? 'heart' : 'heart-outline'} size={18} color={likes.liked ? theme.color.error : theme.color.onSurfaceSecondary} />
            </Animated.View>
            <Text style={styles.likeText}>{likes.count} j'aime</Text>
          </Pressable>
          <Pressable testID="comment-jump" onPress={() => setTab('community')} style={styles.likeBtn}>
            <Feather name="message-square" size={18} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.likeText}>{comments.length} avis</Text>
          </Pressable>
        </View>
        {likeError && <Text style={styles.likeError} testID="like-error">{likeError}</Text>}

        <Text style={styles.description}>{recipe.description}</Text>

        <QuantitySelector testID="quantity-selector" value={quantity} onChange={setQuantity} />

        <Pressable testID="cost-btn" onPress={() => router.push(`/cost/${id}`)} style={styles.costBtn}>
          <Text style={styles.costBtnEmoji}>💰</Text>
          <Text style={styles.costBtnText}>Calculer le coût</Text>
          {costInfo?.available && costInfo.cost_per_piece != null && (
            <Text testID="cost-badge" style={styles.costBadge}>
              {costInfo.cost_per_piece.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €/pièce
            </Text>
          )}
          <Feather name="chevron-right" size={16} color={theme.color.muted} />
        </Pressable>

        <TechnicalSheet technical={recipe.technical} source={recipe.source} quantity={quantity} />

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
          {tab === 'ingredients' && scaledIngredients.map((ing: string, i: number) => (
            <View key={i} style={styles.ingredientRow} testID={`ing-${i}`}>
              <View style={styles.dot} />
              <Text style={styles.ingredientText}>{ing}</Text>
            </View>
          ))}

          {tab === 'steps' && (() => {
            const seq = scaledSteps
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
                {scaledSteps.map((s: string, i: number) => {
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
              {commentError && <Text style={styles.commentError} testID="comment-error">{commentError}</Text>}

              {comments.length > 0 && (
                <View style={styles.sortRow}>
                  {COMMENT_SORT_OPTIONS.map(opt => (
                    <Pressable
                      key={opt.key}
                      testID={`comment-sort-${opt.key}`}
                      onPress={() => setCommentSort(opt.key)}
                      style={[styles.sortChip, commentSort === opt.key && styles.sortChipActive]}
                    >
                      <Text style={[styles.sortChipText, commentSort === opt.key && styles.sortChipTextActive]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {(() => {
                const roots = comments.filter(c => !c.parent_id);
                const repliesFor = (pid: string) => comments.filter(c => c.parent_id === pid);
                const sortedRoots = [...roots].sort((a, b) => {
                  if (commentSort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                  if (commentSort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                  return (b.like_count || 0) - (a.like_count || 0) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                });
                if (sortedRoots.length === 0) return <Text style={styles.noComments}>Soyez le premier à donner votre avis.</Text>;
                return sortedRoots.map((c) => (
                  <View key={c.id} testID={`comment-${c.id}`}>
                    <View style={styles.commentCard}>
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentAvatarText}>{(c.user_name || '?').slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commentName}>{c.user_name}</Text>
                        <Text style={styles.commentBody}>{c.content}</Text>
                        <View style={styles.commentActionsRow}>
                          <Pressable testID={`comment-like-btn-${c.id}`} onPress={() => toggleCommentLike(c.id)} style={styles.replyBtn}>
                            <Ionicons name={c.liked ? 'heart' : 'heart-outline'} size={13} color={c.liked ? theme.color.error : theme.color.brand} />
                            <Text style={styles.replyBtnText}>{c.like_count || 0}</Text>
                          </Pressable>
                          <Pressable testID={`reply-btn-${c.id}`} onPress={() => setReplyTo({ id: c.id, name: c.user_name })} style={styles.replyBtn}>
                            <Feather name="corner-up-left" size={13} color={theme.color.brand} />
                            <Text style={styles.replyBtnText}>Répondre</Text>
                          </Pressable>
                          {user?.user_id === c.user_id && (
                            <Pressable testID={`comment-delete-btn-${c.id}`} onPress={() => deleteComment(c)} style={styles.replyBtn}>
                              <Feather name="trash-2" size={13} color={theme.color.muted} />
                            </Pressable>
                          )}
                        </View>
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
                          <View style={styles.commentActionsRow}>
                            <Pressable testID={`comment-like-btn-${r.id}`} onPress={() => toggleCommentLike(r.id)} style={styles.replyBtn}>
                              <Ionicons name={r.liked ? 'heart' : 'heart-outline'} size={13} color={r.liked ? theme.color.error : theme.color.brand} />
                              <Text style={styles.replyBtnText}>{r.like_count || 0}</Text>
                            </Pressable>
                            {user?.user_id === r.user_id && (
                              <Pressable testID={`comment-delete-btn-${r.id}`} onPress={() => deleteComment(r)} style={styles.replyBtn}>
                                <Feather name="trash-2" size={13} color={theme.color.muted} />
                              </Pressable>
                            )}
                          </View>
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
  heroPlain: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.color.surfaceSecondary },
  heroDrawing: { flex: 1, marginBottom: 92 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(42,31,26,0.5)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cdcBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.color.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  cdcText: { color: theme.color.onBrandPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  category: { color: theme.color.brandSecondary, fontSize: 11, letterSpacing: 3, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: '#fff', marginTop: 6, lineHeight: 36 },
  author: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  photoCredit: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 24, paddingTop: 10,
  },
  photoCreditText: { fontSize: 11, color: theme.color.muted, fontStyle: 'italic' },
  photoCreditLink: { textDecorationLine: 'underline' },
  metaRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 32 },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  metaVal: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, marginTop: 4 },
  likeRow: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, gap: 24 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  likeText: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  likeError: { color: theme.color.error, fontSize: 13, paddingHorizontal: 24, paddingTop: 6 },
  description: { fontSize: 15, color: theme.color.onSurfaceSecondary, lineHeight: 22, paddingHorizontal: 24, paddingTop: 16, fontStyle: 'italic' },
  costBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: theme.spacing.md, marginHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg,
  },
  costBtnEmoji: { fontSize: 16 },
  costBtnText: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.color.onSurface },
  costBadge: { fontSize: 12, color: theme.color.brand, fontWeight: '700' },
  sheet: {
    marginTop: theme.spacing.xl, marginHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg,
  },
  sheetTitle: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600', marginBottom: theme.spacing.md },
  // Label and value side by side, the value taking the width it needs: a
  // conservation note runs several lines, a duration one word.
  sheetRow: { flexDirection: 'row', paddingVertical: theme.spacing.sm, gap: theme.spacing.md },
  sheetLabel: { width: 116, fontSize: theme.fontSize.sm, color: theme.color.muted },
  sheetValue: { flex: 1, fontSize: theme.fontSize.base, color: theme.color.onSurface, lineHeight: 20 },
  sheetSource: { marginTop: theme.spacing.md, fontSize: 11, color: theme.color.muted, fontStyle: 'italic' },
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
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 8 },
  commentInput: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: theme.color.onSurface, minHeight: 44, maxHeight: 120 },
  commentSend: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  commentError: { color: theme.color.error, fontSize: 13, marginBottom: 16 },
  noComments: { color: theme.color.muted, fontSize: 14, fontStyle: 'italic' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.color.brandTertiary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, marginBottom: 10 },
  replyBannerText: { fontSize: 13, color: theme.color.onBrandTertiary, fontWeight: '500' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  replyBtnText: { fontSize: 12, color: theme.color.brand, fontWeight: '600' },
  commentActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  sortChip: { paddingHorizontal: 14, height: 32, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  sortChipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  sortChipText: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  sortChipTextActive: { color: theme.color.onSurfaceInverse },
  replyCard: { flexDirection: 'row', gap: 10, marginBottom: 16, marginLeft: 34, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: theme.color.border },
  replyAvatar: { width: 30, height: 30, borderRadius: 999, backgroundColor: theme.color.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  replyAvatarText: { color: theme.color.onSurfaceTertiary, fontFamily: theme.serif, fontSize: 14 },
  commentCard: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  commentAvatar: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { color: theme.color.onBrandTertiary, fontFamily: theme.serif, fontSize: 16 },
  commentName: { fontSize: 14, fontWeight: '600', color: theme.color.onSurface, marginBottom: 2 },
  commentBody: { fontSize: 14, color: theme.color.onSurfaceSecondary, lineHeight: 20 },
});
