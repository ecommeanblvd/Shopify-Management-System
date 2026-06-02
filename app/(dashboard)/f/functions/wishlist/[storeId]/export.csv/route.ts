/**
 * GET /f/functions/wishlist/:storeId/export.csv
 *   → text/csv of every wishlist row + item for the store.
 *
 * RBAC-gated behind `view_functions`. Empty wishlists still get a
 * row so the export reflects the audit-trail exactly.
 */

import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listWishlistsForStore } from '@/features/functions/wishlist/storefront';
import { csvBody, csvFilename, type CsvValue } from '@/lib/csv';

export const dynamic = 'force-dynamic';

const HEADER = [
  'wishlist_id', 'customer_email', 'device_id', 'item_count',
  'product_id', 'variant_id', 'product_title', 'variant_title',
  'product_handle', 'price_amount', 'price_currency',
  'available_for_sale', 'added_at',
];

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
  const rows: CsvValue[][] = [];
  for (const w of wishlists) {
    const items = await db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.wishlistId, w.id));
    if (items.length === 0) {
      rows.push([w.id, w.customerEmail, w.deviceId, 0, '', '', '', '', '', '', '', '', '']);
      continue;
    }
    for (const it of items) {
      rows.push([
        w.id, w.customerEmail, w.deviceId, w.itemCount,
        it.shopifyProductId, it.shopifyVariantId,
        it.productTitle, it.variantTitle, it.productHandle,
        it.priceAmount, it.priceCurrency,
        it.availableForSale, it.addedAt,
      ]);
    }
  }

  return new Response(csvBody(HEADER, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename('wishlists', store.shopDomain)}"`,
      'cache-control': 'no-store',
    },
  });
}
