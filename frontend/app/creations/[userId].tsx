import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { EmptyState } from '@/src/EmptyState';

type CreationStub = { id: string; title: string; category: string; photos: string[]; like_count: number };

export default function CreationsGallery() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<CreationStub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/users/${userId}/profile`)
      .then(d => setItems(d.creations || []))
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [userId]);

  const isMine = user?.user_id === userId;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="gallery-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isMine ? 'Mes créations' : 'Créations'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={c => c.id}
          numColumns={3}
          columnWrapperStyle={{ gap: 8, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 8, paddingVertical: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable testID={`gallery-creation-${item.id}`} onPress={() => router.push(`/creation/${item.id}` as any)} style={styles.tile}>
              <Image source={{ uri: `${API_BASE}/files/${item.photos[0]}` }} style={styles.tileImage} contentFit="cover" />
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState icon="grid" title="Aucune création" />}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface },
  tile: { flex: 1, aspectRatio: 1, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  tileImage: { width: '100%', height: '100%' },
});
