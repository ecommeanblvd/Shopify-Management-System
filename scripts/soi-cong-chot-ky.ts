/**
 * Cổng chốt kỳ sẽ chặn những kỳ nào, vì lý do gì — CHỈ ĐỌC, không ghi gì.
 *
 * Gọi ĐÚNG hàm mà `phatHanhBangKe` gọi (`chayCongChotKy`), không nạp lại dữ liệu bằng tay: bản
 * đầu của script này có đường nạp riêng và nạp thiếu bảng tuần của Aramex, chặn nhầm hai đơn.
 * Cổng chạy thử và cổng chạy thật phải là một.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/soi-cong-chot-ky.ts
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { chayCongChotKy } from '@/features/ship-ho/statement-core';

async function main(): Promise<void> {
  const ke = await db.execute<Record<string, unknown>>(sql`
    SELECT id, partner_brand_slug brand, period_start::date ky, status,
           (SELECT count(*) FROM ship_ho_orders o WHERE o.statement_id = ship_ho_statements.id) so_don
    FROM ship_ho_statements ORDER BY period_start;`);

  let xanh = 0, chan = 0;
  for (const k of ke.rows) {
    const loi = await chayCongChotKy(String(k.id));
    const nhan = `${String(k.brand).padEnd(12)} ${k.ky} ${String(k.status).padEnd(7)} ${String(k.so_don).padStart(3)} đơn`;
    if (loi.length === 0) { xanh++; console.log(`✓ ${nhan}`); continue; }
    chan++;
    const theoMa = new Map<string, number>();
    for (const l of loi) theoMa.set(l.ma, (theoMa.get(l.ma) ?? 0) + 1);
    console.log(`✗ ${nhan} — ${loi.length} đơn hỏng (${[...theoMa].map(([m, c]) => `${m}:${c}`).join(' ')})`);
    for (const l of loi.slice(0, 5)) console.log(`     ${l.code} [${l.ma}] ${l.ly}`);
    if (loi.length > 5) console.log(`     … còn ${loi.length - 5} đơn`);
  }
  console.log(`\nTổng: ${xanh} kỳ qua cổng · ${chan} kỳ bị chặn`);
  process.exit(0);
}
main();
