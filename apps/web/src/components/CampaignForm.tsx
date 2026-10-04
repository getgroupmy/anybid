'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Category } from '@anybid/shared';
import { browserClient } from '@/lib/client';
import { formatMoney, moneyInputToMinor, unreadableMoney } from '@/lib/format';

const PLACEMENTS = [
  ['HOME_HERO', 'Home hero banner', 'Wide banner at the top of the marketplace.'],
  ['HOME_FEED', 'Home feed', 'Inline card among home page listings.'],
  ['SEARCH_INLINE', 'Search results', 'Beside search results, matched on keywords.'],
  ['LISTING_SIDEBAR', 'Listing sidebar', 'Next to the bid panel on listing pages.'],
  ['CATEGORY_BANNER', 'Category banner', 'Top of a category page.'],
  ['MOBILE_FEED', 'Mobile app feed', 'Native card inside the AnyBid mobile app.'],
] as const;

export function CampaignForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [placements, setPlacements] = useState<string[]>(['SEARCH_INLINE']);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [pricingModel, setPricingModel] = useState<'CPC' | 'CPM'>('CPC');
  const [bid, setBid] = useState('1.20');
  const [dailyBudget, setDailyBudget] = useState('100');

  // Both of these are NaN until the fields hold something readable, and an
  // estimate of "NaN clicks a day" is worse than no estimate.
  const bidMinor = moneyInputToMinor(bid);
  const dailyMinor = moneyInputToMinor(dailyBudget);
  const readable = Number.isFinite(bidMinor) && Number.isFinite(dailyMinor) && bidMinor > 0;
  const estimated = !readable
    ? null
    : pricingModel === 'CPC'
      ? Math.floor(dailyMinor / bidMinor)
      : Math.floor((dailyMinor / bidMinor) * 1000);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const form = new FormData(e.currentTarget);

    const payload = {
      name: String(form.get('name')),
      objective: String(form.get('objective') ?? 'TRAFFIC'),
      pricingModel,
      bidAmount: moneyInputToMinor(bid),
      dailyBudget: moneyInputToMinor(dailyBudget),
      totalBudget: form.get('totalBudget')
        ? moneyInputToMinor(String(form.get('totalBudget')))
        : null,
      startsAt: new Date().toISOString(),
      endsAt: form.get('endsAt') ? new Date(String(form.get('endsAt'))).toISOString() : null,
      placements,
      targetCategoryIds: categoryIds,
      targetKeywords: String(form.get('targetKeywords') ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      targetStates: [],
    };

    const unreadable = unreadableMoney(payload);
    if (Object.keys(unreadable).length > 0) {
      setFieldErrors(unreadable);
      setError('Check the amounts below.');
      setBusy(false);
      return;
    }

    try {
      const { campaign } = await browserClient.advertiser.createCampaign(payload);

      // A campaign is useless without a creative — add the first one inline.
      await browserClient.advertiser.addCreative(campaign.id, {
        headline: String(form.get('headline')),
        body: String(form.get('body') ?? '') || undefined,
        imageUrl: String(form.get('imageUrl')),
        ctaLabel: String(form.get('ctaLabel') ?? 'Learn more'),
        ctaUrl: String(form.get('ctaUrl')),
      });

      router.push(`/advertiser/campaigns/${campaign.id}`);
      router.refresh();
    } catch (err) {
      const apiErr = err as { message?: string; fieldErrors?: Record<string, string> };
      setError(apiErr.message ?? 'The campaign could not be created');
      if (apiErr.fieldErrors) setFieldErrors(apiErr.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-6 p-5" onSubmit={onSubmit} noValidate>
      <section className="space-y-4">
        <h3 className="text-sm font-bold text-ink-900">Campaign</h3>

        <Field label="Name" error={fieldErrors.name}>
          <input name="name" className="input" required placeholder="Raya Electronics Push" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Objective">
            <select name="objective" className="input" defaultValue="TRAFFIC">
              <option value="TRAFFIC">Traffic — send people to my site</option>
              <option value="AWARENESS">Awareness — maximise impressions</option>
              <option value="LISTING_PROMOTION">Promote my AnyBid listings</option>
            </select>
          </Field>
          <Field label="End date (optional)">
            <input name="endsAt" type="date" className="input" />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-ink-900">Bidding and budget</h3>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Pricing model">
            <select
              className="input"
              value={pricingModel}
              onChange={(e) => setPricingModel(e.target.value as 'CPC' | 'CPM')}
            >
              <option value="CPC">CPC — pay per click</option>
              <option value="CPM">CPM — pay per 1,000 impressions</option>
            </select>
          </Field>

          <Field label={pricingModel === 'CPC' ? 'Bid per click (RM)' : 'Bid per 1,000 (RM)'} error={fieldErrors.bidAmount}>
            <input className="input" inputMode="decimal" value={bid} onChange={(e) => setBid(e.target.value)} />
          </Field>

          <Field label="Daily budget (RM)" error={fieldErrors.dailyBudget}>
            <input
              className="input"
              inputMode="decimal"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Total budget (RM, optional)" hint="The campaign stops serving when this is spent.">
          <input name="totalBudget" className="input max-w-xs" inputMode="decimal" placeholder="3000.00" />
        </Field>

        <div className="rounded-lg bg-ink-100 p-3 text-sm text-ink-700">
          {estimated === null ? (
            'Enter a bid and a daily budget to see how far they go.'
          ) : (
            <>
              At {formatMoney(bidMinor)} {pricingModel} with a {formatMoney(dailyMinor)} daily
              budget, you can expect roughly <strong>{estimated.toLocaleString()}</strong>{' '}
              {pricingModel === 'CPC' ? 'clicks' : 'impressions'} a day if you win the auctions.
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-ink-900">Where it runs</h3>

        <div className="grid gap-2 sm:grid-cols-2">
          {PLACEMENTS.map(([value, title, body]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                placements.includes(value) ? 'border-bid-400 bg-bid-50' : 'border-ink-200 hover:border-ink-300'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={placements.includes(value)}
                onChange={() =>
                  setPlacements((prev) =>
                    prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
                  )
                }
              />
              <span>
                <span className="block text-sm font-medium text-ink-900">{title}</span>
                <span className="block text-xs text-ink-500">{body}</span>
              </span>
            </label>
          ))}
        </div>

        <Field label="Target categories" hint="Leave empty to run across the whole marketplace.">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  setCategoryIds((prev) =>
                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                  )
                }
                className={
                  categoryIds.includes(c.id)
                    ? 'rounded-full bg-bid-600 px-3 py-1.5 text-xs font-medium text-white'
                    : 'rounded-full border border-ink-300 px-3 py-1.5 text-xs text-ink-700 hover:border-bid-400'
                }
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Target keywords" hint="Comma separated. Matched against search terms and listing tags.">
          <input name="targetKeywords" className="input" placeholder="iphone, laptop, camera" />
        </Field>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-ink-900">First creative</h3>

        <Field label="Headline" error={fieldErrors.headline}>
          <input name="headline" className="input" required maxLength={80} placeholder="Certified refurbished laptops from RM1,299" />
        </Field>
        <Field label="Body (optional)">
          <input name="body" className="input" maxLength={160} placeholder="12-month warranty, next-day delivery." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Image URL" error={fieldErrors.imageUrl}>
            <input name="imageUrl" className="input" required defaultValue="https://picsum.photos/seed/newad/1200/400" />
          </Field>
          <Field label="Destination URL" error={fieldErrors.ctaUrl}>
            <input name="ctaUrl" className="input" required placeholder="https://example.my/offer" />
          </Field>
        </div>
        <Field label="Button label">
          <input name="ctaLabel" className="input max-w-xs" defaultValue="Learn more" maxLength={24} />
        </Field>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy || placements.length === 0}>
        {busy ? 'Creating…' : 'Create campaign'}
      </button>
      <p className="text-xs text-ink-500">
        Campaigns start as a draft. Activate one from the campaign page when you are ready.
      </p>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
