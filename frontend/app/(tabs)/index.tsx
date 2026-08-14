import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Recipe = { id: string; title: string; category: string; image_url: string; difficulty: string; time_minutes: number; description: string; author_name?: string };
type Tip = { id: string; title: string; category: string; content: string; icon: string };

export default function Home() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([api('/recipes'), api('/tips')]);
      setRecipes(r);
      setTips(t);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const featured = recipes[0];
  const classics = recipes.filter(r => !r.is_user_submitted).slice(1, 8);
  const community = recipes.filter((r: any) => r.is_user_submitted).slice(0, 6);

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

        {featured && (
          <Pressable testID={`hero-recipe-${featured.id}`} onPress={() => router.push(`/recipe/${featured.id}`)} style={styles.hero}>
            <Image source={{ uri: featured.image_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            <LinearGradient colors={['transparent', 'rgba(42,31,26,0.9)']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.heroContent}>
              <Text style={styles.heroBadge}>À LA UNE</Text>
              <Text style={styles.heroTitle}>{featured.title}</Text>
              <Text style={styles.heroMeta}>{featured.difficulty} · {featured.time_minutes} min</Text>
            </View>
          </Pressable>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Astuces du jour</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
            {tips.slice(0, 6).map(t => (
              <View key={t.id} style={styles.tipCard} testID={`tip-${t.id}`}>
                <View style={styles.tipIcon}><Feather name={(t.icon as any) || 'star'} size={16} color={theme.color.brand} /></View>
                <Text style={styles.tipCat}>{t.category.toUpperCase()}</Text>
                <Text style={styles.tipTitle}>{t.title}</Text>
                <Text style={styles.tipBody} numberOfLines={4}>{t.content}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Grands classiques</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}>
            {classics.map(r => (
              <Pressable key={r.id} testID={`classic-${r.id}`} onPress={() => router.push(`/recipe/${r.id}`)} style={styles.classicCard}>
                <Image source={{ uri: r.image_url }} style={styles.classicImage} contentFit="cover" />
                <Text style={styles.classicTitle}>{r.title}</Text>
                <Text style={styles.classicMeta}>{r.difficulty}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {community.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recettes de la communauté</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}>
              {community.map(r => (
                <Pressable key={r.id} testID={`community-${r.id}`} onPress={() => router.push(`/recipe/${r.id}`)} style={styles.classicCard}>
                  <Image source={{ uri: r.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600' }} style={styles.classicImage} contentFit="cover" />
                  <Text style={styles.classicTitle}>{r.title}</Text>
                  <Text style={styles.classicMeta}>par {r.author_name || 'Anonyme'}</Text>
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
  hero: { height: 380, marginHorizontal: 24, position: 'relative', overflow: 'hidden', borderRadius: 4 },
  heroContent: { position: 'absolute', bottom: 20, left: 20, right: 20 },
  heroBadge: { color: theme.color.brandSecondary, fontSize: 10, letterSpacing: 3, fontWeight: '600', marginBottom: 6 },
  heroTitle: { fontFamily: theme.serif, fontSize: 28, color: '#fff', lineHeight: 32 },
  heroMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },
  section: { marginTop: 40 },
  sectionHeader: { paddingHorizontal: 24, marginBottom: 16 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 24, color: theme.color.onSurface },
  tipCard: { width: 260, padding: 20, backgroundColor: theme.color.surfaceSecondary, borderRadius: 4 },
  tipIcon: { width: 32, height: 32, borderRadius: 999, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  tipCat: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  tipTitle: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginTop: 6, marginBottom: 8 },
  tipBody: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
  classicCard: { width: 180 },
  classicImage: { width: 180, height: 180, borderRadius: 4 },
  classicTitle: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginTop: 10 },
  classicMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
});
