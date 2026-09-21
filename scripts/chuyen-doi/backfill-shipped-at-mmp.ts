/** Một lần: bắn order.shipped_at { shippedAt } cho danh sách đơn MMP yêu cầu (21/09/2026).
 *  Chạy: railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/backfill-shipped-at-mmp.ts [danh-sach.txt] [--dry] */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { emitShipHoEvent } from '@/features/ship-ho/mmp-events';

const args = process.argv.slice(2); const DRY = args.includes('--dry'); const file = args.find((a) => !a.startsWith('--'));
async function main() {
  const refs = file ? readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : null;
  // File danh sách rỗng KHÔNG được hiểu thành "bắn cho mọi đơn": `IN ()` là SQL lỗi, và
  // nếu lỡ rơi xuống nhánh không-file thì bắn nhầm cả trăm đơn. Dừng hẳn, mã thoát 1.
  if (refs && refs.length === 0) { console.log(`Danh sách rỗng (${file}) — không có mã nào để bắn, dừng.`); return process.exit(1); }
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; shipped_at: string | null }>(refs
    ? sql`SELECT id, code, source, mmp_ref, shipped_at::text FROM ship_ho_orders WHERE COALESCE(mmp_ref, code) IN ${refs}`
    : sql`SELECT o.id, o.code, o.source, o.mmp_ref, o.shipped_at::text FROM ship_ho_orders o WHERE EXISTS (SELECT 1 FROM ship_ho_order_events e WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered')`);
  console.log(`Đơn: ${rows.length}${DRY ? ' (dry)' : ''}; thiếu ngày gửi: ${rows.filter((r) => !r.shipped_at).length}`);
  if (refs) { const co = new Set(rows.map((r) => r.mmp_ref ?? r.code)); console.log('MMP gửi mà SMS không có:', refs.filter((r) => !co.has(r))); }
  if (DRY) return process.exit(0);
  for (const r of rows) if (r.shipped_at) await emitShipHoEvent({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref }, 'order.shipped_at', { shippedAt: r.shipped_at });
  const k = await db.execute<{ ok: string; loi: string }>(sql`SELECT count(*) FILTER (WHERE delivery_status='delivered') ok, count(*) FILTER (WHERE delivery_status<>'delivered') loi FROM ship_ho_order_events WHERE event='order.shipped_at'`);
  console.log(k.rows[0]); process.exit(0);
}
main();
