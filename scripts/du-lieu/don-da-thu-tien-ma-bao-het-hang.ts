/**
 * Đơn ĐÃ THU TIỀN, chưa giao, mà dòng đang `out_of_stock` — NHƯNG hàng thật sự CÓ.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/don-da-thu-tien-ma-bao-het-hang.ts
 *   ... --loai A|B|C        chỉ một nhóm
 *   ... --csv <đường-dẫn>   xuất ra Excel
 *
 * CHỈ ĐỌC. Chạy từ máy dev (chỉ cần `DATABASE_URL`).
 *
 * Vì sao KHÔNG lọc đơn giản "đã thu tiền + out_of_stock": đo 26/10/2026 ra **492 đơn /
 * 1.077 dòng**, và `out_of_stock` có **22.084 dòng** tổng — nó là đường BÌNH THƯỜNG cho hàng
 * đặt brand (khách trả tiền, brand sản xuất, chờ). Một danh sách 492 đơn "cần xem" mà phần
 * lớn là việc bình thường thì sẽ bị bỏ qua, đúng như mọi cảnh báo nhiễu khác.
 *
 * Tín hiệu đáng nhìn là MÂU THUẪN: hệ thống báo hết hàng trong khi hàng CÓ. Ba nhóm, theo
 * mức hành động được ngay:
 *
 *  A. Có CHIẾC `in_stock` VÀ tồn tổng còn bán ≥ 1
 *     → allocator cấp được NGAY. Dòng còn `out_of_stock` nghĩa là chưa ai chạy lại
 *       (`reallocateSku`) hoặc có lỗi. Mức: cao nhất.
 *  D. Có CHIẾC `in_stock` nhưng tồn tổng còn bán = 0 — HAI BẢNG NÓI KHÁC NHAU
 *     → allocator KHÔNG cấp được: nó pick chiếc rồi giữ chỗ qua `applyMovement`, mà
 *       `warehouse_inventory` có ràng buộc `reserved <= on_hand` nên giữ chỗ khi tồn 0 sẽ vỡ.
 *       Nhóm này sinh ra từ D-256: `warehouse_inventory` nay đồng bộ từ Lark, còn
 *       `goods_receipt_items` vẫn do SMS quản — hai bảng trôi khỏi nhau được.
 *  B. Có TỒN TỔNG nhưng KHÔNG có chiếc nào
 *     → hàng tồn tại ở sổ tổng mà allocator không pick được (nó cấp theo từng chiếc).
 *       Đúng ca hàng resale: tồn đồng bộ từ Lark, không đi qua phiếu nhận.
 *  C. Chỉ Lark nói đang `Lưu kho`, cả hai bảng SMS đều không có
 *     → hàng CÓ THỂ còn trong kho mà SMS chưa biết. Cần người ra kho kiểm.
 *
 * Ca thật tìm ra ngày 26/10/2026 bằng đúng cách nghĩ này: `#MBLVD30867`, thu tiền 24/10,
 * `UNFULFILLED`, dòng `out_of_stock`, mà Lark có hai lô `Lưu kho` cho SKU gốc.
 */
import { writeFileSync } from 'node:fs';
import { db, schema } from '@/db/client';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { skuUngVien } from '@/features/warehouse/allocation-logic';

type Loai = 'A' | 'B' | 'C' | 'D';

