/**
 * Vá phạm vi nước cho phụ phí Demand DHL.
 *
 * Engine chỉ áp demand cho nước nằm trong `country_codes`. DHL đã tính demand
 * cho một số nước CHƯA có trong list → 12 đơn (776.500 ₫) bị bỏ sót. Theo
 * hoá đơn: NL/ES/NO/BE/HU = Europe (32.000/kg), KR/CN = Asia (3.000/kg).
 * (PE/LAC xử riêng — chưa rõ rate.)
 *
 * Idempotent: merge vào list hiện có, khử trùng. Match dòng theo `value` để
 * không phụ thuộc id. Update qua Drizzle → updated_at bump → reconcile cache
 * tự tính lại.
 *
 *   pnpm exec dotenv -- tsx scripts/fix-dhl-demand-countries.ts [--apply]
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const DHL = '67c5b5eb-ae96-4260-990b-8dd1126f3166';

/** value (VND/kg) → các nước cần thêm. */
const ADD: Record<string, string[]> = {
  '32000.0000': ['NL', 'ES', 'NO', 'BE', 'HU'], // Europe
  '3000.0000': ['KR', 'CN'], // Asia
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    id: schema.carrierSurcharges.id,
    value: schema.carrierSurcharges.value,
    cc: schema.carrierSurcharges.countryCodes,
  }).from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.carrierAccountId, DHL), eq(schema.carrierSurcharges.kind, 'demand_per_kg')));

  for (const r of rows) {
    const add = ADD[r.value];
    if (!add) continue;
    const cur = new Set<string>((r.cc as string[]) ?? []);
    const before = cur.size;
    for (const c of add) cur.add(c);
    const merged = [...cur];
    const newOnes = add.filter((c) => !((r.cc as string[]) ?? []).includes(c));
    console.log(`value=${r.value}: ${before} → ${merged.length} nước (thêm: ${newOnes.join(', ') || '—'})`);
    if (apply && newOnes.length > 0) {
      await db.update(schema.carrierSurcharges)
        .set({ countryCodes: merged })
        .where(eq(schema.carrierSurcharges.id, r.id));
    }
  }

  console.log(apply ? '\n✓ Đã cập nhật (updated_at bump → cache reconcile tự tính lại).' : '\n[DRY-RUN] Thêm --apply để ghi.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
