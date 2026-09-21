/** Khi bật MMP_TACH_DUTY=1: bắn lại order.reconciled (cước riêng + dutyVnd + shippedAt) và order.duty_charged cho đơn đã gửi MMP kiểu gộp.
 *  Chạy: MMP_TACH_DUTY=1 railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/ban-lai-tach-duty.ts [--dry] */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { banGiaCuoiNeuDoi } from '@/features/ship-ho/final-charge-emit';
import { giaCuoiChoMmp, batTachDuty } from '@/features/ship-ho/gia-cuoi-mmp';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';

const DRY = process.argv.includes('--dry');
async function main() {
  if (!batTachDuty()) { console.log('MMP_TACH_DUTY chưa = 1 — dừng.'); return process.exit(1); }
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; tracking_number: string | null; shipped_at: string | null; charged_vnd: string | null; actual_charged_vnd: string; actual_duty_vnd: string; reconcile_decision: string | null; duty_bill_numbers: string[] | null }>(sql`
    SELECT o.id, o.code, o.source, o.mmp_ref, o.tracking_number, o.shipped_at::text, o.charged_vnd, o.actual_charged_vnd, o.actual_duty_vnd, o.reconcile_decision, o.duty_bill_numbers
      FROM ship_ho_orders o
     WHERE o.actual_duty_vnd > 0 AND o.reconcile_status = 'reconciled'
       AND EXISTS (SELECT 1 FROM ship_ho_order_events e WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered')`);
  console.log(`Đơn bắn lại: ${rows.length}${DRY ? ' (dry)' : ''}`);
  if (DRY) return process.exit(0);
  let ban = 0;
  for (const r of rows) {
    const cuoc = Number(r.actual_charged_vnd), duty = Number(r.actual_duty_vnd), quoted = r.charged_vnd == null ? null : Number(r.charged_vnd);
    const kl = r.reconcile_decision === 'accepted' ? 'internal_error' : (r.reconcile_decision === 'claim_credited' || r.reconcile_decision === 'claim_rejected') ? r.reconcile_decision : null;
    const ok = await banGiaCuoiNeuDoi({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref },
      { ...giaCuoiChoMmp({ cuocVnd: cuoc, dutyVnd: duty, shippedAt: r.shipped_at }), previousChargedVnd: quoted, deltaVnd: quoted == null ? null : cuoc - quoted, ...(kl ? { reconcileResolution: kl } : {}) });
    if (ok) ban++;
    // duty_charged: xoá dấu "đã cộng" để ghiDutyChoDon coi mọi hoá đơn là mới và bắn từng cái.
    await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: [] });
  }
  console.log(`order.reconciled bắn lại: ${ban}/${rows.length}`);
  process.exit(0);
}
main();
