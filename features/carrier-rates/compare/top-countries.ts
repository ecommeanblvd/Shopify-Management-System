import { and, desc, count, gte, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface TopCountry {
  code: string; // ISO-2 upper
  orders: number;
}

/**
 * Cụm nước line ship rẻ (dưới ~$30/0.5kg): Đông Nam Á + Trung Quốc + Nhật +
 * Hàn. LUÔN xuất hiện trong bảng so sánh cước, dù không nằm top đơn Shopify.
 */
export const CHEAP_LINE_COUNTRIES = [
  'TH', 'SG', 'MY', 'ID', 'PH', 'KH', 'LA', 'MM', 'BN', 'CN', 'JP', 'KR',
] as const;

export interface TopShopifyCountriesOptions {
  limit?: number;
  monthsBack?: number;
  /** Mã nước (ISO-2) loại khỏi kết quả, dù orders cao. */
  exclude?: string[];
  /** Mã nước LUÔN có trong kết quả (thêm vào nếu chưa nằm trong top `limit`). */
  forceInclude?: readonly string[];
}

/**
 * Hợp nhất danh sách nước đã group-by-count với `exclude`/`forceInclude` —
 * hàm THUẦN, không I/O, để test độc lập. `grouped` phải đã upper-case và
 * sort desc theo `orders` (đúng như kết quả SQL trả về).
 */
export function mergeCompareCountries(
  grouped: TopCountry[],
  opts: { limit: number; exclude: string[]; forceInclude: readonly string[] },
): TopCountry[] {
  const exclude = new Set(opts.exclude.map((c) => c.toUpperCase()));
  const filtered = grouped.filter((r) => !exclude.has(r.code));

  const top = filtered.slice(0, opts.limit);
  const result = [...top];
  const present = new Set(result.map((r) => r.code));

  for (const rawCode of opts.forceInclude) {
    const code = rawCode.toUpperCase();
    if (exclude.has(code) || present.has(code)) continue;
    const found = filtered.find((r) => r.code === code);
    result.push({ code, orders: found ? found.orders : 0 });
    present.add(code);
  }

  return result;
}

/**
 * Top nước nhận hàng theo số đơn Shopify trong `monthsBack` tháng gần nhất
 * (mặc định 12 nước / 6 tháng). Đếm theo `ship_country`, bỏ NULL/rỗng. Dùng
 * `processed_at_shopify` (ngày đơn) làm mốc thời gian.
 *
 * `exclude`: loại nước nội địa (VD: VN) khỏi bảng so sánh.
 * `forceInclude`: LUÔN kèm cụm nước (VD: line ship rẻ) dù không nằm top đơn.
 */
export async function topShopifyCountries(
  opts: TopShopifyCountriesOptions = {},
): Promise<TopCountry[]> {
  const { limit = 12, monthsBack = 6, exclude = [], forceInclude = [] } = opts;
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
    .orderBy(desc(count()));

  const grouped: TopCountry[] = rows.map((r) => ({ code: r.code, orders: Number(r.orders) }));
  return mergeCompareCountries(grouped, { limit, exclude, forceInclude });
}
