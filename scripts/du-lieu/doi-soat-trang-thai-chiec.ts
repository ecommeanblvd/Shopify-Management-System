/**
 * Đối soát trạng thái CHIẾC: chiếc còn `allocated` mà dòng đơn đã `shipped` → đánh dấu `shipped`.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/doi-soat-trang-thai-chiec.ts            # chỉ in
 *   npx dotenv -- npx tsx scripts/du-lieu/doi-soat-trang-thai-chiec.ts --ap-dung  # sửa thật
 *   ... --csv <đường-dẫn>
 *
 * DRY-RUN LÀ MẶC ĐỊNH.
 *
 * ## Vì sao có lượt này
 *
 * Đo 26/10/2026: **311 chiếc** mang `stock_status='allocated'` trong khi dòng đơn của chúng đã
 * `shipped` — tức hàng đã RA KHỎI KHO theo đơn mà bản ghi chiếc vẫn nói đang giữ chỗ trong kho.
 * Trải từ 16/06 đến 30/09, 234 SKU. (38 chiếc `allocated` còn lại là ĐÚNG — dòng của chúng
 * đang `in_stock`, khớp `qty_reserved = 38`.)
 *
 * ## NGUYÊN NHÂN CHƯA XÁC LẬP ĐƯỢC — nói rõ để lượt sau không tin nhầm
 *
 * Tôi đã đoán sai HAI lần (26/10/2026): đầu tiên bảo là `features/packing/actions.ts:136`
 * (ship kiện) không chạm `goods_receipt_items` — nhưng đường đó CÓ đặt `shippedAt`, mà cả
 * 334 dòng `shipped` đều KHÔNG có `shipped_at`, `picked_at`, `shipment_id`. Rồi bảo là
 * `scripts/dong-ho-so-don-da-giao.ts:52` — nhưng chính script đó có chốt "chỉ đụng dòng KHÔNG
 * giữ hàng" và không chạm `goods_receipt_items` lần nào.
 *
 * Nên: **chưa biết cái gì tạo ra 311 chiếc này**, và vì vậy **chưa biết nó có tái diễn hay
 * không**. Ứng viên còn lại chưa loại: `scripts/don-giu-hang-oan.ts:113`. Lượt dọn này vẫn
 * an toàn vì bằng chứng "hàng đã đi" KHÔNG dựa vào nguyên nhân (xem chốt chặn dưới), nhưng
 * đừng coi nó là đã chữa gốc.
 *
 * ## Chốt chặn: đòi SHOPIFY xác nhận đơn đã giao
 *
 * `order_fulfillment_lines.status='shipped'` một mình là chưa đủ: cả 334 dòng đó không có
 * `shipped_at` nên không biết ai đặt, lúc nào. Nên điều kiện đòi THÊM
 * `shopify_orders.fulfillment_status='FULFILLED'` và đơn **chưa huỷ** — đó là xác nhận từ hệ
 * thống NGOÀI rằng hàng đã rời kho, không phụ thuộc vào việc SMS tự nói gì về mình.
 * Đo 26/10/2026: cả 311/311 chiếc đều có đơn `FULFILLED`, không đơn nào huỷ.
 *
 * ## Vì sao CHỈ đổi trạng thái, KHÔNG ghi sổ cái
 *
 * Từ D-256, `qty_on_hand` do Lark làm chủ và bị ghi đè MỖI GIỜ theo số của Lark. Một cú
 * `deltaOnHand: -1` ở đây sẽ bị lượt đồng bộ kế tiếp xoá đi, mà nếu Lark cũng đã trừ (hàng đã
 * rời kho thật) thì trừ thêm là ĐẾM TRÙNG. `qty_reserved` thì sổ cái đã nhất quán rồi: cấp
 * 349 − trả 311 = 38 = `qty_reserved` hiện tại. Nên lượt này là ĐỔI TRẠNG THÁI THUẦN.
 */
import { writeFileSync } from 'node:fs';
import { db, schema } from '@/db/client';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { lyDoKhongSuaChiec } from '@/features/warehouse/doi-soat-chiec-logic';

