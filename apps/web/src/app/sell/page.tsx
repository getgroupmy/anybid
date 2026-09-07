import { redirect } from 'next/navigation';
import { serverClient, readSession } from '@/lib/session';
import { SellForm } from '@/components/SellForm';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { orNull } from '@/lib/resilient';

export const metadata = { title: 'Sell an item' };
export const dynamic = 'force-dynamic';

export default async function SellPage() {
  const session = await readSession();
  if (!session) redirect('/login?next=/sell');

  const api = await serverClient();
  const tree = await orNull(api.categories.tree());

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">List an item for auction</h1>
      <p className="mt-1 text-sm text-ink-500">
        Set a starting price low to attract bidders, and a hidden reserve if you have a floor you
        will not go below.
      </p>
      <div className="mt-6">
        {tree === null ? (
          <ServiceUnavailable what="Listing tools" />
        ) : (
          <SellForm categories={tree.categories} />
        )}
      </div>
    </div>
  );
}
