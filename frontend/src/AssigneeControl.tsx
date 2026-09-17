import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { API_BASE } from '@/src/api';
import { avatarUrl } from '@/src/avatar';
import { ActionSheet, type ActionSheetOption } from '@/src/ActionSheet';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import type { OrgMember } from '@/src/useOrgMembers';

/**
 * Qui fait cette étape — un chip "+ Assigner" (personne non assignée) ou un
 * avatar + nom (assigné, tap pour réassigner/désassigner) au-dessus d'une
 * carte d'étape. Partagé entre `production/[id].tsx` (Déroulé) et
 * `app/fournil/[id].tsx` (Mode Fournil) : même `ActionSheet` de choix, même
 * appel à `patchStep(stepId, { assignee_user_id })`, jamais deux
 * implémentations qui pourraient diverger.
 *
 * N'est jamais rendu quand `members` est vide — l'appelant décide déjà de
 * ça (hors organisation, l'attribution n'a pas de sens), donc ce composant
 * ne teste pas lui-même `members.length`.
 */
export function AssigneeControl({
  assigneeUserId,
  members,
  busy,
  onChange,
  size = 'default',
}: {
  assigneeUserId: string | null;
  members: OrgMember[];
  busy?: boolean;
  onChange: (userId: string | null) => void;
  size?: 'default' | 'large';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, size), [colors, size]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const assignee = members.find(m => m.user_id === assigneeUserId) || null;

  const options: ActionSheetOption[] = [
    ...members
      .filter(m => m.user_id !== assigneeUserId)
      .map(m => ({ key: m.user_id, icon: 'user' as const, label: m.name, onPress: () => onChange(m.user_id) })),
    ...(assignee ? [{ key: 'unassign', icon: 'x-circle' as const, label: 'Désassigner', onPress: () => onChange(null), destructive: true }] : []),
  ];

  return (
    <>
      <Pressable
        testID="assignee-control"
        onPress={() => setSheetOpen(true)}
        disabled={busy}
        style={[styles.chip, assignee && styles.chipAssigned]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : assignee ? (
          <>
            <Avatar member={assignee} size={size === 'large' ? 24 : 18} colors={colors} />
            <Text style={styles.chipText} numberOfLines={1}>{assignee.name}</Text>
          </>
        ) : (
          <>
            <Feather name="user-plus" size={size === 'large' ? 16 : 13} color={colors.muted} />
            <Text style={styles.chipTextMuted}>Assigner</Text>
          </>
        )}
      </Pressable>
      <ActionSheet
        visible={sheetOpen}
        title="Attribuer cette étape"
        options={options}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

function Avatar({ member, size, colors }: { member: OrgMember; size: number; colors: ThemeColors }) {
  const uri = avatarUrl(member.picture, API_BASE);
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <Text style={{ color: colors.onBrandTertiary, fontSize: size * 0.55, fontWeight: '700' }}>
          {(member.name || '?').slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors, size: 'default' | 'large') => StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: size === 'large' ? 14 : 10, paddingVertical: size === 'large' ? 8 : 5,
    borderRadius: theme.radius.pill,
  },
  chipAssigned: { borderColor: colors.brandTertiary },
  chipText: { fontSize: size === 'large' ? 13 : 11, color: colors.onSurface, fontWeight: '600', maxWidth: 120 },
  chipTextMuted: { fontSize: size === 'large' ? 13 : 11, color: colors.muted, fontWeight: '600' },
});
