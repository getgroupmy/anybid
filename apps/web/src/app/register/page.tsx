import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await readSession()) redirect('/');

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Join AnyBid</h1>
        <p className="mt-1 text-sm text-ink-500">
          One account to bid, sell, advertise and buy for your company.
        </p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-ink-200" />}>
        <AuthForm mode="register" />
      </Suspense>

      <p className="text-center text-sm text-ink-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-bid-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
