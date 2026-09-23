/** Tra cứu phục vụ ô quét: mã thuộc đơn nào, hàng này đang nằm ở đơn chờ nào. */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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

/**
 * Các đơn CHƯA nhận xong đang có loại hàng này — kho quét hàng lúc chưa mở đơn nào (spec §5:
 * "V: khi chưa mở đơn → liệt kê các đơn đang chờ có món ấy").
 *
 * "Chưa nhận xong" xét ở CẢ hai mức:
 *  - Đơn chưa huỷ — cùng quy ước `isNull(cancelledAtShopify)` mà
 *    `features/warehouse/staging-queries.ts` (listStaging) và `features/warehouse/allocate.ts`
 *    đã dùng để loại đơn huỷ khỏi việc còn phải xử lý, không tự chế tiêu chí mới.
 *  - Món (nếu đã nối được sang `lark_mon_don` — xem `sync-line-id.ts`) chưa bị huỷ trên Lark
 *    (`huy = false`) và CHƯA có dòng `wh_nhan_kcs` (chưa ai nhận). Món chưa nối được line id thì
 *    không có bằng chứng đã nhận nên vẫn tính là đang chờ.
 *
 * Join `lark_mon_don` theo `shopify_line_id` (UNIQUE MỘT PHẦN `lark_mon_don_line_uniq`) rồi
 * `wh_nhan_kcs` theo `mon_dinh_danh` (UNIQUE `wh_nhan_kcs_mon_uniq`) — cả hai đều cho ra
 * 0-hoặc-1 dòng nên KHÔNG nhân đôi kết quả, khác bản cũ join thẳng `wh_nhan_kcs` theo `sku`
 * (không unique, mỗi lần SKU được nhận xong lại nhân thêm một bản — review 23/09/2026 Finding 1).
 * `selectDistinct` (gồm cả `processedAt` — hằng định theo đơn, không phá tính duy nhất) đề
 * phòng một đơn có hai dòng đơn cùng biến thể (mua 2 lần tách dòng): vẫn chỉ ra một hàng
 * đơn+sku, đúng yêu cầu "một đơn và một mã hàng chỉ xuất hiện một lần".
 */
export async function donChoCoBienThe(shopifyVariantId: string): Promise<Array<{ orderNumber: string; sku: string | null }>> {
  const rows = await db
    .selectDistinct({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      sku: schema.shopifyOrderLines.sku,
      processedAt: schema.shopifyOrders.processedAtShopify,
    })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .leftJoin(schema.larkMonDon, eq(schema.larkMonDon.shopifyLineId, schema.shopifyOrderLines.shopifyLineId))
    .leftJoin(schema.whNhanKcs, eq(schema.whNhanKcs.monDinhDanh, schema.larkMonDon.dinhDanh))
    .where(and(
      sql`regexp_replace(${schema.shopifyOrderLines.shopifyVariantId}, '^.*/', '') = ${shopifyVariantId}`,
      isNull(schema.shopifyOrders.cancelledAtShopify),
      isNull(schema.whNhanKcs.id),
      sql`(${schema.larkMonDon.dinhDanh} IS NULL OR ${schema.larkMonDon.huy} = false)`,
    ))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(20);
  return rows.map(({ orderNumber, sku }) => ({ orderNumber, sku }));
}
