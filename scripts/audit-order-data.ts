/**
 * Rà soát READ-ONLY chất lượng dữ liệu đơn/shipment: liệt kê các trạng thái BẤT KHẢ
 * (ngày/cân/nhất quán) + mẫu đơn. Không sửa gì. Chạy định kỳ để bắt rác sớm.
 *
 *   railway run npx tsx scripts/audit-order-data.ts
 *
 * Sửa rác tìm được: scripts/cleanup-bad-shipment-data.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

type Check = { tag: string; kind: 'ERR' | 'INFO'; q: ReturnType<typeof sql> };

const SAMP = sql`(array_agg(o.shopify_order_number ORDER BY o.shopify_order_number))[1:6]`;
const J = sql`FROM shipments sh JOIN shopify_orders o ON o.id=sh.order_id`;

const checks: Check[] = [
  { tag: 'label_created_at ở tương lai (lịch VN)', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.label_created_at::date > (now() + interval '7 hours')::date` },
  { tag: 'label TRƯỚC ngày đặt đơn', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.label_created_at IS NOT NULL AND sh.label_created_at < o.processed_at_shopify - interval '1 day'` },
  { tag: 'label quá cũ (<2020)', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.label_created_at < '2020-01-01'` },
  { tag: 'delivered TRƯỚC khi ship (delivered < label)', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.delivered_at IS NOT NULL AND sh.label_created_at IS NOT NULL AND sh.delivered_at < sh.label_created_at` },
  { tag: 'delivered_at rác (<2020)', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.delivered_at < '2020-01-01'` },
  { tag: 'delivered_at ở tương lai', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.delivered_at > now()` },
  { tag: 'processed_at (ngày đặt) ở tương lai', kind: 'ERR',
    q: sql`SELECT count(*)::int n, (array_agg(shopify_order_number))[1:6] s FROM shopify_orders o WHERE o.processed_at_shopify > now()` },
  { tag: 'cân nặng <= 0 dù có tracking', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.tracking_number IS NOT NULL AND sh.actual_weight_kg IS NOT NULL AND sh.actual_weight_kg <= 0` },
  { tag: 'cân nặng > 100kg', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.actual_weight_kg > 100` },
  { tag: 'delivery_status=delivered nhưng delivered_at NULL', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.delivery_status='delivered' AND sh.delivered_at IS NULL` },
  { tag: `tracking = 'N/A' (rác)`, kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.tracking_number = 'N/A'` },
  { tag: 'có tracking nhưng carrier NULL', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.tracking_number IS NOT NULL AND sh.tracking_number <> 'N/A' AND sh.carrier_key IS NULL` },
  { tag: 'đơn ĐÃ HUỶ vẫn có tracking', kind: 'ERR',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE o.cancelled_at_shopify IS NOT NULL AND sh.tracking_number IS NOT NULL` },
  { tag: 'financial_status lạ (ngoài enum)', kind: 'ERR',
    q: sql`SELECT count(*)::int n, (array_agg(DISTINCT financial_status))[1:6] s FROM shopify_orders o WHERE financial_status NOT IN ('PENDING','AUTHORIZED','PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED','VOIDED','EXPIRED')` },
  { tag: 'có tracking nhưng THIẾU cân nặng', kind: 'INFO',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.tracking_number IS NOT NULL AND sh.actual_weight_kg IS NULL` },
  { tag: 'có tracking nhưng THIẾU ngày label', kind: 'INFO',
    q: sql`SELECT count(*)::int n, ${SAMP} s ${J} WHERE sh.tracking_number IS NOT NULL AND sh.label_created_at IS NULL` },
];

async function main(): Promise<void> {
  const [{ o }] = (await db.execute<{ o: number }>(sql`SELECT count(*)::int o FROM shopify_orders`)).rows;
  const [{ sh }] = (await db.execute<{ sh: number }>(sql`SELECT count(*)::int sh FROM shipments`)).rows;
  process.stdout.write(`\n=== AUDIT: ${o} đơn · ${sh} shipment ===\n`);
  let errTotal = 0;
  for (const c of checks) {
    const r = (await db.execute<{ n: number; s: string[] | null }>(c.q)).rows[0];
    const n = Number(r?.n ?? 0);
    if (c.kind === 'ERR') errTotal += n;
    const flag = n === 0 ? '✅' : c.kind === 'ERR' ? '❌' : 'ℹ️ ';
    const samp = n > 0 && r?.s ? `  → ${r.s.filter(Boolean).join(', ')}` : '';
    process.stdout.write(`${flag} [${c.kind}] ${c.tag}: ${n}${samp}\n`);
  }
  process.stdout.write(`\nTổng lỗi (ERR): ${errTotal}\n`);
  process.exit(errTotal > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`audit-order-data: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
