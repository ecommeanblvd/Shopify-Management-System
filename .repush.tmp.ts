import { inArray, eq } from 'drizzle-orm';
import { db, schema } from './db/client';
import { pushOrderToMmp } from './features/mmp/order-outbound';

(async () => {
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(inArray(schema.stores.name, ['tinhatelier', 'mirermirer-official']));
  let ok = 0, skipped = 0, err = 0, n = 0;
  const errors: Record<string, number> = {};
  for (const st of stores) {
    const rows = await db.select({ id: schema.shopifyOrders.id })
      .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.storeId, st.id));
    console.log(st.name, 'orders:', rows.length);
    for (const r of rows) {
      const res = await pushOrderToMmp(r.id, { force: true });
      if (res.ok && !res.skipped) ok++;
      else if (res.skipped) skipped++;
      else { err++; const k = res.error ?? '?'; errors[k] = (errors[k] ?? 0) + 1; }
      n++; if (n % 200 === 0) console.log('progress', n, { ok, skipped, err });
      await new Promise((res2) => setTimeout(res2, 120));
    }
  }
  console.log('DONE', { ok, skipped, err }, JSON.stringify(errors));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
