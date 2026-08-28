import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type UserRow = { user_id: string; name: string; picture?: string | null; profession?: string | null; team_status?: string };

export default function AddTeamMember() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const Avatar = ({ user, size = 44 }: { user: UserRow; size?: number }) => {
    const uri = avatarUrl(user.picture, API_BASE);
    return (
      <View style={[styles.avatar, { width: size, height: size }]}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{(user.name || '?').slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
    );
  };

  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const invite = async (u: UserRow) => {
    const ok = await confirmAsync(
      'Envoyer une invitation à la Team ?',
      `${u.name} devra l'accepter avant d'apparaître dans votre Team.`,
      'Envoyer',
    );
    if (!ok) return;
    setBusyId(u.user_id);
    try {
      const res = await api('/team/invite', { method: 'POST', body: JSON.stringify({ user_id: u.user_id }) });
      setResults(prev => prev.map(r => r.user_id === u.user_id ? { ...r, team_status: res.status === 'team' ? 'team' : 'pending_sent' } : r));
    } catch (e) { console.warn(e); }
    finally { setBusyId(null); }
  };

  const acceptDirect = async (u: UserRow) => {
    setBusyId(u.user_id);
    try {
      const invites = await api('/team/invites');
      const inv = invites.find((i: any) => i.from_user.user_id === u.user_id);
      if (inv) {
        await api(`/team/invites/${inv.id}/respond`, { method: 'POST', body: JSON.stringify({ accept: true }) });
        setResults(prev => prev.map(r => r.user_id === u.user_id ? { ...r, team_status: 'team' } : r));
      }
    } catch (e) { console.warn(e); }
    finally { setBusyId(null); }
  };

  const Action = ({ u }: { u: UserRow }) => {
    if (u.team_status === 'team') return <Feather name="check-circle" size={20} color={colors.success} />;
    if (u.team_status === 'pending_sent') return <Text style={styles.pendingText}>Envoyée</Text>;
    if (busyId === u.user_id) return <ActivityIndicator size="small" color={colors.brand} />;
    return (
      <Pressable
        testID={`team-add-${u.user_id}`}
        onPress={() => (u.team_status === 'pending_received' ? acceptDirect(u) : invite(u))}
        style={styles.addBtn}
      >
        <Feather name="user-plus" size={15} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>{u.team_status === 'pending_received' ? 'Accepter' : 'Ajouter'}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="team-add-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Ajouter à ma Team</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={18} color={colors.muted} />
        <TextInput
          testID="team-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher par nom ou profession…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <Pressable testID="team-clear-search" onPress={() => setQuery('')}>
            <Feather name="x" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {query.trim().length < 2 ? (
          <Text style={styles.hint}>Recherchez un collègue par son nom ou sa profession.</Text>
        ) : searching ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : results.length === 0 ? (
          <Text style={styles.hint}>Aucun boulanger trouvé pour « {query.trim()} »</Text>
        ) : results.map(u => (
          <View key={u.user_id} style={styles.row} testID={`team-search-result-${u.user_id}`}>
            <View style={styles.rowLeft}>
              <Avatar user={u} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{u.name}</Text>
                {!!u.profession && <Text style={styles.rowSub}>{u.profession}</Text>}
              </View>
            </View>
            <Action u={u} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  avatar: { borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  pendingText: { fontSize: 13, color: colors.muted, fontStyle: 'italic' },
});
