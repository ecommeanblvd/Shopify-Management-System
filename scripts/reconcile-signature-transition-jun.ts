/**
 * Dọn cờ "signature lệch" cho các đơn FedEx CHUYỂN TIẾP (ship 03–11/06/2026):
 * từ 3/6 quy ước always (auto cộng ký nhận), nhưng các đơn này thực tế chưa
 * tick dịch vụ nên FedEx KHÔNG thu — FedEx tính ĐÚNG. Mark 'reconciled' để hết
 * lệch giả. KHÔNG đụng đơn sau 11/6 (vẫn giữ cờ nhắc nếu quên tick).
 *
 * Điều kiện: carrier=fedex, ship ≤ 2026-06-11, diagnosis signature=KHONG_KHOP,
 * billedSignature rỗng, engine có cộng addon (engineAddons>0).
 *
 * Idempotent. Dry-run mặc định; --apply mới ghi.
 *   pnpm exec dotenv -- tsx scripts/reconcile-signature-transition-jun.ts [--apply]
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { reconcileShipments } from '@/features/shipments/reconcile';

const BOUND = new Date('2026-06-11T23:59:59');
const NOTE = 'FedEx đúng — đơn chuyển tiếp 03–11/06 chưa tick ký nhận (trước khi always áp dụng đủ). Không đòi NCC.';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sum = await reconcileShipments({ carrierKey: 'fedex', topN: 10_000 });

  const targets = sum.rows.filter((r) => {
    const sig = r.diagnosis?.components.find((c) => c.key === 'signature');
    return sig?.cause === 'KHONG_KHOP'
      && (r.billedSignature ?? 0) === 0
      && (r.engineAddons ?? 0) > 0
      && r.labelDate !== null && r.labelDate <= BOUND;
  });

  console.log(`Đơn chuyển tiếp cần mark reconciled: ${targets.length}`);
  for (const r of targets) {
    console.log(`  ${r.orderNumber}\t${r.shipCountry}\t${r.labelDate?.toISOString().slice(0, 10)}\tΔ=${r.deltaVnd}`);
  }

  if (!apply) { console.log('\n[DRY-RUN] Thêm --apply để ghi.'); process.exit(0); }

  let n = 0;
  for (const r of targets) {
    await db.insert(schema.shipmentReconcileStatus)
      .values({
        shipmentId: r.shipmentId, status: 'reconciled', note: NOTE,
        billedTotalAtReview: r.billedTotal.toString(),
        carrierErrorKind: null, deltaVndAtReview: null, reconciledBy: 'system:sig-transition',
      })
      .onConflictDoUpdate({
        target: schema.shipmentReconcileStatus.shipmentId,
        set: { status: 'reconciled', note: NOTE, billedTotalAtReview: r.billedTotal.toString(),
          carrierErrorKind: null, deltaVndAtReview: null, reconciledBy: 'system:sig-transition', reconciledAt: sql`now()` },
      });
    n += 1;
  }
  console.log(`\n✓ Đã mark ${n} đơn = reconciled.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
