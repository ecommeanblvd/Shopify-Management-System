/**
 * Rút các khiếu nại NCC đã hết hiệu lực (stale): đơn đang `disputing`
 * nhưng Δ hiện tại đã về ~0 (thường do bổ sung/sửa engine sau lúc duyệt,
 * ví dụ thêm phí Demand) → NCC thực ra tính đúng, không có gì để đòi.
 *
 * Chuyển các đơn đó về `reconciled` và ghi chú lý do rút (giữ lại note cũ).
 *
 *   # xem trước (không ghi DB):
 *   pnpm exec dotenv -- tsx scripts/withdraw-stale-disputes.ts
 *   # áp dụng:
 *   pnpm exec dotenv -- tsx scripts/withdraw-stale-disputes.ts --apply
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  reconcileShipmentsWithStatus,
  STALE_DISPUTE_TOLERANCE_VND,
} from '@/features/shipments/reconcile-view';

const MARKER = '[auto-rút stale]';

function vnd(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' ₫';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { rows } = await reconcileShipmentsWithStatus({ forceRecompute: true });

  const stale = rows.filter((r) => r.staleDispute);

  console.log(
    `Ngưỡng khớp: < ${vnd(STALE_DISPUTE_TOLERANCE_VND)} | Tìm thấy ${stale.length} khiếu nại đã về ~0\n`,
  );
  for (const r of stale) {
    console.log(
      `${r.orderNumber}\t${r.trackingNumber}\t${r.carrierKey}\t${r.shipCountry}` +
        `\tΔnay=${vnd(r.deltaVnd)}\tΔlúc-duyệt=${vnd(r.deltaVndAtReview)}\tkind=${r.carrierErrorKind ?? '-'}`,
    );
  }

  if (!apply) {
    console.log(`\n[DRY-RUN] Chưa ghi DB. Thêm --apply để rút ${stale.length} khiếu nại này.`);
    process.exit(0);
  }

  let changed = 0;
  for (const r of stale) {
    const reason =
      `${MARKER} ${new Date().toISOString().slice(0, 10)}: Δ hiện tại ${vnd(r.deltaVnd)} (≈0) — ` +
      `engine cập nhật sau lúc duyệt, NCC tính đúng, rút khiếu nại.`;
    const prev = r.note?.includes(MARKER) ? r.note : [r.note, reason].filter(Boolean).join(' | ');

    await db
      .update(schema.shipmentReconcileStatus)
      .set({
        status: 'reconciled',
        note: prev,
        reconciledBy: 'system:stale-dispute',
        reconciledAt: new Date(),
      })
      .where(eq(schema.shipmentReconcileStatus.shipmentId, r.shipmentId));
    changed += 1;
  }

  console.log(`\n✓ Đã rút ${changed} khiếu nại stale → trạng thái 'reconciled'.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
