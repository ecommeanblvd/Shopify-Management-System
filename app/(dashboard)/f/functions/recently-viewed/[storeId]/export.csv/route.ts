/**
 * GET /f/functions/recently-viewed/:storeId/export.csv
 *   → text/csv: one row per view event (NOT deduped) so the export
 *     preserves the timeline. For dedup-by-product, use the admin
 *     analytics page.
 */

import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, csvFilename, type CsvValue } from '@/lib/csv';

export const dynamic = 'force-dynamic';

const HEADER = [
  'event_id', 'device_id', 'customer_email', 'product_id', 'variant_id',
  'product_title', 'product_handle', 'price_amount', 'price_currency', 'viewed_at',
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

  const events = await db
    .select()
    .from(schema.recentlyViewedEvents)
    .where(and(eq(schema.recentlyViewedEvents.storeId, storeId)))
    .orderBy(desc(schema.recentlyViewedEvents.viewedAt))
    .limit(50_000);

  const rows: CsvValue[][] = events.map((e) => [
    e.id, e.deviceId, e.customerEmail,
    e.shopifyProductId, e.shopifyVariantId,
    e.productTitle, e.productHandle,
    e.priceAmount, e.priceCurrency,
    e.viewedAt,
  ]);

  return new Response(csvBody(HEADER, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename('recently-viewed', store.shopDomain)}"`,
      'cache-control': 'no-store',
    },
  });
}
