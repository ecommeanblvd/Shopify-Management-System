import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Gift, Calendar, ExternalLink } from 'lucide-react';
import { getPublicView } from '@/features/functions/gift-registry/storefront';
import { GiftRegistryReserveButton } from '@/components/functions/GiftRegistryReserveButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await getPublicView(token);
  if (!view) return { title: 'Registry not found' };
  return {
    title: `${view.registry.eventName} — Gift registry`,
    description: view.registry.message ?? `A shared gift registry from ${view.registry.storeName}.`,
    robots: { index: false, follow: false },
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function formatPrice(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ''}`.trim();
  }
}

export default async function PublicRegistryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getPublicView(token);
  if (!view) notFound();

  const { registry, items } = view;

  return (
    <main className="min-h-screen bg-amber-50/30 text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
            <Gift className="size-3.5" />
            Gift registry
          </div>
          <h1 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
            {registry.eventName}
          </h1>
          {registry.ownerName && (
            <p className="mt-1.5 text-sm text-neutral-600">by {registry.ownerName}</p>
          )}
          {registry.eventDate && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-neutral-600">
              <Calendar className="size-3.5" />
              {formatDate(registry.eventDate)}
            </p>
          )}
          {registry.message && (
            <blockquote className="mt-6 mx-auto max-w-xl text-sm text-neutral-600 italic border-l-2 border-amber-200 pl-4 text-left">
              {registry.message}
            </blockquote>
          )}
        </header>

        {items.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white py-16 px-6 text-center text-sm text-neutral-500">
            The owner hasn&rsquo;t added items yet. Check back soon.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const remaining = Math.max(0, item.qtyWanted - item.qtyReserved);
              return (
                <li key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex gap-4">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        width={88}
                        height={88}
                        className="w-22 h-22 object-cover rounded-md bg-neutral-100 shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-22 h-22 rounded-md bg-neutral-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`https://${registry.shopDomain}/products/${item.productHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-sm hover:underline"
                      >
                        {item.productTitle}
                        <ExternalLink className="size-3 text-neutral-400" />
                      </Link>
                      {item.variantTitle && (
                        <div className="text-xs text-neutral-500 mt-0.5">{item.variantTitle}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-neutral-600">
                        {item.priceAmount !== null && (
                          <span className="tabular-nums font-medium">
                            {formatPrice(item.priceAmount, item.priceCurrency)}
                          </span>
                        )}
                        <span className="tabular-nums">
                          {item.qtyReserved} of {item.qtyWanted} reserved
                        </span>
                      </div>
                      {item.notes && (
                        <p className="mt-2 text-xs text-neutral-600">
                          <span className="font-medium">Note:</span> {item.notes}
                        </p>
                      )}
                      <GiftRegistryReserveButton
                        token={token}
                        itemId={item.id}
                        remaining={remaining}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="mt-16 text-center text-xs text-neutral-400">
          From{' '}
          <a
            href={`https://${registry.shopDomain}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-neutral-600"
          >
            {registry.shopDomain.replace('.myshopify.com', '')}
          </a>
        </footer>
      </div>
    </main>
  );
}
