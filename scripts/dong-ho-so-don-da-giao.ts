/**
 * ĐÓNG hồ sơ fulfillment của đơn ĐÃ GIAO mà chưa ai kiểm trong SMS (CEO 30/09/2026).
 *
 * Ca thật: 19 đơn TINH Atelier + 1 đơn MBLVD từ 2021 — Shopify nói đã giao xong, nhưng dòng
 * bên mình còn ở `pending_check`, tức chưa ai mở ra kiểm bao giờ. Chúng không giữ hàng (chưa
 * được cấp kho) nên không hại gì, chỉ nằm im trong hàng đợi làm nhiễu việc thật.
 *
 * MẶC ĐỊNH LÀ ĐẾM. Phải truyền `--ap-dung` mới ghi.
 *
 * CHỐT CHẶN: chỉ đụng dòng KHÔNG giữ hàng. Dòng đang giữ kho thì bỏ qua và báo — nhả hàng là
 * việc của `don-giu-hang-oan.ts`, có đường ghi sổ riêng. Trộn hai việc vào một script là lúc
 * sai thì không biết cái nào gây ra.
 */
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recomputeRollup } from '@/features/fulfillment/rollup';

const AP_DUNG = process.argv.includes('--ap-dung');

async function main() {
  console.log(AP_DUNG ? '*** GHI THẬT ***' : '--- ĐẾM, không ghi ---');

  const can = await db.execute<Record<string, string>>(sql`
    SELECT f.id::text AS ho_so, o.shopify_order_number AS don,
           to_char(MIN(o.created_at_shopify),'DD/MM/YY') AS ngay, f.status::text AS dang_o,
           COUNT(fl.id)::text AS so_dong,
           COUNT(fl.id) FILTER (WHERE fl.warehouse_inventory_id IS NOT NULL)::text AS dong_dang_giu_hang
      FROM order_fulfillment f
      JOIN shopify_orders o ON o.id = f.order_id
      JOIN order_fulfillment_lines fl ON fl.fulfillment_id = f.id
     WHERE f.status IN ('received','checking','ready_to_pick','picking')
       AND o.fulfillment_status = 'FULFILLED'
     GROUP BY f.id, o.shopify_order_number, f.status ORDER BY MIN(o.created_at_shopify)`);

  console.log(`\nHồ sơ cần đóng: ${can.rows.length}`);
  for (const r of can.rows) console.log('   ', JSON.stringify(r));

  const coGiuHang = can.rows.filter((r) => Number(r.dong_dang_giu_hang) > 0);
  if (coGiuHang.length > 0) {
    console.log(`\n!! ${coGiuHang.length} hồ sơ CÓ dòng đang giữ hàng — BỎ QUA, chạy don-giu-hang-oan.ts trước.`);
  }
  const lam = can.rows.filter((r) => Number(r.dong_dang_giu_hang) === 0);
  console.log(`Sẽ đóng: ${lam.length}`);

  if (!AP_DUNG) { console.log('\n--- không ghi gì. Thêm --ap-dung để chạy thật. ---'); process.exit(0); }

  let xong = 0, loi = 0;
  for (const r of lam) {
    try {
      await db.transaction(async (tx) => {
        await tx.update(schema.orderFulfillmentLines)
          .set({ status: 'shipped', updatedAt: sql`now()` })
          .where(eq(schema.orderFulfillmentLines.fulfillmentId, r.ho_so));
        /* Tính lại bằng chính luật rollup, KHÔNG tự đặt trạng thái hồ sơ bằng tay — đúng lỗi
         * bản dọn trước đã mắc: đổi dòng mà quên tổng, để lại hai sự thật đá nhau. */
        await recomputeRollup(tx, r.ho_so);
      });
      xong++;
    } catch (e) { loi++; console.error(`  HỎNG ${r.don}:`, String(e).slice(0, 140)); }
  }

  const con = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM order_fulfillment f JOIN shopify_orders o ON o.id = f.order_id
     WHERE f.status IN ('received','checking','ready_to_pick','picking') AND o.fulfillment_status = 'FULFILLED'`);
  console.log(`\nĐã đóng ${xong} hồ sơ (hỏng ${loi}) · còn lại ${con.rows[0]?.n}`);
  process.exit(loi > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HỎNG:', e instanceof Error ? e.stack : String(e)); process.exit(1); });
