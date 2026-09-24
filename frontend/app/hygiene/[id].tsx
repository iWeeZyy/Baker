import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  HYGIENE_CATEGORIES, HYGIENE_FICHES, HYGIENE_SOURCE_NAME, HYGIENE_SOURCE_URL,
  type HygieneDocKind, type HygieneFile,
} from '@/src/hygiene/fiches';
import { openFicheFile, printFicheFile, shareFicheFile, type DocActionResult } from '@/src/hygiene/documentActions';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const DOC_KIND_LABEL: Record<HygieneDocKind, string> = {
  fiche: 'Fiche pratique',
  registre: 'Registre',
  plan: 'Plan',
  checklist: 'Checklist',
  protocole: 'Protocole',
  affiche: 'Affiche',
  reglementaire: 'Document réglementaire',
};

const CATEGORY_ICON_BY_KEY: Record<string, keyof typeof Feather.glyphMap> = {
  temperatures: 'thermometer', nettoyage: 'droplet', reception: 'truck', allergenes: 'alert-octagon',
  personnel: 'user', nonconformites: 'alert-triangle', pilotage: 'clipboard', bonnespratiques: 'check-circle',
  reglementaire: 'file-text',
};

type ActionKey = `${string}-open` | `${string}-share` | `${string}-print`;

/**
 * Une fiche HACCP : ses informations, puis pour chaque fichier disponible
 * (PDF et/ou Excel), les actions réellement possibles pour ce format —
 * jamais un bouton "Imprimer" sur un Excel, qui n'a pas de mise en page
 * imprimable sans tableur.
 */
export default function HygieneDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const fiche = useMemo(() => HYGIENE_FICHES.find(f => f.id === id) || null, [id]);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: ActionKey, action: () => Promise<DocActionResult>) => {
    setFlash(null);
    setError(null);
    setBusy(key);
    try {
      const res = await action();
      if (res.ok) {
        if (res.message) setFlash(res.message);
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(null);
    }
  };

  if (!fiche) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable testID="hygiene-detail-back" onPress={() => router.back()} style={styles.iconBtn}>
            <Feather name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Feather name="alert-circle" size={34} color={colors.muted} />
          <Text style={styles.emptyText}>Fiche introuvable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const categoryLabel = HYGIENE_CATEGORIES.find(c => c.key === fiche.category)?.label || '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="hygiene-detail-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconCircle}>
          <Feather name={CATEGORY_ICON_BY_KEY[fiche.category]} size={26} color={colors.brand} />
        </View>
        <Text style={styles.category}>{categoryLabel.toUpperCase()}</Text>
        <Text style={styles.title}>{fiche.title}</Text>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{DOC_KIND_LABEL[fiche.docKind]}</Text>
        </View>

        <Text style={styles.paragraph}>{fiche.description}</Text>
        {fiche.placement && (
          <View style={styles.placementRow}>
            <Feather name="map-pin" size={13} color={colors.muted} />
            <Text style={styles.placementText}>À afficher {fiche.placement}</Text>
          </View>
        )}

        <View style={styles.filesSection}>
          {fiche.files.map((file: HygieneFile) => (
            <View key={file.format} style={styles.fileCard}>
              <View style={styles.fileHeader}>
                <Feather name={file.format === 'pdf' ? 'file-text' : 'grid'} size={16} color={colors.brand} />
                <Text style={styles.fileLabel}>{file.label}</Text>
              </View>
              <View style={styles.actionsRow}>
                <ActionButton
                  testID={`hygiene-open-${file.format}`}
                  icon="external-link"
                  label="Ouvrir"
                  busy={busy === `${file.format}-open`}
                  disabled={busy !== null}
                  colors={colors}
                  onPress={() => run(`${file.format}-open`, () => openFicheFile(file))}
                />
                <ActionButton
                  testID={`hygiene-share-${file.format}`}
                  icon="share"
                  label="Partager"
                  busy={busy === `${file.format}-share`}
                  disabled={busy !== null}
                  colors={colors}
                  onPress={() => run(`${file.format}-share`, () => shareFicheFile(file, fiche.title))}
                />
                {file.format === 'pdf' && (
                  <ActionButton
                    testID={`hygiene-print-${file.format}`}
                    icon="printer"
                    label="Imprimer"
                    busy={busy === `${file.format}-print`}
                    disabled={busy !== null}
                    colors={colors}
                    onPress={() => run(`${file.format}-print`, () => printFicheFile(file, fiche.title))}
                  />
                )}
              </View>
            </View>
          ))}
        </View>

        {flash && <Text style={styles.flash}>{flash}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        {fiche.keywords.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>MOTS-CLÉS</Text>
            <View style={styles.keywordRow}>
              {fiche.keywords.slice(0, 6).map(k => (
                <View key={k} style={styles.keywordPill}><Text style={styles.keywordText}>{k}</Text></View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.attribution}>
          <Text style={styles.attributionText}>Document fourni avec l’autorisation de {HYGIENE_SOURCE_NAME}.</Text>
          <Pressable testID="hygiene-detail-source-link" onPress={() => Linking.openURL(HYGIENE_SOURCE_URL).catch(() => {})}>
            <Text style={styles.attributionLink}>Visiter {HYGIENE_SOURCE_NAME}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ testID, icon, label, busy, disabled, colors, onPress }: {
  testID: string; icon: keyof typeof Feather.glyphMap; label: string; busy: boolean; disabled: boolean;
  colors: ThemeColors; onPress: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={[styles.actionBtn, disabled && !busy && { opacity: 0.45 }]}>
      {busy ? <ActivityIndicator size="small" color={colors.brand} /> : <Feather name={icon} size={18} color={colors.brand} />}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: colors.muted },
  body: { padding: 24, paddingBottom: 60, alignItems: 'center' },
  iconCircle: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  category: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface, textAlign: 'center', marginTop: 8, lineHeight: 32 },
  kindBadge: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 10 },
  kindBadgeText: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '600' },
  paragraph: { fontSize: 15, color: colors.onSurface, lineHeight: 23, textAlign: 'center', marginTop: 18 },
  placementRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  placementText: { fontSize: 12, color: colors.muted },
  filesSection: { width: '100%', marginTop: 28, gap: 12 },
  fileCard: { width: '100%', backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16 },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  fileLabel: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: theme.radius.md, backgroundColor: colors.surfaceTertiary, minHeight: 44, justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '600', color: colors.onSurface },
  flash: { fontSize: 13, color: colors.success, marginTop: 14, textAlign: 'center' },
  error: { fontSize: 13, color: colors.error, marginTop: 14, textAlign: 'center' },
  section: { width: '100%', marginTop: 28 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, fontWeight: '600', marginBottom: 10 },
  keywordRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keywordPill: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  keywordText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '500' },
  attribution: { width: '100%', marginTop: 32, alignItems: 'center', gap: 4 },
  attributionText: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  attributionLink: { fontSize: 13, color: colors.brand, fontWeight: '600' },
});
