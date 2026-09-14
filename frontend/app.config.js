/**
 * Dynamic Expo config — replaces the previous static app.json.
 *
 * The only reason for this: the AdMob config plugin needs different App IDs
 * per build (Google's public test IDs in dev/preview, Lucas's real ones in
 * production), and only a JS config file can read `process.env` per EAS
 * build profile (see eas.json). Everything else below is copied verbatim
 * from the old app.json — no other value changes.
 *
 * Google's test App IDs are public and meant to be committed (they are not
 * secrets — every Expo/AdMob sample app ships them): they always serve test
 * ads that carry no real revenue and never break AdMob policy. Only the
 * *production* App IDs come from env vars, and even those are not secret in
 * the traditional sense (they ship inside the app binary either way) — kept
 * out of source purely so dev/preview/production never need a code change.
 */
const ADMOB_TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
const ADMOB_TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

const admobIosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID || ADMOB_TEST_IOS_APP_ID;
const admobAndroidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID || ADMOB_TEST_ANDROID_APP_ID;

module.exports = {
  expo: {
    name: 'Levanea',
    slug: 'levanea',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'levanea',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.lucasmorey.levanea',
      infoPlist: {
        NSPhotoLibraryUsageDescription: 'Choisir une photo pour votre recette',
        NSCameraUsageDescription: 'Prendre une photo de votre recette',
        NSPhotoLibraryAddUsageDescription: "Enregistrer l'emploi du temps de votre équipe dans vos photos",
        // Required by Apple's App Tracking Transparency before requesting the
        // IDFA (used for personalised ads on the Free plan only — a Pro
        // account never triggers this prompt, see src/ads/provider.ts).
        NSUserTrackingUsageDescription:
          "Nous utilisons cet identifiant pour vous proposer des publicités pertinentes et soutenir le développement gratuit de Levanea. Vous pouvez refuser sans que cela affecte l'application.",
      },
      entitlements: {
        'com.apple.security.application-groups': ['group.com.lucasmorey.levanea'],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#FAF8F5',
      },
      edgeToEdgeEnabled: true,
      package: 'com.lucasmorey.levanea',
      permissions: ['READ_MEDIA_IMAGES', 'VIBRATE', 'POST_NOTIFICATIONS'],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-notifications',
      '@bacons/apple-targets',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-image.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#000000',
        },
      ],
      'expo-audio',
      [
        'expo-media-library',
        {
          photosPermission: 'Choisir une photo pour votre recette',
          savePhotosPermission: "Enregistrer l'emploi du temps de votre équipe dans vos photos",
          isAccessMediaLocationEnabled: false,
        },
      ],
      [
        'react-native-google-mobile-ads',
        {
          iosAppId: admobIosAppId,
          androidAppId: admobAndroidAppId,
          // Delays SDK init until src/ads/provider.ts has resolved consent
          // (Google UMP + iOS ATT) — required for EEA users, Baker's actual
          // audience. See the plugin's own README on this option.
          delayAppMeasurementInit: true,
          userTrackingUsageDescription:
            "Nous utilisons cet identifiant pour vous proposer des publicités pertinentes et soutenir le développement gratuit de Levanea. Vous pouvez refuser sans que cela affecte l'application.",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
  },
};
