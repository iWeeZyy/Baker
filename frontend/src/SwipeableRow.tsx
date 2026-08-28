import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Feather } from '@expo/vector-icons';
import { theme } from './theme';

type Props = {
  ref?: React.RefObject<SwipeableMethods | null>;
  editLabel?: string;
  deleteLabel?: string;
  onEdit: () => void;
  onDelete: () => void;
  onSwipeableWillOpen?: () => void;
  onSwipeableClose?: () => void;
  children: ReactNode;
};

/**
 * A native-feeling "swipe left to reveal Modifier/Supprimer" row, built on the
 * gesture/animation stack already in the app (react-native-gesture-handler +
 * reanimated, both already a dependency for the global GestureHandlerRootView) —
 * no new library. The actions here never contain their own logic: onEdit/onDelete
 * are always the caller's existing edit/delete handlers, so this component adds
 * a second way to reach them, never a second implementation of them.
 */
export function SwipeableRow({
  ref, editLabel = 'Modifier', deleteLabel = 'Supprimer', onEdit, onDelete, onSwipeableWillOpen, onSwipeableClose, children,
}: Props) {
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={styles.container}
      onSwipeableWillOpen={onSwipeableWillOpen}
      onSwipeableClose={onSwipeableClose}
      renderRightActions={() => (
        <>
          <Pressable testID="swipe-action-delete" onPress={onDelete} style={[styles.action, styles.deleteAction]}>
            <Feather name="trash-2" size={17} color="#fff" />
            <Text style={styles.actionText}>{deleteLabel}</Text>
          </Pressable>
          <Pressable testID="swipe-action-edit" onPress={onEdit} style={[styles.action, styles.editAction]}>
            <Feather name="edit-2" size={17} color="#fff" />
            <Text style={styles.actionText}>{editLabel}</Text>
          </Pressable>
        </>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  action: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 4 },
  editAction: { backgroundColor: theme.color.brandSecondary },
  deleteAction: { backgroundColor: theme.color.error },
  actionText: { fontSize: 12, color: '#fff', fontWeight: '700' },
});
