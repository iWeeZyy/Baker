import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api, API_BASE } from '@/src/api';
import { useAuth } from '@/src/auth';
import { avatarUrl } from '@/src/avatar';
import { confirmAsync } from '@/src/confirm';
import { useEntitlements } from '@/src/entitlements';
import { LockedFeatureNotice } from '@/src/PlanChip';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { EmptyState } from '@/src/EmptyState';

type OrgRow = { org_id: string; name: string; role: string; active: boolean };
type Member = { user_id: string; name: string; picture?: string | null; role: string; shop_ids: string[]; joined_at: string };
type Invite = { id: string; org_id: string; org_name: string; role: string; from_user_id: string; from_user_name: string; created_at: string };

const ROLE_LABELS: Record<string, string> = { owner: 'Propriétaire', manager: 'Responsable', employee: 'Employé' };

/**
 * Écran unique pour toute la gestion d'organisation (offre Équipe) : créer,
 * basculer, inviter, gérer le roster, répondre aux invitations reçues.
 * Reste hors-`(tabs)`, même convention que `pro.tsx`/`classement.tsx` —
 * reste utile même sans organisation (invitations reçues, création), donc
 * pas caché derrière un contexte d'organisation déjà actif.
 */
export default function OrganisationScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { can } = useEntitlements();
  const { user } = useAuth();

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState('');
  const [newShopName, setNewShopName] = useState('');
  const [creating, setCreating] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'employee'>('employee');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const activeRole = orgs.find(o => o.active)?.role || null;
  const activeName = orgs.find(o => o.active)?.name || null;

  const load = useCallback(async () => {
    try {
      const [mine, incoming] = await Promise.all([
        api('/organisations/me'),
        api('/organisations/invites'),
      ]);
      setOrgs(mine.organisations || []);
      setActiveOrgId(mine.active_org_id || null);
      setInvites(incoming || []);
      if (mine.active_org_id) {
        try { setMembers(await api('/organisations/members')); }
        catch { setMembers([]); }
      } else {
        setMembers([]);
      }
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createOrganisation = async () => {
    const name = newOrgName.trim();
    if (!name) { setError('Le nom de l’organisation est obligatoire.'); return; }
    setCreating(true);
    setError(null);
    try {
      await api('/organisations', { method: 'POST', body: JSON.stringify({ name, shop_name: newShopName.trim() || undefined }) });
      setNewOrgName('');
      setNewShopName('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Création impossible');
    } finally {
      setCreating(false);
    }
  };

  const activate = async (orgId: string) => {
    if (orgId === activeOrgId) return;
    setBusyOrgId(orgId);
    try {
      const res = await api(`/organisations/${orgId}/activate`, { method: 'POST' });
      setOrgs(res.organisations || []);
      setActiveOrgId(res.active_org_id || null);
      try { setMembers(await api('/organisations/members')); } catch { setMembers([]); }
    } catch (e: any) {
      setError(e.message || 'Bascule impossible');
    } finally {
      setBusyOrgId(null);
    }
  };

  const respondInvite = async (invite: Invite, accept: boolean) => {
    setBusyInviteId(invite.id);
    try {
      await api(`/organisations/invites/${invite.id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
      await load();
    } catch (e: any) {
      setError(e.message || 'Réponse impossible');
    } finally {
      setBusyInviteId(null);
    }
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) { setInviteMessage('Indiquez une adresse e-mail.'); return; }
    setInviting(true);
    setInviteMessage(null);
    try {
      const res = await api('/organisations/invites', { method: 'POST', body: JSON.stringify({ email, role: inviteRole }) });
      setInviteEmail('');
      setInviteMessage(res.status === 'pending_sent' ? 'Une invitation était déjà en attente pour cette personne.' : 'Invitation envoyée.');
    } catch (e: any) {
      setInviteMessage(e.message || 'Envoi impossible');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (member: Member, role: 'manager' | 'employee') => {
    if (member.role === role) return;
    setBusyMemberId(member.user_id);
    try {
      await api(`/organisations/members/${member.user_id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
      await load();
    } catch (e: any) {
      setError(e.message || 'Changement de rôle impossible');
    } finally {
      setBusyMemberId(null);
    }
  };

  const removeMember = async (member: Member, isSelf: boolean) => {
    const ok = await confirmAsync(
      isSelf ? 'Quitter cette organisation ?' : `Retirer ${member.name} ?`,
      isSelf ? 'Vous perdrez l’accès aux données partagées de cette organisation.' : 'Cette personne perdra l’accès aux données partagées.',
      isSelf ? 'Quitter' : 'Retirer',
      true,
    );
    if (!ok) return;
    setBusyMemberId(member.user_id);
    try {
      await api(`/organisations/members/${member.user_id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message || 'Retrait impossible');
    } finally {
      setBusyMemberId(null);
    }
  };

  const Avatar = ({ m }: { m: Member }) => {
    const uri = avatarUrl(m.picture, API_BASE);
    return (
      <View style={styles.avatar}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          : <Text style={styles.avatarText}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>}
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="org-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Organisation</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {error && <Text style={styles.error} testID="org-error">{error}</Text>}

        {invites.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>INVITATIONS REÇUES</Text>
            {invites.map(inv => (
              <View key={inv.id} style={styles.inviteCard} testID={`org-invite-${inv.id}`}>
                <Text style={styles.cardTitle}>{inv.org_name}</Text>
                <Text style={styles.cardSub}>
                  {inv.from_user_name} vous invite en tant que {ROLE_LABELS[inv.role] || inv.role}
                </Text>
                {busyInviteId === inv.id ? (
                  <ActivityIndicator color={colors.brand} style={{ marginTop: 10 }} />
                ) : (
                  <View style={styles.inviteActions}>
                    <Pressable testID={`org-invite-${inv.id}-accept`} onPress={() => respondInvite(inv, true)} style={styles.acceptBtn}>
                      <Text style={styles.acceptBtnText}>Accepter</Text>
                    </Pressable>
                    <Pressable testID={`org-invite-${inv.id}-decline`} onPress={() => respondInvite(inv, false)} style={styles.declineBtn}>
                      <Text style={styles.declineBtnText}>Refuser</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>MES ORGANISATIONS</Text>
        {orgs.length === 0 ? (
          <EmptyState icon="briefcase" title="Aucune organisation" subtitle="Créez-en une, ou attendez une invitation." />
        ) : (
          orgs.map(o => (
            <Pressable
              key={o.org_id}
              testID={`org-row-${o.org_id}`}
              onPress={() => activate(o.org_id)}
              style={[styles.card, o.active && styles.cardActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{o.name}</Text>
                <Text style={styles.cardSub}>{ROLE_LABELS[o.role] || o.role}</Text>
              </View>
              {busyOrgId === o.org_id ? (
                <ActivityIndicator color={colors.brand} />
              ) : o.active ? (
                <Feather name="check-circle" size={20} color={colors.brand} />
              ) : (
                <Text style={styles.switchText}>Activer</Text>
              )}
            </Pressable>
          ))
        )}

        {activeOrgId && (
          <>
            <Text style={styles.sectionLabel}>MEMBRES DE {(activeName || '').toUpperCase()}</Text>
            {members.map(m => {
              const isSelf = m.user_id === user?.user_id;
              // Retirer quelqu'un d'autre : réservé à owner/manager. Se
              // retirer soi-même : toujours possible, sauf pour le
              // propriétaire (server.py refuse déjà ce cas explicitement).
              const canRemove = m.role !== 'owner' && (isSelf || activeRole === 'owner' || activeRole === 'manager');
              return (
                <View key={m.user_id} style={styles.memberRow} testID={`org-member-${m.user_id}`}>
                  <Avatar m={m} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name}{isSelf ? ' (vous)' : ''}</Text>
                    <Text style={styles.cardSub}>{ROLE_LABELS[m.role] || m.role}</Text>
                  </View>
                  {busyMemberId === m.user_id ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {activeRole === 'owner' && m.role !== 'owner' && !isSelf && (
                        <Pressable
                          testID={`org-member-${m.user_id}-role`}
                          onPress={() => changeRole(m, m.role === 'manager' ? 'employee' : 'manager')}
                          style={styles.roleToggle}
                        >
                          <Text style={styles.roleToggleText}>{m.role === 'manager' ? 'Rendre employé' : 'Rendre responsable'}</Text>
                        </Pressable>
                      )}
                      {canRemove && (
                        <Pressable testID={`org-member-${m.user_id}-remove`} onPress={() => removeMember(m, isSelf)}>
                          <Feather name={isSelf ? 'log-out' : 'user-minus'} size={18} color={colors.error} />
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {(activeRole === 'owner' || activeRole === 'manager') && (
              <View style={styles.inviteBox}>
                <Text style={styles.inviteBoxLabel}>Inviter un collègue</Text>
                <TextInput
                  testID="org-invite-email"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="adresse@e-mail.com"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                />
                <View style={styles.roleChips}>
                  {(activeRole === 'owner' ? (['manager', 'employee'] as const) : (['employee'] as const)).map(r => (
                    <Pressable
                      key={r}
                      testID={`org-invite-role-${r}`}
                      onPress={() => setInviteRole(r)}
                      style={[styles.roleChip, inviteRole === r && styles.roleChipOn]}
                    >
                      <Text style={[styles.roleChipText, inviteRole === r && styles.roleChipTextOn]}>{ROLE_LABELS[r]}</Text>
                    </Pressable>
                  ))}
                </View>
                {inviteMessage && <Text style={styles.inviteMessage}>{inviteMessage}</Text>}
                <Pressable testID="org-invite-send" onPress={sendInvite} disabled={inviting} style={[styles.primaryBtn, inviting && { opacity: 0.6 }]}>
                  {inviting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Envoyer l&apos;invitation</Text>}
                </Pressable>
              </View>
            )}
          </>
        )}

        <Text style={styles.sectionLabel}>CRÉER UNE ORGANISATION</Text>
        {!can('org_team') ? (
          <LockedFeatureNotice
            minPlan="team"
            label="Créer une organisation est réservé à l'offre Équipe"
            onPress={() => router.push('/pro?feature=org_team' as any)}
          />
        ) : (
          <View style={styles.inviteBox}>
            <TextInput
              testID="org-new-name"
              value={newOrgName}
              onChangeText={setNewOrgName}
              placeholder="Nom de l'organisation"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              testID="org-new-shop"
              value={newShopName}
              onChangeText={setNewShopName}
              placeholder="Nom de la boutique (optionnel)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { marginTop: 8 }]}
            />
            <Pressable testID="org-create" onPress={createOrganisation} disabled={creating} style={[styles.primaryBtn, creating && { opacity: 0.6 }]}>
              {creating ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Créer</Text>}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: colors.onSurface },
  body: { padding: 24, paddingBottom: 60 },
  error: { color: colors.error, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginTop: 22, marginBottom: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 14, marginBottom: 10,
  },
  inviteCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 14, marginBottom: 10,
  },
  cardActive: { borderWidth: 1, borderColor: colors.brand },
  cardTitle: { fontFamily: theme.serif, fontSize: 16, color: colors.onSurface },
  cardSub: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
  switchText: { fontSize: 13, color: colors.brand, fontWeight: '600' },
  inviteActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  acceptBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: theme.radius.md, backgroundColor: colors.brand },
  acceptBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  declineBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: theme.radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  declineBtnText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  memberName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  avatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.onBrandTertiary, fontFamily: theme.serif },
  roleToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary },
  roleToggleText: { fontSize: 11, color: colors.onSurfaceSecondary, fontWeight: '600' },
  inviteBox: { backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16, marginTop: 12 },
  inviteBoxLabel: { fontSize: 13, fontWeight: '600', color: colors.onSurface, marginBottom: 10 },
  input: { fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface, borderRadius: theme.radius.md, paddingVertical: 11, paddingHorizontal: 12 },
  roleChips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  roleChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  roleChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleChipText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '600' },
  roleChipTextOn: { color: colors.onBrandPrimary },
  inviteMessage: { fontSize: 12, color: colors.muted, marginTop: 10 },
  primaryBtn: { alignItems: 'center', paddingVertical: 13, borderRadius: theme.radius.md, backgroundColor: colors.brand, marginTop: 12 },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },
});