async function main(): Promise<void> {
  const lAt = process.argv.indexOf('--loai');
  const chiLoai = lAt >= 0 ? (process.argv[lAt + 1]?.toUpperCase() as Loai | undefined) : undefined;
  const cAt = process.argv.indexOf('--csv');
  const csvPath = cAt >= 0 ? process.argv[cAt + 1] : null;

  // Dòng out_of_stock trên đơn ĐÃ THU TIỀN, CHƯA giao xong, CHƯA huỷ.
  const dong = await db.select({
    sku: schema.orderFulfillmentLines.sku,
    lineId: schema.orderFulfillmentLines.id,
    don: schema.shopifyOrders.shopifyOrderNumber,
    ngay: schema.shopifyOrders.processedAtShopify,
    tien: schema.shopifyOrders.financialStatus,
    giao: schema.shopifyOrders.fulfillmentStatus,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(
      eq(schema.orderFulfillmentLines.status, 'out_of_stock'),
      isNull(schema.shopifyOrders.cancelledAtShopify),
      sql`upper(coalesce(${schema.shopifyOrders.financialStatus},'')) in ('PAID','PARTIALLY_PAID')`,
      ne(sql`upper(coalesce(${schema.shopifyOrders.fulfillmentStatus},''))`, 'FULFILLED'),
    ));

  // Nạp một lượt rồi khớp trong bộ nhớ: ~800 dòng tồn và ~900 chiếc, rẻ hơn 1.077 truy vấn.
  const tonRows = await db.select({
    sku: schema.warehouseInventory.sku,
    con: sql<number>`${schema.warehouseInventory.qtyOnHand} - ${schema.warehouseInventory.qtyReserved}`,
  }).from(schema.warehouseInventory);
  const ton = new Map<string, number>();
  for (const r of tonRows) ton.set(r.sku.toLowerCase(), (ton.get(r.sku.toLowerCase()) ?? 0) + Number(r.con));

  const chiecRows = await db.select({ sku: schema.goodsReceiptItems.sku })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.stockStatus, 'in_stock'));
  const chiec = new Map<string, number>();
  for (const r of chiecRows) {
    if (!r.sku) continue;
    const k = r.sku.toLowerCase();
    chiec.set(k, (chiec.get(k) ?? 0) + 1);
  }

  const larkRows = await db.select({ sku: schema.larkWhInventory.sku, loai: schema.larkWhInventory.inventoryType })
    .from(schema.larkWhInventory).where(eq(schema.larkWhInventory.whAction, 'Lưu kho'));
  const lark = new Map<string, Set<string>>();
  for (const r of larkRows) {
    if (!r.sku) continue;
    const k = r.sku.trim().toLowerCase();
    (lark.get(k) ?? lark.set(k, new Set()).get(k)!).add(r.loai ?? '(không loại)');
  }

  interface Hang {
    loai: Loai; don: string; ngay: string; sku: string; skuTim: string;
    soChiec: number; tonCon: number; larkLoai: string;
  }
  const ra: Hang[] = [];
  for (const d of dong) {
    if (!d.sku) continue;
    const uv = skuUngVien(d.sku);
    const cChiec = uv.find((u) => (chiec.get(u.toLowerCase()) ?? 0) > 0);
    const cTon = uv.find((u) => (ton.get(u.toLowerCase()) ?? 0) > 0);
    const cLark = uv.find((u) => lark.has(u.toLowerCase()));
    // A chỉ khi CẢ HAI đủ. Có chiếc mà tồn tổng = 0 là nhóm D (hai bảng lệch), KHÔNG phải
    // "cấp được ngay" — giữ chỗ sẽ vỡ ràng buộc `reserved <= on_hand`.
    const loai: Loai | null = cChiec && cTon ? 'A' : cChiec ? 'D' : cTon ? 'B' : cLark ? 'C' : null;
    if (!loai) continue; // không tìm thấy hàng ở đâu → out_of_stock là ĐÚNG, bỏ qua
    const tim = (cChiec ?? cTon ?? cLark)!;
    ra.push({
      loai, don: d.don ?? '?', ngay: d.ngay ? new Date(d.ngay).toISOString().slice(0, 10) : '?',
      sku: d.sku, skuTim: tim,
      soChiec: chiec.get((cChiec ?? tim).toLowerCase()) ?? 0,
      tonCon: ton.get((cTon ?? tim).toLowerCase()) ?? 0,
      larkLoai: [...(lark.get((cLark ?? tim).toLowerCase()) ?? [])].join(' | '),
    });
  }

  const loc = chiLoai ? ra.filter((r) => r.loai === chiLoai) : ra;
  const uuTien: Record<Loai, number> = { A: 0, D: 1, B: 2, C: 3 };
  loc.sort((a, b) => uuTien[a.loai] - uuTien[b.loai] || b.ngay.localeCompare(a.ngay));

  console.log('════ ĐƠN ĐÃ THU TIỀN, CHƯA GIAO, DÒNG BÁO HẾT HÀNG — MÀ HÀNG CÓ ════');
  console.log(`Quét ${dong.length} dòng out_of_stock trên đơn đã thu tiền & chưa giao.`);
  console.log(`→ ${ra.length} dòng MÂU THUẪN (hàng tìm được ở đâu đó).\n`);
  for (const L of ['A', 'D', 'B', 'C'] as Loai[]) {
    const n = ra.filter((r) => r.loai === L);
    const ten = {
      A: 'A · có chiếc VÀ có tồn — allocator cấp được NGAY',
      D: 'D · có chiếc nhưng tồn tổng = 0 — HAI BẢNG LỆCH',
      B: 'B · có tồn tổng, KHÔNG có chiếc',
      C: 'C · chỉ Lark nói Lưu kho',
    }[L];
    console.log(`  ${ten}: ${n.length} dòng`);
  }
  if (!loc.length) { console.log('\n(không có dòng nào trong phạm vi đã chọn)'); process.exit(0); }

  console.log('\n──── Chi tiết ────');
  for (const r of loc) {
    console.log(`[${r.loai}] ${r.don} ${r.ngay}`);
    console.log(`     sku đơn: ${r.sku}`);
    if (r.skuTim !== r.sku) console.log(`     tìm thấy dưới: ${r.skuTim}`);
    console.log(`     chiếc in_stock: ${r.soChiec} · tồn còn bán: ${r.tonCon}${r.larkLoai ? ` · Lark: ${r.larkLoai}` : ''}`);
  }

  if (csvPath) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['loai,don,ngay,sku_don,sku_tim_thay,so_chiec_in_stock,ton_con_ban,lark_loai']
      .concat(loc.map((r) => [r.loai, r.don, r.ngay, r.sku, r.skuTim, r.soChiec, r.tonCon, r.larkLoai].map(esc).join(',')));
    writeFileSync(csvPath, '﻿' + csv.join('\n'), 'utf8');
    console.log(`\nĐã xuất ${loc.length} dòng: ${csvPath}`);
  }

  console.log('\n──── Việc theo nhóm ────');
  console.log('  A → chạy lại phân bổ cho SKU đó, hoặc soi vì sao allocator bỏ qua.');
  console.log('  D → hai bảng lệch: chiếc còn in_stock mà sổ tổng nói hết. Đối soát trước khi cấp;');
  console.log('      cấp thẳng sẽ vỡ ràng buộc reserved <= on_hand.');
  console.log('  B → tồn có ở sổ tổng mà không có chiếc để pick: kiểm kho rồi tạo phiếu nhận, hoặc cấp tay.');
  console.log('  C → SMS chưa biết hàng này: người ra kho kiểm lô Lark còn thật không.');
  process.exit(0);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
