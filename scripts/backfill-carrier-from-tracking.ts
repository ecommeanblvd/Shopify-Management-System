/**
 * Suy carrier cho shipment ĐANG THIẾU carrier_key nhưng ĐÃ có tracking, dựa trên
 * ĐỘ DÀI mã tracking toàn-số (chuẩn cố định của hãng):
 *   - 12 chữ số  → FedEx Express
 *   - 10 chữ số  → DHL Express
 * Mã có chữ / độ dài khác → BỎ QUA (để null, xử lý tay / Lark).
 *
 * An toàn: CHỈ set khi carrier_key đang NULL (không đè). Tự sửa được — nếu sau này
 * Lark điền "Couriers" hoặc hoá đơn carrier về (match theo tracking), carrier thật
 * sẽ ghi đè. Nguyên nhân gốc: cột "Couriers" trên Lark trống/không nhận diện lúc sync.
 *
 *   railway run npx tsx scripts/backfill-carrier-from-tracking.ts --dry-run
 *   railway run npx tsx scripts/backfill-carrier-from-tracking.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const rows = (await db.execute<{ id: string; ord: string; trk: string }>(sql`
    SELECT sh.id, o.shopify_order_number ord, sh.tracking_number trk
      FROM shipments sh JOIN shopify_orders o ON o.id = sh.order_id
     WHERE sh.carrier_key IS NULL
       AND sh.tracking_number ~ '^[0-9]+$'
       AND length(sh.tracking_number) IN (10, 12)
     ORDER BY o.shopify_order_number
  `)).rows;

  let fedex = 0, dhl = 0;
  for (const r of rows) {
    const carrier = r.trk.length === 12 ? 'fedex' : 'dhl';
    if (carrier === 'fedex') fedex++; else dhl++;
    process.stdout.write(`  ${r.ord} · ${r.trk} (${r.trk.length} số) → ${carrier}\n`);
    if (!dryRun) {
      await db.execute(sql`UPDATE shipments SET carrier_key = ${carrier}, updated_at = now() WHERE id = ${r.id}`);
    }
  }

  process.stdout.write(
    `\n${dryRun ? 'DRY-RUN — chưa đổi gì. ' : 'XONG. '}` +
      `FedEx(12 số)=${fedex}, DHL(10 số)=${dhl}, tổng=${rows.length}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`backfill-carrier-from-tracking: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
