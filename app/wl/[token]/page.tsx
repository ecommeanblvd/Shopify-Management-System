import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getWishlistByShareToken } from '@/features/functions/wishlist/storefront';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await getWishlistByShareToken(token);
  if (!view) return { title: 'Wishlist not found' };
  const count = view.items.length;
  return {
    title: `${view.storeName} wishlist (${count} item${count === 1 ? '' : 's'})`,
    description: `A shared wishlist from ${view.storeName}.`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedWishlistPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getWishlistByShareToken(token);
  if (!view) notFound();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Shared wishlist
          </p>
          <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
            {view.storeName}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {view.items.length === 0
              ? 'This wishlist is empty.'
              : `${view.items.length} item${view.items.length === 1 ? '' : 's'} saved.`}
          </p>
        </header>

        {view.items.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white py-16 px-6 text-center text-sm text-neutral-500">
            Nothing here yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {view.items.map((item) => (
              <li key={item.id} className={`rounded-xl border border-neutral-200 bg-white overflow-hidden ${item.availableForSale === false ? 'opacity-75' : ''}`}>
                <a
                  href={`https://${view.shopDomain}/products/${item.productHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-4 p-4 hover:bg-neutral-50 transition-colors"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      width={80}
                      height={80}
                      className={`w-20 h-20 object-cover rounded-md bg-neutral-100 ${item.availableForSale === false ? 'opacity-60' : ''}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-md bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm leading-snug line-clamp-2">
                      {item.productTitle}
                    </div>
                    {item.variantTitle && (
                      <div className="text-xs text-neutral-500 mt-1">{item.variantTitle}</div>
                    )}
                    {item.priceAmount !== null && (
                      <div className="text-sm font-medium tabular-nums mt-1.5">
                        {formatPrice(item.priceAmount, item.priceCurrency)}
                      </div>
                    )}
                    {item.availableForSale === false && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 text-[10px] font-semibold tracking-wider uppercase">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 shrink-0">View →</div>
                </a>
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-16 text-center text-xs text-neutral-400">
          Visit{' '}
          <a
            href={`https://${view.shopDomain}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-neutral-600"
          >
            {view.shopDomain.replace('.myshopify.com', '')}
          </a>
        </footer>
      </div>
    </main>
  );
}

function formatPrice(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ''}`.trim();
  }
}
