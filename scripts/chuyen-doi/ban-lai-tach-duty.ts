/** Khi bật MMP_TACH_DUTY=1: bắn lại order.reconciled (cước riêng + dutyVnd + shippedAt) và order.duty_charged.
 *  Chạy: MMP_TACH_DUTY=1 railway run --service Shopify-Management-System npx tsx scripts/chuyen-doi/ban-lai-tach-duty.ts [--dry]
 *
 *  HAI VÒNG RIÊNG — phạm vi khác nhau:
 *   (1) order.reconciled: chỉ đơn ĐÃ gửi MMP giá gộp duty (có event order.reconciled delivered)
 *       và đã reconciled — bắn lại để MMP thay con số cũ bằng cước-không-duty.
 *   (2) order.duty_charged: MỌI đơn có actual_duty_vnd > 0, KHÔNG đòi đã reconciled và KHÔNG
 *       đòi đã có order.reconciled. Lý do: trong lúc công tắc còn TẮT, ghiDutyChoDon ghi cột
 *       duty nhưng KHÔNG bắn event (batTachDuty() false) và đánh dấu số hoá đơn vào
 *       duty_bill_numbers — lần cron sau coi là "không có hoá đơn mới" nên không bao giờ bắn
 *       nữa. Đơn nào chỉ mới có bill thuế (bill cước chưa về, dutyOnly) lại không lọt vòng (1)
 *       → duty của nó sẽ vĩnh viễn không tới MMP nếu script không phủ. Truyền
 *       actualDutyVnd: null + dutyBillNumbers: [] để mọi hoá đơn được coi là mới và bắn lại.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { banGiaCuoiNeuDoi } from '@/features/ship-ho/final-charge-emit';
import { giaCuoiVaDelta, batTachDuty } from '@/features/ship-ho/gia-cuoi-mmp';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';

const DRY = process.argv.includes('--dry');
async function main() {
  if (!batTachDuty()) { console.log('MMP_TACH_DUTY chưa = 1 — dừng.'); return process.exit(1); }

  // ── Vòng 1: bắn lại order.reconciled cho đơn đã gửi MMP kiểu gộp.
  const { rows } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; tracking_number: string | null; shipped_at: string | null; charged_vnd: string | null; actual_charged_vnd: string; actual_duty_vnd: string; reconcile_decision: string | null }>(sql`
    SELECT o.id, o.code, o.source, o.mmp_ref, o.tracking_number, o.shipped_at::text, o.charged_vnd, o.actual_charged_vnd, o.actual_duty_vnd, o.reconcile_decision
      FROM ship_ho_orders o
     WHERE o.actual_duty_vnd > 0 AND o.reconcile_status = 'reconciled'
       AND EXISTS (SELECT 1 FROM ship_ho_order_events e WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered')`);

  // ── Vòng 2: bắn order.duty_charged cho MỌI đơn có duty (không phụ thuộc đối soát cước).
  const { rows: donDuty } = await db.execute<{ id: string; code: string; source: string; mmp_ref: string | null; tracking_number: string | null; shipped_at: string | null }>(sql`
    SELECT o.id, o.code, o.source, o.mmp_ref, o.tracking_number, o.shipped_at::text
      FROM ship_ho_orders o
     WHERE o.actual_duty_vnd > 0`);

  console.log(`Đơn bắn lại order.reconciled: ${rows.length}${DRY ? ' (dry)' : ''}`);
  console.log(`Đơn bắn order.duty_charged: ${donDuty.length}${DRY ? ' (dry)' : ''}`);
  if (DRY) return process.exit(0);

  let ban = 0;
  for (const r of rows) {
    const cuoc = Number(r.actual_charged_vnd), duty = Number(r.actual_duty_vnd), quoted = r.charged_vnd == null ? null : Number(r.charged_vnd);
    const kl = r.reconcile_decision === 'accepted' ? 'internal_error' : (r.reconcile_decision === 'claim_credited' || r.reconcile_decision === 'claim_rejected') ? r.reconcile_decision : null;
    const gia = giaCuoiVaDelta({ cuocThucVnd: cuoc, giaBaoVnd: quoted, dutyVnd: duty, shippedAt: r.shipped_at });
    if (!gia) continue;
    const ok = await banGiaCuoiNeuDoi({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref },
      { ...gia, ...(kl ? { reconcileResolution: kl } : {}) });
    if (ok) ban++;
  }
  console.log(`order.reconciled bắn lại: ${ban}/${rows.length}`);

  let banDuty = 0;
  for (const r of donDuty) {
    // Xoá dấu "đã cộng" để ghiDutyChoDon coi mọi hoá đơn là mới và bắn từng cái.
    const kq = await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: [] });
    if (kq.daGhi) banDuty++;
  }
  console.log(`order.duty_charged bắn cho: ${banDuty}/${donDuty.length} đơn`);
  process.exit(0);
}
main();
