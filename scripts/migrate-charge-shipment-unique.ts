/**
 * Migration một lần: ép 1 charge / 1 shipment để importer upsert-tại-chỗ
 * (sửa đè khi re-export chỉnh số, không chèn dòng trùng).
 *
 * An toàn: dữ liệu hiện đã 1:1 (đã kiểm — 0 shipment có >1 charge). Nếu
 * tương lai có trùng, lệnh CREATE UNIQUE sẽ báo lỗi → phải dọn trước.
 * Thay index thường trên shipment_id bằng UNIQUE index.
 *
 * Chạy: dotenv -- tsx scripts/migrate-charge-shipment-unique.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main() {
  const dup = await db.execute(
    sql`select count(*)::int as n from (select shipment_id from shipment_charges group by shipment_id having count(*) > 1) d`,
  );
  const n = Number((dup.rows ?? (dup as unknown as { n: number }[]))[0].n);
  if (n > 0) {
    console.error(`ABORT: ${n} shipment đang có >1 charge — dọn trùng trước khi thêm UNIQUE.`);
    process.exit(1);
  }
  await db.execute(sql`DROP INDEX IF EXISTS shipment_charges_shipment_idx`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS shipment_charges_shipment_uniq ON shipment_charges (shipment_id)`);
  console.log('OK: shipment_charges giờ UNIQUE theo shipment_id (1 charge / shipment).');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
