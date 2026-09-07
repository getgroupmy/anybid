'use client';

import { AnyBidClient } from '@anybid/shared';
import { API_URL } from './config';

/**
 * Browser-side client. The access token lives in an httpOnly cookie the
 * browser cannot read, so client components proxy through /api/proxy, which
 * attaches the token server-side.
 */
export const browserClient = new AnyBidClient({
  baseUrl: '/api/proxy',
  fetchImpl: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
});

export const directClient = new AnyBidClient({ baseUrl: API_URL });
