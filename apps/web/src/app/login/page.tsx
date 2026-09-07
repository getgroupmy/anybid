import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const DEMO_ACCOUNTS = [
  ['aisha@example.com', 'Buyer & seller'],
  ['admin@anybid.my', 'Admin console'],
  ['advertiser@brandco.my', 'Advertiser console'],
  ['procurement@megacorp.my', 'Corporate console'],
];

export default async function LoginPage() {
  if (await readSession()) redirect('/');

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Sign in to AnyBid</h1>
        <p className="mt-1 text-sm text-ink-500">
          Bid, sell and manage your consoles from one account.
        </p>
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-ink-200" />}>
        <AuthForm mode="login" />
      </Suspense>

      <p className="text-center text-sm text-ink-500">
        New to AnyBid?{' '}
        <Link href="/register" className="font-medium text-bid-600 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="card p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">Demo accounts</h2>
        <p className="mt-1 text-xs text-ink-500">
          Every seeded account uses the password <code className="font-mono">Password123</code>.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs">
          {DEMO_ACCOUNTS.map(([email, label]) => (
            <li key={email} className="flex justify-between gap-3">
              <code className="font-mono text-ink-700">{email}</code>
              <span className="shrink-0 text-ink-500">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
