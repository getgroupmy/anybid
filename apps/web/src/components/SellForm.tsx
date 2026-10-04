'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeFees, DEFAULT_FEES, type Category } from '@anybid/shared';
import { browserClient } from '@/lib/client';
import { downscaleImage } from '@/lib/image';
import { formatMoney, moneyInputToMinor, unreadableMoney } from '@/lib/format';

const CONDITIONS = [
  ['NEW', 'New'],
  ['LIKE_NEW', 'Like new'],
  ['GOOD', 'Good'],
  ['FAIR', 'Fair'],
  ['REFURBISHED', 'Refurbished'],
  ['FOR_PARTS', 'For parts'],
] as const;

const DURATIONS = [
  [24, '1 day'],
  [72, '3 days'],
  [120, '5 days'],
  [168, '7 days'],
  [240, '10 days'],
] as const;

/** Matches the `images` cap in the shared createListingSchema. */
const MAX_PHOTOS = 12;

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Perak', 'Sabah', 'Sarawak'];

export function SellForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [kind, setKind] = useState<'AUCTION' | 'AUCTION_WITH_BUY_NOW' | 'BUY_NOW'>('AUCTION');
  const [startPrice, setStartPrice] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Let the same file be chosen again after a removal.
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_PHOTOS - images.length;
    if (room <= 0) {
      setUploadError(`A listing can have ${MAX_PHOTOS} photos.`);
      return;
    }

    setUploading(true);
    setUploadError(picked.length > room ? `Only the first ${room} were added.` : null);

    try {
      const body = new FormData();
      for (const original of picked.slice(0, room)) {
        const { file } = await downscaleImage(original);
        body.append('photos', file, file.name);
      }

      // Straight to the proxy: FormData needs its own multipart boundary,
      // which the typed JSON client does not produce.
      const res = await fetch('/api/proxy/v1/uploads/images', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => null)) as
        | { images?: string[]; message?: string }
        | null;

      if (!res.ok || !data?.images) {
        setUploadError(data?.message ?? 'That upload failed. Please try again.');
        return;
      }
      setImages((prev) => [...prev, ...data.images!].slice(0, MAX_PHOTOS));
      setFieldErrors((prev) => ({ ...prev, images: '' }));
    } catch {
      setUploadError('That upload failed. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(url: string) {
    setImages((prev) => prev.filter((u) => u !== url));
  }

  function makeCover(url: string) {
    setImages((prev) => [url, ...prev.filter((u) => u !== url)]);
  }

  // Show the seller exactly what they take home before they commit.
  const feePreview = useMemo(() => {
    const minor = moneyInputToMinor(startPrice);
    return minor > 0 ? computeFees(minor, DEFAULT_FEES) : null;
  }, [startPrice]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const payload = {
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      categoryId: String(form.get('categoryId') ?? ''),
      kind,
      condition: String(form.get('condition') ?? 'GOOD'),
      quantity: Number(form.get('quantity') ?? 1),
      images,
      startPrice: moneyInputToMinor(String(form.get('startPrice') ?? '0')),
      reservePrice: form.get('reservePrice')
        ? moneyInputToMinor(String(form.get('reservePrice')))
        : null,
      buyNowPrice: form.get('buyNowPrice')
        ? moneyInputToMinor(String(form.get('buyNowPrice')))
        : null,
      durationHours: Number(form.get('durationHours') ?? 72),
      shippingCost: moneyInputToMinor(String(form.get('shippingCost') ?? '0')),
      localPickup: form.get('localPickup') === 'on',
      locationState: String(form.get('locationState') ?? ''),
      locationCity: String(form.get('locationCity') ?? ''),
      antiSnipeWindowSec: Number(form.get('antiSnipeWindowSec') ?? 120),
      antiSnipeExtensionSec: Number(form.get('antiSnipeWindowSec') ?? 120),
      tags: String(form.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const unreadable = unreadableMoney(payload);
    if (Object.keys(unreadable).length > 0) {
      setFieldErrors(unreadable);
      setError('Check the amounts below.');
      setBusy(false);
      return;
    }

    try {
      const { listing } = await browserClient.listings.create(payload);
      router.push(`/listing/${listing.slug}`);
      router.refresh();
    } catch (err) {
      const apiErr = err as { message?: string; fieldErrors?: Record<string, string> };
      setError(apiErr.message ?? 'The listing could not be created');
      if (apiErr.fieldErrors) setFieldErrors(apiErr.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit} noValidate>
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">The item</h2>

        <Field label="Title" error={fieldErrors.title} hint="At least 6 characters. Be specific — model, capacity, colour.">
          <input name="title" className="input" required placeholder="iPhone 15 Pro Max 256GB Natural Titanium" />
        </Field>

        <Field label="Description" error={fieldErrors.description} hint="At least 20 characters. Flaws included — it saves disputes later.">
          <textarea name="description" className="input min-h-32" required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" error={fieldErrors.categoryId}>
            <select name="categoryId" className="input" required defaultValue="">
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((parent) => (
                <optgroup key={parent.id} label={`${parent.icon ?? ''} ${parent.name}`}>
                  {(parent.children ?? []).map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Condition">
            <select name="condition" className="input" defaultValue="GOOD">
              {CONDITIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Photos"
          error={fieldErrors.images || uploadError || undefined}
          hint={`JPEG, PNG or WebP, up to ${MAX_PHOTOS}. Large photos are shrunk before upload. The first is the cover.`}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading || images.length >= MAX_PHOTOS}
            onChange={onPickPhotos}
            className="input cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </Field>

        {uploading && (
          <p role="status" className="text-xs text-ink-500">
            Uploading photos…
          </p>
        )}

        {images.length > 0 && (
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {images.map((src, i) => (
              <li key={src} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={i === 0 ? 'Cover photo' : `Photo ${i + 1}`}
                  className="h-20 w-20 rounded-lg object-cover"
                />
                {i === 0 ? (
                  <span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-ink-900/70 py-0.5 text-center text-[10px] font-semibold text-white">
                    Cover
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makeCover(src)}
                    className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-ink-900/70 py-0.5 text-center text-[10px] font-semibold text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  >
                    Make cover
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(src)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-ink-900 text-xs font-bold leading-none text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field label="Tags" hint="Comma separated. These power search and ad targeting.">
          <input name="tags" className="input" placeholder="iphone, apple, smartphone" />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Price and format</h2>

        <Field label="Selling format">
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['AUCTION', 'Auction', 'Highest bid wins'],
                ['AUCTION_WITH_BUY_NOW', 'Auction + buy now', 'Ends early at your price'],
                ['BUY_NOW', 'Fixed price', 'No bidding'],
              ] as const
            ).map(([value, title, body]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg border p-3 transition ${
                  kind === value ? 'border-bid-400 bg-bid-50' : 'border-ink-200 hover:border-ink-300'
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  className="sr-only"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <span className="block text-sm font-medium text-ink-900">{title}</span>
                <span className="block text-xs text-ink-500">{body}</span>
              </label>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starting price (RM)" error={fieldErrors.startPrice}>
            <input
              name="startPrice"
              className="input"
              inputMode="decimal"
              required
              value={startPrice}
              onChange={(e) => setStartPrice(e.target.value)}
              placeholder="100.00"
            />
          </Field>

          {kind !== 'BUY_NOW' && (
            <Field label="Reserve (optional)" error={fieldErrors.reservePrice} hint="Hidden from bidders.">
              <input name="reservePrice" className="input" inputMode="decimal" placeholder="—" />
            </Field>
          )}

          {kind !== 'AUCTION' && (
            <Field label="Buy-now price (RM)" error={fieldErrors.buyNowPrice}>
              <input name="buyNowPrice" className="input" inputMode="decimal" placeholder="500.00" />
            </Field>
          )}
        </div>

        {feePreview && (
          <div className="rounded-lg bg-ink-100 p-3 text-sm">
            <div className="font-medium text-ink-700">If it sells at your starting price</div>
            <dl className="mt-2 space-y-1 text-ink-600">
              <Row label="Hammer price" value={formatMoney(feePreview.hammerPrice)} />
              <Row label="AnyBid commission (6%)" value={`− ${formatMoney(feePreview.sellerCommission)}`} />
              <Row label="You receive" value={formatMoney(feePreview.sellerPayout)} strong />
            </dl>
          </div>
        )}

        {kind !== 'BUY_NOW' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duration">
              <select name="durationHours" className="input" defaultValue={72}>
                {DURATIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Anti-snipe protection" hint="A bid inside this window pushes the close out by the same amount.">
              <select name="antiSnipeWindowSec" className="input" defaultValue={120}>
                <option value={0}>Off — hard close</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </Field>
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          Delivery and location
        </h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity">
            <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
          </Field>
          <Field label="Shipping cost (RM)">
            <input name="shippingCost" className="input" inputMode="decimal" defaultValue="15.00" />
          </Field>
          <Field label="State">
            <select name="locationState" className="input" defaultValue="Selangor">
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="City or town">
          <input name="locationCity" className="input" placeholder="Shah Alam" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="localPickup" defaultChecked className="h-4 w-4" />
          Local pickup available
        </label>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
        {busy ? 'Publishing…' : 'Publish listing'}
      </button>
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={strong ? 'font-bold text-ink-900' : ''}>{value}</dd>
    </div>
  );
}
