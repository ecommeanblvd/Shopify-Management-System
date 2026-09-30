/**
 * ĐẾM (và chỉ khi được bảo mới DỌN) hàng bị giữ oan cho đơn đã giao (CEO 30/09/2026).
 *
 * Vì sao có: lượt nạp 3.238 đơn lịch sử 2025 hôm 30/09 đã cho hệ thống giữ hàng THẬT trên kệ
 * cho những đơn đã giao xong từ 2024–2025, và đẩy đơn đã giao vào hàng đợi việc của kho.
 * Bản vá `nen-giu-hang.ts` chặn việc này TỪ NAY, nhưng KHÔNG dọn thứ đã tạo ra.
 *
 * MẶC ĐỊNH LÀ ĐẾM, KHÔNG GHI. Muốn ghi thật phải truyền `--ap-dung`. Đây là tồn kho đang vận
 * hành: nhả nhầm một món là kho đi bốc rồi không thấy hàng.
 *
 * Chạy đếm:  railway run --service Shopify-Management-System npx tsx scripts/don-giu-hang-oan.ts
 * Chạy thật: railway run --service Shopify-Management-System npx tsx scripts/don-giu-hang-oan.ts --ap-dung
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** Mốc lượt nạp 30/09/2026 (UTC). Chỉ dọn thứ CHÍNH lượt nạp đó tạo ra. */
const MOC_NAP = '2026-09-30 04:00:00';
const AP_DUNG = process.argv.includes('--ap-dung');

const bang = (ten: string, rows: Record<string, unknown>[]) => {
  console.log(`\n### ${ten} — ${rows.length} dòng`);
  for (const r of rows.slice(0, 40)) console.log('   ', JSON.stringify(r));
  if (rows.length > 40) console.log(`    … còn ${rows.length - 40} dòng nữa`);
};

