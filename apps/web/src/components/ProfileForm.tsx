'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@anybid/shared';
import { browserClient } from '@/lib/client';

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Perak', 'Sabah', 'Sarawak'];

export function ProfileForm({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const form = new FormData(e.currentTarget);

    try {
      await browserClient.auth.updateProfile({
        displayName: String(form.get('displayName')),
        phone: String(form.get('phone') || '') || undefined,
        city: String(form.get('city') || '') || undefined,
        state: String(form.get('state') || '') || undefined,
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 p-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Display name</span>
          <input name="displayName" className="input" defaultValue={user.displayName} required />
        </div>
        <div>
          <span className="label">Phone</span>
          <input name="phone" className="input" placeholder="+60 12-345 6789" />
        </div>
        <div>
          <span className="label">City</span>
          <input name="city" className="input" defaultValue={user.city ?? ''} />
        </div>
        <div>
          <span className="label">State</span>
          <select name="state" className="input" defaultValue={user.state ?? ''}>
            <option value="">Not set</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-deal-600">Saved.</p>}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
