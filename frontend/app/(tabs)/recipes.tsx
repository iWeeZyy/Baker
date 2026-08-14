import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const CATEGORIES = ['Tous', 'Pains', 'Viennoiseries', 'Pâtisseries'];

export default function Recipes() {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [category, setCategory] = useState('Tous');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    const q = category === 'Tous' ? '' : `?category=${encodeURIComponent(category)}`;
    api(`/recipes${q}`).then(setRecipes).catch(console.warn).finally(() => setLoading(false));
  }, [category]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.stickyHeader}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandLabel}>LA BIBLIOTHÈQUE</Text>
            <Text style={styles.title}>Recettes</Text>
          </View>
          <Pressable testID="share-recipe-btn" onPress={() => router.push('/share')} style={styles.shareBtn}>
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {CATEGORIES.map(c => (
            <Pressable
              key={c}
              testID={`chip-${c}`}
              onPress={() => setCategory(c)}
              style={[styles.chip, category === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(r) => r.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 16, paddingHorizontal: 24 }}
          contentContainerStyle={{ gap: 24, paddingVertical: 20, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`recipe-card-${item.id}`}
              onPress={() => router.push(`/recipe/${item.id}`)}
              style={styles.card}
            >
              <Image source={{ uri: item.image_url || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600' }} style={styles.cardImage} contentFit="cover" />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.difficulty} · {item.time_minutes} min</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Aucune recette dans cette catégorie.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stickyHeader: { backgroundColor: theme.color.surface, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, marginBottom: 20 },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: theme.color.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 32, color: theme.color.onSurface, marginTop: 4 },
  shareBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  chipsRow: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.surfaceInverse, borderColor: theme.color.surfaceInverse },
  chipText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTextActive: { color: theme.color.onSurfaceInverse },
  card: { flex: 1 },
  cardImage: { width: '100%', aspectRatio: 1, borderRadius: 4 },
  cardTitle: { fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.color.muted, marginTop: 60 },
});
