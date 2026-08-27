import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { AdSlot } from '@/src/ads';
import { formatDuration } from '@/src/format';
import { recipeImage, recipeImageSource } from '@/src/products';
import { theme } from '@/src/theme';

type Recipe = { id: string; title: string; category: string; image_url: string; image_path?: string | null; product?: string | null; difficulty: string; time_minutes: number; description: string; author_name?: string; is_user_submitted?: boolean };

export default function Home() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setRecipes(await api('/recipes'));
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // L'accueil est la vitrine de l'app : seules les recettes avec une vraie
  // photo (upload communautaire ou photographie du catalogue) y figurent —
  // jamais le dessin générique d'archétype, répété sur des dizaines de
  // recettes, ni la bande de couleur unie faute d'image.
  const withPhoto = recipes.filter(r => r.image_path || r.image_url);
  const featured = withPhoto[0];
  const coupsDeCoeur = withPhoto.filter((r: any) => r.coup_de_coeur);
  const classics = withPhoto.filter(r => !r.is_user_submitted).slice(1, 8);
  const community = withPhoto.filter((r: any) => r.is_user_submitted).slice(0, 6);

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brand} />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={styles.header}>
          <Text style={styles.brandLabel}>BAKERS</Text>
          <Text style={styles.headerTitle}>Bonjour, boulanger</Text>
        </View>

        <Pressable testID="calculator-card" onPress={() => router.push('/calculator')} style={styles.calcCard}>
          <View style={styles.calcIcon}>
            <Feather name="percent" size={20} color={theme.color.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.calcTitle}>Calculateur du boulanger</Text>
            <Text style={styles.calcSub}>Adaptez vos quantités par hydratation</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.muted} />
        </Pressable>

        <Pressable testID="cost-calculator-card" onPress={() => router.push('/cost/new')} style={styles.calcCard}>
          <View style={styles.calcIcon}>
            <Text style={{ fontSize: 18 }}>💰</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.calcTitle}>Coût de revient</Text>
            <Text style={styles.calcSub}>Prix matières, marge, prix de vente</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.muted} />
        </Pressable>

        {featured && (
          <Pressable testID={`hero-recipe-${featured.id}`} onPress={() => router.push(`/recipe/${featured.id}`)} style={styles.hero}>
            {/* Une photo se recadre, un dessin se lit entier ou pas du tout —
                même règle que sur la fiche recette, d'où le `contain` quand
                l'image est une illustration. Les vignettes carrées plus bas
                restent en `cover` : le cercle du dessin y tient déjà. */}
            <Image
              source={recipeImageSource(featured, API_BASE)}
              style={StyleSheet.absoluteFillObject}
              contentFit={recipeImage(featured, API_BASE).kind === 'drawing' ? 'contain' : 'cover'}
            />
            <LinearGradient colors={['transparent', 'rgba(42,31,26,0.9)']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.heroContent}>
              <Text style={styles.heroBadge}>À LA UNE</Text>
              <Text style={styles.heroTitle}>{featured.title}</Text>
              <Text style={styles.heroMeta}>{featured.difficulty} · {formatDuration(featured.time_minutes)}</Text>
            </View>
          </Pressable>
        )}

        {coupsDeCoeur.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.cdcHeaderRow}>
                <Feather name="award" size={18} color={theme.color.brand} />
                <Text style={styles.sectionTitle}>Coups de cœur</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}>
              {coupsDeCoeur.map(r => (
                <Pressable key={r.id} testID={`cdc-${r.id}`} onPress={() => router.push(`/recipe/${r.id}`)} style={styles.classicCard}>
                  <View>
                    <Image source={recipeImageSource(r, API_BASE)} style={styles.classicImage} contentFit="cover" />
                    <View style={styles.cardBadge}><Feather name="award" size={11} color="#fff" /></View>
                  </View>
                  <Text style={styles.classicTitle}>{r.title}</Text>
                  <Text style={styles.classicMeta}>{(r as any).like_count} {"j'aime"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Between two sections, in the flow of the scroll: nothing to dismiss,
            nothing covered. Renders nothing at all for a Pro user. */}
        <AdSlot placement="home" />

        {classics.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Grands classiques</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}>
              {classics.map(r => (
                <Pressable key={r.id} testID={`classic-${r.id}`} onPress={() => router.push(`/recipe/${r.id}`)} style={styles.classicCard}>
                  <Image source={recipeImageSource(r, API_BASE)} style={styles.classicImage} contentFit="cover" />
                  <Text style={styles.classicTitle}>{r.title}</Text>
                  <Text style={styles.classicMeta}>{r.difficulty} · {(r as any).like_count} {"j'aime"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {community.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recettes de la communauté</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}>
              {community.map(r => (
                <Pressable key={r.id} testID={`community-${r.id}`} onPress={() => router.push(`/recipe/${r.id}`)} style={styles.classicCard}>
                  <View>
                    <Image source={recipeImageSource(r, API_BASE)} style={styles.classicImage} contentFit="cover" />
                    {(r as any).coup_de_coeur && <View style={styles.cardBadge}><Feather name="award" size={11} color="#fff" /></View>}
                  </View>
                  <Text style={styles.classicTitle}>{r.title}</Text>
                  <Text style={styles.classicMeta}>par {r.author_name || 'Anonyme'} · {(r as any).like_count} {"j'aime"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  brandLabel: { fontSize: 11, letterSpacing: 4, color: theme.color.muted, fontWeight: '500' },
  headerTitle: { fontFamily: theme.serif, fontSize: 32, color: theme.color.onSurface, marginTop: 4 },
  calcCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 8, padding: 16, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, gap: 14 },
  calcIcon: { width: 40, height: 40, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  calcTitle: { fontSize: 15, fontWeight: '600', color: theme.color.onSurface },
  calcSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  hero: { height: 380, marginHorizontal: 24, position: 'relative', overflow: 'hidden', borderRadius: 4, backgroundColor: theme.color.surfaceSecondary },
  heroContent: { position: 'absolute', bottom: 20, left: 20, right: 20 },
  heroBadge: { color: theme.color.brandSecondary, fontSize: 10, letterSpacing: 3, fontWeight: '600', marginBottom: 6 },
  heroTitle: { fontFamily: theme.serif, fontSize: 28, color: '#fff', lineHeight: 32 },
  heroMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },
  section: { marginTop: 40 },
  cdcHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBadge: { position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { paddingHorizontal: 24, marginBottom: 16 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 24, color: theme.color.onSurface },
  classicCard: { width: 180 },
  classicImage: { width: 180, height: 180, borderRadius: 4, backgroundColor: theme.color.surfaceSecondary },
  classicTitle: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginTop: 10 },
  classicMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
});
