/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-surcharges`
 *
 * Kéo phụ phí công bố qua URL chính thức của hãng, gộp 1 lần chạy tuần:
 *   1. FUEL (FedEx + DHL) — auto-apply: refreshCarrierFuel cho mọi account
 *      fedex/dhl đang bật (fuel đổi theo TUẦN, cần cập nhật để engine tính đúng).
 *   2. DEMAND (FedEx) — alert-only: checkFedExDemandUpdates (ghi audit khi có kỳ
 *      mới; KHÔNG tự áp — việc áp vẫn duyệt tay).
 *   3. SURGE (UPS) — alert-only: kiemSurgeUps. Tờ tài liệu surge của UPS ghi USD/lb bản
 *      origin-US, còn UPS VN thu VND/kg với tỉ giá không suy ra được, nên bộ này chỉ bắt
 *      "tài liệu đã đổi chưa" (mức hoặc NGÀY HIỆU LỰC) rồi báo động. Xem surge-fetcher/.
 *
 * Peak / elevated-risk hiện chưa có web-fetcher (cấu hình tay) → không nằm ở đây.
 *
 * Lỗi từng phần được in rõ (KHÔNG nuốt) và set exit 1 để cron báo đỏ — tránh
 * fuel-fetch hỏng âm thầm làm engine dùng % cũ.
 *
 * Exit codes: 0 — mọi phần OK; 1 — có ít nhất 1 phần lỗi.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshCarrierFuel } from '@/features/carrier-rates/fuel-fetcher/apply';
import { checkFedExDemandUpdates } from '@/features/carrier-rates/demand-fetcher/alert';
import { kiemSurgeUps } from '@/features/carrier-rates/surge-fetcher/alert';
import { UPS_SURGE_PDF_URL } from '@/features/carrier-rates/surge-fetcher/ups';

import { chayCron } from '@/features/jobs/run';
async function refreshFuel(): Promise<number> {
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, carrierKey: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(inArray(schema.carriers.key, ['fedex', 'dhl']), eq(schema.carrierAccounts.enabled, true)));

  if (accounts.length === 0) {
    process.stdout.write('refresh-surcharges[fuel]: no enabled fedex/dhl accounts.\n');
    return 0;
  }
  let failures = 0;
  for (const a of accounts) {
    try {
      const r = await refreshCarrierFuel({ carrierAccountId: a.id, triggeredBy: null });
      const change = r.changed ? `${r.previousPercent ?? '∅'}% → ${r.newPercent}%` : `unchanged at ${r.newPercent}%`;
      process.stdout.write(`refresh-surcharges[fuel]: [${r.carrierKey}] ${a.name} — ${change}\n`);
    } catch (err) {
      failures += 1;
      process.stderr.write(`refresh-surcharges[fuel]: [${a.carrierKey ?? '?'}] ${a.name} — FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return failures;
}

async function refreshDemand(): Promise<number> {
  try {
    const r = await checkFedExDemandUpdates();
    process.stdout.write(`refresh-surcharges[demand]: checked ${r.checkedAt.toISOString()} — ${r.newPeriods.length} new period(s), ${r.parseErrors.length} parse error(s).\n`);
    for (const p of r.newPeriods) process.stdout.write(`  NEW demand: ${p.from} → ${p.to ?? 'open'} | ${p.url}\n`);
    for (const e of r.parseErrors) process.stderr.write(`  demand parse error: ${e.url} — ${e.error}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`refresh-surcharges[demand]: FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function checkUpsSurge(): Promise<number> {
  try {
    const r = await kiemSurgeUps();
    if (r.boQua) { process.stdout.write('refresh-surcharges[ups-surge]: không có tài khoản UPS đang bật — bỏ qua.\n'); return 0; }
    if (r.loi) { process.stderr.write(`refresh-surcharges[ups-surge]: FAILED: ${r.loi}\n`); return 1; }
    const vn = r.khoanLienQuanVn.map((k) => `$${k.tien}/${k.donVi} từ ${k.hieuLucTu ?? '?'}`).join(' · ') || 'không thấy dòng nào chạm tuyến VN';
    if (r.lanDau) {
      process.stdout.write(`refresh-surcharges[ups-surge]: lần kiểm ĐẦU — ghi dấu vết ${r.dauVetMoi} (tài liệu cập nhật ${r.capNhatNgay ?? '?'}) · ${vn}\n`);
    } else if (r.doi) {
      process.stdout.write(`refresh-surcharges[ups-surge]: ⚠️ TÀI LIỆU ĐÃ ĐỔI — ${r.dauVetCu} → ${r.dauVetMoi} (cập nhật ${r.capNhatNgay ?? '?'}) · ${vn}\n`);
      process.stdout.write(`  Mức VND/kg phải chốt theo hoá đơn, KHÔNG quy đổi từ USD. Đọc lại: ${UPS_SURGE_PDF_URL}\n`);
    } else {
      process.stdout.write(`refresh-surcharges[ups-surge]: không đổi (${r.dauVetMoi})\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`refresh-surcharges[ups-surge]: FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  // Chạy CẢ BA dù phần nào lỗi (không dừng giữa chừng).
  const fuelFailures = await refreshFuel();
  const demandFailures = await refreshDemand();
  const surgeFailures = await checkUpsSurge();
  if (fuelFailures + demandFailures + surgeFailures > 0) process.exitCode = 1;
}

chayCron('refresh-surcharges', main);
