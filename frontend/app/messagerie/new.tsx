import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type UserRow = { user_id: string; name: string; picture?: string | null };

/**
 * Petit sélecteur de personnes pour démarrer une conversation — réutilise
 * /users/search tel quel (même endpoint que Amis). Aucune conversation
 * n'est créée ici : ouvrir l'écran chat avec zéro historique est déjà
 * supporté, la vraie vérification d'éligibilité n'a lieu que côté serveur
 * au moment de l'envoi effectif d'un message.
 */
export default function NewMessage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try { setResults(await api(`/users/search?q=${encodeURIComponent(q)}`)); }
      catch (e) { console.warn(e); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const openChat = (u: UserRow) => {
    router.replace({ pathname: `/chat/${u.user_id}` as any, params: { name: u.name } });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="new-message-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Nouveau message</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={18} color={colors.muted} />
        <TextInput
          testID="new-message-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un boulanger par nom…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoFocus
        />
      </View>

      {searching ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={results}
          keyExtractor={u => u.user_id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable testID={`new-message-result-${item.user_id}`} onPress={() => openChat(item)} style={styles.row}>
              <View style={styles.avatar}>
                {avatarUrl(item.picture, API_BASE) ? (
                  <Image source={{ uri: avatarUrl(item.picture, API_BASE) as string }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>{(item.name || '?').slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <Text style={styles.rowName}>{item.name}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim().length >= 2 ? (
              <Text style={styles.emptyText}>Aucun boulanger trouvé pour « {query.trim()} »</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, marginBottom: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif, fontSize: 18 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
});
