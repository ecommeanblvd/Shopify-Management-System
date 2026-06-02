/**
 * GET /f/functions/gift-registry/:storeId/export.csv
 *   → text/csv: one row per registry item (or one bare row per
 *     empty registry). Reservations live in their own table; this
 *     export focuses on the registries + items the operator usually
 *     wants to reconcile against orders.
 */

import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, csvFilename, type CsvValue } from '@/lib/csv';

export const dynamic = 'force-dynamic';

const HEADER = [
  'registry_id', 'share_token', 'owner_email', 'owner_name',
  'event_name', 'event_date', 'created_at',
  'item_id', 'product_id', 'variant_id',
  'product_title', 'variant_title', 'product_handle',
  'price_amount', 'price_currency',
  'qty_wanted', 'qty_reserved', 'notes', 'added_at',
];

type Row = {
  registry_id: string;
  share_token: string;
  owner_email: string;
  owner_name: string | null;
  event_name: string;
  event_date: string | null;
  created_at: Date;
  item_id: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  product_title: string | null;
  variant_title: string | null;
  product_handle: string | null;
  price_amount: string | null;
  price_currency: string | null;
  qty_wanted: number | null;
  qty_reserved: string;
  notes: string | null;
  added_at: Date | null;
};

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

  // Single query: every (registry × item) row, with empty registries
  // still emitted via the LEFT JOIN.
  const result = await db.execute<Row>(sql`
    SELECT r.id AS registry_id, r.share_token,
           r.owner_email, r.owner_name,
           r.event_name, r.event_date::text, r.created_at,
           i.id AS item_id,
           i.shopify_product_id, i.shopify_variant_id,
           i.product_title, i.variant_title, i.product_handle,
           i.price_amount::text, i.price_currency,
           i.qty_wanted, i.notes, i.added_at,
           COALESCE(res.qty_reserved, 0)::text AS qty_reserved
      FROM gift_registries r
      LEFT JOIN gift_registry_items i ON i.registry_id = r.id
      LEFT JOIN (
        SELECT item_id, SUM(qty) AS qty_reserved
          FROM gift_registry_reservations
         WHERE status <> 'cancelled'
         GROUP BY item_id
      ) res ON res.item_id = i.id
     WHERE r.store_id = ${storeId}
     ORDER BY r.created_at DESC, i.added_at;
  `);

  const rows: CsvValue[][] = result.rows.map((r) => [
    r.registry_id, r.share_token,
    r.owner_email, r.owner_name,
    r.event_name, r.event_date, r.created_at,
    r.item_id, r.shopify_product_id, r.shopify_variant_id,
    r.product_title, r.variant_title, r.product_handle,
    r.price_amount, r.price_currency,
    r.qty_wanted, Number(r.qty_reserved),
    r.notes, r.added_at,
  ]);

  return new Response(csvBody(HEADER, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename('gift-registries', store.shopDomain)}"`,
      'cache-control': 'no-store',
    },
  });
}
