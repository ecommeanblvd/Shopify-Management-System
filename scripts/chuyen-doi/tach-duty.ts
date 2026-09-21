/**
 * Một lần (spec 21/09 §7): bóc duty ra khỏi actual_charged_vnd của các đơn đã đối soát,
 * ghi actual_duty_vnd + duty_bill_numbers; tính lại bảng kê nháp; gỡ bảng kê Kalisa
 * 03/07–12/08 (mốc quoted_at, luật gom cũ) để controller/CEO tạo lại T7/T8 loại freight
 * qua UI. Chạy: npx tsx --env-file=.env scripts/chuyen-doi/tach-duty.ts [--dry]
 *
 * Lựa đơn: Task 4 (cron) đã ghi actual_duty_vnd cho phần lớn đơn có duty trong bill —
 * nên lọc theo `actual_duty_vnd IS NULL` như spec gốc sẽ ra ~0 dòng. Ở ĐÂY lọc theo
 * đơn mà cột cước (actual_charged_vnd) VẪN CÒN gộp duty trong nó (chưa tách):
 *   actual_bill_breakdown->>'duty' > 0 AND actual_charged_vnd >= duty + 1.
 * Đánh dấu đã tách bằng actual_bill_breakdown.tachDuty = true (idempotent — chạy lại
 * bỏ qua các đơn đã đánh dấu).
 *
 * Bất biến kiểm cuối: actual_charged_vnd(mới) + actual_duty_vnd(mới) = actual_charged_vnd(cũ)
 * trên từng đơn đã tách (giá trị cũ được giữ lại trong bộ nhớ trước khi UPDATE).
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';
import { tinhLaiTongBangKe } from '@/features/ship-ho/statement-core';

const DRY = process.argv.includes('--dry');
const KE_KALISA_CU = '0dcc5f5c-8653-4c75-b6ca-17df243c0135';

async function main() {
  const { rows } = await db.execute<{
    id: string; code: string; source: string; mmp_ref: string | null;
    tracking_number: string | null; shipped_at: string | null;
    actual_charged_vnd: string; duty: string; sell: Record<string, number> | null;
  }>(sql`
    SELECT id, code, source, mmp_ref, tracking_number, shipped_at::text, actual_charged_vnd,
           (actual_bill_breakdown->>'duty') AS duty, actual_bill_breakdown->'sell' AS sell
      FROM ship_ho_orders
     WHERE (actual_bill_breakdown->>'duty')::numeric > 0
       AND actual_charged_vnd IS NOT NULL
       AND actual_charged_vnd >= (actual_bill_breakdown->>'duty')::numeric + 1
       AND COALESCE(actual_bill_breakdown->>'tachDuty', '') <> 'true'`);
  console.log(`Đơn cần bóc duty: ${rows.length}${DRY ? ' (dry)' : ''}`);

  let tongDuty = 0;
  // Giữ cước TRƯỚC khi tách theo id, để kiểm bất biến sau khi ghi thật.
  const cuTruocTheoId = new Map<string, number>();
  for (const r of rows) {
    const cu = Number(r.actual_charged_vnd), duty = Math.round(Number(r.duty));
    if (duty <= 0 || duty >= cu) { console.log(`  BỎ QUA ${r.code}: duty ${duty} bất thường so cước ${cu}`); continue; }
    const moi = cu - duty; tongDuty += duty;
    cuTruocTheoId.set(r.id, cu);
    console.log(`  ${r.code}: ${cu} → cước ${moi} + duty ${duty}`);
    if (DRY) continue;
    const sell = r.sell ? { ...r.sell, chargedVnd: moi } : null;
    await db.execute(sql`UPDATE ship_ho_orders SET actual_charged_vnd = ${String(moi)},
      actual_bill_breakdown = jsonb_set(
        CASE WHEN ${sell}::jsonb IS NULL THEN actual_bill_breakdown ELSE jsonb_set(actual_bill_breakdown, '{sell}', ${JSON.stringify(sell)}::jsonb) END,
        '{tachDuty}', 'true')
      WHERE id = ${r.id} AND actual_charged_vnd = ${r.actual_charged_vnd}`);
    // Ghi cột duty theo hoá đơn thật (công tắc MMP tắt → không bắn duty_charged ở bước này).
    await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: null });
  }
  console.log(`Tổng duty bóc ra: ${tongDuty}`);

  if (!DRY) {
    // Bất biến từng đơn: cước(mới) + duty(mới) = cước(cũ) trước khi tách.
    let lech = 0;
    for (const [id, cuCu] of cuTruocTheoId) {
      const { rows: sau } = await db.execute<{ actual_charged_vnd: string; actual_duty_vnd: string | null }>(sql`
        SELECT actual_charged_vnd, actual_duty_vnd FROM ship_ho_orders WHERE id = ${id}`);
      const tong = Number(sau[0].actual_charged_vnd) + Number(sau[0].actual_duty_vnd ?? 0);
      if (tong !== cuCu) { lech++; console.log(`  LỆCH bất biến ${id}: cước mới ${sau[0].actual_charged_vnd} + duty ${sau[0].actual_duty_vnd} = ${tong} ≠ cước cũ ${cuCu}`); }
    }
    console.log(`Bất biến (cước mới + duty mới = cước cũ) — số đơn lệch (phải 0): ${lech} / ${cuTruocTheoId.size}`);

    // Đối chiếu cột duty với breakdown (phải khớp trên toàn bộ đơn có duty, không riêng đợt này).
    const k = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ship_ho_orders WHERE actual_duty_vnd IS NOT NULL AND (actual_bill_breakdown->>'duty')::numeric <> actual_duty_vnd`);
    console.log('Đơn duty cột ≠ duty breakdown (phải 0):', k.rows[0].n);

    // Bảng kê Kalisa cũ (mốc quoted_at) → gỡ đơn, xoá, tạo lại T7/T8 freight qua UI (controller/CEO, Task 9 bước 2) để có đúng luật gom.
    await db.execute(sql`UPDATE ship_ho_orders SET statement_id = NULL, status = CASE WHEN status = 'billed' THEN 'shipped' ELSE status END WHERE statement_id = ${KE_KALISA_CU}`);
    await db.execute(sql`DELETE FROM ship_ho_statements WHERE id = ${KE_KALISA_CU} AND status = 'draft'`);
    const drafts = await db.execute<{ id: string }>(sql`SELECT id FROM ship_ho_statements WHERE status = 'draft'`);
    for (const d of drafts.rows) console.log('tính lại nháp', d.id, await tinhLaiTongBangKe(d.id));
  }
  process.exit(0);
}
main();
