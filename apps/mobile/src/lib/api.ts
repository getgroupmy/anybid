import { AnyBidClient, type Tokens, type TokenStore } from '@anybid/shared';
import { API_URL } from './config';
import { getItem, removeItem, setItem } from './storage';

const TOKEN_KEY = 'anybid.tokens';

let cached: Tokens | null | undefined;
let onUnauthorized: (() => void) | undefined;

export const tokenStore: TokenStore = {
  async get() {
    if (cached !== undefined) return cached;
    const raw = await getItem(TOKEN_KEY);
    cached = raw ? (JSON.parse(raw) as Tokens) : null;
    return cached;
  },
  async set(tokens) {
    cached = tokens;
    if (tokens) await setItem(TOKEN_KEY, JSON.stringify(tokens));
    else await removeItem(TOKEN_KEY);
  },
};

export const api = new AnyBidClient({
  baseUrl: API_URL,
  tokens: tokenStore,
  onUnauthorized: () => onUnauthorized?.(),
});

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export async function currentAccessToken(): Promise<string | null> {
  const tokens = await tokenStore.get();
  return tokens?.accessToken ?? null;
}
