import { inArray, isNull, and, eq } from 'drizzle-orm';
import { db, schema } from './db/client';
import { fetchOrderByGid } from './features/shopify-orders/sync/fetch-order';
import { upsertOrder } from './features/shopify-orders/sync/upsert-order';

(async () => {
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores).where(inArray(schema.stores.name, ['tinhatelier', 'mirermirer-official']));
  let done = 0, filled = 0, errs = 0;
  for (const st of stores) {
    const rows = await db.select({ id: schema.shopifyOrders.id, gid: schema.shopifyOrders.shopifyOrderId })
      .from(schema.shopifyOrders)
      .where(and(eq(schema.shopifyOrders.storeId, st.id), isNull(schema.shopifyOrders.transactionFee)));
    console.log(st.name, 'thiếu fee:', rows.length);
    for (const r of rows) {
      try {
        const gid = r.gid.startsWith('gid://') ? r.gid : `gid://shopify/Order/${r.gid}`;
        const payload = await fetchOrderByGid(st.id, gid);
        if (payload) { await upsertOrder(st.id, payload, 'backfill'); }
        done++;
        if (done % 100 === 0) console.log('progress', done);
        await new Promise((res) => setTimeout(res, 220));
      } catch (e) {
        errs++; if (errs <= 5) console.error('ERR', r.gid, e instanceof Error ? e.message : e);
        await new Promise((res) => setTimeout(res, 1200));
      }
    }
  }
  const chk = await db.execute((await import('drizzle-orm')).sql`
    SELECT s.name, COUNT(*) AS total, COUNT(o.transaction_fee) AS co_fee
    FROM shopify_orders o JOIN stores s ON s.id = o.store_id
    WHERE s.name IN ('tinhatelier','mirermirer-official') GROUP BY 1`);
  console.log('DONE', { done, errs }, JSON.stringify(chk.rows));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