async function main(): Promise<void> {
  const apDung = process.argv.includes('--ap-dung');
  const cAt = process.argv.indexOf('--csv');
  const csvPath = cAt >= 0 ? process.argv[cAt + 1] : null;

  console.log(apDung ? '*** ÁP DỤNG — SỬA THẬT ***\n' : '*** DRY-RUN — không sửa gì (thêm --ap-dung để sửa) ***\n');

  // Điều kiện HẸP và tường minh: chiếc `allocated`, có nối dòng, và dòng đó ĐÚNG là `shipped`.
  // KHÔNG lấy chiếc không nối dòng nào (`fulfillment_line_id IS NULL`) — không có bằng chứng
  // nào nói hàng đó đã đi, và đánh dấu `shipped` là làm nó biến mất vĩnh viễn.
  const can = await db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    kho: schema.goodsReceiptItems.currentWarehouseCode,
    lineId: schema.orderFulfillmentLines.id,
    don: schema.shopifyOrders.shopifyOrderNumber,
    giaoShopify: schema.shopifyOrders.fulfillmentStatus,
  }).from(schema.goodsReceiptItems)
    .innerJoin(schema.orderFulfillmentLines,
      eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(
      eq(schema.goodsReceiptItems.stockStatus, 'allocated'),
      eq(schema.orderFulfillmentLines.status, 'shipped'),
      // Xác nhận TỪ NGOÀI, không tin SMS tự nói về mình — xem chốt chặn ở đầu tệp.
      sql`upper(coalesce(${schema.shopifyOrders.fulfillmentStatus},'')) = 'FULFILLED'`,
      sql`${schema.shopifyOrders.cancelledAtShopify} is null`,
    ));

  const [tong] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.stockStatus, 'allocated'));
  const tongGiuCho = Number(tong?.n ?? 0);

  console.log(`Chiếc đang 'allocated'            : ${tongGiuCho}`);
  console.log(`→ dòng đơn đã 'shipped' (cần sửa) : ${can.length}`);
  console.log(`→ dòng còn 'in_stock' (ĐÚNG, bỏ)  : ${tongGiuCho - can.length}`);

  if (can.length) {
    console.log(`\n${new Set(can.map((c) => c.sku)).size} SKU · ${new Set(can.map((c) => c.don)).size} đơn · tất cả đều FULFILLED trên Shopify`);
    console.log('\n5 chiếc đầu:');
    for (const c of can.slice(0, 5)) console.log(`  ${c.unitCode}  ${c.sku}  kho ${c.kho}  đơn ${c.don} (${c.giaoShopify})`);
  }

  if (csvPath && can.length) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    writeFileSync(csvPath, '﻿' + ['ma_chiec,sku,kho,don,shopify_giao']
      .concat(can.map((c) => [c.unitCode, c.sku, c.kho, c.don, c.giaoShopify].map(esc).join(',')))
      .join('\n'), 'utf8');
    console.log(`\nĐã xuất ${can.length} dòng: ${csvPath}`);
  }

  const chan = lyDoKhongSuaChiec(can.length, tongGiuCho);
  if (chan) { console.log(`\nTỪ CHỐI: ${chan}`); process.exit(1); }

  if (!apDung) {
    console.log(`\nKhông sửa gì. Soi xong thì chạy lại với --ap-dung.`);
    console.log('Hoàn tác: UPDATE goods_receipt_items SET stock_status=\'allocated\' WHERE id IN (...) — giữ CSV lại.');
    process.exit(0);
  }

  // Sửa theo LÔ id đã chọn ở trên, không theo điều kiện lọc — để không bao giờ sửa nhiều hơn
  // số vừa in ra cho người xem. Cùng nếp hàng rào xoá của `goods_receipt_items.larkRecordId`.
  let sua = 0;
  const LO = 200;
  for (let i = 0; i < can.length; i += LO) {
    const ids = can.slice(i, i + LO).map((c) => c.id);
    const r = await db.update(schema.goodsReceiptItems)
      .set({ stockStatus: 'shipped', updatedAt: sql`now()` })
      .where(and(
        inArray(schema.goodsReceiptItems.id, ids),
        // Guard lại trạng thái cũ: nếu ai đó vừa đổi giữa lúc đọc và lúc ghi thì bỏ qua.
        eq(schema.goodsReceiptItems.stockStatus, 'allocated'),
      ));
    sua += (r as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  console.log(`\nĐã sửa ${sua}/${can.length} chiếc sang 'shipped'.`);

  const [conLai] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.orderFulfillmentLines, eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .where(and(eq(schema.goodsReceiptItems.stockStatus, 'allocated'), eq(schema.orderFulfillmentLines.status, 'shipped')));
  console.log(`Kiểm lại: còn ${Number(conLai?.n ?? 0)} chiếc kẹt (mong đợi 0).`);
  process.exit(0);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
