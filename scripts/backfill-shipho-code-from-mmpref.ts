import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { planCodeBackfill } from '@/features/ship-ho/backfill-code';

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    mmpRef: schema.shipHoOrders.mmpRef, source: schema.shipHoOrders.source,
  }).from(schema.shipHoOrders);
  const plan = planCodeBackfill(rows);
  console.log(`updates: ${plan.updates.length}, collisions: ${plan.collisions.length}`);
  for (const c of plan.collisions) console.log(`  ⚠ collision id=${c.id} mmpRef=${c.mmpRef} (bỏ qua)`);
  for (const u of plan.updates) console.log(`  ${u.from} → ${u.to}`);
  if (!apply) { console.log('DRY-RUN — chạy lại với --apply.'); return; }
  for (const u of plan.updates) {
    await db.update(schema.shipHoOrders).set({ code: u.to }).where(eq(schema.shipHoOrders.id, u.id));
  }
  console.log(`✓ Đổi ${plan.updates.length} code.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
