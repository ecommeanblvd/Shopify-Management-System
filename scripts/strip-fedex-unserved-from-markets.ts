/**
 * Gỡ các nước FedEx KHÔNG phục vụ khỏi danh sách nước của market (vì đã chọn
 * FedEx-only + bỏ ship các nước này). Tránh tạo zone "FedEx —" rỗng khi push.
 * Các nước này sẽ không còn zone nào → khách ở đó không checkout được (đúng ý
 * "bỏ ship 43 nước").
 *
 *   railway run -- npx tsx scripts/strip-fedex-unserved-from-markets.ts [--apply]
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';

async function main() {
  const apply = process.argv.includes('--apply');
  const fedex = await loadAccountSnapshot(FEDEX);
  if (!fedex) throw new Error('no FedEx snapshot');
  const markets = await db.select().from(schema.marketTemplates);

  let totalStripped = 0;
  for (const m of markets) {
    const countries = m.countries as string[];
    const kept = countries.filter((c) => fedex.zonesByCountry.get(c));
    const removed = countries.filter((c) => !fedex.zonesByCountry.get(c));
    if (removed.length === 0) continue;
    totalStripped += removed.length;
    console.log(`${m.handle}: bỏ ${removed.length} nước [${removed.join(',')}] → còn ${kept.length}`);
    if (apply) {
      await db.update(schema.marketTemplates).set({ countries: kept, updatedAt: new Date() })
        .where(eq(schema.marketTemplates.handle, m.handle));
    }
  }
  console.log(`\nTổng bỏ: ${totalStripped} (nước FedEx không phục vụ).`);
  console.log(apply ? '✓ Đã cập nhật market.' : '[DRY-RUN] thêm --apply để ghi.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
