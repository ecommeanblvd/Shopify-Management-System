/**
 * MỘT LẦN (spec 21/09 §7, migration lịch sử — KHÔNG chạy lại cho đơn mới): bóc duty ra
 * khỏi actual_charged_vnd của các đơn đã đối soát TRƯỚC 21/09/2026 (trước khi
 * `reconciledBrandCharge` — commit 2a48e120 — ngừng gộp duty vào chargedVnd), ghi
 * actual_duty_vnd + duty_bill_numbers; tính lại bảng kê nháp; gỡ bảng kê Kalisa
 * 03/07–12/08 (mốc quoted_at, luật gom cũ) để controller/CEO tạo lại T7/T8 loại freight
 * qua UI. Chạy: npx tsx --env-file=.env scripts/chuyen-doi/tach-duty.ts --dry
 * Chạy thật CẦN thêm --xac-nhan (thiếu cờ này → luôn chạy như --dry, không ghi gì).
 *
 * Lựa đơn — KHÔNG chỉ dựa vào "có duty trong breakdown" (sau 2a48e120, đơn mới đối
 * soát có `actual_bill_breakdown.duty` > 0 vẫn hợp lệ NHƯNG duty đã KHÔNG còn nằm
 * trong actual_charged_vnd — chọn nhầm sẽ trừ duty hai lần). Điều kiện chính xác:
 * `sell.chargedVnd` (giá đã lưu lúc đối soát) trừ tổng các thành phần KHÔNG-duty của
 * nó (base + transportSur + customsSur + fuel + processingExVat + vat) phải XẤP XỈ
 * (±1đ, sai số làm tròn) đúng bằng `breakdown.duty` — nghĩa là duty THỰC SỰ đã bị gộp
 * vào chargedVnd lúc lưu (công thức reconcile CŨ). Đơn đối soát theo công thức MỚI (duty
 * tách sẵn) cho hiệu số ≈ 0 ⇒ không khớp ⇒ tự động bị loại, không cần biết ngày đối soát.
 * Đánh dấu đã tách bằng actual_bill_breakdown.tachDuty = 'true' (giữ lại làm lớp phòng
 * thủ thứ hai — idempotent kép: chạy lại vẫn bỏ qua các đơn đã đánh dấu).
 *
 * Bất biến kiểm cuối: actual_charged_vnd(mới) + actual_duty_vnd(mới) = actual_charged_vnd(cũ)
 * trên từng đơn đã tách (giá trị cũ được giữ lại trong bộ nhớ trước khi UPDATE). UPDATE
 * cước dùng optimistic lock (WHERE actual_charged_vnd = giá trị đã đọc) — nếu có agent/route
 * khác ghi đè đúng lúc này, rowCount = 0 → đơn đó bị SKIP hoàn toàn (không gọi ghiDutyChoDon),
 * log lại, và tiến trình thoát mã 1 để không lẫn với một lần chạy sạch.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ghiDutyChoDon } from '@/features/ship-ho/duty';
import { tinhLaiTongBangKe } from '@/features/ship-ho/statement-core';

// `--dry` THẮNG `--xac-nhan`: truyền nhầm cả hai (copy lệnh cũ) thì phải chạy khô, không ghi.
const CO_DRY = process.argv.includes('--dry');
const XAC_NHAN = process.argv.includes('--xac-nhan') && !CO_DRY;
const DRY = !XAC_NHAN;
if (CO_DRY && process.argv.includes('--xac-nhan')) {
  console.log('Có cả --dry lẫn --xac-nhan → ưu tiên --dry (KHÔNG ghi gì).');
} else if (!CO_DRY && !XAC_NHAN) {
  console.log('Chưa truyền --xac-nhan → chạy chế độ --dry (KHÔNG ghi gì). Thêm --xac-nhan để ghi thật.');
}
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
       AND COALESCE(actual_bill_breakdown->>'tachDuty', '') <> 'true'
       AND ABS(
             (
               COALESCE((actual_bill_breakdown->'sell'->>'chargedVnd')::numeric, 0)
               - (
                   COALESCE((actual_bill_breakdown->'sell'->>'baseVnd')::numeric, 0)
                   + COALESCE((actual_bill_breakdown->'sell'->>'transportSurVnd')::numeric, 0)
                   + COALESCE((actual_bill_breakdown->'sell'->>'customsSurVnd')::numeric, 0)
                   + COALESCE((actual_bill_breakdown->'sell'->>'fuelVnd')::numeric, 0)
                   + COALESCE((actual_bill_breakdown->'sell'->>'processingExVatVnd')::numeric, 0)
                   + COALESCE((actual_bill_breakdown->'sell'->>'vatVnd')::numeric, 0)
                 )
             ) - COALESCE((actual_bill_breakdown->>'duty')::numeric, 0)
           ) <= 1`);
  console.log(`Đơn cần bóc duty: ${rows.length}${DRY ? ' (dry)' : ''}`);

  let tongDuty = 0;
  let boQua = 0;
  // Giữ cước TRƯỚC khi tách theo id, để kiểm bất biến sau khi ghi thật.
  const cuTruocTheoId = new Map<string, number>();
  for (const r of rows) {
    const cu = Number(r.actual_charged_vnd), duty = Math.round(Number(r.duty));
    const moi = cu - duty;
    console.log(`  ${r.code}: ${cu} → cước ${moi} + duty ${duty}`);
    if (DRY) { tongDuty += duty; continue; }
    const sell = r.sell ? { ...r.sell, chargedVnd: moi } : null;
    const sellJson = sell ? JSON.stringify(sell) : null;
    const upd = await db.execute(sql`UPDATE ship_ho_orders SET actual_charged_vnd = ${String(moi)},
      actual_bill_breakdown = jsonb_set(
        CASE WHEN ${sellJson}::jsonb IS NULL THEN actual_bill_breakdown ELSE jsonb_set(actual_bill_breakdown, '{sell}', ${sellJson}::jsonb) END,
        '{tachDuty}', 'true')
      WHERE id = ${r.id} AND actual_charged_vnd = ${r.actual_charged_vnd}`);
    if ((upd.rowCount ?? 0) === 0) {
      boQua++;
      console.log(`  SKIP ${r.code}: UPDATE khớp 0 dòng (cước đã bị ghi đè bởi tiến trình khác kể từ lúc đọc) — không ghi duty.`);
      continue;
    }
    tongDuty += duty;
    cuTruocTheoId.set(r.id, cu);
    // Ghi cột duty theo hoá đơn thật (công tắc MMP tắt → không bắn duty_charged ở bước này).
    await ghiDutyChoDon({ id: r.id, code: r.code, source: r.source, mmpRef: r.mmp_ref, trackingNumber: r.tracking_number, shippedAt: r.shipped_at, actualDutyVnd: null, dutyBillNumbers: null });
  }
  console.log(`Tổng duty bóc ra: ${tongDuty}`);
  if (boQua > 0) console.log(`Số đơn SKIP do UPDATE khớp 0 dòng: ${boQua}`);

  let coLoi = boQua > 0;
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
    if (lech > 0) coLoi = true;

    // Đối chiếu cột duty với breakdown (phải khớp trên toàn bộ đơn có duty, không riêng đợt này).
    const k = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ship_ho_orders WHERE actual_duty_vnd IS NOT NULL AND (actual_bill_breakdown->>'duty')::numeric <> actual_duty_vnd`);
    console.log('Đơn duty cột ≠ duty breakdown (phải 0):', k.rows[0].n);

    // Bảng kê Kalisa cũ (mốc quoted_at) → gỡ đơn, xoá, tạo lại T7/T8 freight qua UI (controller/CEO, Task 9 bước 2) để có đúng luật gom.
    await db.execute(sql`UPDATE ship_ho_orders SET statement_id = NULL, status = CASE WHEN status = 'billed' THEN 'shipped' ELSE status END WHERE statement_id = ${KE_KALISA_CU}`);
    await db.execute(sql`DELETE FROM ship_ho_statements WHERE id = ${KE_KALISA_CU} AND status = 'draft'`);
    const drafts = await db.execute<{ id: string }>(sql`SELECT id FROM ship_ho_statements WHERE status = 'draft'`);
    for (const d of drafts.rows) console.log('tính lại nháp', d.id, await tinhLaiTongBangKe(d.id));
  }
  process.exit(coLoi ? 1 : 0);
}
main();
