import 'dotenv/config';
import { and, eq, like } from 'drizzle-orm';
import { db, schema } from '@/db/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const accounts = await db.select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, 'fedex'), eq(schema.carrierAccounts.enabled, true)));
  if (accounts.length === 0) throw new Error('no enabled FedEx account');
  let totalRows = 0;
  for (const acc of accounts) {
    const rows = await db.select({ id: schema.carrierSurcharges.id, applyMode: schema.carrierSurcharges.applyMode, note: schema.carrierSurcharges.note })
      .from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, acc.id),
        eq(schema.carrierSurcharges.kind, 'addon_fixed'),
        like(schema.carrierSurcharges.note, 'Direct Signature — always%'),
      ));
    console.log(`[${acc.name}] Tìm ${rows.length} dòng DS 'always':`, rows.map((r) => r.note?.slice(0, 40)));
    totalRows += rows.length;
    if (!apply) continue;
    for (const r of rows) {
      await db.update(schema.carrierSurcharges).set({ applyMode: 'when_billed' }).where(eq(schema.carrierSurcharges.id, r.id));
    }
  }
  if (!apply) { console.log('DRY-RUN — chạy lại với --apply.'); return; }
  console.log(`✓ Đổi ${totalRows} dòng → when_billed.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
