'use server';

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseShippingInvoiceCsv } from './parse-shipping-invoice';
import { requirePerm } from '@/features/receiving/perm';

export interface ApplyShippingInvoiceInput {
  storeId: string;
  carrierAccountId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  csvText: string;
  filename: string;
}

export interface ApplyShippingInvoiceResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

/*
 * `applyShippingInvoice` và `applyShippingInvoiceGlobal` tự gác `manage_shipping_invoices`
 * trong thân hàm. Tới 25/10/2026 cả hai KHÔNG kiểm quyền. Action nội tuyến của trang theo
 * store (`orders/[storeId]/shipping-invoices/page.tsx:38-49`) cũng không kiểm gì — quyền chỉ
 * ở thân trang (`:23`); trang toàn cục (`orders/shipping-invoices/page.tsx:57`) có kiểm nhưng
 * đó chỉ là một đường vào.
 *
 * Cổng quyền phải nằm TRONG THÂN HÀM, không ở `page.tsx`. Mỗi export của tệp `'use server'` là
 * một endpoint POST; thân trang chỉ chạy lúc RENDER nên một POST thẳng không kích hoạt nó, và
 * cổng duy nhất của dashboard (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi
 * phiên đăng nhập gọi được, kể cả 3 tài khoản vai `viewer`.
 *
 * Hậu quả: hai hàm UPSERT vào `shipping_invoices` theo (store, tracking) — ghi đè chi phí vận
 * chuyển THỰC của từng vận đơn. Bảng này được P&L đọc ưu tiên hơn ước tính của engine
 * (`features/shopify-orders/dashboard-actions.ts:195-251`) nên sửa nó là đổi biên lợi nhuận
 * từng đơn; bản Global còn tự dò store theo mã vận đơn nên một CSV chạm mọi store.
 *
 * Khoá `manage_shipping_invoices` là ĐÚNG khoá của cả hai trang (`:23`, và `:24`/`:57` ở trang
 * toàn cục). Hai hàm này không nhận `userId` nên không có gì để bỏ.
 */
export async function applyShippingInvoice(input: ApplyShippingInvoiceInput): Promise<ApplyShippingInvoiceResult> {
  await requirePerm('manage_shipping_invoices');
  const { rows, errors } = parseShippingInvoiceCsv(input.csvText);
  if (errors.length > 0) return { inserted: 0, overwritten: 0, errors };
  if (rows.length === 0) return { inserted: 0, overwritten: 0, errors: [] };

  let inserted = 0;
  let overwritten = 0;
  for (const r of rows) {
    const found = await db
      .select({ id: schema.shippingInvoices.id })
      .from(schema.shippingInvoices)
      .where(and(
        eq(schema.shippingInvoices.storeId, input.storeId),
        eq(schema.shippingInvoices.trackingNumber, r.trackingNumber),
      ));
    if (found.length > 0) overwritten++; else inserted++;

    await db.insert(schema.shippingInvoices)
      .values({
        storeId: input.storeId,
        carrierAccountId: input.carrierAccountId,
        trackingNumber: r.trackingNumber,
        invoicePeriodStart: input.invoicePeriodStart,
        invoicePeriodEnd: input.invoicePeriodEnd,
        actualCost: r.actualCost,
        currency: r.currency,
        source: `csv:${input.filename}`,
      })
      .onConflictDoUpdate({
        target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
        set: {
          actualCost: r.actualCost,
          currency: r.currency,
          invoicePeriodStart: input.invoicePeriodStart,
          invoicePeriodEnd: input.invoicePeriodEnd,
          source: `csv:${input.filename}`,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted, overwritten, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────
// Global variant — operator uploads one CSV from the carrier covering
// every store, we auto-resolve each tracking_number to its owning store.
// ─────────────────────────────────────────────────────────────────────

export interface ApplyShippingInvoiceGlobalInput {
  carrierAccountId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  csvText: string;
  filename: string;
}

export interface ApplyShippingInvoiceGlobalResult {
  inserted: number;
  overwritten: number;
  /** Tracking numbers that didn't match any order yet — operator can re-upload
   *  later once the matching order has been backfilled. */
  unmatched: string[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * Upload one carrier invoice that spans multiple stores. We look up each
 * tracking number in `shopify_orders.raw_payload.fulfillments[*].trackingInfo[*]`
 * to discover the owning store and stamp it on the invoice row.
 *
 * Rows whose tracking number isn't in our DB yet (late-arriving order,
 * store not connected, partial backfill) are skipped and returned in
 * `unmatched` so the operator can re-upload after the next sync cycle.
 */
export async function applyShippingInvoiceGlobal(
  input: ApplyShippingInvoiceGlobalInput,
): Promise<ApplyShippingInvoiceGlobalResult> {
  await requirePerm('manage_shipping_invoices');
  const { rows, errors } = parseShippingInvoiceCsv(input.csvText);
  if (errors.length > 0) return { inserted: 0, overwritten: 0, unmatched: [], errors };
  if (rows.length === 0) return { inserted: 0, overwritten: 0, unmatched: [], errors: [] };

  // Single batch lookup: tracking_number → store_id, from the JSONB
  // `fulfillments[].trackingInfo[].number` path inside raw_payload.
  const trackings = rows.map((r) => r.trackingNumber);
  const trackingsSql = sql.join(trackings.map((t) => sql`${t}`), sql`, `);
  const lookupRes = await db.execute<{ tracking: string; store_id: string }>(sql`
    SELECT DISTINCT
           ti ->> 'number' AS tracking,
           o.store_id
      FROM shopify_orders o
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.raw_payload -> 'fulfillments', '[]'::jsonb)) f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f -> 'trackingInfo', '[]'::jsonb)) ti
     WHERE ti ->> 'number' IN (${trackingsSql})
  `);
  const trackingToStore = new Map(lookupRes.rows.map((r) => [r.tracking, r.store_id]));

  let inserted = 0;
  let overwritten = 0;
  const unmatched: string[] = [];

  for (const r of rows) {
    const storeId = trackingToStore.get(r.trackingNumber);
    if (!storeId) {
      unmatched.push(r.trackingNumber);
      continue;
    }

    const found = await db
      .select({ id: schema.shippingInvoices.id })
      .from(schema.shippingInvoices)
      .where(and(
        eq(schema.shippingInvoices.storeId, storeId),
        eq(schema.shippingInvoices.trackingNumber, r.trackingNumber),
      ));
    if (found.length > 0) overwritten++; else inserted++;

    await db.insert(schema.shippingInvoices)
      .values({
        storeId,
        carrierAccountId: input.carrierAccountId,
        trackingNumber: r.trackingNumber,
        invoicePeriodStart: input.invoicePeriodStart,
        invoicePeriodEnd: input.invoicePeriodEnd,
        actualCost: r.actualCost,
        currency: r.currency,
        source: `csv:${input.filename}`,
      })
      .onConflictDoUpdate({
        target: [schema.shippingInvoices.storeId, schema.shippingInvoices.trackingNumber],
        set: {
          actualCost: r.actualCost,
          currency: r.currency,
          invoicePeriodStart: input.invoicePeriodStart,
          invoicePeriodEnd: input.invoicePeriodEnd,
          source: `csv:${input.filename}`,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted, overwritten, unmatched, errors: [] };
}
