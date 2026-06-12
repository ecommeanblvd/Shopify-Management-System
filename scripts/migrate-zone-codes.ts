/**
 * Đổi tên zone ship trong `market_store_overrides.shipping` sang MÃ NGẮN của mình
 * (ME1, US1, SE1… — 2 chữ market + số), nhét tên mô tả gốc vào `zone.label`
 * (chỉ nội bộ, KHÔNG đẩy Shopify). Idempotent: chạy lại không mất label gốc.
 *
 * Dry-run mặc định (in old→new từng zone). `--apply` để ghi (bump version).
 * KHÔNG đẩy Shopify — đó là bước apply riêng do operator chủ động.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { MarketShipping } from '@/features/markets/types';
import { buildMarketCodes, applyZoneCodes } from '@/features/markets/domain/shipping-matrix-view';

async function main() {
  const apply = process.argv.includes('--apply');
  const stores = await db.select().from(schema.stores);

  for (const store of stores) {
    const rows = await db.select().from(schema.marketStoreOverrides)
      .where(eq(schema.marketStoreOverrides.storeId, store.id));
    const withShipping = rows.filter((r) => r.shipping && (r.shipping as MarketShipping).zones);
    if (withShipping.length === 0) continue;

    const codes = buildMarketCodes(withShipping.map((r) => r.marketHandle));
    console.log(`\n=== store ${store.name} (${withShipping.length} market có ship) ===`);

    for (const row of withShipping) {
      const code = codes[row.marketHandle];
      const before = row.shipping as MarketShipping;
      const after = applyZoneCodes(before, code);
      const oldKeys = Object.keys(before.zones);
      const newKeys = Object.keys(after.zones);
      console.log(`  [${code}] ${row.marketHandle}:`);
      oldKeys.forEach((ok, i) => console.log(`      ${ok}  →  ${newKeys[i]}   (label: ${after.zones[newKeys[i]].label})`));

      if (apply) {
        await db.update(schema.marketStoreOverrides).set({
          shipping: after,
          version: row.version + 1,
          updatedAt: new Date(),
        }).where(and(
          eq(schema.marketStoreOverrides.storeId, row.storeId),
          eq(schema.marketStoreOverrides.marketHandle, row.marketHandle),
        ));
        console.log('      [written]');
      }
    }
  }
  console.log(apply ? '\n✅ Đã ghi DB (chưa đẩy Shopify — apply trang /f/functions/manual-shipping-rates khi sẵn sàng).' : '\n(dry-run — thêm --apply để ghi.)');
  process.exit(0);
}
main();
