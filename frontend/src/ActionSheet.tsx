/**
 * Petit menu d'actions cross-plateforme, en bas d'écran. Extrait du menu
 * "+" de l'écran Recettes (scanner / créer manuellement) pour être
 * réutilisé par la photo de profil (caméra / photothèque / supprimer) —
 * un `Modal` + `Pressable`, pas `Alert.alert`, dont `react-native-web` ne
 * fait rien du tout (no-op complet, déjà documenté dans `src/confirm.ts`).
 */
import { useMemo } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export type ActionSheetOption = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

export function ActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ActionSheetOption[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {options.map(opt => (
            <Pressable
              key={opt.key}
              testID={`action-sheet-${opt.key}`}
              onPress={() => { onClose(); opt.onPress(); }}
              style={styles.option}
            >
              <Feather name={opt.icon} size={20} color={opt.destructive ? colors.error : colors.onSurface} />
              <Text style={[styles.optionText, opt.destructive && { color: colors.error }]}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable testID="action-sheet-cancel" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Annuler</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, paddingBottom: 40, gap: 4 },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  optionText: { fontSize: 16, color: colors.onSurface, fontWeight: '500' },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  cancelText: { fontSize: 15, color: colors.muted, fontWeight: '500' },
});
