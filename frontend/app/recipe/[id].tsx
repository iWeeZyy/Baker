import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { theme } from '@/src/theme';

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<any>(null);
  const [tab, setTab] = useState<'ingredients' | 'steps'>('ingredients');
  const [favorited, setFavorited] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/recipes/${id}`);
        setRecipe(r);
        try { const f = await api(`/recipes/${id}/favorite`); setFavorited(f.favorited); } catch {}
      } finally { setLoading(false); }
    })();
  }, [id]);

  const toggleFav = async () => {
    try { const res = await api(`/recipes/${id}/favorite`, { method: 'POST' }); setFavorited(res.favorited); } catch {}
  };

  if (loading || !recipe) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  const imgUri = recipe.image_path ? `${API_BASE}/files/${recipe.image_path}` : recipe.image_url;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: imgUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient colors={['rgba(42,31,26,0.4)', 'transparent', 'rgba(42,31,26,0.7)']} style={StyleSheet.absoluteFillObject} />
          <SafeAreaView edges={['top']} style={styles.heroTop}>
            <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Pressable testID="fav-btn" onPress={toggleFav} style={styles.iconBtn}>
              <Feather name={favorited ? 'bookmark' : 'bookmark'} size={20} color={favorited ? theme.color.brandSecondary : '#fff'} />
            </Pressable>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <Text style={styles.category}>{recipe.category.toUpperCase()}</Text>
            <Text style={styles.title}>{recipe.title}</Text>
            {recipe.author_name && <Text style={styles.author}>par {recipe.author_name}</Text>}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>DIFFICULTÉ</Text><Text style={styles.metaVal}>{recipe.difficulty}</Text></View>
          <View style={styles.metaCol}><Text style={styles.metaLabel}>TEMPS</Text><Text style={styles.metaVal}>{recipe.time_minutes} min</Text></View>
          {recipe.hydration > 0 && <View style={styles.metaCol}><Text style={styles.metaLabel}>HYDRATATION</Text><Text style={styles.metaVal}>{recipe.hydration}%</Text></View>}
        </View>

        <Text style={styles.description}>{recipe.description}</Text>

        <View style={styles.segment}>
          <Pressable testID="segment-ingredients" onPress={() => setTab('ingredients')} style={[styles.segBtn, tab === 'ingredients' && styles.segActive]}>
            <Text style={[styles.segText, tab === 'ingredients' && styles.segTextActive]}>Ingrédients</Text>
          </Pressable>
          <Pressable testID="segment-steps" onPress={() => setTab('steps')} style={[styles.segBtn, tab === 'steps' && styles.segActive]}>
            <Text style={[styles.segText, tab === 'steps' && styles.segTextActive]}>Préparation</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          {tab === 'ingredients' ? (
            recipe.ingredients.map((ing: string, i: number) => (
              <View key={i} style={styles.ingredientRow} testID={`ing-${i}`}>
                <View style={styles.dot} />
                <Text style={styles.ingredientText}>{ing}</Text>
              </View>
            ))
          ) : (
            recipe.steps.map((s: string, i: number) => (
              <View key={i} style={styles.stepRow} testID={`step-${i}`}>
                <Text style={styles.stepNum}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
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
  category: { color: theme.color.brandSecondary, fontSize: 11, letterSpacing: 3, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: '#fff', marginTop: 6, lineHeight: 36 },
  author: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 32 },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '600' },
  metaVal: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, marginTop: 4 },
  description: { fontSize: 15, color: theme.color.onSurfaceSecondary, lineHeight: 22, paddingHorizontal: 24, paddingTop: 20, fontStyle: 'italic' },
  segment: { flexDirection: 'row', marginTop: 24, marginHorizontal: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 24 },
  segBtn: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segActive: { borderBottomColor: theme.color.brand },
  segText: { fontSize: 15, color: theme.color.muted, fontWeight: '500' },
  segTextActive: { color: theme.color.onSurface },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color.brand },
  ingredientText: { fontSize: 15, color: theme.color.onSurface, flex: 1 },
  stepRow: { flexDirection: 'row', marginBottom: 24, gap: 16 },
  stepNum: { fontFamily: theme.serif, fontSize: 24, color: theme.color.brand, minWidth: 36 },
  stepText: { fontSize: 15, color: theme.color.onSurface, lineHeight: 22, flex: 1 },
});
