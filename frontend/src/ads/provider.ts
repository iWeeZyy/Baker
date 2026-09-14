import { type AdProvider, noopProvider } from './adProviderTypes';
export type { AdPlacement, AdProvider, ConsentStatus } from './adProviderTypes';
export { noopProvider };

/**
 * The provider in force on web: `noopProvider`, always.
 *
 * `react-native-google-mobile-ads` is a native module — its JS entry point
 * imports `react-native/Libraries/Utilities/codegenNativeComponent`, which
 * Metro's web bundler refuses to bundle at all ("Importing native-only
 * module ... on web"), independent of any runtime `Platform.OS` check.
 * The real implementation therefore lives in `provider.native.ts`, a
 * separate file Metro resolves automatically for iOS/Android only — the
 * `.native.ts` suffix is Metro's own platform-file convention (same one
 * this project's Metro config already gets for free from
 * `expo/metro-config`), so `import ... from './provider'` picks this file
 * on web and `provider.native.ts` on iOS/Android with no code-level branch
 * anywhere. This was verified empirically: a first attempt used a plain
 * `Platform.OS === 'web' ? noopProvider : admobProvider` inside one shared
 * file, and `npx expo export --platform web` failed on exactly the import
 * above — Metro bundles by static import graph, not by which branch would
 * run, so the AdMob import had to be in a file web never resolves at all.
 */
export const adProvider: AdProvider = noopProvider;
