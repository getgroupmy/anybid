import { formatMoney, formatMoneyCompact, type Money } from '@anybid/shared';

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

export function moneyInputToMinor(value: string): Money {
  const n = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
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
