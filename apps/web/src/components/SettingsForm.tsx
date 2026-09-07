'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeFees, type FeeSchedule } from '@anybid/shared';
import { browserClient } from '@/lib/client';
import { formatMoney } from '@/lib/format';

const BPS_FIELDS = [
  ['sellerCommissionBps', 'Seller commission', 'Taken from the hammer price.'],
  ['buyerPremiumBps', 'Buyer premium', 'Added on top of the hammer price.'],
  ['paymentProcessingBps', 'Payment processing', 'What the gateway charges us.'],
] as const;

const MONEY_FIELDS = [
  ['paymentFlatFee', 'Flat payment fee', 'Per transaction.'],
  ['minCommission', 'Minimum commission', 'Floor on the seller commission.'],
  ['maxCommission', 'Maximum commission', 'Cap on the seller commission. 0 disables the cap.'],
] as const;

export function SettingsForm({ settings }: { settings: Record<string, number | boolean> }) {
  const router = useRouter();
  const [values, setValues] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show the effect of the current fee settings on a realistic sale.
  const preview = computeFees(1_000_00, {
    sellerCommissionBps: Number(values.sellerCommissionBps ?? 0),
    buyerPremiumBps: Number(values.buyerPremiumBps ?? 0),
    paymentProcessingBps: Number(values.paymentProcessingBps ?? 0),
    paymentFlatFee: Number(values.paymentFlatFee ?? 0),
    minCommission: Number(values.minCommission ?? 0),
    maxCommission: Number(values.maxCommission ?? 0),
  } as FeeSchedule);

  function set(key: string, value: number | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await browserClient.admin.updateSettings(values);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <section>
        <h3 className="text-sm font-bold text-ink-900">Fees</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {BPS_FIELDS.map(([key, label, hint]) => (
            <div key={key}>
              <span className="label">{label}</span>
              <div className="relative">
                <input
                  className="input pr-8"
                  inputMode="decimal"
                  value={(Number(values[key] ?? 0) / 100).toString()}
                  onChange={(e) => set(key, Math.round(Number(e.target.value || 0) * 100))}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">%</span>
              </div>
              <p className="mt-1 text-xs text-ink-500">{hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {MONEY_FIELDS.map(([key, label, hint]) => (
            <div key={key}>
              <span className="label">{label}</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">RM</span>
                <input
                  className="input pl-10"
                  inputMode="decimal"
                  value={(Number(values[key] ?? 0) / 100).toFixed(2)}
                  onChange={(e) => set(key, Math.round(Number(e.target.value || 0) * 100))}
                />
              </div>
              <p className="mt-1 text-xs text-ink-500">{hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg bg-ink-100 p-4 text-sm">
          <div className="font-medium text-ink-700">On a RM1,000.00 sale</div>
          <dl className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Row label="Buyer pays" value={formatMoney(preview.buyerTotal)} />
            <Row label="Seller receives" value={formatMoney(preview.sellerPayout)} />
            <Row label="Commission" value={formatMoney(preview.sellerCommission)} />
            <Row label="Net to AnyBid" value={formatMoney(preview.platformRevenue)} strong />
          </dl>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-ink-900">Auction defaults</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Anti-snipe window (seconds)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={1800}
              value={Number(values.defaultAntiSnipeWindowSec ?? 120)}
              onChange={(e) => set('defaultAntiSnipeWindowSec', Number(e.target.value))}
            />
          </div>
          <div>
            <span className="label">Anti-snipe extension (seconds)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={1800}
              value={Number(values.defaultAntiSnipeExtensionSec ?? 120)}
              onChange={(e) => set('defaultAntiSnipeExtensionSec', Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold text-ink-900">Moderation</h3>
        <div className="mt-3 space-y-2">
          <Toggle
            checked={Boolean(values.newListingsRequireReview)}
            onChange={(v) => set('newListingsRequireReview', v)}
            label="New listings need admin approval"
            hint="Listings are held in review instead of going live immediately."
          />
          <Toggle
            checked={Boolean(values.maintenanceMode)}
            onChange={(v) => set('maintenanceMode', v)}
            label="Maintenance mode"
            hint="Show a maintenance notice across the marketplace."
          />
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-deal-600">Settings saved.</p>}

      <button type="button" className="btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-600">{label}</dt>
      <dd className={strong ? 'font-bold text-ink-900' : 'font-medium'}>{value}</dd>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 hover:border-ink-300">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        <span className="block text-xs text-ink-500">{hint}</span>
      </span>
    </label>
  );
}
