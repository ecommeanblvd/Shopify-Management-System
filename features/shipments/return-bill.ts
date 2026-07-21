/**
 * Nhận diện dòng bill là cước HÀNG HOÀN từ orderRef FedEx và gắn về đơn gốc.
 * Pattern thực tế trên bill: "#MBLVD28712_ R" (suffix _R, có thể lẫn khoảng
 * trắng) và "RETURN OF 872181045003" (theo tracking chiều đi).
 * `parseReturnRef` THUẦN; `applyReturnLinks` là apply step idempotent (chạy sau
 * import bill + cron hourly).
 */
import { sql, and, isNull, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export type ReturnRef =
  | { kind: 'order'; orderNumber: string }   // bare, không '#'
  | { kind: 'tracking'; trackingNumber: string };

export function parseReturnRef(orderRef: string | null | undefined): ReturnRef | null {
  const raw = String(orderRef ?? '').trim();
  if (!raw) return null;
  const m1 = raw.match(/^RETURN\s+OF\s+(\d{8,})$/i);
  if (m1) return { kind: 'tracking', trackingNumber: m1[1] };
  // "_R" suffix (chấp nhận khoảng trắng quanh R): "#MBLVD28712_ R", "TA123_R"
  const m2 = raw.match(/^(.+?)_\s*R$/i);
  if (m2) {
    const orderNumber = m2[1].trim().replace(/^#/, '');
    if (orderNumber) return { kind: 'order', orderNumber };
  }
  return null;
}

export interface ApplyReturnSummary { linked: number; unresolved: number }

/** Quét dòng bill chưa gắn: orderRef khớp pattern hoàn → set return_of_order_id. */
export async function applyReturnLinks(): Promise<ApplyReturnSummary> {
  const rows = await db.select({
      id: schema.carrierBillLines.id,
      orderNumber: schema.carrierBillLines.orderNumber,
    })
    .from(schema.carrierBillLines)
    .where(and(
      isNull(schema.carrierBillLines.returnOfOrderId),
      isNotNull(schema.carrierBillLines.orderNumber),
    ));

  let linked = 0, unresolved = 0;
  for (const r of rows) {
    const ref = parseReturnRef(r.orderNumber);
    if (!ref) continue;
    let orderId: string | null = null;
    if (ref.kind === 'order') {
      const res = await db.execute(sql`
        SELECT id FROM shopify_orders WHERE REPLACE(shopify_order_number, '#', '') = ${ref.orderNumber} LIMIT 1`);
      orderId = (res.rows[0] as { id?: string } | undefined)?.id ?? null;
    } else {
      const res = await db.execute(sql`
        SELECT order_id FROM shipments WHERE tracking_number = ${ref.trackingNumber} LIMIT 1`);
      orderId = (res.rows[0] as { order_id?: string } | undefined)?.order_id ?? null;
    }
    if (orderId) {
      await db.execute(sql`UPDATE carrier_bill_lines SET return_of_order_id = ${orderId} WHERE id = ${r.id}`);
      linked += 1;
    } else {
      unresolved += 1;
    }
  }
  return { linked, unresolved };
}
