/**
 * Dọn ngày ship rác: shipment có `label_created_at` ở TƯƠNG LAI (placeholder Lark
 * kiểu "31/12/2026" cho đơn CHƯA ship) → set NULL. Một label không thể tạo ở
 * tương lai; để lọt thì reconcile lấy nó làm NGÀY SHIP → sai. Parser Lark nay đã
 * chặn tại nguồn, script này dọn các row đã lỡ lưu trước đó.
 *
 *   railway run npx tsx scripts/cleanup-future-label-dates.ts --dry-run   # chỉ đếm
 *   railway run npx tsx scripts/cleanup-future-label-dates.ts             # dọn thật
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const preview = await db.execute<{ label_date: string; n: number }>(sql`
    SELECT label_created_at::date::text AS label_date, count(*)::int AS n
      FROM shipments
     WHERE label_created_at::date > current_date + 2
     GROUP BY 1 ORDER BY n DESC;
  `);
  const total = preview.rows.reduce((s, r) => s + Number(r.n), 0);

  process.stdout.write(`cleanup-future-label-dates: ${total} shipment có label_created_at ở tương lai\n`);
  for (const r of preview.rows) process.stdout.write(`  ${r.label_date}: ${r.n}\n`);

  if (dryRun) {
    process.stdout.write('DRY-RUN — chưa đổi gì.\n');
    process.exit(0);
  }
  if (total === 0) {
    process.stdout.write('Không có gì để dọn.\n');
    process.exit(0);
  }

  const res = await db.execute<{ id: string }>(sql`
    UPDATE shipments SET label_created_at = NULL, updated_at = now()
     WHERE label_created_at::date > current_date + 2
     RETURNING id;
  `);
  process.stdout.write(`XONG — đã set NULL cho ${res.rows.length} shipment.\n`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`cleanup-future-label-dates: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
