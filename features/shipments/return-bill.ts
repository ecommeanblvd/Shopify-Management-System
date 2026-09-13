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

export interface ApplyReturnSummary { linked: number; unresolved: number; linkedShipHo: number }

/** Tìm đơn SHIP HỘ khớp tham chiếu hoàn. Ship hộ có tới ba cách gọi tên nên thử cả ba. */
async function timDonShipHo(ref: ReturnRef): Promise<string | null> {
  const res = ref.kind === 'order'
    ? await db.execute(sql`
        SELECT id FROM ship_ho_orders
         WHERE code = ${ref.orderNumber}
            OR lark_order_number = ${ref.orderNumber}
            OR REPLACE(COALESCE(brand_reference, ''), '#', '') = ${ref.orderNumber}
         LIMIT 1`)
    : await db.execute(sql`
        SELECT id FROM ship_ho_orders WHERE tracking_number = ${ref.trackingNumber} LIMIT 1`);
  return (res.rows[0] as { id?: string } | undefined)?.id ?? null;
}

/**
 * Quét dòng bill chưa gắn: orderRef khớp pattern hoàn → gắn về đơn gốc.
 *
 * Tìm ở CẢ HAI luồng. Trước đây chỉ tra `shopify_orders`/`shipments`, nên cước hoàn của đơn ship
 * hộ không bao giờ gắn được về đâu và rơi vào khoảng không — đúng lúc cần nhất, vì ca ship sai
 * địa chỉ là ca sinh ra cước hoàn (13/09/2026).
 *
 * Đo trên 21 dòng cước hoàn đang có: 21/21 chân hoàn dùng MÃ VẬN ĐƠN RIÊNG, không dòng nào dùng
 * lại mã đi. Vì vậy không thể tra chân hoàn bằng mã đi, và cũng không thể ghép bằng tracking của
 * chính dòng bill — chỉ ghép được qua orderRef.
 */
export async function applyReturnLinks(): Promise<ApplyReturnSummary> {
  const rows = await db.select({
      id: schema.carrierBillLines.id,
      orderNumber: schema.carrierBillLines.orderNumber,
    })
    .from(schema.carrierBillLines)
    .where(and(
      isNull(schema.carrierBillLines.returnOfOrderId),
      isNull(schema.carrierBillLines.returnOfShipHoOrderId),
      isNotNull(schema.carrierBillLines.orderNumber),
    ));

  let linked = 0, unresolved = 0, linkedShipHo = 0;
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
      continue;
    }
    const shipHoId = await timDonShipHo(ref);
    if (shipHoId) {
      await db.execute(sql`UPDATE carrier_bill_lines SET return_of_ship_ho_order_id = ${shipHoId} WHERE id = ${r.id}`);
      linkedShipHo += 1;
    } else {
      unresolved += 1;
    }
  }
  return { linked, unresolved, linkedShipHo };
}
