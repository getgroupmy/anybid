import { DEFAULT_FEES, type FeeSchedule } from '@anybid/shared';
import { prisma } from '../db.ts';

export interface PlatformSettings extends FeeSchedule {
  defaultAntiSnipeWindowSec: number;
  defaultAntiSnipeExtensionSec: number;
  maintenanceMode: boolean;
  newListingsRequireReview: boolean;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  ...DEFAULT_FEES,
  defaultAntiSnipeWindowSec: 120,
  defaultAntiSnipeExtensionSec: 120,
  maintenanceMode: false,
  newListingsRequireReview: false,
};

const SETTINGS_KEY = 'platform';
const CACHE_TTL_MS = 10_000;

let cache: { value: PlatformSettings; at: number } | null = null;

export async function getSettings(force = false): Promise<PlatformSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const row = await prisma.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
  const value = { ...DEFAULT_SETTINGS, ...((row?.value as object) ?? {}) } as PlatformSettings;
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(
  patch: Partial<PlatformSettings>,
  updatedBy: string,
): Promise<PlatformSettings> {
  const current = await getSettings(true);
  const value = { ...current, ...patch };
  await prisma.platformSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: value as never, updatedBy },
    update: { value: value as never, updatedBy },
  });
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettings(): void {
  cache = null;
}
