/**
 * FedEx Direct Signature: lịch sử = when_billed (khớp bill thực tế, gồm cả
 * window 11/5→2/6/2026 không tick dịch vụ), từ 3/6/2026 = always (auto áp
 * mọi đơn để khỏi mất phí). Giữ miễn 13 nước FedEx không thu.
 *
 * Cơ chế engine sẵn có (apply_mode + cửa sổ ngày) → chỉ sửa data:
 *  - Mọi dòng addon_fixed FedEx → apply_mode='when_billed'.
 *  - Dòng mở (endsAt=null) bị cắt endsAt=2026-06-03.
 *  - Thêm dòng 92.700, 2026-06-03→∞, apply_mode='always', copy excluded 13 nước.
 *
 * Idempotent. Mặc định dry-run; --apply mới ghi.
 *   pnpm exec dotenv -- tsx scripts/fedex-signature-always-from-jun3.ts [--apply]
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const CUTOFF = new Date('2026-06-03');

function d(x: Date | null): string { return x ? x.toISOString().slice(0, 10) : '∞'; }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await db.select()
    .from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.carrierAccountId, FEDEX), eq(schema.carrierSurcharges.kind, 'addon_fixed')));

  console.log(`FedEx addon_fixed (Direct Signature): ${rows.length} dòng`);
  for (const r of rows) console.log(`  ${d(r.startsAt)}→${d(r.endsAt)}  ${r.value}  apply=${r.applyMode}  excl=${Array.isArray(r.excludedCountryCodes) ? (r.excludedCountryCodes as string[]).length : 0}`);

  const openRow = rows.find((r) => r.endsAt === null);
  if (!openRow) { console.log('\n⚠ Không thấy dòng mở (endsAt=null) — dừng.'); process.exit(1); }

  const alreadyHasAlways = rows.some((r) => r.applyMode === 'always' && r.startsAt && r.startsAt.getTime() === CUTOFF.getTime());

  console.log('\nDự kiến:');
  console.log(`  - ${rows.length} dòng lịch sử → when_billed`);
  console.log(`  - dòng mở (${d(openRow.startsAt)}→∞) cắt endsAt=${d(CUTOFF)}`);
  console.log(`  - thêm dòng ${openRow.value}, ${d(CUTOFF)}→∞, always, excl=${Array.isArray(openRow.excludedCountryCodes) ? (openRow.excludedCountryCodes as string[]).length : 0}${alreadyHasAlways ? ' (ĐÃ CÓ — bỏ qua)' : ''}`);

  if (!apply) { console.log('\n[DRY-RUN] Thêm --apply để ghi.'); process.exit(0); }

  // 1. Tất cả dòng lịch sử → when_billed; dòng mở thêm endsAt=CUTOFF.
  for (const r of rows) {
    await db.update(schema.carrierSurcharges)
      .set({ applyMode: 'when_billed', ...(r.id === openRow.id ? { endsAt: CUTOFF } : {}) })
      .where(eq(schema.carrierSurcharges.id, r.id));
  }

  // 2. Dòng always tương lai (idempotent).
  if (!alreadyHasAlways) {
    await db.insert(schema.carrierSurcharges).values({
      carrierAccountId: FEDEX,
      kind: 'addon_fixed',
      value: openRow.value,
      applyMode: 'always',
      startsAt: CUTOFF,
      endsAt: null,
      excludedCountryCodes: openRow.excludedCountryCodes,
      fuelable: openRow.fuelable,
      active: true,
      note: 'Direct Signature — always từ 03/06/2026 (auto áp mọi đơn), miễn 13 nước',
    });
  }

  console.log('\n✓ Đã cập nhật (updated_at bump → cache reconcile tự tính lại).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
