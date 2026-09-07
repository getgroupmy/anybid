import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { serverClient, readSession } from '@/lib/session';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import type { Category } from '@anybid/shared';

export const metadata: Metadata = {
  title: {
    default: 'AnyBid — Malaysia’s bidding marketplace',
    template: '%s · AnyBid',
  },
  description:
    'Bid on phones, watches, cars and collectibles across Malaysia. Proxy bidding, hidden reserves and anti-sniping on every auction.',
};

export const viewport: Viewport = {
  themeColor: '#ef3307',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  const api = await serverClient();

  let categories: Category[] = [];
  try {
    categories = (await api.categories.tree()).categories;
  } catch {
    // The site still renders if the API is down — just without the category bar.
  }

  return (
    <html lang="en-MY">
      <body className="flex min-h-screen flex-col">
        <Suspense fallback={<div className="h-[104px] border-b border-ink-200 bg-white" />}>
          <SiteHeader user={session?.user ?? null} categories={categories} />
        </Suspense>
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
