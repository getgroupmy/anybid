import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Two distribution channels ship from this one codebase:
 *
 *   google  — Play Store / App Store build.
 *   huawei  — AppGallery build. Huawei devices ship without Google Mobile
 *             Services, so this variant must not pull in anything that
 *             depends on GMS (Play Services location, Google Maps, FCM).
 *             AnyBid avoids those modules entirely, so the difference is the
 *             application id, the push transport and the update channel.
 *
 * Select with EXPO_PUBLIC_DIST_CHANNEL=huawei before `expo prebuild` / `eas build`.
 */
const channel = (process.env.EXPO_PUBLIC_DIST_CHANNEL ?? 'google') as 'google' | 'huawei';
const isHuawei = channel === 'huawei';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'AnyBid',
  slug: 'anybid',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'anybid',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  primaryColor: '#ef3307',

  splash: {
    backgroundColor: '#ef3307',
    resizeMode: 'contain',
  },

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'my.anybid.app',
    buildNumber: '1',
    infoPlist: {
      NSPhotoLibraryUsageDescription:
        'AnyBid needs access to your photos so you can add pictures to a listing.',
      NSCameraUsageDescription:
        'AnyBid needs the camera so you can photograph an item you are listing.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    // A separate application id keeps the AppGallery build installable
    // alongside the Play build during testing.
    package: isHuawei ? 'my.anybid.app.huawei' : 'my.anybid.app',
    versionCode: 1,
    adaptiveIcon: { backgroundColor: '#ef3307' },
    permissions: ['INTERNET', 'READ_MEDIA_IMAGES'],
    // No Google Play Services dependency: AnyBid ships no Maps, no FCM and no
    // Play location, so the same bundle runs on a Huawei device.
    blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
  },

  web: { bundler: 'metro', output: 'single' },

  plugins: [
    'expo-router',
    'expo-secure-store',
    // expo-notifications pulls in Firebase Cloud Messaging on Android, which
    // needs Google Play Services. The AppGallery build uses Huawei Push Kit
    // instead, so the plugin is left out of that variant entirely.
    ...(isHuawei ? [] : ['expo-notifications' as const]),
    [
      'expo-image-picker',
      {
        photosPermission: 'AnyBid uses your photos so you can add pictures to a listing.',
        cameraPermission: 'AnyBid uses the camera so you can photograph an item you are listing.',
      },
    ],
  ],

  extra: {
    distChannel: channel,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:4000/realtime',
    // Huawei Push Kit is wired at the native layer for the AppGallery build;
    // the Play/App Store build uses Expo push. Both funnel into one abstraction
    // in src/lib/push.ts.
    pushProvider: isHuawei ? 'hms' : 'expo',
  },

  experiments: { typedRoutes: false },
});
