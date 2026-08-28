/**
 * Bouton "Profil" de la barre d'onglets, remplacé par un tabBarButton
 * custom : au lieu de naviguer directement, il ouvre un petit menu ancré
 * en haut à droite de la barre (Profil / Amis / Abonnements) — Amis et
 * Abonnements restent des routes du groupe (tabs), juste masquées de la
 * barre (`href: null`), donc rien de leur fonctionnement n'a changé, seul
 * le chemin pour y arriver est différent.
 *
 * Ancrage à droite plutôt qu'une mesure précise du bouton (measureInWindow) :
 * "Profil" est toujours le dernier onglet, donc `right: 16` reproduit une
 * position "près du bouton" sans la fragilité d'une mesure au runtime, et
 * garantit mécaniquement que le menu ne sort jamais de l'écran, quel que
 * soit le modèle d'iPhone.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { api } from '@/src/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

const TAB_BAR_HEIGHT = 82;

type MenuItem = { key: string; label: string; icon: keyof typeof Feather.glyphMap; route: '/(tabs)/profile' | '/(tabs)/friends' | '/(tabs)/following' | '/classement'; showBadge?: boolean };

export function ProfileTabButton() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Groupe actif : Profil doit rester mis en avant quand on est sur Amis ou
  // Abonnements aussi, pour que l'utilisateur comprenne que ces pages en
  // dépendent — comparaison stricte, pas startsWith, pour ne matcher que
  // ces trois routes précises.
  const active = pathname === '/profile' || pathname === '/friends' || pathname === '/following' || pathname === '/classement';

  const loadUnreadCount = () => {
    api('/notifications/unread-count').then(r => setUnreadCount(r.count)).catch(() => {});
  };

  // Une seule fois au montage : la barre d'onglets reste montée pendant
  // toute la session, un polling permanent ici serait le genre de charge
  // superflue que la demande écarte explicitement (menu fermé = rien de
  // lourd chargé). Le ré-chargement à l'ouverture (ci-dessous) suffit à
  // garder la pastille raisonnablement à jour.
  useEffect(() => { loadUnreadCount(); }, []);

  const openMenu = () => {
    loadUnreadCount();
    setMenuOpen(true);
    scale.setValue(0.9);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = () => setMenuOpen(false);

  const toggleMenu = () => (menuOpen ? closeMenu() : openMenu());

  const items: MenuItem[] = [
    { key: 'profile', label: 'Profil', icon: 'user', route: '/(tabs)/profile' },
    { key: 'friends', label: 'Amis', icon: 'users', route: '/(tabs)/friends' },
    { key: 'following', label: 'Abonnements', icon: 'rss', route: '/(tabs)/following', showBadge: unreadCount > 0 },
    // "award" est déjà l'icône du badge "coup de cœur" (contenu le plus
    // aimé) ailleurs dans l'app — cohérent avec un classement, pas une
    // icône inventée pour l'occasion.
    { key: 'classement', label: 'Classement', icon: 'award', route: '/classement' },
  ];

  const select = (item: MenuItem) => {
    closeMenu();
    router.push(item.route as any);
  };

  return (
    <>
      <Pressable testID="profile-tab-button" onPress={toggleMenu} style={styles.tabButton}>
        <View style={styles.iconWrap}>
          <Feather name="user" size={20} color={active ? colors.brand : colors.muted} />
          {unreadCount > 0 && <View style={styles.tabDot} />}
        </View>
        <Text style={[styles.tabLabel, { color: active ? colors.brand : colors.muted }]}>
          {`Profil ${menuOpen ? '▴' : '▾'}`}
        </Text>
      </Pressable>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <Animated.View style={[styles.menu, { opacity, transform: [{ scale }] }]}>
            {items.map((item, i) => {
              const itemActive = pathname === item.route.replace('/(tabs)', '');
              return (
                <Pressable
                  key={item.key}
                  testID={`profile-menu-${item.key}`}
                  onPress={() => select(item)}
                  style={[styles.row, i < items.length - 1 && styles.rowDivider]}
                >
                  <Feather name={item.icon} size={18} color={itemActive ? colors.brand : colors.onSurface} />
                  <Text style={[styles.rowText, itemActive && { color: colors.brand, fontWeight: '600' }]}>{item.label}</Text>
                  {item.showBadge && <View style={styles.rowDot} />}
                </Pressable>
              );
            })}
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  iconWrap: { position: 'relative' },
  tabDot: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brand },
  tabLabel: { fontSize: 11, letterSpacing: 0.5, fontWeight: '500' },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute', right: 16, bottom: TAB_BAR_HEIGHT + 8, width: 200,
    backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowText: { flex: 1, fontFamily: theme.serif, fontSize: 15, color: colors.onSurface },
  rowDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brand },
});
