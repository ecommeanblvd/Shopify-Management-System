import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';
(async () => {
  // Ưu tiên: đơn ĐÃ có ngày nhận WH (nhóm by_received của MMP) — payload mới sẽ mang receivedAt
  const rows = await db.execute(sql`
    SELECT p.order_id AS id
    FROM mmp_order_pushes p JOIN shopify_orders o ON o.id = p.order_id
    WHERE p.status = 'sent' AND EXISTS (
      SELECT 1 FROM mmp_line_received lr
      WHERE lr.order_number = REPLACE(o.shopify_order_number, '#', '') AND lr.received_at IS NOT NULL)
    ORDER BY o.processed_at_shopify DESC NULLS LAST`);
  const ids = rows.rows.map((r) => String((r as { id: unknown }).id));
  console.log(`Re-check ${ids.length} đơn có ngày nhận WH…`);
  let pushed = 0, skipped = 0, failed = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await pushOrderToMmp(ids[i]);
      if (r.ok && r.skipped) skipped++;
      else if (r.ok) pushed++;
      else failed++;
    } catch { failed++; }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${ids.length} · re-push ${pushed} · không đổi ${skipped} · lỗi ${failed}`);
  }
  console.log(`XONG: re-push ${pushed} đơn (payload đổi — có receivedAt mới), không đổi ${skipped}, lỗi ${failed}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
