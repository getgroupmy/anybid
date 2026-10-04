import { parseMoneyInput } from '@anybid/shared';

export {
  formatMoney,
  formatMoneyCompact,
  formatCountdown,
  msRemaining,
  unreadableMoney,
} from '@anybid/shared';

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  if (abs < 2_592_000_000) return `${Math.round(abs / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * What the user typed, in sen — or NaN if it is not an amount.
 *
 * This was the third copy of this parser in the repository, all three of them
 * answering 0 for text they could not read, and zero is how the codebase spells
 * "none": a reserve of zero is no reserve. So letters in the reserve box
 * removed a seller's floor, silently. It delegates to the shared one now, so
 * there is one answer to this question rather than three.
 */
export function moneyInputToMinor(value: string): number {
  return parseMoneyInput(value) ?? Number.NaN;
}
