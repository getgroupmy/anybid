import Constants from 'expo-constants';

interface Extra {
  apiUrl: string;
  wsUrl: string;
  distChannel: 'google' | 'huawei';
  pushProvider: 'expo' | 'hms';
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000';
export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? extra.wsUrl ?? API_URL.replace(/^http/, 'ws') + '/realtime';
export const DIST_CHANNEL = extra.distChannel ?? 'google';
export const PUSH_PROVIDER = extra.pushProvider ?? 'expo';
export const IS_HUAWEI = DIST_CHANNEL === 'huawei';
