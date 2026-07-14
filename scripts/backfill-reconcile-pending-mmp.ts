/**
 * Backfill: gửi `order.reconcile_pending` sang MMP cho các đơn ĐANG 'pending_review'
 * (bill về, có sai lệch, CHƯA duyệt). Sửa các đơn lỡ bị đẩy giá thực (order.reconciled
 * cũ, trước khi có gating) — MMP gỡ "đã đối soát" → về "chờ đối soát" + giá dự tính.
 *
 * Chạy SAU khi MMP đã thêm handler `order.reconcile_pending` (nếu chạy trước,
 * event 404 → pending → cron retry tự giao khi MMP sẵn sàng).
 *
 *   railway run npx tsx scripts/backfill-reconcile-pending-mmp.ts --dry-run
 *   railway run npx tsx scripts/backfill-reconcile-pending-mmp.ts
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from '@/features/ship-ho/mmp-events';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await db
    .select({
      id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      deltaVnd: schema.shipHoOrders.deltaVnd,
    })
    .from(schema.shipHoOrders)
    .where(and(
      eq(schema.shipHoOrders.reconcileStatus, 'reconciled'),
      eq(schema.shipHoOrders.reconcileDecision, 'pending_review'),
    ));

  const eligible = rows.filter((r) => r.source === 'mmp' && r.mmpRef);
  process.stdout.write(`pending_review: ${rows.length} đơn (đơn MMP: ${eligible.length})\n`);
  const num = (v: string | null) => (v == null ? null : Number(v));

  for (const r of eligible) {
    process.stdout.write(`  ${r.code} · est=${r.carrierCostVnd} bill=${r.actualCarrierCostVnd} delta=${r.deltaVnd}\n`);
    if (!dryRun) {
      await emitShipHoEvent(
        { id: r.id, code: r.code, source: r.source, mmpRef: r.mmpRef },
        'order.reconcile_pending',
        { estimatedCostVnd: num(r.carrierCostVnd), billedCostVnd: num(r.actualCarrierCostVnd), deltaVnd: num(r.deltaVnd) },
      );
    }
  }
  process.stdout.write(`${dryRun ? 'DRY-RUN — chưa gửi.' : 'XONG — đã emit (kiểm outbox delivery_status).'}\n`);
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); });
