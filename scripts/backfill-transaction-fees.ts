/**
 * Backfill transaction_fee cho đơn Shopify đã sync trước khi có cột này.
 * Fetch transactions per-order từ Shopify → deriveTxnFee → update 3 cột.
 * Chạy: npx dotenv -- tsx scripts/backfill-transaction-fees.ts [--dry] [--store <domain>]
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { getStoreToken, graphqlCall } from '../lib/shopify/client';
import { deriveTxnFee, type ShopifyTxn } from '../features/shopify-orders/derive-txn-fee';

const DRY = process.argv.includes('--dry');
const storeArg = (() => { const i = process.argv.indexOf('--store'); return i >= 0 ? process.argv[i + 1] : null; })();
const API = process.env.SHOPIFY_API_VERSION ?? '2025-01';
const Q = `query($id: ID!){ order(id:$id){ currencyCode transactions(first:20){ kind status amountSet{ shopMoney{ amount currencyCode } } fees{ amount{ amount currencyCode } rate type flatFee{ amount } } } } }`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stores = await db.select().from(schema.stores);
  let updated = 0, noFee = 0, skipped = 0;
  for (const store of stores) {
    if (storeArg && store.shopDomain !== storeArg) continue;
    const token = await getStoreToken(store.id);
    const orders = await db
      .select({ id: schema.shopifyOrders.id, gid: schema.shopifyOrders.shopifyOrderId, cur: schema.shopifyOrders.currency })
      .from(schema.shopifyOrders)
      .where(and(eq(schema.shopifyOrders.storeId, store.id), isNull(schema.shopifyOrders.transactionFee)));
    console.log(`${store.shopDomain}: ${orders.length} đơn cần backfill`);
    for (const o of orders) {
      let res;
      try { res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: API, token, query: Q, variables: { id: o.gid } }); }
      catch { skipped++; await sleep(2000); continue; } // backoff khi 429/lỗi mạng
      if (res.errors) { skipped++; console.warn(`  [errors] ${o.gid}: ${JSON.stringify(res.errors).slice(0, 160)}`); await sleep(1000); continue; }
      const ord = (res.data as { order?: { currencyCode: string; transactions: ShopifyTxn[] } } | null)?.order;
      if (!ord) { skipped++; continue; }
      const f = deriveTxnFee(ord.transactions ?? [], ord.currencyCode ?? o.cur);
      if (f.feeOrderCcy === null) { noFee++; await sleep(500); continue; }
      if (!DRY) {
        await db.update(schema.shopifyOrders).set({
          transactionFee: String(f.feeOrderCcy),
          transactionFeeNative: f.feeNative !== null ? String(f.feeNative) : null,
          transactionFeeNativeCurrency: f.feeNativeCurrency,
        }).where(eq(schema.shopifyOrders.id, o.id));
      }
      updated++;
      await sleep(500);
    }
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Xong: updated=${updated} noFee=${noFee} skipped=${skipped}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
