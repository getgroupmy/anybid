import { PUSH_PROVIDER } from './config';

/**
 * Push notification abstraction.
 *
 * The Play/App Store build registers with Expo's push service. The AppGallery
 * build has no Google Play Services, so it registers with Huawei Push Kit
 * through a native module supplied at build time. Both paths hand the same
 * shaped token to the API, so nothing above this file knows the difference.
 */
export interface PushRegistration {
  provider: 'expo' | 'hms';
  token: string;
}

type HmsBridge = { getToken(): Promise<string> };

export async function registerForPush(): Promise<PushRegistration | null> {
  if (PUSH_PROVIDER === 'hms') {
    // Resolved at runtime so the Play build never links the HMS module.
    const bridge = (globalThis as { HmsPushBridge?: HmsBridge }).HmsPushBridge;
    if (!bridge) return null;
    try {
      return { provider: 'hms', token: await bridge.getToken() };
    } catch {
      return null;
    }
  }

  try {
    // Static specifier so Metro bundles it for the Play/App Store build. The
    // AppGallery build never reaches this branch (PUSH_PROVIDER is 'hms'), and
    // `npm run strip:gms` removes the dependency entirely for that build so no
    // Google Play Services code is linked. See docs/HUAWEI.md.
    const Notifications = await import('expo-notifications');
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;
    const { data } = await Notifications.getExpoPushTokenAsync();
    return { provider: 'expo', token: data };
  } catch {
    // expo-notifications is an optional dependency — the app works without it.
    return null;
  }
}
