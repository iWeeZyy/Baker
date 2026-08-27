/**
 * Petit menu d'actions cross-plateforme, en bas d'écran. Extrait du menu
 * "+" de l'écran Recettes (scanner / créer manuellement) pour être
 * réutilisé par la photo de profil (caméra / photothèque / supprimer) —
 * un `Modal` + `Pressable`, pas `Alert.alert`, dont `react-native-web` ne
 * fait rien du tout (no-op complet, déjà documenté dans `src/confirm.ts`).
 */
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

export type ActionSheetOption = {
  key: string;
  emoji: string;
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
              <Text style={styles.optionEmoji}>{opt.emoji}</Text>
              <Text style={[styles.optionText, opt.destructive && { color: theme.color.error }]}>{opt.label}</Text>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42,31,26,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, paddingBottom: 40, gap: 4 },
  title: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  optionEmoji: { fontSize: 22 },
  optionText: { fontSize: 16, color: theme.color.onSurface, fontWeight: '500' },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  cancelText: { fontSize: 15, color: theme.color.muted, fontWeight: '500' },
});
