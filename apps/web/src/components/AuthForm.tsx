'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [extraRoles, setExtraRoles] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const payload =
      mode === 'login'
        ? { email: form.get('email'), password: form.get('password') }
        : {
            email: form.get('email'),
            password: form.get('password'),
            displayName: form.get('displayName'),
            phone: form.get('phone') || undefined,
            accountType: extraRoles.includes('CORPORATE') ? 'BUSINESS' : 'PERSONAL',
            requestRoles: extraRoles,
            organizationName: form.get('organizationName') || undefined,
          };

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'Something went wrong');
        const issues = (data.details?.issues ?? []) as { path: string[]; message: string }[];
        setFieldErrors(
          Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message])),
        );
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      // Reached only when the browser itself could not complete the request.
      // A reachable server that cannot reach the API answers 503 above, with a
      // message that does not blame the visitor's network.
      setError('We could not complete that request. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function toggleRole(role: string) {
    setExtraRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  return (
    <form className="card space-y-4 p-5" onSubmit={onSubmit} noValidate>
      {mode === 'register' && (
        <Field label="Your name" error={fieldErrors.displayName}>
          <input name="displayName" className="input" required autoComplete="name" placeholder="Aisha Rahman" />
        </Field>
      )}

      <Field label="Email" error={fieldErrors.email}>
        <input
          name="email"
          type="email"
          className="input"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </Field>

      <Field label="Password" error={fieldErrors.password}>
        <input
          name="password"
          type="password"
          className="input"
          required
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder={mode === 'register' ? 'At least 10 characters' : ''}
        />
      </Field>

      {mode === 'register' && (
        <>
          <Field label="Phone (optional)" error={fieldErrors.phone}>
            <input name="phone" className="input" autoComplete="tel" placeholder="+60 12-345 6789" />
          </Field>

          <fieldset>
            <legend className="label">What else will you use AnyBid for?</legend>
            <div className="space-y-2">
              <RoleOption
                checked={extraRoles.includes('ADVERTISER')}
                onChange={() => toggleRole('ADVERTISER')}
                title="Advertising"
                body="Run promoted placements across the marketplace."
              />
              <RoleOption
                checked={extraRoles.includes('CORPORATE')}
                onChange={() => toggleRole('CORPORATE')}
                title="Company procurement"
                body="Buy on behalf of an organisation with approvals and budgets."
              />
            </div>
          </fieldset>

          {extraRoles.length > 0 && (
            <Field label="Company name" error={fieldErrors.organizationName}>
              <input name="organizationName" className="input" placeholder="MegaCorp Sdn Bhd" />
            </Field>
          )}
        </>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function RoleOption({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
        checked ? 'border-bid-400 bg-bid-50' : 'border-ink-200 hover:border-ink-300'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block text-sm font-medium text-ink-900">{title}</span>
        <span className="block text-xs text-ink-500">{body}</span>
      </span>
    </label>
  );
}
