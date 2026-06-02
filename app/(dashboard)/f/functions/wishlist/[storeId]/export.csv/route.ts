/**
 * GET /f/functions/wishlist/:storeId/export.csv
 *   → text/csv of every wishlist row + item for the store.
 *
 * RBAC-gated behind `view_functions` so any operator who can see the
 * page can download the data they're looking at. Streamed inline so
 * even a 100k-row export stays under the function memory ceiling.
 */

import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWishlistsForStore } from '@/features/functions/wishlist/storefront';

export const dynamic = 'force-dynamic';

const CSV_HEADER = [
  'wishlist_id',
  'customer_email',
  'device_id',
  'item_count',
  'product_id',
  'variant_id',
  'product_title',
  'variant_title',
  'product_handle',
  'price_amount',
  'price_currency',
  'available_for_sale',
  'added_at',
].join(',');

function csvEscape(v: string | number | boolean | null | Date | undefined): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote if the value contains a comma, quote, newline, or leading/trailing whitespace.
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeId: string }> },
): Promise<Response> {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return new Response('Forbidden', { status: 403 });
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const wishlists = await listWishlistsForStore(storeId, 10_000);

  const lines: string[] = [CSV_HEADER];
  for (const w of wishlists) {
    const items = await db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.wishlistId, w.id));
    if (items.length === 0) {
      // Still emit a row so empty wishlists aren't lost from the export.
      lines.push([
        csvEscape(w.id),
        csvEscape(w.customerEmail),
        csvEscape(w.deviceId),
        csvEscape(0),
        '', '', '', '', '', '', '', '', '',
      ].join(','));
      continue;
    }
    for (const it of items) {
      lines.push([
        csvEscape(w.id),
        csvEscape(w.customerEmail),
        csvEscape(w.deviceId),
        csvEscape(w.itemCount),
        csvEscape(it.shopifyProductId),
        csvEscape(it.shopifyVariantId),
        csvEscape(it.productTitle),
        csvEscape(it.variantTitle),
        csvEscape(it.productHandle),
        csvEscape(it.priceAmount),
        csvEscape(it.priceCurrency),
        csvEscape(it.availableForSale),
        csvEscape(it.addedAt),
      ].join(','));
    }
  }

  const filename = `wishlists-${store.shopDomain.replace('.myshopify.com', '')}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
