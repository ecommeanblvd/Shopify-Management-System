import { and, count, desc, gte, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface TopCountry {
  code: string; // ISO-2 upper
  orders: number;
}

/**
 * Top nước nhận hàng theo số đơn Shopify trong `monthsBack` tháng gần nhất
 * (mặc định 12 nước / 6 tháng). Đếm theo `ship_country`, bỏ NULL/rỗng. Dùng
 * `processed_at_shopify` (ngày đơn) làm mốc thời gian.
 */
export async function topShopifyCountries(limit = 12, monthsBack = 6): Promise<TopCountry[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const rows = await db
    .select({
      code: sql<string>`upper(${schema.shopifyOrders.shipCountry})`,
      orders: count(),
    })
    .from(schema.shopifyOrders)
    .where(and(
      gte(schema.shopifyOrders.processedAtShopify, since),
      isNotNull(schema.shopifyOrders.shipCountry),
      ne(schema.shopifyOrders.shipCountry, ''),
    ))
    .groupBy(sql`upper(${schema.shopifyOrders.shipCountry})`)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({ code: r.code, orders: Number(r.orders) }));
}
