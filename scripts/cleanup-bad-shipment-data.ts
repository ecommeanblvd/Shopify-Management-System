/**
 * Dọn các giá trị RÁC rõ ràng trên shipments (nguồn: placeholder/parse Lark hỏng).
 * Chỉ null-hoá dữ liệu bất khả, KHÔNG đụng dữ liệu hợp lệ. Parser Lark nay đã chặn
 * tại nguồn (parse-pack-row / parse-status-row) — script này dọn các row đã lỡ lưu.
 *
 *   railway run npx tsx scripts/cleanup-bad-shipment-data.ts --dry-run   # chỉ đếm
 *   railway run npx tsx scripts/cleanup-bad-shipment-data.ts             # dọn thật
 *
 * Thay cho scripts/cleanup-future-label-dates.ts (bao trùm rộng hơn).
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

interface Fix {
  tag: string;
  count: ReturnType<typeof sql>;
  update: ReturnType<typeof sql>;
}

const fixes: Fix[] = [
  {
    tag: 'label_created_at ở NGÀY TƯƠNG LAI (theo lịch VN) → NULL',
    count: sql`SELECT count(*)::int n FROM shipments WHERE label_created_at::date > (now() + interval '7 hours')::date`,
    update: sql`UPDATE shipments SET label_created_at = NULL, updated_at = now()
                 WHERE label_created_at::date > (now() + interval '7 hours')::date RETURNING id`,
  },
  {
    tag: 'label_created_at TRƯỚC ngày đặt đơn (bất khả) → NULL',
    count: sql`SELECT count(*)::int n FROM shipments sh JOIN shopify_orders o ON o.id=sh.order_id
                WHERE sh.label_created_at IS NOT NULL AND sh.label_created_at < o.processed_at_shopify - interval '1 day'`,
    update: sql`UPDATE shipments sh SET label_created_at = NULL, updated_at = now()
                 FROM shopify_orders o WHERE o.id = sh.order_id
                  AND sh.label_created_at IS NOT NULL AND sh.label_created_at < o.processed_at_shopify - interval '1 day'
                RETURNING sh.id`,
  },
  {
    tag: 'delivered_at rác (< 2020, vd 1997) → NULL',
    count: sql`SELECT count(*)::int n FROM shipments WHERE delivered_at < '2020-01-01'`,
    update: sql`UPDATE shipments SET delivered_at = NULL, updated_at = now()
                 WHERE delivered_at < '2020-01-01' RETURNING id`,
  },
  {
    tag: `tracking_number = 'N/A' (rác) → NULL`,
    count: sql`SELECT count(*)::int n FROM shipments WHERE tracking_number = 'N/A'`,
    update: sql`UPDATE shipments SET tracking_number = NULL, updated_at = now()
                 WHERE tracking_number = 'N/A' RETURNING id`,
  },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  let grand = 0;
  for (const f of fixes) {
    const n = Number((await db.execute<{ n: number }>(f.count)).rows[0]?.n ?? 0);
    grand += n;
    if (dryRun || n === 0) {
      process.stdout.write(`${n === 0 ? '✅' : '•'} ${f.tag}: ${n}\n`);
      continue;
    }
    const res = await db.execute<{ id: string }>(f.update);
    process.stdout.write(`✔ ${f.tag}: đã dọn ${res.rows.length}\n`);
  }
  process.stdout.write(`\n${dryRun ? 'DRY-RUN — chưa đổi gì. ' : ''}Tổng row rác: ${grand}\n`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`cleanup-bad-shipment-data: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
