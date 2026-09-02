import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Linking, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AddToCollectionModal } from '@/src/AddToCollectionModal';
import { api, API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { useAuth } from '@/src/auth';
import { confirmAsync } from '@/src/confirm';
import { useTimer } from '@/src/TimerContext';
import { formatDuration } from '@/src/format';
import { scaleIngredientLine, scaleStepLine, scaleYieldLabel } from '@/src/ingredientScale';
import { recipeImage } from '@/src/products';
import { QuantitySelector } from '@/src/QuantitySelector';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { LevelBadge } from '@/src/gamification/LevelBadge';
import { showGamificationToast } from '@/src/gamification/UnlockToast';

type Comment = {
  id: string; user_id: string; user_name: string; user_picture?: string | null; content: string;
  created_at: string; edited_at?: string | null; parent_id?: string | null;
  reply_to_user_id?: string | null; reply_to_user_name?: string | null;
  like_count?: number; liked?: boolean;
  user_level?: { level: number; title: string };
};

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
export default function RecipeDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const PhotoCredit = ({ credit }: { credit?: Record<string, any> | null }) => {
    if (!credit?.author || !credit?.page) return null;
    const open = (url?: string) => { if (url) Linking.openURL(url).catch(() => {}); };
    return (
      <View style={styles.photoCredit} testID="photo-credit">
        <Feather name="camera" size={11} color={colors.muted} />
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
  };

  const TechnicalSheet = (
    { technical, source, quantity }:
    { technical?: Record<string, any> | null; source?: string | null; quantity: number },
  ) => {
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
  };

  const { id, tab: tabParam, highlightComment } = useLocalSearchParams<{ id: string; tab?: string; highlightComment?: string }>();
  const router = useRouter();
  const { start, startSequence } = useTimer();
  const [recipe, setRecipe] = useState<any>(null);
  const [tab, setTab] = useState<'ingredients' | 'steps' | 'community'>('ingredients');
  const [favorited, setFavorited] = useState(false);
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  const [likes, setLikes] = useState({ count: 0, liked: false });
  const [likeError, setLikeError] = useState<string | null>(null);
  const [likePending, setLikePending] = useState(false);
  const likeScale = useRef(new Animated.Value(1)).current;
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentSort, setCommentSort] = useState<CommentSort>('likes');
  const [commentText, setCommentText] = useState('');
  // parentId : toujours la racine (profondeur 2 maximum, comme côté serveur) ;
  // toUserId/toName : l'auteur visé, racine ou réponse — sert à la fois au
  // placeholder "Répondre à X…" et au reply_to_user_id envoyé au serveur.
  const [replyTo, setReplyTo] = useState<{ parentId: string; toUserId: string; toName: string } | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const commentRefs = useRef<Record<string, View | null>>({});
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [costInfo, setCostInfo] = useState<{ available: boolean; cost_per_piece?: number } | null>(null);
  const { user, refreshUser } = useAuth();

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

  // Arrivée depuis "Mes commentaires" : bascule sur l'onglet Communauté et
  // repère le commentaire visé, une fois qu'il a une chance d'être chargé.
  useEffect(() => {
    if (tabParam === 'community') setTab('community');
  }, [tabParam]);

  useEffect(() => {
    if (!highlightComment || tab !== 'community' || comments.length === 0) return;
    setExpandedRoots(prev => {
      const target = comments.find(c => c.id === highlightComment);
      const rootId = target?.parent_id || target?.id;
      if (!rootId || prev.has(rootId)) return prev;
      return new Set(prev).add(rootId);
    });
    const timeout = setTimeout(() => {
      const node = commentRefs.current[highlightComment];
      // measureLayout n'existe que sur les vues natives (pas sur `Text`), et le
      // ciblage est du meilleur effort : un échec ne doit rien casser.
      if (node && scrollRef.current) {
        // @ts-ignore - measureLayout existe à l'exécution même si absent du type RN
        node.measureLayout?.(
          // @ts-ignore
          scrollRef.current.getInnerViewNode?.() ?? scrollRef.current,
          (_x: number, y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true }),
          () => {},
        );
      }
      setHighlightedCommentId(highlightComment);
      setTimeout(() => setHighlightedCommentId(null), 2000);
    }, 300);
    return () => clearTimeout(timeout);
    // `comments` volontairement absent : seule sa longueur doit redéclencher ce
    // repérage (un like qui change la référence du tableau ne doit pas rejouer
    // le défilement/surbrillance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightComment, tab, comments.length]);

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
    const parent = replyTo?.parentId || null;
    const replyToUserId = replyTo?.toUserId || null;
    setReplyTo(null);
    try {
      const c = await api(`/recipes/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: txt, parent_id: parent, reply_to_user_id: replyToUserId }),
      });
      setComments(prev => [...prev, { ...c, like_count: 0, liked: false }]);
      if (parent) setExpandedRoots(prev => new Set(prev).add(parent));
      showGamificationToast(c.gamification);
      refreshUser();
    } catch (e: any) {
      setCommentError(e.message || 'Erreur');
    }
  };

  const startEditComment = (c: Comment) => {
    setCommentError(null);
    setEditingId(c.id);
    setEditText(c.content);
  };

  const saveEditComment = async () => {
    if (!editingId) return;
    const txt = editText.trim();
    if (!txt) return;
    setCommentError(null);
    try {
      const updated = await api(`/recipes/${id}/comments/${editingId}`, { method: 'PUT', body: JSON.stringify({ content: txt }) });
      setComments(prev => prev.map(c => c.id === editingId ? { ...c, content: updated.content, edited_at: updated.edited_at } : c));
      setEditingId(null);
      setEditText('');
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

  if (loading || !recipe) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  // Téléversement, puis photo du produit, puis dessin d'archétype, puis rien.
  // La règle vit dans `src/products.ts` et sert aussi à l'accueil, pour que les
  // deux écrans ne puissent pas diverger.
  const image = recipeImage(recipe, API_BASE);
  const photo = image.kind === 'upload' || image.kind === 'photo' ? image.uri : null;
  const tile = image.kind === 'drawing' ? image.source : null;

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
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
              <Feather name="arrow-left" size={20} color={colors.onBrandPrimary} />
            </Pressable>
            <View style={styles.heroTopRightGroup}>
              <Pressable testID="fav-btn" onPress={toggleFav} style={styles.iconBtn}>
                <Feather name="bookmark" size={20} color={favorited ? colors.brandSecondary : colors.onBrandPrimary} />
              </Pressable>
              <Pressable testID="add-to-collection-btn" onPress={() => setCollectionModalVisible(true)} style={styles.iconBtn}>
                <Feather name="folder-plus" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <View style={styles.heroBadgeRow}>
              <Text style={styles.category}>{recipe.category.toUpperCase()}</Text>
              {recipe.coup_de_coeur && (
                <View style={styles.cdcBadge} testID="cdc-badge">
                  <Feather name="award" size={11} color={colors.onBrandPrimary} />
                  <Text style={styles.cdcText}>COUP DE CŒUR</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>{recipe.title}</Text>
            {recipe.author_name && (
              <View style={styles.authorRow}>
                <View style={styles.authorAvatar}>
                  {avatarUrl(recipe.author_picture, API_BASE) ? (
                    <Image source={{ uri: avatarUrl(recipe.author_picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : (
                    <Text style={styles.authorAvatarText}>{recipe.author_name.slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <Text style={styles.author}>{recipe.author_name}</Text>
                <LevelBadge level={recipe.author_level} compact style={styles.authorLevel} />
              </View>
            )}
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
              <Feather name="heart" size={18} color={likes.liked ? colors.error : colors.onSurfaceSecondary} />
            </Animated.View>
            <Text style={styles.likeText}>{likes.count} j'aime</Text>
          </Pressable>
          <Pressable testID="comment-jump" onPress={() => setTab('community')} style={styles.likeBtn}>
            <Feather name="message-square" size={18} color={colors.onSurfaceSecondary} />
            <Text style={styles.likeText}>{comments.length} avis</Text>
          </Pressable>
        </View>
        {likeError && <Text style={styles.likeError} testID="like-error">{likeError}</Text>}

        <Text style={styles.description}>{recipe.description}</Text>

        <QuantitySelector testID="quantity-selector" value={quantity} onChange={setQuantity} />

        <Pressable testID="cost-btn" onPress={() => router.push(`/cost/${id}`)} style={styles.costBtn}>
          <Feather name="dollar-sign" size={16} color={colors.onSurface} />
          <Text style={styles.costBtnText}>Calculer le coût</Text>
          {costInfo?.available && costInfo.cost_per_piece != null && (
            <Text testID="cost-badge" style={styles.costBadge}>
              {costInfo.cost_per_piece.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €/pièce
            </Text>
          )}
          <Feather name="chevron-right" size={16} color={colors.muted} />
        </Pressable>

        <Pressable testID="adapt-btn" onPress={() => router.push(`/adapt/${id}` as any)} style={styles.costBtn}>
          <Feather name="settings" size={16} color={colors.onSurface} />
          <Text style={styles.costBtnText}>Adapter la recette</Text>
          <Feather name="chevron-right" size={16} color={colors.muted} />
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
                    <Feather name="play-circle" size={16} color={colors.onBrandPrimary} />
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
                            <Feather name="clock" size={13} color={colors.brand} />
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
                  <Feather name="edit-3" size={15} color={colors.brand} />
                  <Text style={styles.noteTitle}>Mes notes personnelles</Text>
                </View>
                <TextInput
                  testID="note-input"
                  value={note}
                  onChangeText={(t) => { setNote(t); setNoteSaved(false); }}
                  placeholder="Vos ajustements, astuces, tour de main…"
                  placeholderTextColor={colors.muted}
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
                  <Text style={styles.replyBannerText}>Réponse à {replyTo.toName}</Text>
                  <Pressable testID="cancel-reply" onPress={() => setReplyTo(null)}>
                    <Feather name="x" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              )}
              <View style={styles.commentInputRow}>
                <TextInput
                  testID="comment-input"
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder={replyTo ? `Répondre à ${replyTo.toName}…` : 'Partagez votre avis…'}
                  placeholderTextColor={colors.muted}
                  style={styles.commentInput}
                  multiline
                />
                <Pressable testID="comment-send" onPress={sendComment} disabled={!commentText.trim()} style={[styles.commentSend, !commentText.trim() && { opacity: 0.4 }]}>
                  <Feather name="send" size={18} color={colors.onBrandPrimary} />
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

                const renderActions = (c: Comment, rootId: string) => (
                  <View style={styles.commentActionsRow}>
                    <Pressable testID={`comment-like-btn-${c.id}`} onPress={() => toggleCommentLike(c.id)} style={styles.replyBtn}>
                      <Feather name="heart" size={13} color={c.liked ? colors.error : colors.brand} />
                      <Text style={styles.replyBtnText}>{c.like_count || 0}</Text>
                    </Pressable>
                    <Pressable
                      testID={`reply-btn-${c.id}`}
                      onPress={() => setReplyTo({ parentId: rootId, toUserId: c.user_id, toName: c.user_name })}
                      style={styles.replyBtn}
                    >
                      <Feather name="corner-up-left" size={13} color={colors.brand} />
                      <Text style={styles.replyBtnText}>Répondre</Text>
                    </Pressable>
                    {user?.user_id === c.user_id && (
                      <>
                        <Pressable testID={`comment-edit-btn-${c.id}`} onPress={() => startEditComment(c)} style={styles.replyBtn}>
                          <Feather name="edit-2" size={13} color={colors.muted} />
                        </Pressable>
                        <Pressable testID={`comment-delete-btn-${c.id}`} onPress={() => deleteComment(c)} style={styles.replyBtn}>
                          <Feather name="trash-2" size={13} color={colors.muted} />
                        </Pressable>
                      </>
                    )}
                  </View>
                );

                const renderBody = (c: Comment) => editingId === c.id ? (
                  <View>
                    <TextInput
                      testID={`comment-edit-input-${c.id}`}
                      value={editText}
                      onChangeText={setEditText}
                      style={styles.commentEditInput}
                      multiline
                      autoFocus
                    />
                    <View style={styles.editActionsRow}>
                      <Pressable testID={`comment-edit-cancel-${c.id}`} onPress={() => { setEditingId(null); setEditText(''); }} style={styles.editActionBtn}>
                        <Text style={styles.editActionText}>Annuler</Text>
                      </Pressable>
                      <Pressable testID={`comment-edit-save-${c.id}`} onPress={saveEditComment} disabled={!editText.trim()} style={[styles.editActionBtn, !editText.trim() && { opacity: 0.4 }]}>
                        <Text style={[styles.editActionText, { color: colors.brand, fontWeight: '700' }]}>Enregistrer</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.commentBody}>
                    {c.content}
                    {c.edited_at ? <Text style={styles.editedBadge}> (modifié)</Text> : null}
                  </Text>
                );

                return sortedRoots.map((c) => {
                  const replies = repliesFor(c.id);
                  const isExpanded = expandedRoots.has(c.id);
                  const shownReplies = replies.length <= 2 || isExpanded ? replies : [];
                  return (
                    <View key={c.id} testID={`comment-${c.id}`}>
                      <View
                        ref={(node) => { commentRefs.current[c.id] = node; }}
                        style={[styles.commentCard, highlightedCommentId === c.id && styles.commentHighlighted]}
                      >
                        <View style={styles.commentAvatar}>
                          {avatarUrl(c.user_picture, API_BASE) ? (
                            <Image source={{ uri: avatarUrl(c.user_picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          ) : (
                            <Text style={styles.commentAvatarText}>{(c.user_name || '?').slice(0, 1).toUpperCase()}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.commentNameRow}>
                            <Text style={styles.commentName}>{c.user_name}</Text>
                            <LevelBadge level={c.user_level} compact />
                          </View>
                          {renderBody(c)}
                          {renderActions(c, c.id)}
                        </View>
                      </View>
                      {shownReplies.map((r) => (
                        <View
                          key={r.id}
                          ref={(node) => { commentRefs.current[r.id] = node; }}
                          style={[styles.replyCard, highlightedCommentId === r.id && styles.commentHighlighted]}
                          testID={`comment-${r.id}`}
                        >
                          <View style={styles.replyAvatar}>
                            {avatarUrl(r.user_picture, API_BASE) ? (
                              <Image source={{ uri: avatarUrl(r.user_picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            ) : (
                              <Text style={styles.replyAvatarText}>{(r.user_name || '?').slice(0, 1).toUpperCase()}</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={styles.commentNameRow}>
                              <Text style={styles.commentName}>{r.user_name}</Text>
                              <LevelBadge level={r.user_level} compact />
                            </View>
                            {r.reply_to_user_name && r.reply_to_user_name !== c.user_name && (
                              <Text style={styles.replyToLabel}>↳ Réponse à {r.reply_to_user_name}</Text>
                            )}
                            {renderBody(r)}
                            {renderActions(r, c.id)}
                          </View>
                        </View>
                      ))}
                      {replies.length > 2 && (
                        <Pressable
                          testID={`toggle-replies-${c.id}`}
                          onPress={() => setExpandedRoots(prev => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                          style={styles.toggleRepliesBtn}
                        >
                          <Text style={styles.toggleRepliesText}>
                            {isExpanded ? 'Masquer les réponses' : `Voir les ${replies.length} réponses`}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                });
              })()}
            </View>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
      <AddToCollectionModal
        visible={collectionModalVisible}
        recipeId={id}
        onClose={() => setCollectionModalVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heroWrap: { height: 420, position: 'relative' },
  heroPlain: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surfaceSecondary },
  heroDrawing: { flex: 1, marginBottom: 92 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  heroTopRightGroup: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(42,31,26,0.5)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cdcBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  cdcText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  category: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 3, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onBrandPrimary, marginTop: 6, lineHeight: 36 },
  author: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontStyle: 'italic' },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  // Littéral, pas un token de thème : ce texte flotte sur la photo du héros
  // (fond invariant), pas sur la surface de l'app — même discipline déjà
  // appliquée à `author` juste au-dessus.
  authorLevel: { color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' },
  authorAvatar: { width: 22, height: 22, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  authorAvatarText: { fontSize: 11, color: colors.onBrandTertiary, fontFamily: theme.serif },
  photoCredit: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 24, paddingTop: 10,
  },
  photoCreditText: { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  photoCreditLink: { textDecorationLine: 'underline' },
  metaRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 32 },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 10, letterSpacing: 2, color: colors.muted, fontWeight: '600' },
  metaVal: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, marginTop: 4 },
  likeRow: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, gap: 24 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  likeText: { fontSize: 14, color: colors.onSurfaceSecondary, fontWeight: '500' },
  likeError: { color: colors.error, fontSize: 13, paddingHorizontal: 24, paddingTop: 6 },
  description: { fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 22, paddingHorizontal: 24, paddingTop: 16, fontStyle: 'italic' },
  costBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: theme.spacing.md, marginHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg,
  },
  costBtnText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.onSurface },
  costBadge: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  sheet: {
    marginTop: theme.spacing.xl, marginHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg,
  },
  sheetTitle: { fontSize: 10, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: theme.spacing.md },
  // Label and value side by side, the value taking the width it needs: a
  // conservation note runs several lines, a duration one word.
  sheetRow: { flexDirection: 'row', paddingVertical: theme.spacing.sm, gap: theme.spacing.md },
  sheetLabel: { width: 116, fontSize: theme.fontSize.sm, color: colors.muted },
  sheetValue: { flex: 1, fontSize: theme.fontSize.base, color: colors.onSurface, lineHeight: 20 },
  sheetSource: { marginTop: theme.spacing.md, fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  segment: { flexDirection: 'row', marginTop: 24, marginHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 20 },
  segBtn: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segActive: { borderBottomColor: colors.brand },
  segText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  segTextActive: { color: colors.onSurface },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  dot: { width: 6, height: 6, borderRadius: theme.radius.pill, backgroundColor: colors.brand },
  ingredientText: { fontSize: 15, color: colors.onSurface, flex: 1 },
  stepRow: { flexDirection: 'row', marginBottom: 24, gap: 16 },
  stepNum: { fontFamily: theme.serif, fontSize: 24, color: colors.brand, minWidth: 36 },
  stepText: { fontSize: 15, color: colors.onSurface, lineHeight: 22 },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start', backgroundColor: colors.brandTertiary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  timerChipText: { fontSize: 12, color: colors.onBrandTertiary, fontWeight: '600' },
  seqBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, paddingVertical: 12, borderRadius: 8, marginBottom: 24 },
  seqBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '600' },
  noteCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 28 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  noteTitle: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  noteInput: { fontSize: 15, color: colors.onSurface, minHeight: 60, textAlignVertical: 'top' },
  saveNoteBtn: { alignSelf: 'flex-end', marginTop: 10, backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 4 },
  saveNoteText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  commentsTitle: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface, marginBottom: 16 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 8 },
  commentInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: colors.onSurface, minHeight: 44, maxHeight: 120 },
  commentSend: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  commentError: { color: colors.error, fontSize: 13, marginBottom: 16 },
  noComments: { color: colors.muted, fontSize: 14, fontStyle: 'italic' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.brandTertiary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.lg, marginBottom: 10 },
  replyBannerText: { fontSize: 13, color: colors.onBrandTertiary, fontWeight: '500' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  replyBtnText: { fontSize: 12, color: colors.brand, fontWeight: '600' },
  commentActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  sortChip: { paddingHorizontal: 14, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  sortChipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  sortChipText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '500' },
  sortChipTextActive: { color: colors.onSurfaceInverse },
  replyCard: { flexDirection: 'row', gap: 10, marginBottom: 16, marginLeft: 34, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.border },
  replyAvatar: { width: 30, height: 30, borderRadius: 999, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  replyAvatarText: { color: colors.onSurfaceTertiary, fontFamily: theme.serif, fontSize: 14 },
  commentCard: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  commentAvatar: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  commentAvatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif, fontSize: 16 },
  commentName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  commentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  commentBody: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20 },
  editedBadge: { fontSize: 12, color: colors.muted, fontStyle: 'italic' },
  commentHighlighted: { backgroundColor: colors.brandTertiary, borderRadius: 8, padding: 8, margin: -8 },
  replyToLabel: { fontSize: 12, color: colors.brand, fontWeight: '500', marginBottom: 2 },
  toggleRepliesBtn: { marginLeft: 34, marginBottom: 16, marginTop: -6 },
  toggleRepliesText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  commentEditInput: { fontSize: 14, color: colors.onSurface, lineHeight: 20, backgroundColor: colors.surfaceSecondary, borderRadius: 8, padding: 10, minHeight: 44, textAlignVertical: 'top' },
  editActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 },
  editActionBtn: { paddingVertical: 4 },
  editActionText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
});
