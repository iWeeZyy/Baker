import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { ActionSheet } from '@/src/ActionSheet';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { EmptyState } from '@/src/EmptyState';

const ROLE_OPTIONS = ['Boulanger', 'Pâtissier', 'Apprenti', 'Responsable', 'Chef', 'Tourier', 'Chocolatier', 'Traiteur', 'Autre'];

type Member = { user_id: string; name: string; picture?: string | null; role: string | null; since: string };

export default function TeamList() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isMine = user?.user_id === userId;

  const [members, setMembers] = useState<Member[]>([]);
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<Member | null>(null);
  const [roleFor, setRoleFor] = useState<Member | null>(null);
  const debounceRef = useRef<any>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await api(`/users/${userId}/team${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setMembers(res.members);
      setVisible(res.visible);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(''); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query.trim()), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || members.length === 0 || query.trim()) return;
    setLoadingMore(true);
    try {
      const before = encodeURIComponent(members[members.length - 1].since);
      const res = await api(`/users/${userId}/team?before=${before}`);
      setMembers(prev => [...prev, ...res.members]);
      setHasMore(res.has_more);
    } catch (e) { console.warn(e); }
    finally { setLoadingMore(false); }
  };

  const removeMember = async (m: Member) => {
    const ok = await confirmAsync('Retirer cette personne de votre Team ?', `${m.name} ne fera plus partie de votre Team.`, 'Retirer', true);
    if (!ok) return;
    try {
      await api(`/team/members/${m.user_id}`, { method: 'DELETE' });
      setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    } catch (e) { console.warn(e); }
  };

  const setRole = async (role: string) => {
    if (!roleFor) return;
    const target = roleFor;
    setRoleFor(null);
    try {
      await api(`/team/members/${target.user_id}`, { method: 'PUT', body: JSON.stringify({ role }) });
      setMembers(prev => prev.map(x => x.user_id === target.user_id ? { ...x, role } : x));
    } catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="team-list-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isMine ? 'Ma Team' : 'Team'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {visible && (
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            testID="team-list-search"
            value={query}
            onChangeText={setQuery}
            placeholder={isMine ? 'Rechercher dans ma Team' : 'Rechercher un membre'}
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
        </View>
      )}

      {!visible ? (
        <EmptyState icon="lock" title="Cette Team est privée" />
      ) : loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : members.length === 0 ? (
        <EmptyState
          icon="users"
          title={query.trim() ? 'Aucun membre trouvé' : isMine ? 'Votre Team est vide' : 'Cette Team est vide'}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={members}
          keyExtractor={m => m.user_id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}
          renderItem={({ item }) => (
            <Pressable testID={`team-list-member-${item.user_id}`} onPress={() => router.push(`/baker/${item.user_id}` as any)} style={styles.row}>
              <View style={styles.avatar}>
                {avatarUrl(item.picture, API_BASE) ? (
                  <Image source={{ uri: avatarUrl(item.picture, API_BASE) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>{(item.name || '?').slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                {!!item.role && <Text style={styles.rowRole}>{item.role}</Text>}
              </View>
              {isMine && (
                <Pressable testID={`team-list-menu-${item.user_id}`} onPress={() => setMenuFor(item)} style={styles.menuBtn}>
                  <Feather name="more-horizontal" size={20} color={colors.muted} />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}

      <ActionSheet
        visible={!!menuFor}
        title={menuFor?.name || ''}
        onClose={() => setMenuFor(null)}
        options={menuFor ? [
          { key: 'role', icon: 'tag', label: 'Modifier le rôle', onPress: () => setRoleFor(menuFor) },
          { key: 'remove', icon: 'trash-2', label: 'Retirer de ma Team', onPress: () => removeMember(menuFor), destructive: true },
        ] : []}
      />
      <ActionSheet
        visible={!!roleFor}
        title="Rôle dans la Team"
        onClose={() => setRoleFor(null)}
        options={ROLE_OPTIONS.map(r => ({ key: r, icon: 'tag', label: r, onPress: () => setRole(r) }))}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 18, color: colors.onBrandTertiary, fontFamily: theme.serif },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowRole: { fontSize: 12, color: colors.muted, marginTop: 2 },
  menuBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