async function main() {
  console.log(AP_DUNG ? '*** CHẾ ĐỘ GHI THẬT ***' : '--- chế độ ĐẾM, không ghi gì ---');

  /* 1. Hàng đang bị giữ cho đơn ĐÃ GIAO, do lượt nạp tạo ra.
   *
   * Bám vào `updated_at` của dòng đơn: chỉ đụng thứ lượt nạp sinh ra, KHÔNG quét cả hệ thống.
   * Có thể còn ca giữ oan cũ hơn — đếm riêng ở mục 3 để CEO quyết, không tự gộp vào. */
  const giuOan = await db.execute<Record<string, unknown>>(sql`
    SELECT fl.id::text AS dong_id, fl.warehouse_inventory_id::text AS o_kho,
           o.shopify_order_number AS don, to_char(o.created_at_shopify,'DD/MM/YYYY') AS ngay_dat,
           o.fulfillment_status AS shopify, fl.sku, fl.allocated_qty::text AS giu,
           w.warehouse_code AS kho
      FROM order_fulfillment_lines fl
      JOIN order_fulfillment f ON f.id = fl.fulfillment_id
      JOIN shopify_orders o ON o.id = f.order_id
      LEFT JOIN warehouse_inventory w ON w.id = fl.warehouse_inventory_id
     WHERE fl.status = 'in_stock' AND fl.warehouse_inventory_id IS NOT NULL
       AND fl.updated_at >= ${MOC_NAP}::timestamp
       AND o.fulfillment_status = 'FULFILLED'
     ORDER BY o.created_at_shopify`);
  bang('A. Hàng giữ oan cho đơn ĐÃ GIAO (do lượt nạp 30/09)', giuOan.rows);
  const tongGiu = giuOan.rows.reduce((s, r) => s + Number(r.giu ?? 0), 0);
  console.log(`    → tổng ${tongGiu} món sẽ được NHẢ ra`);

  /* 2. Đơn ĐÃ GIAO nằm trong hàng đợi việc của kho, do lượt nạp tạo ra. */
  const viecMa = await db.execute<Record<string, unknown>>(sql`
    SELECT f.id::text AS ho_so_id, o.shopify_order_number AS don,
           to_char(o.created_at_shopify,'DD/MM/YYYY') AS ngay_dat,
           f.status AS dang_o, o.fulfillment_status AS shopify
      FROM order_fulfillment f
      JOIN shopify_orders o ON o.id = f.order_id
     WHERE f.created_at >= ${MOC_NAP}::timestamp
       AND f.status IN ('received','checking','ready_to_pick','picking')
       AND o.fulfillment_status = 'FULFILLED'
     ORDER BY o.created_at_shopify`);
  bang('B. Đơn ĐÃ GIAO đang nằm trong hàng đợi việc của kho', viecMa.rows);

  /* 3. CHỈ ĐỂ BIẾT, không dọn: ca giữ oan có từ TRƯỚC lượt nạp. */
  const cu = await db.execute<Record<string, unknown>>(sql`
    SELECT COUNT(*)::text AS so_dong, COALESCE(SUM(fl.allocated_qty),0)::text AS so_mon
      FROM order_fulfillment_lines fl
      JOIN order_fulfillment f ON f.id = fl.fulfillment_id
      JOIN shopify_orders o ON o.id = f.order_id
     WHERE fl.status = 'in_stock' AND fl.warehouse_inventory_id IS NOT NULL
       AND fl.updated_at < ${MOC_NAP}::timestamp
       AND o.fulfillment_status = 'FULFILLED'`);
  console.log('\n### C. CHỈ ĐỂ BIẾT — ca giữ oan có TRƯỚC lượt nạp (KHÔNG dọn lượt này)');
  console.log('   ', JSON.stringify(cu.rows[0]));

  if (!AP_DUNG) {
    console.log('\n--- KHÔNG ghi gì. Chạy lại với --ap-dung để dọn thật. ---');
    process.exit(0);
  }

  /* DỌN. Mỗi dòng một transaction riêng: một dòng hỏng không được kéo theo dòng khác, và
   * `applyMovement` là chỗ duy nhất được phép đụng sổ kho — không tự UPDATE tồn kho bằng tay. */
  const { applyMovement } = await import('@/features/warehouse/ledger');
  const { eq } = await import('drizzle-orm');
  const { schema } = await import('@/db/client');
  let nha = 0, loi = 0;
  for (const r of giuOan.rows) {
    try {
      await db.transaction(async (tx) => {
        const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, kho: schema.warehouseInventory.warehouseCode })
          .from(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, String(r.o_kho)));
        if (!inv) throw new Error('không thấy ô kho');
        await applyMovement(tx, {
          sku: inv.sku, warehouseCode: inv.kho,
          deltaOnHand: 0, deltaReserved: -Number(r.giu ?? 1),
          reason: 'release_allocation', refType: 'item', refId: String(r.o_kho),
          note: `Nhả giữ oan: đơn ${r.don} đã giao xong (lượt nạp lịch sử 30/09/2026)`,
          actor: 'system:don-giu-hang-oan',
        });
        await tx.update(schema.orderFulfillmentLines)
          .set({ status: 'shipped', warehouseInventoryId: null, allocatedQty: 0, updatedAt: sql`now()` })
          .where(eq(schema.orderFulfillmentLines.id, String(r.dong_id)));
      });
      nha++;
    } catch (e) {
      loi++;
      console.error(`  HỎNG dòng ${r.dong_id} (${r.don}):`, String(e).slice(0, 160));
    }
  }
  let doHoSo = 0;
  for (const r of viecMa.rows) {
    await db.update(schema.orderFulfillment).set({ status: 'shipped' })
      .where(eq(schema.orderFulfillment.id, String(r.ho_so_id)));
    doHoSo++;
  }
  console.log(`\nĐÃ NHẢ ${nha} món (hỏng ${loi}) · đưa ${doHoSo} hồ sơ ra khỏi hàng đợi.`);
  process.exit(loi > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HỎNG:', e instanceof Error ? e.stack : String(e)); process.exit(1); });
