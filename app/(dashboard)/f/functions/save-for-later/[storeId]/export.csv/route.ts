/**
 * GET /f/functions/save-for-later/:storeId/export.csv
 *   → text/csv of every save-for-later row currently in the system.
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
  'item_id', 'device_id', 'customer_email', 'product_id', 'variant_id',
  'product_title', 'variant_title', 'product_handle',
  'price_amount', 'price_currency', 'qty', 'saved_at',
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

  const items = await db
    .select()
    .from(schema.saveForLaterItems)
    .where(and(eq(schema.saveForLaterItems.storeId, storeId)))
    .orderBy(desc(schema.saveForLaterItems.savedAt))
    .limit(50_000);

  const rows: CsvValue[][] = items.map((it) => [
    it.id, it.deviceId, it.customerEmail,
    it.shopifyProductId, it.shopifyVariantId,
    it.productTitle, it.variantTitle, it.productHandle,
    it.priceAmount, it.priceCurrency, it.qty, it.savedAt,
  ]);

  return new Response(csvBody(HEADER, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename('save-for-later', store.shopDomain)}"`,
      'cache-control': 'no-store',
    },
  });
}
