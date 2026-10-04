import { formatMoney, formatMoneyCompact, parseMoneyInput, type Money } from '@anybid/shared';

export { formatMoney, formatMoneyCompact };

export function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [2_592_000_000, 'day'],
    [31_536_000_000, 'month'],
  ];
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return fmt.format(Math.round(-diff / 1000), 'second');
  if (abs < 3_600_000) return fmt.format(Math.round(-diff / 60_000), 'minute');
  if (abs < 86_400_000) return fmt.format(Math.round(-diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return fmt.format(Math.round(-diff / 86_400_000), 'day');
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * What the user typed, in sen — or NaN if it is not an amount.
 *
 * This used to return 0 for anything it could not read, and zero is how the
 * codebase spells "none": a reserve of zero is no reserve, a maxCommission of
 * zero is no commission cap. So letters in the reserve box removed a seller's
 * floor and letters in the admin's commission cap removed the cap, both
 * silently, because nothing downstream could tell a real zero from a failure.
 *
 * NaN cannot be mistaken for a value. It fails `moneySchema` at the API, which
 * answers 400 naming the field, and it compares false against everything, so a
 * preview that guards on `> 0` simply does not render. The one place that has
 * to do arithmetic with it checks first.
 */
export function moneyInputToMinor(value: string): Money {
  return parseMoneyInput(value) ?? Number.NaN;
}

export function statusTone(status: string): string {
  switch (status) {
    case 'LIVE':
    case 'ACTIVE':
    case 'APPROVED':
    case 'COMPLETED':
    case 'PAID':
    case 'DELIVERED':
      return 'bg-deal-100 text-deal-800';
    case 'SOLD':
      return 'bg-bid-100 text-bid-800';
    case 'PENDING':
    case 'PENDING_REVIEW':
    case 'AWAITING_PAYMENT':
    case 'AWAITING_SHIPMENT':
    case 'SCHEDULED':
    case 'PAUSED':
      return 'bg-amber-100 text-amber-800';
    case 'REJECTED':
    case 'CANCELLED':
    case 'SUSPENDED':
    case 'DISPUTED':
    case 'UNSOLD':
    case 'OUT_OF_BUDGET':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}

/**
 * The money fields in a payload that were typed but could not be read.
 *
 * `moneyInputToMinor` answers NaN for text that is not an amount, which is
 * deliberately not a value — but it must not be sent either, and not because
 * the API would catch it. `JSON.stringify` turns NaN into `null`, and `null` is
 * how a reserve, a buy-now price, a total budget and an approval threshold all
 * say "there isn't one". So an unreadable reserve would arrive as no reserve
 * and be accepted, which is the silent removal this is here to stop, wearing a
 * different hat.
 *
 * So the form checks before it sends. Returns one message per offending field,
 * shaped like the API's own field errors so it renders the same way.
 */
export function unreadableMoney(payload: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [field, value] of Object.entries(payload)) {
    if (typeof value === 'number' && Number.isNaN(value)) errors[field] = 'Enter an amount';
  }
  return errors;
}
