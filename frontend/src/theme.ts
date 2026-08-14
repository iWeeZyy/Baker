export const theme = {
  color: {
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
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 0, md: 4, lg: 8, pill: 999 },
  fontSize: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, display: 32 },
  serif: undefined as string | undefined,
};

import { Platform } from 'react-native';
theme.serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });
