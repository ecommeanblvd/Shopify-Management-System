/**
 * Tách dòng GoGreen DHL 2025 thành 2 giai đoạn:
 *   2025-01-01 → 2025-09-29 : stepFloorKg=2.0 (CŨ — <2kg phẳng 1.900, từ 2kg nhảy)
 *   2025-09-29 → 2026-01-01 : stepFloorKg=null (MỚI — nhảy bước mọi cân)
 * Dòng 2026 giữ nguyên (MỚI). Idempotent.
 * Chạy: dotenv -- tsx scripts/migrate-dhl-gogreen-stepfloor-2025.ts [--apply]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const SPLIT = new Date(Date.UTC(2025, 8, 29)); // 2025-09-29
const NEW_END = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01

async function main() {
  const apply = process.argv.includes('--apply');
  const acct = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const dhl = acct.find((a) => a.key === 'dhl');
  if (!dhl) throw new Error('Không tìm thấy DHL account.');

  const rows = await db
    .select()
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, dhl.id),
      eq(schema.carrierSurcharges.kind, 'per_step_fixed'),
    ));

  const already = rows.some((r) => r.endsAt && r.endsAt.getTime() === SPLIT.getTime());
  if (already) { console.log('ĐÃ tách (có dòng ends 2025-09-29). Bỏ qua.'); process.exit(0); }

  const orig = rows.find((r) =>
    r.startsAt && r.startsAt.getUTCFullYear() === 2025 &&
    r.endsAt && r.endsAt.getUTCFullYear() === 2026 && r.endsAt.getUTCMonth() === 0);
  if (!orig) { console.log('Không thấy dòng GoGreen 2025 (2025-01-01→2026-01-01). Bỏ qua.'); process.exit(0); }

  console.log('DHL account:', dhl.id);
  console.log('Dòng gốc 2025:', orig.id, '| value', orig.value, '| stepKg', orig.stepKg, '|', String(orig.startsAt).slice(0, 10), '→', String(orig.endsAt).slice(0, 10));
  console.log('SẼ:');
  console.log('  • rút dòng gốc về ends 2025-09-29 + stepFloorKg=2.0 (CŨ)');
  console.log('  • thêm dòng 2025-09-29 → 2026-01-01, stepFloorKg=null (MỚI)');

  if (!apply) { console.log('\n⚠ DRY RUN — chưa ghi. Chạy lại với --apply.'); process.exit(0); }

  await db.transaction(async (tx) => {
    await tx.update(schema.carrierSurcharges)
      .set({ endsAt: SPLIT, stepFloorKg: '2.000', note: 'GoGreen Plus (SAF) 1.900/0.5kg — CŨ: 0–1.5kg phẳng, từ 2kg nhảy (stepFloor 2.0). Đến 29/9/2025.' })
      .where(eq(schema.carrierSurcharges.id, orig.id));
    await tx.insert(schema.carrierSurcharges).values({
      carrierAccountId: dhl.id,
      kind: 'per_step_fixed',
      value: orig.value,
      stepKg: orig.stepKg,
      stepFloorKg: null,
      active: true,
      startsAt: SPLIT,
      endsAt: NEW_END,
      applyMode: 'always',
      note: 'GoGreen Plus (SAF) 1.900/0.5kg — MỚI: nhảy bước mọi cân từ 29/9/2025.',
    });
  });
  console.log('\n✅ ĐÃ tách config GoGreen DHL 2025.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
