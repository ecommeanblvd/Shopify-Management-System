/** Tra cứu phục vụ ô quét: mã thuộc đơn nào, hàng này đang nằm ở đơn chờ nào. */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Dòng đơn này thuộc đơn nào — để hỏi "chuyển sang đơn #X?". */
export async function donCuaDong(shopifyLineId: string): Promise<{ orderNumber: string } | null> {
  const [r] = await db
    .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .where(sql`regexp_replace(${schema.shopifyOrderLines.shopifyLineId}, '^.*/', '') = ${shopifyLineId}`)
    .limit(1);
  return r ?? null;
}

/** Các đơn CHƯA nhận xong đang có loại hàng này — kho quét hàng lúc chưa mở đơn nào. */
export async function donChoCoBienThe(shopifyVariantId: string): Promise<Array<{ orderNumber: string; sku: string | null }>> {
  const rows = await db
    .select({ orderNumber: schema.shopifyOrders.shopifyOrderNumber, sku: schema.shopifyOrderLines.sku })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .leftJoin(schema.whNhanKcs, eq(schema.whNhanKcs.sku, schema.shopifyOrderLines.sku))
    .where(sql`regexp_replace(${schema.shopifyOrderLines.shopifyVariantId}, '^.*/', '') = ${shopifyVariantId}`)
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(20);
  return rows;
}
