import { Platform } from 'react-native';

export type ThemeColors = {
  surface: string; onSurface: string;
  surfaceSecondary: string; onSurfaceSecondary: string;
  surfaceTertiary: string; onSurfaceTertiary: string;
  surfaceInverse: string; onSurfaceInverse: string;
  brand: string; brandPrimary: string; onBrandPrimary: string;
  brandSecondary: string; onBrandSecondary: string;
  brandTertiary: string; onBrandTertiary: string;
  success: string; warning: string; error: string; info: string;
  border: string; borderStrong: string; divider: string; muted: string;
};

// Seules les couleurs neutres (surfaces, textes, bordures) varient entre les
// deux thèmes. La marque, les couleurs sémantiques et surfaceInverse/
// onSurfaceInverse (voile de lisibilité sur une photo, jamais l'arrière-plan
// de l'app) restent identiques dans les deux modes — voir ThemeContext.tsx.
export const LIGHT_COLORS: ThemeColors = {
  surface: '#FAF8F5',
  onSurface: '#2A1F1A',
  surfaceSecondary: '#F3EFEA',
  onSurfaceSecondary: '#4A3D36',
  surfaceTertiary: '#EAE3DB',
  onSurfaceTertiary: '#5D4D44',
  surfaceInverse: '#2A1F1A',
  onSurfaceInverse: '#FAF8F5',
  brand: '#C05A35',
  brandPrimary: '#C05A35',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#D4A373',
  onBrandSecondary: '#2A1F1A',
  brandTertiary: '#F0DAC6',
  onBrandTertiary: '#8B4527',
  success: '#5C7658',
  warning: '#CBA244',
  error: '#B74D4D',
  info: '#7B6F63',
  border: '#EAE3DB',
  borderStrong: '#CFC4B6',
  divider: '#EAE3DB',
  muted: '#8B7D72',
};

// Une hiérarchie à trois niveaux (fond -> carte -> carte différenciée), dans
// la même tonalité chaude que la palette claire — jamais un simple
// #FFFFFF -> #000000 ni un gris neutre froid.
export const DARK_COLORS: ThemeColors = {
  surface: '#1C1712',
  onSurface: '#F2E9E1',
  surfaceSecondary: '#262019',
  onSurfaceSecondary: '#C9BBAF',
  surfaceTertiary: '#302820',
  onSurfaceTertiary: '#B5A493',
  surfaceInverse: LIGHT_COLORS.surfaceInverse,
  onSurfaceInverse: LIGHT_COLORS.onSurfaceInverse,
  brand: LIGHT_COLORS.brand,
  brandPrimary: LIGHT_COLORS.brandPrimary,
  onBrandPrimary: LIGHT_COLORS.onBrandPrimary,
  brandSecondary: LIGHT_COLORS.brandSecondary,
  onBrandSecondary: LIGHT_COLORS.onBrandSecondary,
  brandTertiary: LIGHT_COLORS.brandTertiary,
  onBrandTertiary: LIGHT_COLORS.onBrandTertiary,
  success: LIGHT_COLORS.success,
  warning: LIGHT_COLORS.warning,
  error: LIGHT_COLORS.error,
  info: '#9C8C7E',
  border: '#3A2E24',
  borderStrong: '#52402F',
  divider: '#3A2E24',
  muted: '#9C8C7E',
};

// Jamais couplés à une couleur (dimensions et police) : un seul jeu de
// valeurs, partagé par les deux thèmes.
export const theme = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 0, md: 4, lg: 8, xl: 16, pill: 999 },
  fontSize: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, display: 32 },
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string,
};
